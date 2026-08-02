import { useLayoutEffect, useRef, useState } from 'preact/hooks'

/** A complaint, and which attempt produced it. */
export interface FormErrorState {
  message: string | undefined
  attempt: number
}

/**
 * A form's error state, counted rather than merely stored.
 *
 * The count is what makes a repeated failure a new event. A submit handler
 * clears the error and sets it again in one tick, so two identical failures in a
 * row commit the same string — nothing about the message has changed, and an
 * effect watching only the message would sit out the second attempt. Which is
 * the original symptom returning: tap, read it, tap again, nothing happens.
 */
export const useFormError = () => {
  const [error, setState] = useState<FormErrorState>({ message: undefined, attempt: 0 })

  const setError = (message: string | undefined) => {
    setState((previous) => ({ message, attempt: previous.attempt + 1 }))
  }

  return [error, setError] as const
}

/**
 * A form's complaint about what was just submitted.
 *
 * Render it immediately before the submit button, not at the top of the form.
 * These forms are taller than a phone screen, so a message above the first field
 * is off screen when the button is tapped — which reads as the button doing
 * nothing at all, and that is what someone joining actually reported.
 *
 * Focusing it is the other half: it scrolls itself into view with no scrolling
 * code here, and a screen reader announces it on arrival rather than only when
 * `role="alert"` happens to fire.
 */
export const FormError = ({ error }: { error: FormErrorState }) => {
  const ref = useRef<HTMLParagraphElement | null>(null)

  // Keyed on the attempt, not the message. Every submit refocuses; an unrelated
  // render — a keystroke in the field they are correcting — must not, or the
  // caret is snatched out of the box mid-fix.
  useLayoutEffect(() => {
    if (error.message !== undefined) ref.current?.focus()
  }, [error.attempt, error.message])

  if (error.message === undefined) return null

  return (
    <p class="form-error" role="alert" tabIndex={-1} ref={ref}>
      {error.message}
    </p>
  )
}
