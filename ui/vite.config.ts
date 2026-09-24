import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Served on 127.0.0.1 (not localhost) so the session cookie set during
// the OAuth callback — which atproto requires on a loopback IP — applies.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // The play-along audio worklet must load from a real URL (Safari
    // won't take a data: URL), so never inline it.
    assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined),
  },
  worker: { format: 'es' },
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
