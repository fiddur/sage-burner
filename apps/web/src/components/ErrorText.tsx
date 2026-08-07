/**
 * Something went wrong, said where the reader is (#147).
 *
 * `<p class="form-error" role="alert">` behind an `{error !== undefined && …}` guard,
 * written out across twenty-eight files. This is that, with the guard folded in.
 *
 * `FormError` is the other one, and the choice between them is one question: **is the
 * reader waiting on a submit they just made?** A form taller than a phone screen puts
 * its complaint off-screen, which reads as a button that did nothing — so a submit's
 * error takes focus, which scrolls it into view. A notice about the page is not that,
 * and stealing focus for it would move somebody away from what they were reading.
 * `FormError` keeps an element of its own because it needs a `ref` and a `tabIndex`,
 * neither of which a Preact function component forwards.
 *
 * `id` is for a field's own complaint, which the input points at with
 * `aria-describedby`.
 */
export const ErrorText = ({ message, id }: { message: string | undefined; id?: string }) =>
  message === undefined ? null : (
    <p class="form-error" role="alert" id={id}>
      {message}
    </p>
  )
