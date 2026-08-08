import type { JSX } from 'preact'

/**
 * A button that says what it is doing while it does it (#147).
 *
 * Thirteen buttons across the app wrote out `{saving ? 'Saving…' : 'Save'}` beside
 * `disabled={saving || …}`, and those two are one fact said twice: a button reading
 * "Saving…" that is still pressable submits the form again. Here `busy` decides both,
 * so they cannot come apart.
 *
 * The wording stays the caller's. "Saving…", "Signing in…" and "Setting you up…" say
 * different things about how long to expect, and a shared "One moment…" would lose
 * that for nothing.
 *
 * `aria-busy` makes the state **discoverable**, which is less than the wording does and
 * is worth being exact about: flipping it on a button outside a live region is not
 * announced by most screen readers, and the accessible name does not change with it —
 * so somebody landing on the button hears "Save, button, unavailable" and can find out
 * why, rather than being told. The alternative is no answer to "why is this dead", so
 * it stays. `IconButton` carries the same attribute for the same reason.
 */
export const PendingButton = ({
  busy,
  label,
  busyLabel,
  disabled,
  ...rest
}: {
  busy: boolean
  label: string
  busyLabel: string
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button {...rest} disabled={busy || disabled === true} aria-busy={busy}>
    {busy ? busyLabel : label}
  </button>
)
