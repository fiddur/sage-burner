import preact from '@preact/preset-vite'
// From `vitest/config`, not `vite`: the plain Vite config type has no `test` key.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [preact()],

  server: {
    // The backend serves both halves in production, so the app always talks to
    // a same-origin `/api`. In development Vite stands in for that, which keeps
    // the client free of any base-url configuration and means no CORS anywhere.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },

  build: {
    sourcemap: true,
  },

  test: {
    environment: 'happy-dom',
    globals: false,
  },
})
