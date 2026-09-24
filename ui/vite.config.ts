import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Served on 127.0.0.1 (not localhost) so the session cookie set during
// the OAuth callback — which atproto requires on a loopback IP — applies.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: '127.0.0.1',
    port: 3004,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8120',
      '/oauth': 'http://127.0.0.1:8120',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
