import type { Event } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { HomeApi } from './Home.tsx'

import { apiError } from '../api/client.ts'
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
  welcome_markdown: '# Bring water\n\nAnd a [map](/map).',
  member_cap: 42,
  created_at: '2026-01-01T00:00:00.000Z',
}

/** These cases are about rendering, not saving; a call here is a test bug. */
const notStubbed = () => Promise.reject(new Error('updateWelcome is not stubbed here'))

const SIGNED_OUT: Viewer = { status: 'signed-out' }

const renderHome = (
  event: Event | null,
  viewer: Viewer = SIGNED_OUT,
  updateWelcome: HomeApi['updateWelcome'] = notStubbed,
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Home api={{ getActiveEvent: () => Promise.resolve({ event }), updateWelcome }} />
    </ViewerProvider>,
  )

const asRoles = (roles: ('admin' | 'member')[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', roles },
})

describe('Home', () => {
  it('renders the active event name and dates', async () => {
    renderHome(summer)

    expect(await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })).toBeTruthy()
    expect(screen.getByText('2026-08-01')).toBeTruthy()
    expect(screen.getByText('2026-08-05')).toBeTruthy()
  })

  it('renders the welcome markdown', async () => {
    // The acceptance criterion for #13: what an organiser typed, on the public
    // page, with no deploy in between.
    renderHome(summer)

    // Level 2: the page's own `h1` is the site name, so content headings shift
    // down one rather than producing a second `h1` under an `h2`.
    expect(await screen.findByRole('heading', { name: 'Bring water', level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'map' }).getAttribute('href')).toBe('/map')
  })

  it('escapes raw HTML in the welcome text', async () => {
    // Written by any approved member, shown to every visitor. The escaping is what
    // makes that safe, so this test is the one holding the control up.
    renderHome({ ...summer, welcome_markdown: 'Hi <script>alert(1)</script>' })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })
    expect(document.querySelector('.welcome script')).toBeNull()
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
  })

  it('does not flash "Apply to join" at a member while the viewer loads', async () => {
    // `isMember` is false during `loading`, so without the gate a member sees an
    // invitation to apply to something they are already in, then watches it
    // vanish — a layout shift on the first paint of the public page.
    renderHome(summer, { status: 'loading' })

    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
  })

  it('says there is no burn rather than showing nothing', async () => {
    // Before the first event, and again after the last one ends.
    renderHome(null)

    expect(await screen.findByText(/no burn scheduled/i)).toBeTruthy()
  })

  it('says come back later when the API cannot be reached', async () => {
    // Also what an offline first paint looks like, which is why it does not
    // render a code or a stack.
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home
          api={{ getActiveEvent: () => Promise.reject(new Error('offline')), updateWelcome: notStubbed }}
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
    // Someone who arrived to apply should not wait on a round trip to find the
    // button.
    let resolve: (value: { event: Event | null }) => void = () => undefined
    const pending = new Promise<{ event: Event | null }>((r) => {
      resolve = r
    })
    render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={{ getActiveEvent: () => pending, updateWelcome: notStubbed }} />
      </ViewerProvider>,
    )

    expect(screen.getByRole('link', { name: 'Apply to join' })).toBeTruthy()
    resolve({ event: null })
  })

  it('does not offer Apply to someone who is already a member', async () => {
    renderHome(summer, { status: 'signed-in', account: { id: 'a-1', roles: ['member'] } })

    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })
    expect(screen.queryByRole('link', { name: 'Apply to join' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
  })

  it('fetches once, not once per render', async () => {
    const getActiveEvent = vi.fn(() => Promise.resolve({ event: summer }))
    // The *same* object both times. A fresh literal per render is a different
    // `api` identity and legitimately refetches — which is why `App` memoises
    // the client. This pins the half that lives here: given a stable client,
    // re-rendering must not refetch.
    const api = { getActiveEvent, updateWelcome: notStubbed }

    const { rerender } = render(
      <ViewerProvider viewer={SIGNED_OUT}>
        <Home api={api} />
      </ViewerProvider>,
    )
    await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })

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
      await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })

      expect(screen.queryByRole('button', { name: 'Edit this text' })).toBeNull()
    })

    it('offers no editor to a signed-in account with no roles', async () => {
      renderHome(summer, asRoles([]))
      await screen.findByRole('heading', { name: 'Summer Burn 2026', level: 2 })

      expect(screen.queryByRole('button', { name: 'Edit this text' })).toBeNull()
    })

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      it(`offers it to ${roles.join(' + ')}`, async () => {
        // `admin` counts as well as `member`, because the roles are independent:
        // an organiser who is not attending still writes the welcome text.
        renderHome(summer, asRoles([...roles]))

        expect(await screen.findByRole('button', { name: 'Edit this text' })).toBeTruthy()
      })
    }

    it('saves the text and shows what came back, not what was typed', async () => {
      // The response is the row as written, so rendering it rather than the local
      // draft is what stops the page claiming a save that landed differently.
      const updateWelcome = vi.fn<HomeApi['updateWelcome']>(() =>
        Promise.resolve({ event: { ...summer, welcome_markdown: 'Saved server-side' } }),
      )
      renderHome(summer, asRoles(['member']), updateWelcome)

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
      // Still editing, with the draft intact — losing what they typed over a
      // refusal would be the second failure.
      expect(screen.getByLabelText<HTMLTextAreaElement>('Welcome text').value).toBe('Nope')
    })

    it('opens on the text as it is now, not as it was when the page loaded', async () => {
      // The whole field is overwritten on save, so a homepage left open while
      // somebody else edited would discard their work. Re-reading on open is what
      // shrinks that window to the moment between pressing Edit and pressing Save.
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockResolvedValue({ event: { ...summer, welcome_markdown: 'Written by someone else' } })
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe(
        'Written by someone else',
      )
    })

    it('opens on what is on screen when the re-read fails', async () => {
      // Refusing to open the editor because the network hiccuped would be worse
      // than opening it on a slightly stale draft.
      const getActiveEvent = vi
        .fn<HomeApi['getActiveEvent']>()
        .mockResolvedValueOnce({ event: summer })
        .mockRejectedValue(new Error('offline'))
      render(
        <ViewerProvider viewer={asRoles(['member'])}>
          <Home api={{ getActiveEvent, updateWelcome: notStubbed }} />
        </ViewerProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Edit this text' }))

      expect((await screen.findByLabelText<HTMLTextAreaElement>('Welcome text')).value).toBe(
        summer.welcome_markdown,
      )
    })

    it('does not show a stale save error when the editor is reopened', async () => {
      // `useFormError` lives on the page, so an error survives the editor closing —
      // and `FormError` takes focus when it mounts, so a stale one would steal the
      // caret as well as mislead.
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
