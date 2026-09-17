import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxies /api calls to the backend so the frontend can just use relative
// paths in dev, matching how it would sit behind one domain in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
