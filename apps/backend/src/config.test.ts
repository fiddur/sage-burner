import { describe, expect, it } from 'vitest'

import { createConfig } from './config.ts'

describe('createConfig', () => {
  it('runs on an empty environment, so a bare `docker run` works', () => {
    const config = createConfig({})

    expect(config.node_env).toBe('development')
    expect(config.port).toBe(3000)
    expect(config.host).toBe('0.0.0.0')
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
      expect(config.host).toBe('0.0.0.0')
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
      expect(createConfig({ WEB_ROOT: ' /usr/share/web \n' }).web_root).toBe('/usr/share/web')
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
      // configuration block this module and the README promise.
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
