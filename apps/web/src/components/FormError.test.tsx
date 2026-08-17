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
    const { rerender } = render(<FormError error={{ message: 'Please tell us your name.', attempt: 1 }} />)
    screen.getByRole('alert').blur()

    rerender(<FormError error={{ message: 'Please choose a password.', attempt: 2 }} />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('takes focus again on the same complaint, which is a different attempt', () => {
    const { rerender } = render(<FormError error={{ message: 'Not that.', attempt: 1 }} />)
    screen.getByRole('alert').blur()

    rerender(<FormError error={{ message: 'Not that.', attempt: 2 }} />)

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })

  it('leaves focus where it is on a render that is not an attempt', () => {
    const { rerender } = render(<FormError error={{ message: 'Not that.', attempt: 1 }} />)
    const alert = screen.getByRole('alert')
    alert.blur()

    rerender(<FormError error={{ message: 'Not that.', attempt: 1 }} />)

    expect(document.activeElement).not.toBe(alert)
  })
})

describe('useFormError', () => {
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
    render(<Form complaint="Not that." />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    screen.getByRole('alert').blur()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })
})
