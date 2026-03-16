import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'textures',
  server: {
    port: 8080,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: ['beyond-all-reason'],
    proxy: {
      '/api': 'http://127.0.0.1:8081',
      '/verification': 'http://127.0.0.1:8081',
    },
  },
  build: {
    outDir: 'dist',
  },
});
