import type { ComponentChildren } from 'preact'

import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { BannerField, messageForFailure } from './BannerField.tsx'

afterEach(cleanup)

const stub = (overrides: Partial<Parameters<typeof BannerField>[0]['api']> = {}) => ({
  setInstallationBanner: () => Promise.resolve({ banner: '2026-08-07T12:00:00.000Z' }),
  removeInstallationBanner: () => Promise.resolve(undefined),
  ...overrides,
})

const within = (banner: string | null, children: ComponentChildren) => (
  <InstallationProvider title="The Burning Sage" banner={banner}>
    {children}
  </InstallationProvider>
)

const preview = () => screen.queryByAltText('The banner as it is now')

describe('choosing the picture a shared link shows', () => {
  it('shows the one that is there, through the route that serves it', () => {
    render(within('2026-08-07T10:00:00.000Z', <BannerField api={stub()} />))

    expect(preview()?.getAttribute('src')).toBe(
      `${apiRoutes.getInstallationBanner.path()}?v=2026-08-07T10%3A00%3A00.000Z`,
    )
  })

  it('shows nothing to remove when there is no banner', () => {
    render(within(null, <BannerField api={stub()} />))

    expect(preview()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove it' })).toBeNull()
    expect(screen.getByText('Choose an image')).toBeTruthy()
  })

  it('removes it, and the homepage stops drawing one without a reload', async () => {
    // The context rather than local state: the banner is drawn on the homepage, which
    // is one client-side navigation away and fetches nothing on the way there.
    let removed = false
    render(
      within(
        '2026-08-07T10:00:00.000Z',
        <BannerField
          api={stub({
            removeInstallationBanner: () => {
              removed = true
              return Promise.resolve(undefined)
            },
          })}
        />,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }))

    await waitFor(() => {
      expect(removed).toBe(true)
    })
    await waitFor(() => {
      expect(preview()).toBeNull()
    })
  })

  it('offers any picture the browser can draw, since what goes up is a JPEG either way', () => {
    render(within(null, <BannerField api={stub()} />))

    expect(screen.getByLabelText('The picture a shared link shows').getAttribute('accept')).toBe('image/*')
  })

  it('says what a card does with a picture of the wrong shape', () => {
    // The format is what decides whether a share is a big picture or a thumbnail, and
    // finding that out from Facebook afterwards is the expensive way.
    render(within(null, <BannerField api={stub()} />))

    expect(screen.getByText(/1200 × 630/).textContent).toContain('600 × 315')
  })
})

describe('what to tell an admin about a failure', () => {
  it('advises on the picture only when the failure is about the file', () => {
    expect(messageForFailure(new Error('no canvas'))).toContain('wide photograph')
    expect(messageForFailure(apiError(415, 'bad_request', 'x'))).toContain('wide photograph')
  })

  it('does not send somebody to re-export a perfectly good file', () => {
    expect(messageForFailure(apiError(500, 'unknown', 'x'))).not.toContain('wide photograph')
    expect(messageForFailure(apiError(403, 'forbidden', 'x'))).toContain('admin')
  })

  it('keeps the client wording for a connection failure', () => {
    const failure = apiError(0, 'network', 'Could not reach the server. Check your connection and try again.')

    expect(messageForFailure(failure)).toBe(failure.message)
  })
})
