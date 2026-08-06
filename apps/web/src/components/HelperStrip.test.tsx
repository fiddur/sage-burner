import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Person } from './HelperStrip.tsx'

import { HelperStrip, meFirst } from './HelperStrip.tsx'

afterEach(cleanup)

const ADA = { account_id: 'a-1', name: 'Ada' }
const BEA = { account_id: 'a-2', name: 'Bea' }
const CAI = { account_id: 'a-3', name: 'Cai' }

const strip = (over: Partial<Parameters<typeof HelperStrip>[0]> = {}) =>
  render(
    <HelperStrip
      label="the sauna"
      people={[]}
      candidates={[ADA, BEA, CAI]}
      viewerId="a-1"
      busy={false}
      onAdd={() => undefined}
      onRemove={() => undefined}
      {...over}
    />,
  )

const vacancies = () => [...document.querySelectorAll('.helper-vacancy')]

describe('HelperStrip', () => {
  it('shows a row per place still wanted', () => {
    strip({ people: [ADA], wanted: 3, viewerId: 'a-3' })

    // Two short of three, and the buttons sit on the first of those rather than on
    // a row of their own — an extra row appears only when nothing is short.
    expect(vacancies()).toHaveLength(2)
    expect(screen.getAllByText('wanted')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
  })

  it('still offers a place when the count is met', () => {
    // #27's rule: the offer outlives the count, because a pair of hands is not a
    // bed. The row is there, and it does not claim anybody is wanted.
    strip({ people: [ADA, BEA], wanted: 2, viewerId: 'a-3' })

    expect(vacancies()).toHaveLength(1)
    expect(screen.queryByText('wanted')).toBeNull()
    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
  })

  it('offers a place where nobody has counted at all', () => {
    // A dream's helpers and a meal's crew have no wanted number.
    strip({ people: [], viewerId: 'a-3' })

    expect(vacancies()).toHaveLength(1)
    expect(screen.queryByText('wanted')).toBeNull()
  })

  it('puts the buttons on the first empty row and nowhere else', () => {
    // Slots are interchangeable, so one pair of controls fills the next free place
    // and the rows below are pure count.
    strip({ people: [], wanted: 4, viewerId: 'a-3' })

    expect(screen.getAllByRole('button', { name: 'Take the spot on the sauna' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Appoint someone to the sauna' })).toHaveLength(1)
  })

  it('takes the spot for whoever pressed it', () => {
    const onAdd = vi.fn()
    strip({ viewerId: 'a-3', onAdd })

    screen.getByRole('button', { name: 'Take the spot on the sauna' }).click()

    expect(onAdd).toHaveBeenCalledWith('a-3')
  })

  it('offers no hand to somebody already on it', () => {
    strip({ people: [ADA], viewerId: 'a-1' })

    expect(screen.queryByRole('button', { name: 'Take the spot on the sauna' })).toBeNull()
    // Appointing somebody else is still there — being on it does not stop you
    // putting a second pair of hands up for it.
    expect(screen.getByRole('button', { name: 'Appoint someone to the sauna' })).toBeTruthy()
  })

  it('offers no hand to somebody who could not be appointed either', () => {
    // An organiser holding `admin` without `member`: these are held by an
    // attendance, so somebody not coming has nothing to put a hand up for. The
    // caller filters them out of `candidates`, and that decides both.
    strip({ viewerId: 'a-9' })

    expect(screen.queryByRole('button', { name: 'Take the spot on the sauna' })).toBeNull()
  })

  it('never offers you in the appoint list, since 🙋 is that route', () => {
    strip({ viewerId: 'a-1' })

    fireEvent.click(screen.getByRole('button', { name: 'Appoint someone to the sauna' }))

    expect(screen.queryByRole('option', { name: 'Ada' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Bea' })).toBeTruthy()
  })

  it('never offers somebody already on it', () => {
    strip({ people: [BEA], viewerId: 'a-1' })

    fireEvent.click(screen.getByRole('button', { name: 'Appoint someone to the sauna' }))

    expect(screen.queryByRole('option', { name: 'Bea' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Cai' })).toBeTruthy()
  })

  it('appoints the one chosen and closes the picker', () => {
    const onAdd = vi.fn()
    strip({ viewerId: 'a-1', onAdd })

    fireEvent.click(screen.getByRole('button', { name: 'Appoint someone to the sauna' }))
    fireEvent.change(screen.getByLabelText('Who to appoint to the sauna'), { target: { value: 'a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Appoint' }))

    expect(onAdd).toHaveBeenCalledWith('a-2')
    expect(screen.queryByLabelText('Who to appoint to the sauna')).toBeNull()
  })

  it('takes somebody off', () => {
    const onRemove = vi.fn()
    strip({ people: [ADA, BEA], onRemove })

    screen.getByRole('button', { name: 'Take Bea off the sauna' }).click()

    expect(onRemove).toHaveBeenCalledWith('a-2')
  })

  it('says what it means on a phone, not only on hover', () => {
    // `title` is a desktop tooltip and nothing at all to a thumb or a screen
    // reader, so the meaning is in the accessible name as well.
    strip({ viewerId: 'a-3' })

    const hand = screen.getByRole('button', { name: 'Take the spot on the sauna' })
    expect(hand.getAttribute('title')).toBe('Take the spot')
  })
})

describe('meFirst', () => {
  it('puts the viewer at the top, named, and sorts the rest', () => {
    const ordered = meFirst([CAI, ADA, BEA], 'a-2')

    expect(ordered.map((person) => person.name)).toEqual(['Me — Bea', 'Ada', 'Cai'])
  })

  it('says just Me for somebody who has not filled a name in', () => {
    // `Me — Someone without a name yet` reads as a bug rather than as a name.
    const nameless: Person = { account_id: 'a-4', name: null }

    expect(meFirst([ADA, nameless], 'a-4')[0]?.name).toBe('Me')
  })

  it('leaves the list alone when the viewer is not in it', () => {
    expect(meFirst([CAI, ADA], 'a-9').map((person) => person.name)).toEqual(['Ada', 'Cai'])
  })
})
