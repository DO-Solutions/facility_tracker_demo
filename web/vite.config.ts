import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // import.meta.dirname, not __dirname: Vite's native config loader is
              // becoming the default and does not provide the CJS globals.
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  build: {
    // Express serves this directory; keep it inside web/ so the server's
    // static middleware has one obvious place to look.
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `npm run dev` runs Vite and Express side by side. Everything the
    // server owns is proxied, so the browser only ever talks to :5173.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/complain': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
      '/qr.svg': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
