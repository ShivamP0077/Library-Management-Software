import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 3001,
      open: !env.CI && !env.NO_OPEN,
      // In dev, /api is proxied to the local backend unless VITE_API_URL points elsewhere
      proxy: {
        '/api': { target: env.VITE_DEV_API_PROXY || 'http://localhost:4000', changeOrigin: true },
        '/health': { target: env.VITE_DEV_API_PROXY || 'http://localhost:4000', changeOrigin: true }
      }
    }
  };
});
