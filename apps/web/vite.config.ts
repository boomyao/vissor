import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite dev server is the user-facing entry on :9999; it proxies
// /api/* to the Fastify backend on :9998 so the client can use
// relative URLs and EventSource stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9999,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9998',
        changeOrigin: true,
        ws: false,
      },
    },
  },
})
