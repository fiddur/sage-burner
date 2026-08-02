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
    // Publishes the TypeScript at `/assets/*.map`, served publicly and
    // `immutable`. Kept deliberately: the licence is AGPL, so the source is
    // public whatever this setting says, and a stack trace from a member's
    // browser that names a real line is worth far more than the nothing this
    // would hide.
    sourcemap: true,
  },

  test: {
    environment: 'happy-dom',
    globals: false,
    // Pinned, and not to UTC on purpose. `datetime.ts` converts between UTC
    // instants and the browser's wall clock, and in UTC every wrong
    // implementation — slicing the ISO string, for one — is indistinguishable
    // from a right one. A fixed offset makes the difference fail.
    env: { TZ: 'Europe/Stockholm' },
  },
})
