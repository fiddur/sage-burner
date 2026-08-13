import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { apiError } from '../api/client.ts'
import { ICON_ACCEPT, isSvg } from '../icon.ts'
import { InstallationProvider } from '../installation.tsx'
import { IconField, messageForFailure } from './IconField.tsx'

afterEach(cleanup)

/**
 * Inside a provider, since the preview's `?v=` is the installation's own (#376).
 *
 * `icon` is what the API has said so far — `null` for "nobody has uploaded one",
 * which is what the manifest spells `default`.
 */
const renderField = (api: Parameters<typeof IconField>[0]['api'], icon: string | null = null) =>
  render(
    <InstallationProvider icon={icon}>
      <IconField api={api} />
    </InstallationProvider>,
  )

const svgFile = () =>
  new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'logo.svg', { type: 'image/svg+xml' })

const stub = (overrides: Partial<Parameters<typeof IconField>[0]['api']> = {}) => ({
  setInstallationIcon: () => Promise.resolve({ icon: '2026-08-06T12:00:00.000Z' }),
  removeInstallationIcon: () => Promise.resolve(undefined),
  ...overrides,
})

const icon = () => screen.getByAltText("This installation's app icon")

describe('choosing the icon on a home screen', () => {
  it('shows what is there now, through the route that serves it', () => {
    renderField(stub())

    expect(icon().getAttribute('src')).toContain(apiRoutes.getInstallationIcon.path())
  })

  it('sends an SVG exactly as chosen', async () => {
    // The whole reason SVG is allowed: rasterising a logo to 512 pixels throws away
    // what made it worth uploading. A canvas would also be unavailable here.
    let sent: Blob | undefined
    renderField(
      stub({
        setInstallationIcon: (image: Blob) => {
          sent = image
          return Promise.resolve({ icon: 'v2' })
        },
      }),
    )

    fireEvent.change(screen.getByLabelText('The icon on a home screen'), {
      target: { files: [svgFile()] },
    })

    await waitFor(() => {
      expect(sent?.type).toBe('image/svg+xml')
    })
  })

  it('quotes the version the manifest quotes, so one picture is one URL', async () => {
    // Two spellings of it would be two entries in the offline cache under one path,
    // and the newest-wins rule then drops one on every store (#376).
    renderField(stub(), '2026-08-01T00:00:00.000Z')

    // The literal, so the one spelling every caller shares is pinned somewhere rather
    // than only asserted against the builder that produces it.
    expect(icon().getAttribute('src')).toBe('/api/installation/icon?v=2026-08-01T00%3A00%3A00.000Z')
  })

  it('says default before anybody has uploaded one, as the manifest does', () => {
    renderField(stub())

    expect(icon().getAttribute('src')).toBe('/api/installation/icon?v=default')
  })

  it('shows the new one rather than whatever was under that URL', async () => {
    renderField(stub())
    const before = icon().getAttribute('src')

    fireEvent.change(screen.getByLabelText('The icon on a home screen'), {
      target: { files: [svgFile()] },
    })

    await waitFor(() => {
      expect(icon().getAttribute('src')).not.toBe(before)
    })
  })

  it('goes back to the flame', async () => {
    let removed = false
    renderField(
      stub({
        removeInstallationIcon: () => {
          removed = true
          return Promise.resolve(undefined)
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to the flame' }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    await waitFor(() => {
      expect(removed).toBe(true)
    })
  })

  it('offers only the two types the route will store', () => {
    renderField(stub())

    expect(screen.getByLabelText('The icon on a home screen').getAttribute('accept')).toBe(ICON_ACCEPT)
    expect(ICON_ACCEPT).toBe('image/png,image/svg+xml')
  })

  it('says what went wrong', async () => {
    renderField(
      stub({
        setInstallationIcon: () => Promise.reject(apiError(413, 'too_large', 'Payload too large')),
      }),
    )

    fireEvent.change(screen.getByLabelText('The icon on a home screen'), {
      target: { files: [svgFile()] },
    })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('too large')
    })
  })
})

describe('what to tell an admin about a failure', () => {
  it('advises on the format only when the failure is about the file', () => {
    expect(messageForFailure(new Error('no canvas'))).toContain('PNG or an SVG')
    expect(messageForFailure(apiError(415, 'bad_request', 'x'))).toContain('PNG or an SVG')
  })

  it('does not send somebody to re-export a perfectly good file', () => {
    // The advice is expensive to get wrong: it sends them off to convert an image
    // that was never the problem, and the second attempt fails the same way.
    expect(messageForFailure(apiError(500, 'unknown', 'x'))).not.toContain('PNG or an SVG')
    expect(messageForFailure(apiError(403, 'forbidden', 'x'))).toContain('admin')
  })

  it('keeps the client wording for a connection failure', () => {
    const failure = apiError(0, 'network', 'Could not reach the server. Check your connection and try again.')

    expect(messageForFailure(failure)).toBe(failure.message)
  })
})

describe('telling an SVG apart from anything else', () => {
  it('is what decides whether a canvas gets involved', () => {
    expect(isSvg(new Blob([], { type: 'image/svg+xml' }))).toBe(true)
    expect(isSvg(new Blob([], { type: 'image/png' }))).toBe(false)
    expect(isSvg(new Blob([], { type: '' }))).toBe(false)
  })
})
