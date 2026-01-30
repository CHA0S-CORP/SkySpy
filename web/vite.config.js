import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use environment variable for API target, default to localhost for local dev
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  base: '/static/',
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
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: apiTarget.replace('http', 'ws'),
        ws: true,
        changeOrigin: true,
        secure: false,
        // Ensure WebSocket upgrade headers are properly forwarded
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('WebSocket proxy error:', err.message);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('WebSocket proxying:', req.url);
          });
        },
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
  cacheDir: '/tmp/.vite',
})