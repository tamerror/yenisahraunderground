import { defineConfig } from 'vite';

/** Single-chunk build used to publish the game as one self-contained HTML page. */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    chunkSizeWarningLimit: 2000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
