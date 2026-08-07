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
 * `aria-busy` says the same thing the wording does, for the callers whose face is an
 * emoji: the homepage's pen becomes an hourglass, which changes nothing a screen reader
 * can read, and `disabled` alone does not say *why* it cannot be pressed.
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
