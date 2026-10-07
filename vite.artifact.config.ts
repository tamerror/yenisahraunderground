import { defineConfig } from 'vite';

/** Single-chunk build used to publish the game as one self-contained HTML page. */
export default defineConfig({
  base: './',
  // the claude.ai artifact sandbox blocks the Google Maps script, so Street View is switched off there
  define: { 'import.meta.env.VITE_ARTIFACT': JSON.stringify('1') },
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    chunkSizeWarningLimit: 2000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
