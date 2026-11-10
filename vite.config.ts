import { defineConfig } from 'vite';

// Production build: one self-contained script (code, styles and map data) that
// mounts the map on every [data-iran-map] element. scripts/finish-build.mjs
// then adds the licence banner and writes the single-file page for iframes.
export default defineConfig({
  build: {
    target: 'es2020',
    lib: {
      entry: 'src/embed.ts',
      formats: ['iife'],
      name: 'IranMapEmbed',
      fileName: () => 'iran-map.js',
    },
  },
});
