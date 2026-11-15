/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // API_TARGET=https://... points the dev page at a deployed server (default: the local one).
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8000', changeOrigin: true },
    },
    fs: {
      // lets the app import ../contract (shared types + example replies)
      allow: ['..'],
    },
  },
  test: {
    environment: 'node',
  },
})
