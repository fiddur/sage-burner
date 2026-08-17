import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HelperStrip } from './HelperStrip.tsx'

afterEach(cleanup)

const ADA = { account_id: 'a-1', name: 'Ada', avatar: null }
const BEA = { account_id: 'a-2', name: 'Bea', avatar: '2026-08-01T00:00:00.000Z' }
const CAI = { account_id: 'a-3', name: 'Cai', avatar: null }

const strip = (over: Partial<Parameters<typeof HelperStrip>[0]> = {}) =>
  render(
    <HelperStrip
      label="the sauna"
      people={[]}
      candidates={[ADA, BEA, CAI]}
      everyone={[ADA, BEA, CAI]}
      viewerId="a-1"
      busy={false}
      onAdd={() => undefined}
      onRemove={() => undefined}
      {...over}
    />,
  )

const vacancies = () => [...document.querySelectorAll('.helper-vacancy')]

describe('HelperStrip', () => {
  it('draws each person as a face beside their name (#301)', () => {
    strip({ people: [ADA, BEA] })

    const badges = [...document.querySelectorAll('.person-badge')]

    expect(badges).toHaveLength(2)
    expect(badges[0]?.textContent).toContain('Ada')
    expect(badges[0]?.querySelector('img')).toBeNull()
    expect(badges[1]?.textContent).toContain('Bea')
    expect(badges[1]?.querySelector('img')?.getAttribute('src')).toContain('/api/accounts/a-2/avatar')
  })

  it('finds the face in `everyone`, not in `candidates`', () => {
    strip({ people: [BEA], candidates: [] })

    expect(document.querySelector('.person-badge img')).not.toBeNull()
  })

  it('falls back to the initials circle for somebody it has no face for', () => {
    strip({ people: [BEA], everyone: [] })

    const badge = document.querySelector('.person-badge')

    expect(badge?.textContent).toContain('Bea')
    expect(badge?.querySelector('img')).toBeNull()
  })

  it('shows a row per place still wanted', () => {
    strip({ people: [ADA], wanted: 3, viewerId: 'a-3' })

    expect(vacancies()).toHaveLength(2)
    expect(screen.getAllByText('wanted')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
  })

  it('still offers a place when the count is met', () => {
    strip({ people: [ADA, BEA], wanted: 2, viewerId: 'a-3' })

    expect(vacancies()).toHaveLength(1)
    expect(screen.queryByText('wanted')).toBeNull()
    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
  })

  it('offers a place where nobody has counted at all', () => {
    strip({ people: [], viewerId: 'a-3' })

    expect(vacancies()).toHaveLength(1)
    expect(screen.queryByText('wanted')).toBeNull()
  })

  it('puts the buttons on the first empty row and nowhere else', () => {
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
    expect(screen.getByRole('button', { name: 'Appoint someone to the sauna' })).toBeTruthy()
  })

  it('offers the hand to somebody not coming yet, so the refusal can say to join (#503)', () => {
    strip({ viewerId: 'a-9' })

    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
  })

  it('offers the hand on a burn nobody has joined yet, which is every burn on day one (#520)', () => {
    strip({ viewerId: 'a-9', candidates: [], everyone: [] })

    expect(screen.getByRole('button', { name: 'Take the spot on the sauna' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Appoint someone to the sauna' })).toBeNull()
  })

  it('offers no hand to somebody coming who is not eligible for this spot', () => {
    strip({ viewerId: 'a-9', candidates: [ADA], everyone: [ADA, { account_id: 'a-9', avatar: null }] })

    expect(screen.queryByRole('button', { name: 'Take the spot on the sauna' })).toBeNull()
  })

  it('offers nothing on a spot the page shut, which joining would not open', () => {
    strip({ viewerId: 'a-9', shut: true })

    expect(screen.queryByRole('button', { name: 'Take the spot on the sauna' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Appoint someone to the sauna' })).toBeNull()
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
    strip({ viewerId: 'a-3' })

    const hand = screen.getByRole('button', { name: 'Take the spot on the sauna' })
    expect(hand.getAttribute('title')).toBe('Take the spot')
  })
})
