import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { Table } from './Table.tsx'

afterEach(cleanup)

const aTable = (also?: string) => (
  <Table class={also}>
    <tbody>
      <tr>
        <td>Ada</td>
      </tr>
    </tbody>
  </Table>
)

describe('the shared table', () => {
  it('sits in a box that scrolls, so a wide one does not take the page with it', () => {
    render(aTable())

    expect(screen.getByRole('table').parentElement?.className).toBe('table-wrap')
  })

  it('is still the shared table', () => {
    render(aTable())

    expect(screen.getByRole('table').className).toBe('table')
  })

  it('takes a class of its own without losing the shared one', () => {
    render(aTable('notification-settings'))

    expect(screen.getByRole('table').className).toBe('table notification-settings')
  })
})
