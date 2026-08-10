export const WaitingListLine = ({ columns }: { columns: number }) => (
  <tr class="waiting-line">
    <th colSpan={columns} scope="colgroup">
      Waiting list
    </th>
  </tr>
)

export const startsTheWaitingList = (entries: readonly { waiting: boolean }[], index: number) =>
  (entries[index]?.waiting ?? false) && !(entries[index - 1]?.waiting ?? false)
