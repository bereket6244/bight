import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  const pagesBuild = process.env.VITE_BIGHT_TARGET === 'web-demo';

  return {
    plugins: [react()],
    define: {
      __BIGHT_WEB_DEMO__: JSON.stringify(pagesBuild),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      // Capacitor loads the build from the filesystem, so relative asset URLs
      // are required. GitHub Pages instead serves the project beneath /bight/.
      assetsInlineLimit: 4096,
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
    base: pagesBuild ? '/bight/' : './',
  };
});
