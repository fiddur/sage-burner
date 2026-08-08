import type { ComponentChildren } from 'preact'

/**
 * The shared table — the members list, the roster, the accounts, the invites, the
 * notification switches — inside the box that scrolls it (#339).
 *
 * A table with more columns than a phone has room for overflowed the body, so a
 * sideways drag on Members took the whole page with it, nav and all. The schedule
 * grid, the meal plan and the leads register had each grown a wrapper of their own;
 * a fourth copy is a component instead, so the next one of these cannot be added
 * without the box.
 *
 * That matters more now the nav is fixed to the bottom on a phone (#337): a page
 * sliding sideways under a bar that does not looks broken in a way it did not before.
 */
export const Table = ({ class: also, children }: { class?: string; children: ComponentChildren }) => (
  <div class="table-wrap">
    <table class={also === undefined ? 'table' : `table ${also}`}>{children}</table>
  </div>
)
