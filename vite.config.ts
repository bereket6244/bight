import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Capacitor loads the build from the filesystem, so relative asset URLs
    // are required. Absolute "/assets/..." paths break inside the WebView.
    assetsInlineLimit: 4096,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  base: './',
});
