import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { PrivacyApi } from './Privacy.tsx'

import { Privacy } from './Privacy.tsx'

afterEach(cleanup)

const stub = (markdown: string): PrivacyApi => ({ getPrivacy: () => Promise.resolve({ markdown }) })

describe('the privacy page', () => {
  it('renders the policy for anybody, signed in or not', async () => {
    // No `ViewerProvider` here on purpose: this page must render for a stranger, which is
    // what Facebook's app review is, and the absence of a guard is the thing being asserted.
    render(<Privacy api={stub('# What we keep\n\nYour name, and not much else.')} />)

    expect(await screen.findByRole('heading', { level: 2, name: 'What we keep' })).toBeTruthy()
    expect(screen.getByText(/not much else/)).toBeTruthy()
  })

  it('owns the page heading, so the file needs none', async () => {
    // `renderMarkdown` shifts a `#` down a level under it, which is why the file's own
    // sections start at `#` and land as `<h2>`.
    render(<Privacy api={stub('# A section')} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeTruthy()
  })

  it('says so plainly for an image built without the file', async () => {
    render(<Privacy api={stub('   ')} />)

    expect(await screen.findByText(/No privacy policy is written down/)).toBeTruthy()
  })

  it('says it could not load rather than showing an empty policy', async () => {
    render(<Privacy api={{ getPrivacy: () => Promise.reject(new Error('nope')) }} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the privacy policy')
  })
})
