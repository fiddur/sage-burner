import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { TermsApi } from './Terms.tsx'

import { apiError } from '../api/client.ts'
import { Terms } from './Terms.tsx'

afterEach(cleanup)

const stub = (over: Partial<TermsApi> = {}): TermsApi => ({
  getTerms: () => Promise.resolve({ markdown: '# Getting an account\n\nGiven rather than opened.\n' }),
  ...over,
})

describe('the terms page', () => {
  it('renders what the server sent as markdown, under a heading of its own', async () => {
    render(<Terms api={stub()} />)

    expect(await screen.findByText('Given rather than opened.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Getting an account')
  })

  it('says so when the image has no terms', async () => {
    render(<Terms api={stub({ getTerms: () => Promise.resolve({ markdown: '   ' }) })} />)

    expect(await screen.findByText(/No terms are written down/)).toBeTruthy()
  })

  it('says the read failed rather than showing an empty page', async () => {
    render(<Terms api={stub({ getTerms: () => Promise.reject(new Error('nope')) })} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the terms')
  })

  it('shows what the server said when it said something', async () => {
    render(<Terms api={stub({ getTerms: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')) })} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Nope.')
  })
})
