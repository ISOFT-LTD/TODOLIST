import { defineConfig } from 'vitest/config';

// Tests run the plugin's modules directly in a DOM, without Module Federation:
// the federation plugin in vite.config.js is for building the remote only.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
  },
});
