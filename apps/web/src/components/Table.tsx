import type { ComponentChildren } from 'preact'

export const Table = ({ class: also, children }: { class?: string; children: ComponentChildren }) => (
  <div class="table-wrap">
    <table class={also === undefined ? 'table' : `table ${also}`}>{children}</table>
  </div>
)
