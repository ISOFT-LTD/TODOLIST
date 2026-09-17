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
  // every /api request to the FastAPI service. That lets the local development
  // SDK (src/dev-sdk.js) make same-origin calls with no backend URL hardcoded.
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8000',
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
