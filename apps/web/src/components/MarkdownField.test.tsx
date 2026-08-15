import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { useState } from 'preact/hooks'
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

  it('carries focus with the selection when an arrow key moves it', () => {
    // The roving `tabIndex` makes the unselected tab untabbable, so a selection that
    // moves without focus leaves the keyboard on a button nothing can reach again.
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    const write = screen.getByRole('tab', { name: 'Write' })
    write.focus()
    fireEvent.keyDown(write, { key: 'ArrowRight' })

    const preview = screen.getByRole('tab', { name: 'Preview' })
    expect(preview.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(preview)
  })

  it('points a tab at a panel that is there, only one being rendered at a time', () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    const named = screen.getByRole('tab', { name: 'Write' }).getAttribute('aria-controls')
    expect(named).not.toBeNull()
    expect(document.getElementById(named ?? '')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-controls')).toBeNull()
  })

  it('reports what was typed', () => {
    const onInput = vi.fn()
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={onInput} />)

    fireEvent.input(screen.getByLabelText('Help text'), { target: { value: PRINCIPLES } })

    expect(onInput).toHaveBeenCalledWith(PRINCIPLES)
  })

  it('writes until Preview is asked for, and reads it back under the same tabs', async () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text')).toHaveProperty('value', PRINCIPLES)
    expect(screen.queryByRole('listitem')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect((await screen.findAllByRole('listitem')).map((item) => item.textContent)).toEqual([
      'Radical inclusion',
      'Leave no trace',
    ])
    expect(screen.queryByLabelText('Help text')).toBeNull()
  })

  it('goes back to what was typed, which is the whole of a mode being a mode', () => {
    render(<MarkdownField label="Help text" value={PRINCIPLES} maxLength={2000} onInput={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }))

    expect(screen.getByLabelText('Help text')).toHaveProperty('value', PRINCIPLES)
  })

  it('says there is nothing to read rather than showing an empty panel', () => {
    render(<MarkdownField label="Help text" value="   " maxLength={2000} onInput={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(screen.getByText('Nothing written yet.')).toBeTruthy()
  })

  it('says markdown is supported, and where to read about it', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Markdown is supported' }).getAttribute('href')).toBe(
      '/formatting',
    )
  })

  it('offers the picture line only where pictures can be sent', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)
    expect(screen.queryByText(/add a picture/)).toBeNull()

    cleanup()
    render(
      <MarkdownField
        label="Help text"
        value=""
        maxLength={2000}
        upload={() => Promise.reject(new Error('not used'))}
        onInput={vi.fn()}
      />,
    )

    expect(screen.getByText(/paste, drop or click/)).toBeTruthy()
  })

  it('escapes raw HTML in the preview, so it shows what an applicant gets', async () => {
    render(
      <MarkdownField
        label="Help text"
        value={'# Heading\n<script>alert(1)</script>'}
        maxLength={2000}
        onInput={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

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

  it('writes the syntax rather than talking about it, wherever the field appears', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Bold in Help text' })).toBeTruthy()
  })

  it('names the toolbar after what the field is for where the label is not that', () => {
    render(
      <MarkdownField
        label="Anything more"
        accessibleName="What you want to say about Sauna at dawn"
        value=""
        maxLength={2000}
        onInput={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Bold in What you want to say about Sauna at dawn' }),
    ).toBeTruthy()
  })

  it('opens as tall as the text it holds', () => {
    // The bug (#338): three lines whatever was in it, so editing a page of welcome
    // text began by scrolling inside a sliver.
    const twenty = Array.from({ length: 20 }, (_unused, line) => `line ${line}`).join('\n')
    render(<MarkdownField label="Help text" value={twenty} maxLength={2000} onInput={vi.fn()} />)
    const tall = screen.getByLabelText('Help text').getAttribute('rows')

    cleanup()
    render(<MarkdownField label="Help text" value="one line" maxLength={2000} onInput={vi.fn()} />)

    expect(Number(tall)).toBeGreaterThan(Number(screen.getByLabelText('Help text').getAttribute('rows')))
  })

  it("takes a caller's height as a floor rather than a size", () => {
    // `rows` is what the burn's payment and transfer texts ask for. It says how tall
    // an empty box opens, and must not shrink one that already holds more.
    render(<MarkdownField label="Help text" value="" maxLength={2000} rows={12} onInput={vi.fn()} />)
    expect(screen.getByLabelText('Help text').getAttribute('rows')).toBe('12')

    cleanup()
    render(
      <MarkdownField
        label="Help text"
        value={'line\n'.repeat(19)}
        maxLength={2000}
        rows={12}
        onInput={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Help text').getAttribute('rows')).toBe('20')
  })

  it('caps the text at the length the API accepts', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text').getAttribute('maxlength')).toBe('2000')
  })
})

const NEARLY = 'x'.repeat(24)

describe('naming somebody in a markdown field', () => {
  const Held = ({
    people,
    maxLength = 2000,
  }: {
    people?: readonly { account_id: string; name: string | null }[]
    maxLength?: number
  }) => {
    const [value, setValue] = useState('')

    return (
      <MarkdownField
        label="Help text"
        value={value}
        maxLength={maxLength}
        people={people}
        onInput={setValue}
      />
    )
  }

  const type = (value: string, caret: number) => {
    const box = screen.getByLabelText('Help text')
    fireEvent.input(box, { target: { value } })
    fireEvent.keyUp(box, { target: { selectionStart: caret } })
  }

  it('offers nobody at all where the field does not do mentions', () => {
    render(<Held />)

    type('@', 1)

    expect(screen.queryByRole('button', { name: '@everybody' })).toBeNull()
  })

  it('offers them where it does', () => {
    render(<Held people={[{ account_id: 'a-1', name: 'Ada' }]} />)

    type('@', 1)

    expect(screen.getByRole('button', { name: '@everybody' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '@Ada' })).toBeTruthy()
  })

  it('offers them to a burn with nobody coming yet, which is not the same as no field', () => {
    render(<Held people={[]} />)

    type('@', 1)

    expect(screen.getByRole('button', { name: '@everybody' })).toBeTruthy()
  })

  it('offers nobody whose token would not fit, rather than writing one the API refuses', () => {
    // `maxlength` does not apply to a programmatic insert, so the menu could write a body over
    // the limit and the save came back as a generic failure (#457).
    render(<Held people={[{ account_id: 'a-1', name: 'Ada' }]} maxLength={40} />)

    type(`${NEARLY} @`, NEARLY.length + 2)

    expect(screen.queryByRole('button', { name: '@Ada' })).toBeNull()
    expect(screen.queryByRole('button', { name: '@everybody' })).toBeNull()
  })

  it('offers them at the same length where there is room, which is what makes it a bound', () => {
    render(<Held people={[{ account_id: 'a-1', name: 'Ada' }]} maxLength={80} />)

    type(`${NEARLY} @`, NEARLY.length + 2)

    expect(screen.getByRole('button', { name: '@Ada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '@everybody' })).toBeTruthy()
  })
})
