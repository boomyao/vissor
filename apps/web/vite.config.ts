import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web app talks to the Fastify backend on :9999. In dev we proxy
// /api/* straight through so the client can use relative URLs and the
// EventSource target stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: true,
        ws: false,
      },
    },
  },
})
