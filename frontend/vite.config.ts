import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { chunkForModule } from './build-chunks';

const KAPOWARR_PORT = process.env.KAPOWARR_PORT || '5656';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${KAPOWARR_PORT}`,
      '/api/socket.io': {
        target: `http://localhost:${KAPOWARR_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: chunkForModule,
      },
    },
  },
});
