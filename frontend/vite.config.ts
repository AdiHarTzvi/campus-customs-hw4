import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward API and image requests to the FastAPI backend (backend/main.py).
    proxy: {
      // xfwd adds X-Forwarded-For so the backend can rate-limit guests per browser address.
      '/api': { target: 'http://127.0.0.1:8000', xfwd: true },
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
