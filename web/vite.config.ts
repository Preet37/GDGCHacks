/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
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
