import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use environment variable for API target, default to localhost for local dev
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/static': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget.replace('http', 'ws'),
        ws: true,
        rewriteWsOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
  cacheDir: '/tmp/.vite',
})