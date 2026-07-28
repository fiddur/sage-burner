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
    it('trims a database url, which an env file can leave a newline on', () => {
      expect(createConfig({ DATABASE_URL: './data/burn.sqlite\n' }).database_url).toBe('./data/burn.sqlite')
    })

    it('trims the web root as well', () => {
      expect(createConfig({ WEB_ROOT: ' /usr/share/web \n' }).web_root).toBe('/usr/share/web')
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
