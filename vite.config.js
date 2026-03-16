import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'textures',
  server: {
    port: 5173,
    allowedHosts: ['beyond-all-reason'],
    proxy: {
      '/api': 'http://localhost:8080',
      '/verification': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'vite-index.html'),
    },
  },
});
