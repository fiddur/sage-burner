import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Destroy } from './Destroy.tsx'

afterEach(cleanup)

describe('destroying something', () => {
  it('asks before it happens, which is the whole of what this is for', () => {
    const onDestroy = vi.fn()
    render(<Destroy what="Planning call" busy={false} onDestroy={onDestroy} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))

    expect(screen.getByText('Remove Planning call?')).toBeTruthy()
    expect(onDestroy).not.toHaveBeenCalled()
  })

  it('does it once the answer is yes', () => {
    const onDestroy = vi.fn()
    render(<Destroy what="Planning call" busy={false} onDestroy={onDestroy} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Planning call' }))

    expect(onDestroy).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when the answer is no, and offers the same control again', () => {
    const onDestroy = vi.fn()
    render(<Destroy what="Planning call" busy={false} onDestroy={onDestroy} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(onDestroy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove Planning call' })).toBeTruthy()
  })

  it('closes the question after answering yes, so a second press is a fresh decision', () => {
    render(<Destroy what="Planning call" busy={false} onDestroy={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Planning call' }))

    expect(screen.getByRole('button', { name: 'Remove Planning call' })).toBeTruthy()
  })

  it('says what else goes with it, where something does', () => {
    render(
      <Destroy
        what="Sauna at dawn"
        verb="Withdraw"
        because="Its helpers and hearts go too."
        busy={false}
        onDestroy={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Sauna at dawn' }))

    expect(screen.getByText('Withdraw Sauna at dawn? Its helpers and hearts go too.')).toBeTruthy()
  })

  it('takes the verb into the question and into the answer', () => {
    render(<Destroy what="Nature of Love" verb="Take out" busy={false} onDestroy={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Take out Nature of Love' }))

    expect(screen.getByRole('button', { name: 'Really take out Nature of Love' })).toBeTruthy()
  })

  it('wears a word rather than a bin where the control is part of a sentence', () => {
    render(
      <Destroy
        what="your place at Summer burn"
        verb="Leave"
        trigger="I cannot come after all"
        busy={false}
        onDestroy={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'I cannot come after all' }))

    expect(screen.getByText('Leave your place at Summer burn?')).toBeTruthy()
  })

  it('keeps an accessible name the call site needs, where the word alone says too little', () => {
    render(
      <Destroy
        what="a passkey"
        trigger="Remove"
        triggerLabel="Remove the phone"
        busy={false}
        onDestroy={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove the phone' }).textContent).toBe('Remove')
  })

  it('presses nothing while something else is in flight', () => {
    const onDestroy = vi.fn()
    render(<Destroy what="Planning call" busy onDestroy={onDestroy} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))

    expect(screen.queryByText('Remove Planning call?')).toBeNull()
  })

  it('takes focus to the answer, the trigger it replaced having gone', () => {
    render(<Destroy what="Planning call" busy={false} onDestroy={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Really remove Planning call' }))
  })

  it('hands focus back to the trigger when the answer is no', () => {
    render(<Destroy what="Planning call" busy={false} onDestroy={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Planning call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Planning call' }))
  })

  it('reaches for nothing on the way in, so a page of these does not fight over focus', () => {
    render(
      <>
        <Destroy what="the first" busy={false} onDestroy={vi.fn()} />
        <Destroy what="the second" busy={false} onDestroy={vi.fn()} />
      </>,
    )

    expect(document.activeElement).toBe(document.body)
  })

  it('describes both answers with the question, which nothing else announces', () => {
    render(
      <Destroy
        what="Sauna at dawn"
        verb="Withdraw"
        because="Its helpers and hearts go too."
        busy={false}
        onDestroy={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Sauna at dawn' }))

    const asked = screen.getByText('Withdraw Sauna at dawn? Its helpers and hearts go too.')

    for (const name of ['Really withdraw Sauna at dawn', 'Keep it']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-describedby')).toBe(asked.id)
    }
  })

  it('marks the one being worked on rather than dimming every other', () => {
    render(<Destroy what="Planning call" busy={false} working onDestroy={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Remove Planning call' }).getAttribute('aria-busy')).toBe(
      'true',
    )
  })
})
