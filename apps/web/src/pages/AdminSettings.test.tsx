import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
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
    Promise.resolve({
      installation: {
        title: 'Sage Burner',
        banner_updated_at: null,
        icon_updated_at: null,
        sends_email: false,
        social_logins: [],
      },
    }),
  getMapLink: () => Promise.resolve({ map: { url: null } }),
  setMapLink: () => Promise.reject(new Error('setMapLink is not stubbed here')),
  getMailSettings: () => Promise.resolve({ mail: null }),
  getOauthSettings: () => Promise.resolve({ settings: null }),
  updateOauthSettings: () => Promise.reject(new Error('updateOauthSettings is not stubbed here')),
  removeOauthSettings: () => Promise.reject(new Error('removeOauthSettings is not stubbed here')),
  updateMailSettings: () => Promise.reject(new Error('updateMailSettings is not stubbed here')),
  removeMailSettings: () => Promise.reject(new Error('removeMailSettings is not stubbed here')),
  sendTestEmail: () => Promise.reject(new Error('sendTestEmail is not stubbed here')),
  sendDigestPreview: () => Promise.resolve({ sent: true, to: 'admin@example.org', reason: null }),
  updateInstallation: () => Promise.reject(new Error('updateInstallation is not stubbed here')),
  setInstallationIcon: () => Promise.reject(new Error('setInstallationIcon is not stubbed here')),
  removeInstallationIcon: () => Promise.reject(new Error('removeInstallationIcon is not stubbed here')),
  setInstallationBanner: () => Promise.reject(new Error('setInstallationBanner is not stubbed here')),
  removeInstallationBanner: () => Promise.reject(new Error('removeInstallationBanner is not stubbed here')),
  ...over,
})

const renderPage = (api: AdminSettingsApi, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminSettings api={api} />
    </ViewerProvider>,
  )

const titleForm = async () => {
  const form = (await screen.findByText('What these burns are called')).closest('form')
  if (form === null) throw new Error('the title field has no form around it')

  return within(form)
}

const titleField = async () => (await titleForm()).getByRole('textbox')
const saveTitle = async () => (await titleForm()).getByRole('button', { name: 'Save' })

describe('AdminSettings', () => {
  it('shows what the installation is called now', async () => {
    renderPage(stub())

    expect(await titleField()).toHaveProperty('value', 'Sage Burner')
  })

  it('carries nothing personal: this page is the installation’s settings', async () => {
    renderPage(stub())
    await titleField()

    expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull()
  })

  it('leaves signing out to the page that holds the rest of the account', async () => {
    renderPage(stub())
    await titleField()

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('is where both pictures are chosen — the home screen’s and a shared link’s', async () => {
    renderPage(stub())

    expect(await screen.findByLabelText('The icon on a home screen')).toBeTruthy()
    expect(screen.getByLabelText('The picture a shared link shows')).toBeTruthy()
  })

  it('renames it', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({
        installation: {
          title: 'The Burning Sage',
          banner_updated_at: null,
          icon_updated_at: null,
          sends_email: false,
          social_logins: [],
        },
      }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: 'The Burning Sage' } })
    fireEvent.click(await saveTitle())

    await waitFor(() => expect(updateInstallation).toHaveBeenCalledWith({ title: 'The Burning Sage' }))
    expect((await screen.findByRole('status')).textContent).toContain('Saved')
  })

  it('trims what it sends, so a stray space is not a rename', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({
        installation: {
          title: 'The Burning Sage',
          banner_updated_at: null,
          icon_updated_at: null,
          sends_email: false,
          social_logins: [],
        },
      }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: '  The Burning Sage  ' } })
    fireEvent.click(await saveTitle())

    await waitFor(() => expect(updateInstallation).toHaveBeenCalledWith({ title: 'The Burning Sage' }))
  })

  it('refuses a blank name here rather than letting the server say no', async () => {
    const updateInstallation = vi.fn<AdminSettingsApi['updateInstallation']>(() =>
      Promise.resolve({
        installation: {
          title: '',
          banner_updated_at: null,
          icon_updated_at: null,
          sends_email: false,
          social_logins: [],
        },
      }),
    )
    renderPage(stub({ updateInstallation }))

    fireEvent.input(await titleField(), { target: { value: '   ' } })
    fireEvent.click(await saveTitle())

    expect((await screen.findByRole('alert')).textContent).toContain('Give it a name')
    expect(updateInstallation).not.toHaveBeenCalled()
  })

  it('renames the header in the same moment, without a reload', async () => {
    const Header = () => <output aria-label="brand">{useInstallationTitle() ?? '-'}</output>
    render(
      <ViewerProvider viewer={ADMIN}>
        <InstallationProvider title="Sage Burner">
          <Header />
          <AdminSettings
            api={stub({
              updateInstallation: () =>
                Promise.resolve({
                  installation: {
                    title: 'The Burning Sage',
                    banner_updated_at: null,
                    icon_updated_at: null,
                    sends_email: false,
                    social_logins: [],
                  },
                }),
            })}
          />
        </InstallationProvider>
      </ViewerProvider>,
    )

    fireEvent.input(await titleField(), { target: { value: 'The Burning Sage' } })
    fireEvent.click(await saveTitle())

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
    fireEvent.click(await saveTitle())

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getInstallation: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('sends a signed-out visitor to log in, rather than telling them to ask an admin', async () => {
    const getInstallation = vi.fn<AdminSettingsApi['getInstallation']>(() =>
      Promise.resolve({
        installation: {
          title: 'Sage Burner',
          banner_updated_at: null,
          icon_updated_at: null,
          sends_email: false,
          social_logins: [],
        },
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
        installation: {
          title: 'Sage Burner',
          banner_updated_at: null,
          icon_updated_at: null,
          sends_email: false,
          social_logins: [],
        },
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
