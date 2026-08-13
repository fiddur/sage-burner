import type { ApplicationMessage } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApplicationThread } from './ApplicationThread.tsx'

afterEach(cleanup)

const aMessage = (
  over: Partial<ApplicationMessage> & Pick<ApplicationMessage, 'id'>,
): ApplicationMessage => ({
  author_account_id: 'a-1',
  author_name: 'Fredrik',
  body: 'Hello',
  mine: true,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const draw = (messages: readonly ApplicationMessage[], onSay: (body: string) => void = vi.fn()) =>
  render(<ApplicationThread messages={messages} busy={false} subject="Fredrik" onSay={onSay} />)

const box = () => screen.getByRole('textbox', { name: 'Say something to Fredrik' })

describe('the thread on an application', () => {
  it('sends what was typed, trimmed', () => {
    const onSay = vi.fn()
    draw([], onSay)

    fireEvent.input(box(), { target: { value: '  When does it start?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSay).toHaveBeenCalledWith('When does it start?')
  })

  it('keeps the draft through a refetch that brought nothing new, the send not having landed', () => {
    const { rerender } = draw([aMessage({ id: 'm-1' })])

    fireEvent.input(box(), { target: { value: 'When does it start?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    rerender(
      <ApplicationThread
        messages={[aMessage({ id: 'm-1' })]}
        busy={false}
        subject="Fredrik"
        onSay={vi.fn()}
      />,
    )

    expect(box()).toHaveProperty('value', 'When does it start?')
  })

  it('empties the box once the message it sent has arrived', () => {
    const { rerender } = draw([aMessage({ id: 'm-1' })])

    fireEvent.input(box(), { target: { value: 'When does it start?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    rerender(
      <ApplicationThread
        messages={[aMessage({ id: 'm-1' }), aMessage({ id: 'm-2', body: 'When does it start?' })]}
        busy={false}
        subject="Fredrik"
        onSay={vi.fn()}
      />,
    )

    expect(box()).toHaveProperty('value', '')
  })
})
