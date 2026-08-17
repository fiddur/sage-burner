import type { Event } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { HomeApi } from './Home.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Home } from './Home.tsx'

afterEach(cleanup)

const summer: Event = {
  id: 'e-1',
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '00:00',
  end_time: '23:59',
  location: '',
  welcome_markdown: '# Bring water\n\nAnd a [map](/map).',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-01-01T00:00:00.000Z',
}

const notStubbed = () => Promise.reject(new Error('that call is not stubbed here'))

const SIGNED_OUT: Viewer = { status: 'signed-out' }

const renderHome = (
  event: Event | null,
  viewer: Viewer = SIGNED_OUT,
  updateWelcome: HomeApi['updateWelcome'] = notStubbed,
  banner: string | null = null,
) =>
  render(
    <InstallationProvider title="The Burning Sage" banner={banner}>
      <ViewerProvider viewer={viewer}>
        <Home
          api={{ getActiveEvent: () => Promise.resolve({ event }), updateWelcome, uploadImage: notStubbed }}
        />
      </ViewerProvider>
    </InstallationProvider>,
  )

const asRoles = (roles: ('admin' | 'member')[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles },
})

describe('Home', () => {
  it('renders the active event name and dates', async () => {
    renderHome(summer)

    expect(await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })).toBeTruthy()
    expect(screen.getByText('2026-08-01')).toBeTruthy()
    expect(screen.getByText('2026-08-05')).toBeTruthy()
  })

  it('says where the burn is, beside its dates', async () => {
    renderHome({ ...summer, location: 'Sagegården, Rättvik' })

    expect(await screen.findByText(/Sagegården, Rättvik/)).toBeTruthy()
  })

  it('says nothing about the place when nobody has named one', async () => {
    const { container } = renderHome(summer)

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })
    expect(container.querySelector('.event-dates')?.textContent).toBe('2026-08-01 – 2026-08-05')
  })

  it('leads with the burn rather than repeating what the bar already says', async () => {
    const { container } = renderHome(summer)

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })
    expect(container.textContent).not.toContain('The Burning Sage')
  })

  it('draws the banner an admin uploaded, at the version they uploaded', async () => {
    renderHome(summer, SIGNED_OUT, notStubbed, '2026-08-07T10:00:00.000Z')

    const banner = document.querySelector('.burn-banner')

    expect(banner?.getAttribute('src')).toBe('/api/installation/banner?v=2026-08-07T10%3A00%3A00.000Z')
    expect(banner?.getAttribute('alt')).toBe('')
  })

  it('draws no banner when nobody has uploaded one', () => {
    renderHome(summer)

    expect(document.querySelector('.burn-banner')).toBeNull()
  })

  it('renders the welcome markdown', async () => {
    renderHome(summer)

    expect(await screen.findByRole('heading', { name: 'Bring water', level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'map' }).getAttribute('href')).toBe('/map')
  })

  it('escapes raw HTML in the welcome text', async () => {
    renderHome({ ...summer, welcome_markdown: 'Hi <script>alert(1)</script>' })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })
    expect(document.querySelector('.welcome script')).toBeNull()
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
  })

  it('does not flash "Apply to join" at a member while the viewer loads', async () => {
    renderHome(summer, { status: 'loading' })

    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
  })

  it('says there is no burn rather than showing nothing', async () => {
    renderHome(null)

    expect(await screen.findByText(/no burn scheduled/i)).toBeTruthy()
  })

  it('falls back to the installation for its heading between burns', async () => {
    renderHome(null)

    expect(await screen.findByRole('heading', { name: 'The Burning Sage', level: 1 })).toBeTruthy()
  })

  it('waits for the installation rather than heading the page with nothing', async () => {
    render(
      <InstallationProvider>
        <ViewerProvider viewer={SIGNED_OUT}>
          <Home
            api={{
              getActiveEvent: () => Promise.resolve({ event: null }),
              updateWelcome: notStubbed,
              uploadImage: notStubbed,
            }}
          />
        </ViewerProvider>
      </InstallationProvider>,
    )

    await screen.findByText(/no burn scheduled/i)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('says come back later when the API cannot be reached', async () => {
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home
          api={{
            getActiveEvent: () => Promise.reject(new Error('offline')),
            updateWelcome: notStubbed,
            uploadImage: notStubbed,
          }}
        />
      </ViewerProvider>,
    )

    expect(await screen.findByText(/try again shortly/i)).toBeTruthy()
  })

  it('offers Apply and Log in to a signed-out visitor', async () => {
    renderHome(summer)

    expect((await screen.findByRole('link', { name: 'Apply to join' })).getAttribute('href')).toBe('/apply')
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
  })

  it('offers Apply before the event has loaded', async () => {
    let resolve: (value: { event: Event | null }) => void = () => undefined
    const pending = new Promise<{ event: Event | null }>((r) => {
      resolve = r
    })
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={{ getActiveEvent: () => pending, updateWelcome: notStubbed, uploadImage: notStubbed }} />
      </ViewerProvider>,
    )

    expect(screen.getByRole('link', { name: 'Apply to join' })).toBeTruthy()
    resolve({ event: null })
  })

  it('does not offer Apply to someone who is already a member', async () => {
    renderHome(summer, {
      status: 'signed-in',
      account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
    })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })
    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
  })

  it('fetches once, not once per render', async () => {
    const getActiveEvent = vi.fn(() => Promise.resolve({ event: summer }))
    const api = { getActiveEvent, updateWelcome: notStubbed, uploadImage: notStubbed }

    const { rerender } = render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={api} />
      </ViewerProvider>,
    )
    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })

    rerender(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={api} />
      </ViewerProvider>,
    )

    expect(getActiveEvent).toHaveBeenCalledTimes(1)
  })

  describe('editing the welcome text', () => {
    it('offers no editor to someone signed out', async () => {
      renderHome(summer)
      await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })

      expect(screen.queryByRole('button', { name: 'Edit this text' })).toBeNull()
    })

    it('offers no editor to a signed-in account with no roles', async () => {
      renderHome(summer, asRoles([]))
      await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 1 })

      expect(screen.queryByRole('button', { name: 'Edit this text' })).toBeNull()
    })

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      it(`offers it to ${roles.join(' + ')}`, async () => {
        renderHome(summer, asRoles([...roles]))

        expect(await screen.findByRole('button', { name: 'Edit this text' })).toBeTruthy()
      })
    }

    it('saves the text and shows what the server has, not what was typed', async () => {
      const saved = { ...summer, welcome_markdown: 'Saved server-side' }
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(() => Promise.resolve({ event: saved }))
      let written = false
      render(
        <InstallationProvider title="The Burning Sage" banner={null}>
          <ViewerProvider viewer={asRoles(['member'])}>
            <Home
              api={{
                getActiveEvent: () => Promise.resolve({ event: written ? saved : summer }),
                updateWelcome: async (id, body) => {
                  written = true
                  return await updateWelcome(id, body)
                },
                uploadImage: notStubbed,
              }}
            />
          </ViewerProvider>
        </InstallationProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      fireEvent.input(await screen.findByLabelText('Welcome text'), { target: { value: 'Bring a cup' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(updateWelcome).toHaveBeenCalledWith('e-1', { welcome_markdown: 'Bring a cup' }),
      )
      expect(await screen.findByText('Saved server-side')).toBeTruthy()
      expect(screen.queryByLabelText('Welcome text')).toBeNull()
    })

    it('starts the editor from the text that is there', async () => {
      renderHome(summer, asRoles(['member']))

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe(
        summer.welcome_markdown,
      )
    })

    it('leaves the text alone when the save is refused', async () => {
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(() =>
        Promise.reject(apiError(403, 'forbidden', 'You do not have access to that.')),
      )
      renderHome(summer, asRoles(['member']), updateWelcome)

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      fireEvent.input(await screen.findByLabelText('Welcome text'), { target: { value: 'Nope' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect((await screen.findByRole('alert')).textContent).toContain('do not have access')
      expect(screen.getByLabelText<HTMLTextAreaElement>('Welcome text').value).toBe('Nope')
    })

    it('offers a picture here too, and holds the save while one is going up', async () => {
      renderHome(summer, asRoles(['member']))

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      await screen.findByLabelText('Welcome text')

      expect(screen.getByLabelText('Add a picture to Welcome text')).toBeTruthy()

      fireEvent.input(screen.getByLabelText('Welcome text'), {
        target: { value: 'Bring water ![Uploading sauna.jpg…]()' },
      })

      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true),
      )
    })

    it('opens on the text as it is now, not as it was when the page loaded', async () => {
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockResolvedValue({ event: { ...summer, welcome_markdown: 'Written by someone else' } })
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome: notStubbed, uploadImage: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe(
        'Written by someone else',
      )
    })

    it('refuses to open when the burn has ended since the page loaded', async () => {
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockResolvedValue({ event: null })
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(notStubbed)
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome, uploadImage: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect(await screen.findByText(/no burn scheduled/)).toBeTruthy()
      expect(screen.queryByLabelText('Welcome text')).toBeNull()
      expect(updateWelcome).not.toHaveBeenCalled()
    })

    it('shows the wait while the re-read is in flight', async () => {
      let release = (_value: { event: Event | null }) => {}
      const held = new Promise<{ event: Event | null }>((resolve) => {
        release = resolve
      })
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockReturnValue(held)
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome: notStubbed, uploadImage: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      const opening = await screen.findByRole('button', { name: 'Edit this text' })
      await waitFor(() => expect(opening.querySelector('[data-icon="waiting"]')).not.toBeNull())
      expect(opening.hasAttribute('disabled')).toBe(true)

      release({ event: summer })
      expect(await screen.findByLabelText('Welcome text')).toBeTruthy()
    })

    it('opens on what is on screen when the re-read fails', async () => {
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockRejectedValue(new Error('offline'))
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome: notStubbed, uploadImage: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe(
        summer.welcome_markdown,
      )
    })

    it('does not show a stale save error when the editor is reopened', async () => {
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(() =>
        Promise.reject(apiError(403, 'forbidden', 'You do not have access to that.')),
      )
      renderHome(summer, asRoles(['member']), updateWelcome)

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      await screen.findByLabelText('Welcome text')
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect((await screen.findByRole('alert')).textContent).toContain('do not have access')

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      await screen.findByLabelText('Welcome text')

      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('puts the text back on cancel, without asking the API', async () => {
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(notStubbed)
      renderHome(summer, asRoles(['member']), updateWelcome)

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
      fireEvent.input(await screen.findByLabelText('Welcome text'), { target: { value: 'Discard me' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByLabelText('Welcome text')).toBeNull()
      expect(await screen.findByRole('button', { name: 'Edit this text' })).toBeTruthy()
      expect(updateWelcome).not.toHaveBeenCalled()
    })
  })
})

describe('somebody else saving the welcome text first', () => {
  const refused = () =>
    Promise.reject(
      apiError(412, 'stale', 'Somebody else changed this while you had it open.', {
        error: 'stale',
        event: { ...summer, welcome_markdown: 'Bring a bowl and a cup' },
      }),
    )

  it('keeps what was typed and puts theirs beside it', async () => {
    renderHome(summer, asRoles(['member']), refused)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')
    fireEvent.input(field, { target: { value: 'Bring a cup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Bring a bowl and a cup')).toBeTruthy()
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe('Bring a cup')
  })

  it('shows no other version when the save failed for some other reason', async () => {
    renderHome(summer, asRoles(['member']), () =>
      Promise.reject(apiError(500, 'internal_error', 'Something went wrong at our end.')),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))
    await screen.findByLabelText('Welcome text')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Something went wrong at our end.')).toBeTruthy()
    expect(screen.queryByText(/What is saved now/)).toBeNull()
  })
})
