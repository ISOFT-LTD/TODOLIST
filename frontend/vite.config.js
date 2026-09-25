import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  // Relative asset URLs so the build works wherever it is served from:
  // the plugin container root, or behind the core at /plugins/todo/.
  base: './',

  plugins: [
    federation({
      name: 'todo_plugin',
      filename: 'remoteEntry.js',
      exposes: {
        './TodoApp': './src/todo-app.js',
      },
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
