import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { ErrorText } from './ErrorText.tsx'

afterEach(cleanup)

describe('saying something went wrong', () => {
  it('announces the message when there is one', () => {
    render(<ErrorText message="Could not load the list." />)

    expect(screen.getByRole('alert').textContent).toBe('Could not load the list.')
  })

  it('renders nothing at all for no message, which is the guard it folds in', () => {
    const { container } = render(<ErrorText message={undefined} />)

    expect(container.innerHTML).toBe('')
  })

  it('takes an id, so an input can point at it with aria-describedby', () => {
    render(<ErrorText message="Please tell us your name." id="applicant_name-error" />)

    expect(screen.getByRole('alert').getAttribute('id')).toBe('applicant_name-error')
  })
})
