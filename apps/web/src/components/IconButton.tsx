import type { JSX } from 'preact'

/**
 * ✏️, 🗑️, 🙋 — a button whose whole face is one emoji (#147).
 *
 * A dozen rows carry these, and an emoji is not a name: without a label the button is
 * announced as "button" or, worse, as the emoji's own Unicode name. Every site wrote
 * the same five lines and every site had to remember `aria-label`. Here it is a
 * required prop, so forgetting it does not compile.
 *
 * `RowActions` was the shape #147 proposed, but the pair is not what repeats — only
 * `Places` and `Options` pair ✏️ with 🗑️. Elsewhere ✏️ sits beside a withdraw, a
 * two-step confirm, or a rename. The single button is the leaf.
 *
 * `busyIcon` is for the ones that wait on a round trip — the homepage's pen opens its
 * editor after a re-read (#335). The label does not change with the face, which is the
 * reason this belongs here rather than at `PendingButton`: there the label *is* the
 * wording, so a call site whose wording is an emoji had to pass `aria-label` beside it
 * and undo the contract. The state is `aria-busy` and `disabled`; `PendingButton` says
 * what those are worth.
 */
export const IconButton = ({
  icon,
  busyIcon,
  busy = false,
  label,
  disabled,
  ...rest
}: {
  icon: string
  /** The face while `busy`. Without one the icon simply stays put. */
  busyIcon?: string
  busy?: boolean
  /** What pressing this does, for anybody who cannot see the emoji. */
  label: string
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button
    type="button"
    class="link-button"
    aria-label={label}
    aria-busy={busy}
    disabled={busy || disabled === true}
    {...rest}
  >
    {busy ? (busyIcon ?? icon) : icon}
  </button>
)
