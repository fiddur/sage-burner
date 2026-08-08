import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AdminSettingsApi } from './AdminSettings.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider, useInstallationTitle } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { AdminSettings } from './AdminSettings.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['admin'] },
}

const stub = (over: Partial<AdminSettingsApi> = {}): AdminSettingsApi => ({
  getInstallation: () =>
    Promise.resolve({ installation: { title: 'Sage Burner', banner_updated_at: null, sends_email: false } }),
  // The mail form mounted here has its own tests; this keeps it from reaching the API
  // when the page under test is about the title.
  getMailSettings: () => Promise.resolve({ mail: null }),
  updateMailSettings: () => Promise.reject(new Error('updateMailSettings is not stubbed here')),
  removeMailSettings: () => Promise.reject(new Error('removeMailSettings is not stubbed here')),
  sendTestEmail: () => Promise.reject(new Error('sendTestEmail is not stubbed here')),
  updateInstallation: () => Promise.reject(new Error('updateInstallation is not stubbed here')),
  // The toggle mounted here has its own tests; these keep it from reaching the API
  // when the page under test is about the title.
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  getPushKey: () => Promise.resolve({ public_key: null }),
  subscribeToPush: () => Promise.reject(new Error('subscribeToPush is not stubbed here')),
  unsubscribeFromPush: () => Promise.reject(new Error('unsubscribeFromPush is not stubbed here')),
  setInstallationIcon: () => Promise.reject(new Error('setInstallationIcon is not stubbed here')),
  removeInstallationIcon: () => Promise.reject(new Error('removeInstallationIcon is not stubbed here')),
  setInstallationBanner: () => Promise.reject(new Error('setInstallationBanner is not stubbed here')),
  removeInstallationBanner: () => Promise.reject(new Error('removeInstallationBanner is not stubbed here')),
  logout: () => Promise.reject(new Error('logout is not stubbed here')),
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

  it('offers the way out, for the account the details page refuses', async () => {
    // The whole justification for a second Log out button (#195): the details page is
    // `require="member"`, so an account holding `admin` without `member` is turned
    // away from the only other one. Nothing asserted it, so deleting this button left
    // the suite green and stranded that account signed in.
    renderPage(stub(), {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: ['admin'] },
    })

    expect(await screen.findByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('is where both pictures are chosen — the home screen’s and a shared link’s', async () => {
    // Two uploads on one page, and neither is inside the form that saves the title:
    // they save on choosing a file, and a file input in that form would be two ways
    // to save one page.
    renderPage(stub())

    expect(await screen.findByLabelText('The icon on a home screen')).toBeTruthy()
    expect(screen.getByLabelText('The picture a shared link shows')).toBeTruthy()
  })

  it('renames it', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({
        installation: { title: 'The Burning Sage', banner_updated_at: null, sends_email: false },
      }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: 'The Burning Sage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateInstallation).toHaveBeenCalledWith({ title: 'The Burning Sage' }))
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('trims what it sends, so a stray space is not a rename', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({
        installation: { title: 'The Burning Sage', banner_updated_at: null, sends_email: false },
      }),
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
      Promise.resolve({ installation: { title: '', banner_updated_at: null, sends_email: false } }),
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
              updateInstallation: () =>
                Promise.resolve({
                  installation: { title: 'The Burning Sage', banner_updated_at: null, sends_email: false },
                }),
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
      Promise.resolve({
        installation: { title: 'Sage Burner', banner_updated_at: null, sends_email: false },
      }),
    )
    renderPage(stub({ getInstallation }), { status: 'signed-out' })

    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(getInstallation).not.toHaveBeenCalled()
  })

  it('tells somebody signed in without the role to ask, not to log in again', async () => {
    const getInstallation = vi.fn<AdminSettingsApi['getInstallation']>(() =>
      Promise.resolve({
        installation: { title: 'Sage Burner', banner_updated_at: null, sends_email: false },
      }),
    )
    renderPage(stub({ getInstallation }), {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: ['member'] },
    })

    expect(screen.getByText(/for admins/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
    expect(getInstallation).not.toHaveBeenCalled()
  })
})
