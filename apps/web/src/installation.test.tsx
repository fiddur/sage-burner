import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from './app.tsx'

import { FetchedInstallationProvider, InstallationProvider, useInstallationTitle } from './installation.tsx'

/**
 * The provider the real app uses, against an injected client.
 *
 * `app.test.tsx` always passes an explicit title so no render there touches the
 * network; this is the file that covers what happens when it does.
 */

const SHELL_TITLE = 'Sage Burner'

beforeEach(() => {
  document.title = SHELL_TITLE
})

afterEach(cleanup)

const Probe = () => <output>{useInstallationTitle() ?? '-'}</output>

const renderWith = (getInstallation: AppApi['getInstallation']) =>
  render(
    <FetchedInstallationProvider api={{ getInstallation }}>
      <Probe />
    </FetchedInstallationProvider>,
  )

const shown = () => screen.getByRole('status').textContent

describe('FetchedInstallationProvider', () => {
  it('shows nothing until the answer arrives', async () => {
    // Not the software's name: on an installation called something else, the
    // header would say the wrong thing and then correct itself.
    renderWith(vi.fn<AppApi['getInstallation']>(() => new Promise(() => undefined)))

    expect(shown()).toBe('-')
    await waitFor(() => expect(document.title).toBe(SHELL_TITLE))
  })

  it('hands the title to whoever asks for it', async () => {
    renderWith(
      vi.fn<AppApi['getInstallation']>(() =>
        Promise.resolve({ installation: { title: 'The Burning Sage' } }),
      ),
    )

    await waitFor(() => expect(shown()).toBe('The Burning Sage'))
  })

  it('puts it in the browser tab as well as the page', async () => {
    renderWith(
      vi.fn<AppApi['getInstallation']>(() =>
        Promise.resolve({ installation: { title: 'The Burning Sage' } }),
      ),
    )

    await waitFor(() => expect(document.title).toBe('The Burning Sage'))
  })

  it('leaves the shell title alone when the request fails', async () => {
    // What an offline first paint looks like. There is nothing to report and
    // nowhere on the public homepage to report it.
    renderWith(vi.fn<AppApi['getInstallation']>(() => Promise.reject(new TypeError('Failed to fetch'))))

    await waitFor(() => expect(shown()).toBe('-'))
    expect(document.title).toBe(SHELL_TITLE)
  })

  it('aborts the request when unmounted', async () => {
    const signals: AbortSignal[] = []
    const getInstallation = vi.fn<AppApi['getInstallation']>((signal) => {
      if (signal !== undefined) signals.push(signal)
      return new Promise(() => undefined)
    })

    const { unmount } = renderWith(getInstallation)
    unmount()

    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })
})

describe('InstallationProvider', () => {
  it('states the title without a fetch, and titles the tab the same way', () => {
    render(
      <InstallationProvider title="The Burning Sage">
        <Probe />
      </InstallationProvider>,
    )

    expect(shown()).toBe('The Burning Sage')
    expect(document.title).toBe('The Burning Sage')
  })
})
