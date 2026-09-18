import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    open: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
  plugins: [react()],
})
