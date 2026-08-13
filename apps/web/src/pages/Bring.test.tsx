import type { BringEntry, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { BringApi } from './Bring.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Bring } from './Bring.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const BOSS: Viewer = {
  status: 'signed-in',
  account: { id: 'a-9', name: 'Cai', avatar: null, roles: ['admin'] },
}

const BURN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: null,
}

const anItem = (over: Partial<BringEntry> & Pick<BringEntry, 'id'>): BringEntry => ({
  event_id: 'e-1',
  author_account_id: 'a-1',
  author_name: 'Ada',
  title: 'Drums',
  comment: '',
  withdrawn_at: null,
  created_at: '2026-07-02T00:00:00.000Z',
  hands: [],
  thread_id: 't-1',
  ...over,
})

const COMING = [
  { account_id: 'a-1', name: 'Ada', avatar: null },
  { account_id: 'a-2', name: 'Bea', avatar: null },
]

const stub = (
  over: Partial<BringApi> = {},
  items: BringEntry[] = [],
  attendees: { account_id: string; name: string | null; avatar: string | null }[] = COMING,
): BringApi => ({
  getBringList: () => Promise.resolve({ items }),
  getEventAttendees: () => Promise.resolve({ attendees }),
  addBringItem: () => Promise.reject(new Error('addBringItem is not stubbed here')),
  updateBringItem: () => Promise.reject(new Error('updateBringItem is not stubbed here')),
  deleteBringItem: () => Promise.reject(new Error('deleteBringItem is not stubbed here')),
  bringThis: () => Promise.reject(new Error('bringThis is not stubbed here')),
  stopBringingThis: () => Promise.reject(new Error('stopBringingThis is not stubbed here')),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  ...over,
})

