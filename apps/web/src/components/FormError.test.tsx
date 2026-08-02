import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { FormError } from './FormError.tsx'

afterEach(cleanup)

describe('FormError', () => {
  it('says nothing when there is nothing wrong', () => {
    render(<FormError message={undefined} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes focus, which is what scrolls it into view on a long form', () => {
    render(<FormError message="Please choose a password." />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('takes focus again when the complaint changes', () => {
    // Two guards failing in turn is one message replacing another in a node that
    // never unmounts. Without the message in the dependencies the second one
    // renders unfocused, so someone who scrolled away never learns of it.
    const { rerender } = render(<FormError message="Please tell us your name." />)
    const alert = screen.getByRole('alert')
    alert.blur()

    rerender(<FormError message="Please choose a password." />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })
})
