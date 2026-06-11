import { defineConfig } from 'vitest/config';
import path from 'path';

// Phase 6 — unit tests for the pure mobile/offline logic (see IOS.md §8).
// jsdom gives us `window`/`localStorage` for the endpoint + notification helpers.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
