import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownField } from './MarkdownField.tsx'

afterEach(cleanup)

const PRINCIPLES = '- Radical inclusion\n- Leave no trace'

describe('MarkdownField', () => {
  it('edits in a textarea, not a single-line input', () => {
    // Help text carries things like the 10+1 principles, which cannot be written
    // in an `<input>` however long its maxLength is.
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text').tagName).toBe('TEXTAREA')
  })

  it('reports what was typed', () => {
    const onInput = vi.fn()
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={onInput} />)

    fireEvent.input(screen.getByLabelText('Help text'), { target: { value: PRINCIPLES } })

    expect(onInput).toHaveBeenCalledWith(PRINCIPLES)
  })

  it('renders the markdown under Preview', async () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('tab', { name: 'Preview' }).click()

    expect((await screen.findAllByRole('listitem')).map((item) => item.textContent)).toEqual([
      'Radical inclusion',
      'Leave no trace',
    ])
  })

  it('goes back to writing', async () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('tab', { name: 'Preview' }).click()
    await screen.findAllByRole('listitem')
    screen.getByRole('tab', { name: 'Write' }).click()

    expect(await screen.findByLabelText('Help text')).toHaveProperty('value', PRINCIPLES)
  })

  it('says there is nothing to preview rather than showing a blank pane', async () => {
    render(<MarkdownField label="Help text" value="   " maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('tab', { name: 'Preview' }).click()

    expect(await screen.findByText('Nothing to preview yet.')).toBeTruthy()
  })

  it('escapes raw HTML in the preview, so it shows what an applicant gets', async () => {
    render(
      <MarkdownField
        label="Help text"
        value="<script>alert(1)</script>"
        maxLength={2000}
        onInput={vi.fn()}
      />,
    )

    screen.getByRole('tab', { name: 'Preview' }).click()

    expect(await screen.findByText(/alert\(1\)/)).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
  })

  it('caps the text at the length the API accepts', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text').getAttribute('maxlength')).toBe('2000')
  })
})
