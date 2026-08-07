import { describe, expect, it } from 'vitest'

import { createConfig } from './config.ts'

describe('createConfig', () => {
  it('runs on an empty environment, bound to loopback', () => {
    const config = createConfig({})

    expect(config.node_env).toBe('development')
    expect(config.port).toBe(3000)
    // Loopback, not `0.0.0.0`. A bare `docker run` is unaffected — the image
    // sets HOST itself — so the only runs this default reaches are the ones
    // nobody documented, and those should not be on the LAN with the published
    // development signing key.
    expect(config.host).toBe('127.0.0.1')
    expect(config.database_url).toBe('./data/sage-burner.sqlite')
    expect(config.build_sha).toBe('unknown')
    expect(config.web_root).toBeUndefined()
  })

  it('reads the values it is given', () => {
    const config = createConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      DATABASE_URL: '/data/burn.sqlite',
      LOG_LEVEL: 'warn',
      BUILD_SHA: 'abc123',
      WEB_ROOT: '/usr/share/web',
      SESSION_SECRET: 'x'.repeat(40),
      SESSION_TTL_SECONDS: '3600',
    })

    expect(config).toEqual({
      node_env: 'production',
      port: 8080,
      host: '127.0.0.1',
      database_url: '/data/burn.sqlite',
      log_level: 'warn',
      build_sha: 'abc123',
      web_root: '/usr/share/web',
      trust_proxy: false,
      session_secret: 'x'.repeat(40),
      session_ttl_seconds: 3600,
      secure_cookies: true,
    })
  })

  describe('SESSION_SECRET', () => {
    it('refuses to build a production config without one', () => {
      // A random default generated at boot would look like it works and log
      // every member out on each deploy — which, with watchtower redeploying on
      // a tag move, is every few minutes after a merge.
      expect(() => createConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/)
    })

    it('refuses a blank one in production, which is what .env.example ships', () => {
      // `.env.example` has `SESSION_SECRET=` with no value, so a copied file
      // sends an empty string rather than nothing at all. That must be the same
      // refusal, or the documented first step produces a running app with a
      // development key.
      for (const value of ['', '   ']) {
        expect(() => createConfig({ NODE_ENV: 'production', SESSION_SECRET: value }), value).toThrow(
          /SESSION_SECRET/,
        )
      }
    })

    it('runs without one outside production', () => {
      expect(createConfig({}).session_secret.length).toBeGreaterThanOrEqual(32)
    })

    it('rejects one too short to sign with, in any environment', () => {
      // The schema bound, not the production guard: a 12-character secret set
      // in development would otherwise be accepted here and rejected by
      // createSessions at request time.
      expect(() => createConfig({ SESSION_SECRET: 'too-short' })).toThrow(/SESSION_SECRET/)
    })

    it('refuses the development key on anything reachable, not just in production', () => {
      // `NODE_ENV` cannot answer "is this reachable by anyone": it defaults to
      // `development` when unset, so a bare `node src/server.ts`, a systemd
      // unit, or a compose file that drops the image's environment would sign
      // sessions with a key committed to a public repository — and omit
      // `Secure` at the same time. `HOST` is the value that knows.
      expect(() => createConfig({ HOST: '0.0.0.0' })).toThrow(/SESSION_SECRET/)
      expect(() => createConfig({ HOST: '192.168.1.10' })).toThrow(/SESSION_SECRET/)
      expect(() => createConfig({ HOST: '::' })).toThrow(/SESSION_SECRET/)
    })

    it('allows it on loopback outside production, which is what `pnpm dev` is', () => {
      for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1']) {
        expect(createConfig({ HOST: host }).session_secret.length, host).toBeGreaterThanOrEqual(32)
      }
    })

    it('refuses it in production even on loopback', () => {
      // Production on loopback is still production — behind a proxy on the same
      // host, which is exactly the documented deployment.
      expect(() => createConfig({ NODE_ENV: 'production', HOST: '127.0.0.1' })).toThrow(/SESSION_SECRET/)
    })

    it('names both values in the message, so the refusal is diagnosable', () => {
      // Two conditions decide this, and an operator who reads only "required in
      // production" while running development will not look at HOST.
      expect(() => createConfig({ HOST: '0.0.0.0' })).toThrow(/NODE_ENV=development.*HOST=0\.0\.0\.0/s)
    })

    it('requires a secret when WEB_ROOT is set, even on loopback outside production', () => {
      // The hole the first two signals left, and it is the deployment this repo
      // documents: a reverse proxy in front means the app binds *loopback*. So
      // `pnpm start` behind docs/deploying.md's Apache vhost with NODE_ENV unset
      // satisfied both "not production" and "loopback", and would have booted on
      // the development key that is committed to this repository — serving a
      // non-Secure cookie over Apache's TLS.
      //
      // Setting WEB_ROOT says "serve the built frontend", which is a deployment
      // by definition: Vite serves it in development, so a dev run never sets it.
      expect(() => createConfig({ WEB_ROOT: '/usr/share/web' })).toThrow(/SESSION_SECRET/)
      expect(() => createConfig({ WEB_ROOT: '/usr/share/web', HOST: '127.0.0.1' })).toThrow(/SESSION_SECRET/)
    })

    it('marks cookies Secure when WEB_ROOT is set, on the same predicate', () => {
      // One predicate for both, so the flag and the secret requirement cannot
      // drift: the cookie would otherwise lack Secure on exactly the run above.
      const config = createConfig({ SESSION_SECRET: 's'.repeat(40), WEB_ROOT: '/usr/share/web' })

      expect(config.secure_cookies).toBe(true)
    })

    it('marks cookies Secure whenever the app is reachable beyond loopback', () => {
      // Keyed off the same predicate as the secret guard, not off NODE_ENV.
      // Before that, `SESSION_SECRET=… HOST=0.0.0.0 node src/server.ts` bound
      // every interface and issued the cookie without Secure — and behind a
      // proxy that also answers on :80 the browser sends it in cleartext.
      const secret = { SESSION_SECRET: 's'.repeat(40) }

      expect(createConfig({ ...secret, HOST: '0.0.0.0' }).secure_cookies).toBe(true)
      expect(createConfig({ ...secret, HOST: '192.168.1.10' }).secure_cookies).toBe(true)
      expect(createConfig({ NODE_ENV: 'production', ...secret, HOST: '127.0.0.1' }).secure_cookies).toBe(true)
    })

    it('leaves cookies unmarked only on loopback outside production', () => {
      // Otherwise login silently fails on plain-HTTP `pnpm dev`: the browser
      // discards a Secure cookie, the 200 says signed in, the next load says not.
      for (const host of ['127.0.0.1', 'localhost', '::1']) {
        expect(createConfig({ HOST: host }).secure_cookies, host).toBe(false)
      }
    })

    it('defaults the session lifetime to two weeks', () => {
      expect(createConfig({}).session_ttl_seconds).toBe(60 * 60 * 24 * 14)
    })
  })

  describe('empty values', () => {
    // `DATABASE_URL: ${DATABASE_URL}` in a compose file with the variable unset
    // expands to '' rather than to nothing, so every default here has to
    // survive an empty string as well as an absent key.
    it('treats an empty string as absent rather than letting it win', () => {
      const config = createConfig({ DATABASE_URL: '', PORT: '', HOST: '', BUILD_SHA: '' })

      expect(config.database_url).toBe('./data/sage-burner.sqlite')
      expect(config.port).toBe(3000)
      expect(config.host).toBe('127.0.0.1')
      expect(config.build_sha).toBe('unknown')
    })

    it('treats a whitespace-only string as absent too', () => {
      expect(createConfig({ DATABASE_URL: '   ' }).database_url).toBe('./data/sage-burner.sqlite')
    })

    it('leaves web_root unset rather than empty, so static serving stays off', () => {
      expect(createConfig({ WEB_ROOT: '' }).web_root).toBeUndefined()
    })
  })

  describe('trimming', () => {
    // Every string value, not just the ones that happened to get an ad-hoc
    // .trim(): an env file can leave a trailing newline on any of them.
    it('trims a database url, which an env file can leave a newline on', () => {
      expect(createConfig({ DATABASE_URL: './data/burn.sqlite\n' }).database_url).toBe('./data/burn.sqlite')
    })

    it('trims the web root as well', () => {
      // A secret because a set WEB_ROOT is deployment-shaped, which is what the
      // `looksLikeDeployment` cases below cover.
      expect(createConfig({ SESSION_SECRET: 's'.repeat(40), WEB_ROOT: ' /usr/share/web \n' }).web_root).toBe(
        '/usr/share/web',
      )
    })

    it('trims the host, which would otherwise fail dns lookup at boot', () => {
      // `z.string().min(1)` is perfectly happy with "127.0.0.1\n"; it reaches
      // dns.lookup and the boot dies with an ENOTFOUND naming a host that
      // looks entirely correct in the logs.
      expect(createConfig({ HOST: '127.0.0.1\n' }).host).toBe('127.0.0.1')
    })

    it('trims the build sha', () => {
      expect(createConfig({ BUILD_SHA: 'abc123\n' }).build_sha).toBe('abc123')
    })
  })

  describe('PUBLIC_ORIGIN', () => {
    it('keeps an origin as it was given', () => {
      expect(createConfig({ PUBLIC_ORIGIN: 'https://burn.example.org' }).public_origin).toBe(
        'https://burn.example.org',
      )
    })

    it('takes a trailing slash off, which would otherwise build an unroutable path', () => {
      // The share card concatenates onto this, so `https://burn.example.org//api/…`
      // is what a slash produces — and `z.url()` accepts the value that made it.
      expect(createConfig({ PUBLIC_ORIGIN: 'https://burn.example.org/' }).public_origin).toBe(
        'https://burn.example.org',
      )
    })

    it('takes a path off too — the app is served at a domain root', () => {
      expect(createConfig({ PUBLIC_ORIGIN: 'https://burn.example.org/app/' }).public_origin).toBe(
        'https://burn.example.org',
      )
    })

    it('keeps the port, which is part of an origin', () => {
      expect(createConfig({ PUBLIC_ORIGIN: 'http://localhost:3000/' }).public_origin).toBe(
        'http://localhost:3000',
      )
    })

    it('is absent when nobody set one', () => {
      expect(createConfig({}).public_origin).toBeUndefined()
    })
  })

  describe('trust_proxy', () => {
    it('trusts nothing by default', () => {
      // `true` would believe the whole X-Forwarded-For chain from whoever
      // connects, making request.ip client-controlled. Nothing guarantees a
      // header-stripping proxy is in front — the container runs one process.
      expect(createConfig({}).trust_proxy).toBe(false)
    })

    it('accepts a hop count, the right answer behind one reverse proxy', () => {
      expect(createConfig({ TRUST_PROXY: '1' }).trust_proxy).toBe(1)
      expect(createConfig({ TRUST_PROXY: '2' }).trust_proxy).toBe(2)
    })

    it('accepts explicit booleans', () => {
      expect(createConfig({ TRUST_PROXY: 'true' }).trust_proxy).toBe(true)
      expect(createConfig({ TRUST_PROXY: 'false' }).trust_proxy).toBe(false)
    })

    it('passes an address or CIDR list through', () => {
      expect(createConfig({ TRUST_PROXY: '10.0.0.0/8' }).trust_proxy).toBe('10.0.0.0/8')
      expect(createConfig({ TRUST_PROXY: '127.0.0.1,10.0.0.1' }).trust_proxy).toBe('127.0.0.1,10.0.0.1')
    })

    it('accepts the named presets proxy-addr understands', () => {
      expect(createConfig({ TRUST_PROXY: 'loopback' }).trust_proxy).toBe('loopback')
      expect(createConfig({ TRUST_PROXY: 'uniquelocal' }).trust_proxy).toBe('uniquelocal')
    })

    it('reports a malformed value here rather than letting Fastify throw later', () => {
      // Without validating, `TRUE` reaches proxy-addr.compile() from inside
      // Fastify() and surfaces as a bare `invalid IP address: TRUE`, not the
      // configuration block this module and docs/configuration.md promise.
      expect(() => createConfig({ TRUST_PROXY: 'TRUE' })).toThrow(/Invalid environment configuration/)
      expect(() => createConfig({ TRUST_PROXY: 'TRUE' })).toThrow(/TRUST_PROXY/)
      expect(() => createConfig({ TRUST_PROXY: '10.0.0.0/nonsense' })).toThrow(/TRUST_PROXY/)
    })
  })

  describe('rejection', () => {
    it('refuses a port that is not a number', () => {
      expect(() => createConfig({ PORT: 'http' })).toThrow(/Invalid environment/)
    })

    it('refuses a port outside the valid range', () => {
      expect(() => createConfig({ PORT: '0' })).toThrow(/Invalid environment/)
      expect(() => createConfig({ PORT: '70000' })).toThrow(/Invalid environment/)
    })

    it('refuses an unknown log level rather than silently logging nothing', () => {
      expect(() => createConfig({ LOG_LEVEL: 'verbose' })).toThrow(/Invalid environment/)
    })

    it('refuses an unknown NODE_ENV', () => {
      expect(() => createConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid environment/)
    })

    it('names every problem at once, not just the first', () => {
      const failure = (): unknown => createConfig({ PORT: 'http', LOG_LEVEL: 'verbose' })

      expect(failure).toThrow(/PORT/)
      expect(failure).toThrow(/LOG_LEVEL/)
    })
  })
})
