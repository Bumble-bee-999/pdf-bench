import { defineConfig } from 'vite';

export default defineConfig({
  // './' keeps the build portable: GitHub Pages, a subfolder, or file:// after
  // serving locally. No absolute host assumptions anywhere.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib') || id.includes('fontkit')) return 'pdflib';
          if (id.includes('tesseract')) return 'ocr';
        },
      },
    },
  },
  worker: { format: 'es' },
});
