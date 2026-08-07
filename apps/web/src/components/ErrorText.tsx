/**
 * Something went wrong, said where the reader is (#147).
 *
 * `<p class="form-error" role="alert">` was written out fifty-odd times across
 * twenty-eight files, usually behind an `{error !== undefined && …}` guard. This is
 * that, with the guard folded in: nothing renders for no message, so a caller passes
 * whatever it has.
 *
 * **`role="alert"` is the whole of what this is.** It is announced when it appears,
 * and that is all — it does not move focus and does not scroll.
 *
 * `FormError` is the other one, and the choice between them is one question: **is
 * the reader waiting on a submit they just made?** A form taller than a phone
 * screen puts its complaint off-screen, which reads as a button that did nothing —
 * so a submit's error takes focus, which scrolls it into view and announces it on
 * arrival. A notice about the page — a list that would not load, a row that would
 * not delete — is not that, and stealing focus for it would move somebody away from
 * what they were reading.
 *
 * `FormError` keeps a `<p>` of its own rather than rendering this one: it needs a
 * `ref` and a `tabIndex` on the element, and a Preact function component does not
 * forward either. Two elements, one class, and the rule above for choosing.
 *
 * `id` is for a field's own complaint, which the input points at with
 * `aria-describedby` — without it those would each need a `<p>` back.
 */
export const ErrorText = ({ message, id }: { message: string | undefined; id?: string }) =>
  message === undefined ? null : (
    <p class="form-error" role="alert" id={id}>
      {message}
    </p>
  )
