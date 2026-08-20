import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NEEDS_JOINING } from '../joining.ts'
import { DreamPanel } from './DreamPanel.tsx'

afterEach(cleanup)

const panel = (over: Partial<Parameters<typeof DreamPanel>[0]> = {}) =>
  render(
    <DreamPanel label="Sauna at dawn" error={undefined} onClose={() => undefined} {...over}>
      <p>the dream</p>
    </DreamPanel>,
  )

describe('the panel a dream and a meal open in', () => {
  it('carries the join nudge with the link, the panel being where 🙋 was pressed (#521)', () => {
    panel({ error: NEEDS_JOINING })

    const said = screen.getByRole('alert')
    expect(said.textContent).toContain('You need to join this burn')
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe('/profile')
  })

  it('links nothing on a failure that is not about joining', () => {
    panel({ error: 'Could not save that. Please try again.' })

    expect(screen.getByRole('alert').textContent).toContain('Could not save that')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says nothing where nothing went wrong', () => {
    panel()

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes on Escape, and on a press outside it', () => {
    const onClose = vi.fn()
    panel({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(document.querySelector('.dream-modal') ?? document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('goes back rather than closing where there is somewhere to go back to', () => {
    const onBack = vi.fn()
    const onClose = vi.fn()
    panel({ onBack, onClose })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the way out of a panel that covers a phone whole', () => {
  it('offers a ✕ named for what it closes, and closes outright even where Escape goes back', () => {
    const onBack = vi.fn()
    const onClose = vi.fn()
    panel({ onBack, onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close Sauna at dawn' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('closing a panel that holds something nobody else has', () => {
  const asking = (over: Partial<Parameters<typeof DreamPanel>[0]> = {}) =>
    panel({ askBeforeClosing: 'Throw this dream away?', ...over })

  it('asks rather than closing on the ✕', () => {
    const onClose = vi.fn()
    asking({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close Sauna at dawn' }))

    expect(screen.getByText('Throw this dream away?')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes once the question is answered', () => {
    const onClose = vi.fn()
    asking({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close Sauna at dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Throw it away' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('puts the question away again on Keep writing, leaving the panel up', () => {
    const onClose = vi.fn()
    asking({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close Sauna at dawn' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }))

    expect(screen.queryByText('Throw this dream away?')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks on Escape and on the backdrop too, which lose it just as thoroughly', () => {
    const onClose = vi.fn()
    asking({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    expect(screen.getByText('Throw this dream away?')).toBeTruthy()
  })

  it('asks nothing where there is nothing to lose', () => {
    const onClose = vi.fn()
    panel({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close Sauna at dawn' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
