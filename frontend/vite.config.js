import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use the same hosted API in local development and production so both URLs
// read and write the same Atlas-backed application data.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://swiftspace-api.onrender.com',
        changeOrigin: true,
      },
    },
  },
});
