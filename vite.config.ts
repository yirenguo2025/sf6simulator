import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/sf6simulator/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
