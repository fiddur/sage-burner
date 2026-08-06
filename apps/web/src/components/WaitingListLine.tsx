/**
 * Where the places run out (#23).
 *
 * A row in the table rather than a second table, because it is one list in one
 * order — `withPlaces` decides who is above the line and both pages read it, so a
 * split into two tables would be two chances to disagree about who has a place.
 */
export const WaitingListLine = ({ columns }: { columns: number }) => (
  <tr class="waiting-line">
    <th colSpan={columns} scope="colgroup">
      Waiting list
    </th>
  </tr>
)

/** Whether the divider belongs above `index` — the first waiting row, and only it. */
export const startsTheWaitingList = (entries: readonly { waiting: boolean }[], index: number) =>
  (entries[index]?.waiting ?? false) && !(entries[index - 1]?.waiting ?? false)
