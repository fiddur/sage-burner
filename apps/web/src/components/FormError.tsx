import { useLayoutEffect, useRef } from 'preact/hooks'

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
export const FormError = ({ message }: { message: string | undefined }) => {
  const ref = useRef<HTMLParagraphElement | null>(null)

  // After the render that shows it, so there is a node to focus.
  useLayoutEffect(() => {
    if (message !== undefined) ref.current?.focus()
  }, [message])

  if (message === undefined) return null

  return (
    <p class="form-error" role="alert" tabIndex={-1} ref={ref}>
      {message}
    </p>
  )
}
