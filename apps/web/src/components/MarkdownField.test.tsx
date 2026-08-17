import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownField } from './MarkdownField.tsx'

afterEach(cleanup)

const PRINCIPLES = '- Radical inclusion\n- Leave no trace'

describe('MarkdownField', () => {
  it('edits in a textarea, not a single-line input', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByLabelText('Help text').tagName).toBe('TEXTAREA')
  })

  it('carries focus with the selection when an arrow key moves it', () => {
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

  it('opens the formatting help away, so a draft is not routed out from under somebody', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    const help = screen.getByRole('link', { name: 'Markdown is supported' })
    expect(help.getAttribute('target')).toBe('_blank')
    expect(help.getAttribute('rel')).toBe('noreferrer')
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

  it('drops the picture half of the help line in Preview, where none of it is on screen (#719)', () => {
    render(
      <MarkdownField
        label="Help text"
        value="Something"
        maxLength={2000}
        upload={() => Promise.reject(new Error('not used'))}
        onInput={vi.fn()}
      />,
    )

    expect(screen.getByText(/paste, drop or click/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(screen.queryByText(/paste, drop or click/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Markdown is supported' })).toBeTruthy()
  })

  it('brings it back on the way to Write, the toolbar coming with it', () => {
    render(
      <MarkdownField
        label="Help text"
        value="Something"
        maxLength={2000}
        upload={() => Promise.reject(new Error('not used'))}
        onInput={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }))

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
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    const field = screen.getByLabelText('Help text')
    expect(field.id).not.toBe('')
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe('Help text')
    expect(field.getAttribute('aria-label')).toBeNull()
  })

  it('leaves no <label> pointing at a box that is not there, while previewing', () => {
    render(<MarkdownField label="Help text" value="something" maxLength={2000} onInput={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(document.querySelector('.field > label')).toBeNull()
    expect(document.querySelector('.field > span')?.textContent).toBe('Help text')
  })

  it('names both panels after the tab that opens them, so neither is an unnamed region', () => {
    render(<MarkdownField label="Help text" value="something" maxLength={2000} onInput={vi.fn()} />)

    const named = () => {
      const panel = screen.getByRole('tabpanel')
      const by = panel.getAttribute('aria-labelledby') ?? ''

      return document.getElementById(by)?.textContent
    }

    expect(named()).toBe('Write')

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(named()).toBe('Preview')
  })

  it('says which field the two tabs belong to, a page holding several', () => {
    render(
      <MarkdownField
        label="what you said"
        labelHidden
        accessibleName="Rewrite what you said"
        value=""
        maxLength={2000}
        onInput={vi.fn()}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'Write or preview Rewrite what you said' })).toBeTruthy()
  })

  it('comes back to Write when the box is emptied from outside, as a post empties it', () => {
    const { rerender } = render(
      <MarkdownField label="Help text" value="is one mat enough?" maxLength={2000} onInput={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true')

    rerender(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Write' }).getAttribute('aria-selected')).toBe('true')
  })

  it('writes the syntax rather than talking about it, wherever the field appears', () => {
    render(<MarkdownField label="Help text" value="" maxLength={2000} onInput={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Bold in Help text' })).toBeTruthy()
  })

  it('names the toolbar after the label, not after the name that says which box this is', () => {
    render(
      <MarkdownField
        label="what you said"
        labelHidden
        accessibleName="Rewrite what you said"
        value=""
        maxLength={2000}
        onInput={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Bold in what you said' })).toBeTruthy()
    expect(screen.getByLabelText('Rewrite what you said').tagName).toBe('TEXTAREA')
  })

  it('opens as tall as the text it holds', () => {
    const twenty = Array.from({ length: 20 }, (_unused, line) => `line ${line}`).join('\n')
    render(<MarkdownField label="Help text" value={twenty} maxLength={2000} onInput={vi.fn()} />)
    const tall = screen.getByLabelText('Help text').getAttribute('rows')

    cleanup()
    render(<MarkdownField label="Help text" value="one line" maxLength={2000} onInput={vi.fn()} />)

    expect(Number(tall)).toBeGreaterThan(Number(screen.getByLabelText('Help text').getAttribute('rows')))
  })

  it("takes a caller's height as a floor rather than a size", () => {
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
