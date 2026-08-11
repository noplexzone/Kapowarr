import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chunkForModule } from './build-chunks';

function serviceWorkerVersionPlugin() {
  return {
    name: 'kapowarr-service-worker-version',
    writeBundle(options: { dir?: string }) {
      const outputDir = options.dir || 'dist';
      const index = readFileSync(resolve(outputDir, 'index.html'));
      const version = createHash('sha256').update(index).digest('hex').slice(0, 16);
      const workerPath = resolve(outputDir, 'sw.js');
      const worker = readFileSync(workerPath, 'utf8');
      writeFileSync(workerPath, worker.replace('__KAPOWARR_BUILD_VERSION__', version));
    },
  };
}

const KAPOWARR_PORT = process.env.KAPOWARR_PORT || '5656';

export default defineConfig({
  plugins: [react(), serviceWorkerVersionPlugin()],
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
