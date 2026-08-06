import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * The service worker, built separately from the app.
 *
 * It has to land at `dist/sw.js` — the site root, which is the only place a worker
 * can claim `/` as its scope — with a name that does not change, since browsers key
 * a registration on the URL. Vite's app build content-hashes every entry it emits, so
 * this is a second pass rather than a second input: `emptyOutDir: false` so it lands
 * beside the app's output instead of replacing it, which makes the order in
 * `package.json`'s `build` script load-bearing.
 *
 * IIFE rather than an ES module. Module workers are still not everywhere — Firefox
 * only recently — and nothing here needs `import` at runtime.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('src/sw/main.ts', import.meta.url)),
      output: {
        entryFileNames: 'sw.js',
        format: 'iife',
      },
    },
  },
})
