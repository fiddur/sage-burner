import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewerProvider } from '../viewer.tsx'
import { LogOutButton } from './LogOutButton.tsx'

afterEach(cleanup)

describe('logging out', () => {
  it('empties the cache before it asks the server, which is the half that has to happen', async () => {
    // #268. The comment claimed the order and nothing held it up — and the order is
    // the whole point: a logout that throws must already have taken the roster off
    // the device.
    const order: string[] = []
    const forget = vi.fn(() => {
      order.push('forget')
      return Promise.resolve(true)
    })
    const logout = vi.fn(() => {
      order.push('logout')
      return Promise.reject(new TypeError('Failed to fetch'))
    })

    render(
      <ViewerProvider
        viewer={{ status: 'signed-in', account: { id: 'a-1', name: null, avatar: null, roles: ['member'] } }}
      >
        <LogOutButton api={{ logout }} forget={forget} />
      </ViewerProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(order).toEqual(['forget', 'logout'])
  })
})
