import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// Use environment variable for API target, default to localhost for local dev
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000'

export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    mode === 'production' && visualizer({
      template: 'treemap',
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
  // Only use /static/ base for build, not for dev server
  base: command === 'build' ? '/static/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Vendor chunk: React core
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor'
            }
            // Radix UI chunk
            if (id.includes('@radix-ui')) {
              return 'radix'
            }
            // TanStack/React Query chunk
            if (id.includes('@tanstack')) {
              return 'query'
            }
            // Leaflet/map chunk
            if (id.includes('leaflet')) {
              return 'map'
            }
            // Framer Motion chunk
            if (id.includes('framer-motion')) {
              return 'motion'
            }
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // Socket.IO must be first and use regex to bypass base path check
      '^/socket.io': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Socket.IO proxy error:', err.message);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('Socket.IO WebSocket proxying:', req.url);
          });
        },
      },
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
}))