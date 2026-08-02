import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { FormError, useFormError } from './FormError.tsx'

afterEach(cleanup)

describe('FormError', () => {
  it('says nothing when there is nothing wrong', () => {
    render(<FormError error={{ message: undefined, attempt: 0 }} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes focus, which is what scrolls it into view on a long form', () => {
    render(<FormError error={{ message: 'Please choose a password.', attempt: 1 }} />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('takes focus again when the complaint changes', () => {
    // Two guards failing in turn is one message replacing another in a node that
    // never unmounts. Without the message in the dependencies the second one
    // renders unfocused, so someone who scrolled away never learns of it.
    const { rerender } = render(<FormError error={{ message: 'Please tell us your name.', attempt: 1 }} />)
    screen.getByRole('alert').blur()

    rerender(<FormError error={{ message: 'Please choose a password.', attempt: 2 }} />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('takes focus again on the same complaint, which is a different attempt', () => {
    // The message is all the DOM has to go on and it is identical, so without the
    // count there is nothing here to tell a second failure from a redraw.
    const { rerender } = render(<FormError error={{ message: 'Not that.', attempt: 1 }} />)
    screen.getByRole('alert').blur()

    rerender(<FormError error={{ message: 'Not that.', attempt: 2 }} />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('leaves focus where it is on a render that is not an attempt', () => {
    // The reason this is a count rather than "focus on every render": a keystroke
    // in the field being corrected re-renders the form, and stealing the caret
    // back to the message each time would make the form unusable.
    const { rerender } = render(<FormError error={{ message: 'Not that.', attempt: 1 }} />)
    const alert = screen.getByRole('alert')
    alert.blur()

    rerender(<FormError error={{ message: 'Not that.', attempt: 1 }} />)

    expect(document.activeElement).not.toBe(alert)
  })
})

describe('useFormError', () => {
  /** The shape every submit handler has: clear, then complain, in one tick. */
  const Form = ({ complaint }: { complaint: string }) => {
    const [error, setError] = useFormError()

    return (
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          setError(undefined)
          setError(complaint)
        }}
      >
        <FormError error={error} />
        <button type="submit">Send</button>
      </form>
    )
  }

  it('counts an attempt that says exactly what the last one said', () => {
    // Both calls resolve against the same pending value before anything commits,
    // so the committed message never changes. The count is what survives that.
    render(<Form complaint="Not that." />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    screen.getByRole('alert').blur()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })
})
