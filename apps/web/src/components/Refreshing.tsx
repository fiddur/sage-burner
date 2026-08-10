export const Refreshing = ({ on }: { on: boolean }) =>
  on ? <span class="refreshing" role="status" aria-label="Updating" /> : null
