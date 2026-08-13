import type { NotificationLogEntry } from '@sage-burner/shared'

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { NotificationLogApi } from './AdminNotificationLog.tsx'

import { ViewerProvider } from '../viewer.tsx'
import { AdminNotificationLog, devices } from './AdminNotificationLog.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['admin'] },
}

const anEntry = (over: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  id: 'n-1',
  category: 'payment',
  body: 'Your payment is recorded',
  link: '/',
  created_at: '2026-08-03T12:30:00.000Z',
  told: 1,
  suppressed: 0,
  emailed: 0,
  accepted: 1,
  failed: 0,
  gone: 0,
  ...over,
})

const stub = (entries: NotificationLogEntry[]): NotificationLogApi => ({
  getNotificationLog: () => Promise.resolve({ entries }),
})

const renderPage = (api: NotificationLogApi) =>
  render(
    <ViewerProvider viewer={ADMIN}>
      <AdminNotificationLog api={api} />
    </ViewerProvider>,
  )

describe('the notification log', () => {
  it('says what went out and how many heard it', async () => {
    renderPage(stub([anEntry({ told: 12, suppressed: 3 })]))

    expect(await screen.findByText('Your payment is recorded')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('says nothing has gone out where nothing has', async () => {
    renderPage(stub([]))

    expect(await screen.findByText('Nothing has gone out yet.')).toBeTruthy()
  })
})

describe('what a row says about the devices', () => {
  it('counts what was taken against what was tried', () => {
    expect(devices(anEntry({ accepted: 2, failed: 1, gone: 1 }))).toBe('2 of 4')
  })

  it('says nobody had one registered rather than "0 of 0"', () => {
    expect(devices(anEntry({ accepted: 0, failed: 0, gone: 0 }))).toBe('none registered')
  })
})
