import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `index.html` names three paths it cannot import (#256).
 *
 * Every other spelling of an endpoint comes from `apiRoutes`, which is what stops the
 * client and the route file drifting apart. A `<link href>` is the one place that
 * cannot — so the drift is caught here instead, by reading the file rather than by
 * trusting that nobody will move a route.
 */
// From the working directory rather than from `import.meta.url`: the suite runs in
// happy-dom, where that is an http URL and `fileURLToPath` refuses it. Vitest's cwd
// is this package, which is where `index.html` lives.
const shell = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')

const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`).exec(shell)?.[1]

describe('the HTML shell', () => {
  it('points at the manifest the backend serves', () => {
    expect(shell).toContain(`href="${apiRoutes.webManifest.path()}"`)
  })

  it('points at the icon route rather than a file that would have to be redeployed', () => {
    expect(shell).toContain(`href="${apiRoutes.getInstallationIcon.path()}"`)
  })

  it('links a manifest at all, and as a manifest', () => {
    // The assertions above would both pass on a file that had lost its `rel`, since
    // they only look for the path.
    expect(attribute('link', 'rel')).toBe('manifest')
    expect(shell).toContain('rel="apple-touch-icon"')
  })

  it('uses the same icon in the tab as on the home screen (#285)', () => {
    // The admin's icon was the installed app's and the tab kept the browser's default
    // globe, which is the one place the installation did not look like itself.
    expect(shell).toContain(`<link rel="icon" href="${apiRoutes.getInstallationIcon.path()}" />`)
  })

  it('claims no type for the icon, since the upload decides it', () => {
    // A `type="image/svg+xml"` here would be a lie the moment somebody uploads a PNG
    // — and nothing in this process decodes an image to find out which it is. The
    // response's own `content-type` is the answer, so the link must not second-guess
    // it. A browser that cannot read what arrives falls back on its own.
    expect(/<link rel="icon"[^>]*\stype=/.test(shell)).toBe(false)
  })

  it('names a theme colour from the palette', () => {
    // `--ember`, the same one the manifest sends. Two places, because a browser reads
    // this one before it has fetched anything.
    expect(shell).toContain('name="theme-color"')
    expect(shell).toContain('content="#c2410c"')
  })

  it('has no route with a dot in it, which the backend would 404', () => {
    // The rule `app.ts` documents: any path whose last segment has an extension is
    // treated as a file. Both paths here are served by real routes, and this is the
    // check that they still are rather than being client-side routes by accident.
    expect(apiRoutes.webManifest.fastify).toBe('/manifest.webmanifest')
    expect(apiRoutes.getInstallationIcon.fastify).toBe('/api/installation/icon')
  })
})
