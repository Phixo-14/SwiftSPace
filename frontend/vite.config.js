import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep local development pointed at the local backend. Production uses VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
