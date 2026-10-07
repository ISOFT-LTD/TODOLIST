import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';
import { parse } from 'yaml';

// The panel checks the remote's name, its entry file and its modules against the manifest Core
// serves, which is ../pulsar.yaml rendered. So they are read from there, and the build stops when
// pulsar.yaml names a module this file has no source for, or the other way round.
const manifestFile = fileURLToPath(new URL('../pulsar.yaml', import.meta.url));
const { ui } = parse(readFileSync(manifestFile, 'utf8'));

// Each module the panel can load, and its source.
const sources = {
  // The standalone pages: mount(el, { sdk, path }).
  './TodoApp': './src/todo-app.js',
  // Core extension contributions (pulsar.yaml, ui.contributions):
  // mount(el, context, sdk) returning { update, unmount }.
  './ComputerTodoAction': './src/extensions/computer-todo-action.js',
  './ComputerTodoTab': './src/extensions/computer-todo-tab.js',
};
const declared = [ui.remote.exposedModule, ...(ui.contributions ?? []).map((c) => c.exposedModule)];
const undeclared = Object.keys(sources).filter((name) => !declared.includes(name));
const missing = declared.filter((name) => !(name in sources));
if (missing.length || undeclared.length) {
  throw new Error(
    `${manifestFile} and vite.config.js disagree. No source for: ${missing.join(', ') || 'none'}. ` +
      `Not in pulsar.yaml: ${undeclared.join(', ') || 'none'}.`,
  );
}

export default defineConfig({
  // Relative asset URLs so the build works wherever it is served from:
  // the plugin container root, or behind the core at /plugins/todo/.
  base: './',

  plugins: [
    federation({
      name: ui.remote.remoteName,
      filename: ui.remote.entry,
      exposes: sources,
      // Vanilla JS: nothing to share with the React shell.
      shared: {},
      manifest: true,
      // Plain JS, no tsconfig - skip federated type generation.
      dts: false,
    }),
  ],

  // Dev-only proxy: the browser talks to the Vite server on :5173, which forwards
  // every /api request onward. The SDK (src/core-sdk.js) calls api/... relative
  // to the page, so the same code reaches the API through Cobalt Core in
  // production and through this proxy in development.
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // dev/fake_core.py: mints the token Core would, then calls the backend.
        // 127.0.0.1, not localhost: Node resolves localhost to ::1 first, and
        // the fake Core listens on IPv4.
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    // Module Federation's remote entry uses top-level await.
    target: 'esnext',
  },
});
