import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { Formatting } from './Formatting.tsx'

afterEach(cleanup)

describe('the formatting page', () => {
  it('shows each mark beside what the app makes of it', () => {
    render(<Formatting />)

    const list = screen.getByRole('row', { name: /A list/ })
    expect(list.textContent).toContain('- towels')
    expect(list.querySelectorAll('li')).toHaveLength(3)
  })

  it('renders the examples through the app’s own renderer, so the page cannot promise more', () => {
    // The heading example is `## Saturday`, which `renderMarkdown` shifts down one level —
    // written out as HTML this page would say `h2` while every other page said `h3`.
    render(<Formatting />)

    expect(screen.getByRole('heading', { name: 'Saturday', level: 3 })).toBeTruthy()
  })

  it('says raw HTML is not formatting, which is what markdown.ts guarantees', () => {
    render(<Formatting />)

    expect(screen.getByText(/shown as you typed it/)).toBeTruthy()
  })
})
