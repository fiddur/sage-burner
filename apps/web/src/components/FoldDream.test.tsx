import type { Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FoldDream } from './FoldDream.tsx'

afterEach(cleanup)

const aDream = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  event_id: 'e-1',
  facilitator_account_id: 'a-1',
  description: '',
  repeatable: false,
  time_slot_start: null,
  time_slot_end: null,
  place_id: null,
  withdrawn_at: null,
  merged_into_id: null,
  helpers: [],
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  thread_id: null,
  ...over,
})

const show = (busy = false) =>
  render(
    <FoldDream
      dream={aDream({ id: 's-2', title: 'Morning yoga' })}
      others={[aDream({ id: 's-1', title: 'Sunrise yoga' })]}
      busy={busy}
      onFold={vi.fn()}
    />,
  )

describe('folding a dream into another', () => {
  it('takes focus to the choice, the trigger it replaced having gone', () => {
    show()

    fireEvent.click(screen.getByRole('button', { name: 'Fold into another dream…' }))

    expect(document.activeElement).toBe(screen.getByLabelText('Fold Morning yoga into'))
  })

  it('hands focus back to the trigger when they are kept apart', () => {
    show()

    fireEvent.click(screen.getByRole('button', { name: 'Fold into another dream…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it apart' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fold into another dream…' }))
  })

  it('reaches for nothing on the way in, so a page of these does not fight over focus', () => {
    show()

    expect(document.activeElement).toBe(document.body)
  })
})
