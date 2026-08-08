import { defineConfig } from 'vitest/config';
import path from 'path';

// Frontend unit + UI component tests (jsdom). Prefer `renderBkemo` from
// `src/test/render.tsx` for product UI under the `.bkemo` token scope.
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
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
