import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mock react-leaflet for tests (dependency used in EnhancedFlightMap but not installed for tests)
      'react-leaflet': path.resolve(__dirname, 'src/test/mocks/react-leaflet.jsx'),
      'leaflet/dist/leaflet.css': path.resolve(__dirname, 'src/test/mocks/empty.js'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{js,jsx}',
        'src/**/*.spec.{js,jsx}',
        'src/main.jsx',
      ],
      // Skip thresholds when no tests exist
      skipFull: true,
    },
  },
});
