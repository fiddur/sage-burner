import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
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

    screen.getByRole('button', { name: 'Preview Help text' }).click()

    expect((await screen.findAllByRole('listitem')).map((item) => item.textContent)).toEqual([
      'Radical inclusion',
      'Leave no trace',
    ])
  })

  it('goes back to writing', async () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('button', { name: 'Preview Help text' }).click()
    await screen.findAllByRole('listitem')
    screen.getByRole('button', { name: 'Write Help text' }).click()

    expect(await screen.findByLabelText('Help text')).toHaveProperty('value', PRINCIPLES)
  })

  it('says there is nothing to preview rather than showing a blank pane', async () => {
    render(<MarkdownField label="Help text" value="   " maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('button', { name: 'Preview Help text' }).click()

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

    screen.getByRole('button', { name: 'Preview Help text' }).click()

    expect(await screen.findByText(/alert\(1\)/)).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
  })

  it('names the textarea with a real <label for>, not a duplicated aria-label', () => {
    // The accessible name and the click target come from one place, which is
    // what the `<label class="field">` this replaced already gave every other
    // field.
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    const field = screen.getByLabelText('Help text')
    expect(field.id).not.toBe('')
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe('Help text')
    // The half of the name this test used to leave unpinned: re-adding
    // `aria-label` beside the id satisfies every line above while quietly
    // putting the accessible name back in two places, with `aria-label`
    // winning over the `<label>`.
    expect(field.getAttribute('aria-label')).toBeNull()
  })

  it('drops the label association while previewing, when there is no field to name', async () => {
    render(<MarkdownField label="Help text" value="x" maxLength={2000} onInput={vi.fn()} />)

    screen.getByRole('button', { name: 'Preview Help text' }).click()

    await waitFor(() => expect(screen.queryByLabelText('Help text')).toBeNull())
    expect(document.querySelector('label')?.getAttribute('for')).toBeNull()
  })

  it('says which view is showing without claiming to be a tab widget', async () => {
    // `role="tab"` promises a controlled panel and roving focus; these are
    // toggles, so they say so.
    render(<MarkdownField label="Help text" value="x" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Write Help text' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Preview Help text' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    screen.getByRole('button', { name: 'Preview Help text' }).click()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview Help text' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )
  })

  it('caps the text at the length the API accepts', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text').getAttribute('maxlength')).toBe('2000')
  })
})
