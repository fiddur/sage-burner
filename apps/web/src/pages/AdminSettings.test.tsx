import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AdminSettingsApi } from './AdminSettings.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider, useInstallationTitle } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { AdminSettings } from './AdminSettings.tsx'

afterEach(cleanup)

const ADMIN: Viewer = { status: 'signed-in', account: { id: 'a-1', name: null, roles: ['admin'] } }

const stub = (over: Partial<AdminSettingsApi> = {}): AdminSettingsApi => ({
  getInstallation: () => Promise.resolve({ installation: { title: 'Sage Burner' } }),
  updateInstallation: () => Promise.reject(new Error('updateInstallation is not stubbed here')),
  // The toggle mounted here has its own tests; these keep it from reaching the API
  // when the page under test is about the title.
  getPushKey: () => Promise.resolve({ public_key: null }),
  subscribeToPush: () => Promise.reject(new Error('subscribeToPush is not stubbed here')),
  unsubscribeFromPush: () => Promise.reject(new Error('unsubscribeFromPush is not stubbed here')),
  ...over,
})

const renderPage = (api: AdminSettingsApi, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminSettings api={api} />
    </ViewerProvider>,
  )

const titleField = async () => await screen.findByRole('textbox')

describe('AdminSettings', () => {
  it('shows what the installation is called now', async () => {
    renderPage(stub())

    expect(await titleField()).toHaveProperty('value', 'Sage Burner')
  })

  it('renames it', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({ installation: { title: 'The Burning Sage' } }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: 'The Burning Sage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateInstallation).toHaveBeenCalledWith({ title: 'The Burning Sage' }))
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('trims what it sends, so a stray space is not a rename', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({ installation: { title: 'The Burning Sage' } }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: '  The Burning Sage  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateInstallation).toHaveBeenCalledWith({ title: 'The Burning Sage' }))
  })

  it('refuses a blank name here rather than letting the server say no', async () => {
    // `aria-required` rather than `required`, so the browser does not block the
    // submit before this message can be shown. The page is the only authority.
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({ installation: { title: '' } }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Give it a name')
    expect(updateInstallation).not.toHaveBeenCalled()
  })

  it('renames the header in the same moment, without a reload', async () => {
    // The header is `Layout`, several levels up and mounted once. Without the
    // shared setter a save leaves it saying the old name until the page is
    // reloaded, which reads as the save not having worked.
    const Header = () => <output aria-label="brand">{useInstallationTitle() ?? '-'}</output>
    render(
      <ViewerProvider viewer={ADMIN}>
        <InstallationProvider title="Sage Burner">
          <Header />
          <AdminSettings
            api={stub({
              updateInstallation: () => Promise.resolve({ installation: { title: 'The Burning Sage' } }),
            })}
          />
        </InstallationProvider>
      </ViewerProvider>,
    )

    fireEvent.input(await titleField(), { target: { value: 'The Burning Sage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'brand' }).textContent).toBe('The Burning Sage'),
    )
    await waitFor(() => expect(document.title).toBe('The Burning Sage'))
  })

  it('shows what the server said when it refuses', async () => {
    renderPage(
      stub({ updateInstallation: () => Promise.reject(apiError(400, 'bad_request', 'That will not do')) }),
    )

    fireEvent.input(await titleField(), { target: { value: 'Something' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getInstallation: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('sends a signed-out visitor to log in, rather than telling them to ask an admin', async () => {
    // This page was one of the five that showed a signed-out visitor "ask someone
    // who already has admin" — advice for somebody already signed in. #145 fixed it
    // once, in `GuardedPage`, rather than five times.
    const getInstallation = vi.fn<AdminSettingsApi['getInstallation']>(() =>
      Promise.resolve({ installation: { title: 'Sage Burner' } }),
    )
    renderPage(stub({ getInstallation }), { status: 'signed-out' })

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(getInstallation).not.toHaveBeenCalled()
  })

  it('tells somebody signed in without the role to ask, not to log in again', async () => {
    const getInstallation = vi.fn<AdminSettingsApi['getInstallation']>(() =>
      Promise.resolve({ installation: { title: 'Sage Burner' } }),
    )
    renderPage(stub({ getInstallation }), {
      status: 'signed-in',
      account: { id: 'a-9', name: null, roles: ['member'] },
    })

    expect(screen.getByText(/for organisers/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
    expect(getInstallation).not.toHaveBeenCalled()
  })
})
