import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
    expect(attribute('link', 'rel')).toBe('manifest')
    expect(shell).toContain('rel="apple-touch-icon"')
  })

  it('points the home-screen tile at the touch-icon route, which answers a PNG', () => {
    expect(shell).toMatch(
      new RegExp(`<link[^>]*rel="apple-touch-icon"[^>]*href="${apiRoutes.getTouchIcon.path('180')}"`),
    )
    expect(shell).not.toMatch(
      new RegExp(`<link[^>]*rel="apple-touch-icon"[^>]*href="${apiRoutes.getInstallationIcon.path()}"`),
    )
  })

  it('gives the tab the installation’s icon, for a signed-out visitor too (#285)', () => {
    expect(shell).toMatch(
      new RegExp(`<link[^>]*rel="icon"[^>]*href="${apiRoutes.getInstallationIcon.path()}"`),
    )
  })

  it('gives that link the id favicon.ts rewrites, and declares only one', () => {
    expect(shell).toContain('id="app-favicon"')
    expect(shell.match(/<link[^>]*rel="icon"/g)).toHaveLength(1)
  })

  it('claims no type for the icon, since the upload decides it', () => {
    expect(/<link[^>]*rel="icon"[^>]*\stype=/.test(shell)).toBe(false)
  })

  it('names a theme colour from the palette', () => {
    expect(shell).toContain('name="theme-color"')
    expect(shell).toContain('content="#c2410c"')
  })

  it('has no route with a dot in it, which the backend would 404', () => {
    expect(apiRoutes.webManifest.fastify).toBe('/manifest.webmanifest')
    expect(apiRoutes.getInstallationIcon.fastify).toBe('/api/installation/icon')
    expect(apiRoutes.getTouchIcon.fastify).toBe('/api/installation/icons/:size')
  })
})
