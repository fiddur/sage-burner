import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChangelogApi } from './Changelog.tsx'

import { apiError } from '../api/client.ts'
import { Changelog } from './Changelog.tsx'

afterEach(cleanup)

/**
 * What's new — where the redeploy notification and the reload bar both lead (#325).
 *
 * Public, so there is no viewer to provide: the bar is on every page a signed-out
 * visitor can see, and a notification tapped on a locked phone opens before anything
 * has been signed into.
 */
const stub = (over: Partial<ChangelogApi> = {}): ChangelogApi => ({
  getChangelog: () => Promise.resolve({ markdown: '# 2026-08-07\n\n- A Q&A per burn.\n' }),
  ...over,
})

describe('the changelog', () => {
  it('renders what the server sent as markdown, under a heading of its own', async () => {
    // The page owns the `<h1>`: `renderMarkdown` shifts the file's headings down one, so
    // a page taking its only heading from the file would start at `<h2>`.
    render(<Changelog api={stub()} />)

    expect(await screen.findByText('A Q&A per burn.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("What's new")
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('2026-08-07')
  })

  it('escapes html rather than rendering it', async () => {
    // Written by whoever deploys, not by a member — but it goes through the same
    // `renderMarkdown` everything else does, and that escapes rather than filters.
    render(
      <Changelog api={stub({ getChangelog: () => Promise.resolve({ markdown: '<script>x()</script>' }) })} />,
    )

    await screen.findByText(/script/)
    expect(document.querySelector('script')).toBeNull()
  })

  it('says so when the image has no changelog', async () => {
    // Rather than an empty page: the notification that sends somebody here has to land
    // on something that explains itself.
    render(<Changelog api={stub({ getChangelog: () => Promise.resolve({ markdown: '' }) })} />)

    expect(await screen.findByText(/Nothing is written down/)).toBeTruthy()
  })

  it('says the read failed rather than showing an empty page', async () => {
    render(
      <Changelog
        api={stub({ getChangelog: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')) })}
      />,
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
