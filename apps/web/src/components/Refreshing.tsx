/**
 * A small turning ring beside a heading, while the page it names is being refetched.
 *
 * Its whole job is to say that what is under it came from a moment ago and is being
 * checked — the state `useLoad`'s `remember` creates by drawing last time's data
 * instead of "Loading…". Without it the page looks settled while it is not.
 *
 * Distinct from `StaleData`, which is about data that could *not* be refreshed and
 * says so in words. This one is transient and says nothing, because there is nothing
 * to act on.
 */
export const Refreshing = ({ on }: { on: boolean }) =>
  on ? <span class="refreshing" role="status" aria-label="Updating" /> : null
