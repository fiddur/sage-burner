import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IconButton } from './IconButton.tsx'

afterEach(cleanup)

const faceOf = (button: HTMLElement) => button.querySelector('svg')?.getAttribute('data-icon')

describe('a button whose face is an icon', () => {
  it('is found by what it does, not by the drawing', () => {
    render(<IconButton icon="edit" label="Edit Temple" />)

    expect(screen.getByRole('button', { name: 'Edit Temple' })).not.toBeNull()
  })

  it('wears the icon it was given', () => {
    render(<IconButton icon="destroy" label="Remove Temple" />)

    expect(faceOf(screen.getByRole('button', { name: 'Remove Temple' }))).toBe('destroy')
  })

  it('puts no words of its own into the button', () => {
    render(<IconButton icon="destroy" label="Remove Temple" />)

    expect(screen.getByRole('button', { name: 'Remove Temple' }).textContent).toBe('')
  })

  it('calls back when pressed', () => {
    const onClick = vi.fn()
    render(<IconButton icon="edit" label="Edit Temple" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Temple' }))

    expect(onClick).toHaveBeenCalled()
  })

  it('does not submit the form it sits in', () => {
    render(<IconButton icon="destroy" label="Remove Temple" />)

    expect(screen.getByRole('button', { name: 'Remove Temple' }).getAttribute('type')).toBe('button')
  })

  it('can be disabled while something else is in flight', () => {
    render(<IconButton icon="edit" label="Edit Temple" disabled />)

    expect(screen.getByRole('button', { name: 'Edit Temple' })).toHaveProperty('disabled', true)
  })
})

describe('one that waits on a round trip', () => {
  it('keeps its name while its face changes', () => {
    render(<IconButton icon="edit" busyIcon="waiting" busy label="Edit this text" />)

    const button = screen.getByRole('button', { name: 'Edit this text' })
    expect(faceOf(button)).toBe('waiting')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button).toHaveProperty('disabled', true)
  })

  it('wears its own face and says nothing of being busy when it is not', () => {
    render(<IconButton icon="edit" busyIcon="waiting" busy={false} label="Edit this text" />)

    const button = screen.getByRole('button', { name: 'Edit this text' })
    expect(faceOf(button)).toBe('edit')
    expect(button.getAttribute('aria-busy')).toBe('false')
    expect(button).toHaveProperty('disabled', false)
  })

  it('leaves the icon put when there is no second one to wear', () => {
    render(<IconButton icon="destroy" busy label="Remove Temple" />)

    expect(faceOf(screen.getByRole('button', { name: 'Remove Temple' }))).toBe('destroy')
  })
})
