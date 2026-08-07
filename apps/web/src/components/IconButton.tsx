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
 */
export const IconButton = ({
  icon,
  label,
  ...rest
}: {
  icon: string
  /** What pressing this does, for anybody who cannot see the emoji. */
  label: string
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button type="button" class="link-button" aria-label={label} {...rest}>
    {icon}
  </button>
)
