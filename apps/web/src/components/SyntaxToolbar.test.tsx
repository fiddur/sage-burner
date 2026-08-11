import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it } from 'vitest'

import { SyntaxToolbar, useSyntax } from './SyntaxToolbar.tsx'

afterEach(cleanup)

const Held = ({ initial = '', maxLength }: { initial?: string; maxLength?: number }) => {
  const [value, setValue] = useState(initial)
  const syntax = useSyntax({ value, maxLength, onInput: setValue })

  return (
    <>
      <SyntaxToolbar syntax={syntax} subject="what you say" />
      <textarea
        ref={syntax.ref}
        aria-label="what you say"
        value={value}
        onInput={(typed) => setValue(typed.currentTarget.value)}
        {...syntax.handlers}
      />
    </>
  )
}

const box = () => screen.getByLabelText<HTMLTextAreaElement>('what you say')

const select = (start: number, end: number) => {
  box().setSelectionRange(start, end)
}

describe('the toolbar over a composer', () => {
  it('is found by what it writes and in which field', () => {
    render(<Held />)

    for (const name of ['Bold', 'Italic', 'Link', 'List']) {
      expect(screen.getByRole('button', { name: `${name} in what you say` })).toBeTruthy()
    }
  })

  it('wraps the selection in the syntax it stands for', () => {
    render(<Held initial="a warm sauna" />)
    select(7, 12)

    fireEvent.click(screen.getByRole('button', { name: 'Bold in what you say' }))

    expect(box().value).toBe('a warm **sauna**')
  })

  it('leaves the caret between the markers when nothing is selected', () => {
    render(<Held initial="a warm " />)
    select(7, 7)

    fireEvent.click(screen.getByRole('button', { name: 'Bold in what you say' }))

    expect(box().value).toBe('a warm ****')
    expect(box().selectionStart).toBe(9)
  })

  it('writes the same thing from the keyboard, for whoever has one', () => {
    render(<Held initial="a warm sauna" />)
    select(7, 12)

    fireEvent.keyDown(box(), { key: 'b', ctrlKey: true })

    expect(box().value).toBe('a warm **sauna**')
  })

  it('leaves an ordinary keystroke alone, and a shortcut it does not know', () => {
    render(<Held initial="a warm sauna" />)
    select(7, 12)

    fireEvent.keyDown(box(), { key: 'b' })
    fireEvent.keyDown(box(), { key: 's', ctrlKey: true })

    expect(box().value).toBe('a warm sauna')
  })

  it('refuses to write past the length the API accepts', () => {
    render(<Held initial={'x'.repeat(19)} maxLength={20} />)
    select(0, 19)

    fireEvent.click(screen.getByRole('button', { name: 'Bold in what you say' }))

    expect(box().value).toBe('x'.repeat(19))
  })
})
