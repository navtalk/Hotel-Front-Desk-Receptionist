import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: mode === 'development' ? '/' : '/Hotel-Front-Desk-Receptionist/',
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
}))
