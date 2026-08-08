import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { PendingButton } from './PendingButton.tsx'

afterEach(cleanup)

describe('a button that says what it is doing', () => {
  it('reads as its label and is pressable when nothing is in flight', () => {
    render(<PendingButton busy={false} label="Save" busyLabel="Saving…" />)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
  })

  it('reads as the busy wording while it is', () => {
    render(<PendingButton busy label="Save" busyLabel="Saving…" />)

    expect(screen.getByRole('button', { name: 'Saving…' })).not.toBeNull()
  })

  it('cannot be pressed again while busy, which is the pair this exists to keep', () => {
    render(<PendingButton busy label="Save" busyLabel="Saving…" />)

    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true)
  })

  it("honours the caller's own reason for disabling", () => {
    render(<PendingButton busy={false} label="Save" busyLabel="Saving…" disabled />)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  it('says it is busy where a screen reader can find it', () => {
    // Not announced — `aria-busy` outside a live region rarely is — but it is the
    // only answer to "why is this button dead" for anybody who cannot see the
    // wording change, and `disabled` alone does not give one.
    render(<PendingButton busy label="Save" busyLabel="Saving…" />)

    expect(screen.getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true')
  })

  it('does not claim to be busy when nothing is in flight', () => {
    // The side nothing pinned: a button stuck at `aria-busy="true"` reads as
    // permanently unavailable to whoever it was written for.
    render(<PendingButton busy={false} label="Save" busyLabel="Saving…" />)

    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBe('false')
  })

  it('passes the rest through, so it is still an ordinary button', () => {
    render(<PendingButton busy={false} label="Save" busyLabel="Saving…" type="submit" class="wide" />)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.className).toContain('wide')
  })
})
