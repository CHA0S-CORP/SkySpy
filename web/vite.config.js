import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
        target: 'http://host.docker.internal:5000',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
  // optimizeDeps: {
  //   force: true,
  // },
  cacheDir: '/tmp/.vite',
})