// `null`, not `undefined`: passing `undefined` to a parameter with a default gets the
// default, so "no burn" written that way silently renders the usual one.
const renderPage = (api: BringApi, viewer: Viewer = ADA, burn: MyBurn | null = BURN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Bring api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('the bring list', () => {
  it('puts what nobody is bringing under its own heading, ahead of what somebody is', async () => {
    renderPage(
      stub({}, [
        anItem({ id: 'b-1', title: 'Drums' }),
        anItem({ id: 'b-2', title: 'Speakers', hands: [{ account_id: 'a-2', name: 'Bea' }] }),
      ]),
    )

    const headings = (await screen.findAllByRole('heading', { level: 2 })).map((one) => one.textContent)
    expect(headings.slice(0, 2)).toEqual(['Nobody is bringing these yet', 'Somebody is bringing these'])

    const asks = screen.getByRole('heading', { name: 'Nobody is bringing these yet' })
    expect(asks.nextElementSibling?.textContent).toContain('Drums')
    expect(asks.nextElementSibling?.textContent).not.toContain('Speakers')
  })

  it('says an empty list is empty, rather than that everything asked for is covered', async () => {
    renderPage(stub())

    expect(await screen.findByText(/Nothing on the list yet/)).toBeTruthy()
    expect(screen.queryByText(/Everything asked for has somebody bringing it/)).toBeNull()
  })

  it('says everything asked for is covered when every item has a hand', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', hands: [{ account_id: 'a-2', name: 'Bea' }] })]))

    expect(await screen.findByText(/Everything asked for has somebody bringing it/)).toBeTruthy()
    expect(screen.queryByText(/Nothing on the list yet/)).toBeNull()
  })

  it('says who added it, linking to them', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', author_account_id: 'a-2', author_name: 'Bea' })]))

    const link = await screen.findByRole('link', { name: 'Bea' })
    expect(link.getAttribute('href')).toBe('/members/a-2')
  })

  it('names nobody when whoever added it has gone', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', author_account_id: null, author_name: null })]))

    expect(await screen.findByText(/somebody who has left/)).toBeTruthy()
  })

  it('shows every hand, several people bringing one thing', async () => {
    renderPage(
      stub({}, [
        anItem({
          id: 'b-1',
          hands: [
            { account_id: 'a-1', name: 'Ada' },
            { account_id: 'a-2', name: 'Bea' },
          ],
        }),
      ]),
    )

    expect(await screen.findByRole('button', { name: 'Take Ada off bringing Drums' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take Bea off bringing Drums' })).toBeTruthy()
  })

  it('puts your own hand up', async () => {
    const bringThis = vi.fn<BringApi['bringThis']>(() =>
      Promise.reject(new Error('the answer is not what this asserts')),
    )
    renderPage(stub({ bringThis }, [anItem({ id: 'b-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take the spot on bringing Drums' }))

    await waitFor(() => expect(bringThis).toHaveBeenCalledWith('b-1', { account_id: 'a-1' }))
  })

  it('nudges somebody not coming to join, rather than refusing them', async () => {
    renderPage(
      stub(
        { bringThis: () => Promise.reject(apiError(400, 'not_attending', 'Bad request')) },
        [anItem({ id: 'b-1' })],
        [{ account_id: 'a-2', name: 'Bea', avatar: null }],
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Take the spot on bringing Drums' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('You need to join this burn')
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/profile')
  })

  it('takes a hand down again', async () => {
    const stopBringingThis = vi.fn<BringApi['stopBringingThis']>(() =>
      Promise.reject(new Error('the answer is not what this asserts')),
    )
    renderPage(
      stub({ stopBringingThis }, [anItem({ id: 'b-1', hands: [{ account_id: 'a-2', name: 'Bea' }] })]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Take Bea off bringing Drums' }))

    await waitFor(() => expect(stopBringingThis).toHaveBeenCalledWith('b-1', 'a-2'))
  })

  it('adds an ask when the tick is left alone', async () => {
    const addBringItem = vi.fn<BringApi['addBringItem']>(() => Promise.reject(new Error('stop here')))
    renderPage(stub({ addBringItem }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'What is it?' }), {
      target: { value: 'Drums to use around the fire' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addBringItem).toHaveBeenCalledWith('e-1', {
        title: 'Drums to use around the fire',
        comment: '',
        bringing: false,
      }),
    )
  })

  it('adds an offer when the tick says you are bringing it', async () => {
    const addBringItem = vi.fn<BringApi['addBringItem']>(() => Promise.reject(new Error('stop here')))
    renderPage(stub({ addBringItem }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'What is it?' }), {
      target: { value: 'Huge speakers' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'I am bringing this myself' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addBringItem).toHaveBeenCalledWith('e-1', {
        title: 'Huge speakers',
        comment: '',
        bringing: true,
      }),
    )
  })

  it('offers no tick to somebody not coming, who has nothing to pledge with', async () => {
    renderPage(stub({}, [], [{ account_id: 'a-2', name: 'Bea', avatar: null }]))

    expect(await screen.findByRole('button', { name: 'Add it' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'I am bringing this myself' })).toBeNull()
  })

  it('refuses a nameless item here rather than at the server', async () => {
    const addBringItem = vi.fn<BringApi['addBringItem']>(() =>
      Promise.reject(new Error('should not be reached')),
    )
    renderPage(stub({ addBringItem }))

    fireEvent.click(await screen.findByRole('button', { name: 'Add it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Say what it is')
    expect(addBringItem).not.toHaveBeenCalled()
  })

  it('offers the pen on your own item only, and the bin to an admin as well', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', author_account_id: 'a-2', author_name: 'Bea' })]), BOSS)

    expect(await screen.findByRole('button', { name: 'Take off Drums' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Drums' })).toBeNull()
  })

  it('offers neither to somebody who is neither the author nor an admin', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', author_account_id: 'a-2', author_name: 'Bea' })]))

    expect(await screen.findByRole('button', { name: 'Take the spot on bringing Drums' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Drums' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take off Drums' })).toBeNull()
  })

  it('edits one in place, sending both fields the form holds', async () => {
    const updateBringItem = vi.fn<BringApi['updateBringItem']>(() => Promise.reject(new Error('stop here')))
    renderPage(stub({ updateBringItem }, [anItem({ id: 'b-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Drums' }))
    fireEvent.input(await screen.findByRole('textbox', { name: 'Comment, for Drums' }), {
      target: { value: 'Anything with a skin.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateBringItem).toHaveBeenCalledWith('b-1', {
        title: 'Drums',
        comment: 'Anything with a skin.',
      }),
    )
  })

  it('takes one off the list', async () => {
    const deleteBringItem = vi.fn<BringApi['deleteBringItem']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteBringItem }, [anItem({ id: 'b-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take off Drums' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really take off Drums' }))

    await waitFor(() => expect(deleteBringItem).toHaveBeenCalledWith('b-1'))
  })

  it('renders the comment as markdown, since members write it for each other', async () => {
    renderPage(stub({}, [anItem({ id: 'b-1', comment: 'Anything **with a skin**.' })]))

    expect((await screen.findByText('with a skin')).tagName).toBe('STRONG')
  })

  it('fetches the conversation only once somebody opens it', async () => {
    const getThread = vi.fn<BringApi['getThread']>(() =>
      Promise.resolve({
        thread: {
          id: 't-1',
          event_id: 'e-1',
          burn: 'Summer burn',
          entity_type: 'bring',
          entity_id: 'b-1',
          title: 'Drums',
          link: null,
          body: null,
          gone: false,
          own: true,
          entry_count: 0,
          last_at: null,
          entries: [],
          supporters: [],
          support_count: 0,
          supported_by_me: false,
          followed_by_me: false,
        },
      }),
    )
    renderPage(stub({ getThread }, [anItem({ id: 'b-1' })]))

    expect(await screen.findByRole('button', { name: 'Show what has been said about Drums' })).toBeTruthy()
    expect(getThread).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Show what has been said about Drums' }))

    await waitFor(() => expect(getThread).toHaveBeenCalledWith('t-1', expect.anything()))
    expect(await screen.findByRole('button', { name: 'Hide what has been said about Drums' })).toBeTruthy()
  })

  it('says there is nothing to bring anything to when no burn is chosen', async () => {
    renderPage(stub(), ADA, null)

    expect(await screen.findByText(/there is nothing to bring anything to/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add it' })).toBeNull()
  })

  it('does not fetch for somebody who is neither a member nor an admin', async () => {
    const getBringList = vi.fn<BringApi['getBringList']>(() => Promise.resolve({ items: [] }))
    renderPage(stub({ getBringList }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getBringList).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getBringList: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })
})
