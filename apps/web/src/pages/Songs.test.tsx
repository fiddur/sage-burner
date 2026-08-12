import type { SongCategory, SongSummary } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { SongsApi } from './Songs.tsx'

import { createRemembered, RememberedProvider } from '../remembered.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { RECENTLY_GONE_DAYS, recentlyGone, Songs } from './Songs.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const CHANT: SongCategory = { id: 'c-1', order: 0, label: 'Chant' }
const SONG: SongCategory = { id: 'c-2', order: 1, label: 'Song' }

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

const aSong = (over: Partial<SongSummary> & Pick<SongSummary, 'id' | 'title'>): SongSummary => ({
  artist: null,
  capo: null,
  links: [],
  category_ids: [],
  author_account_id: 'a-1',
  deleted_at: null,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const stub = (
  over: Partial<SongsApi> = {},
  songs: SongSummary[] = [],
  categories: SongCategory[] = [CHANT, SONG],
): SongsApi => ({
  getSongbook: () => Promise.resolve({ songs, categories }),
  addSong: () => Promise.reject(new Error('addSong is not stubbed here')),
  restoreSong: () => Promise.reject(new Error('restoreSong is not stubbed here')),
  ...over,
})

const renderPage = (api: SongsApi, viewer: Viewer = ADA) =>
  render(
    <RememberedProvider remembered={createRemembered()}>
      <ViewerProvider viewer={viewer}>
        <Songs api={api} />
      </ViewerProvider>
    </RememberedProvider>,
  )

describe('the songbook', () => {
  it('lists what is in it by title, whatever order it arrived in', async () => {
    renderPage(stub({}, [aSong({ id: 's-2', title: 'Zephyr' }), aSong({ id: 's-1', title: 'Ashes' })]))

    const links = await screen.findAllByRole('link', { name: /Ashes|Zephyr/ })
    expect(links.map((link) => link.textContent)).toEqual(['Ashes', 'Zephyr'])
  })

  it('says whose song it is beside the title', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Talkin’ bout a revolution', artist: 'Tracy Chapman' })]))

    expect(await screen.findByText('Tracy Chapman')).toBeTruthy()
  })

  it('sorts by artist when asked, and back by title', async () => {
    renderPage(
      stub({}, [
        aSong({ id: 's-1', title: 'Ashes', artist: 'Zoe' }),
        aSong({ id: 's-2', title: 'Zephyr', artist: 'Ada' }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'By artist' }))
    expect(screen.getAllByRole('link', { name: /Ashes|Zephyr/ }).map((one) => one.textContent)).toEqual([
      'Zephyr',
      'Ashes',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'By title' }))
    expect(screen.getAllByRole('link', { name: /Ashes|Zephyr/ }).map((one) => one.textContent)).toEqual([
      'Ashes',
      'Zephyr',
    ])
  })

  it('puts the songs nobody has named an artist for last, rather than first', async () => {
    renderPage(
      stub({}, [aSong({ id: 's-1', title: 'Ashes' }), aSong({ id: 's-2', title: 'Zephyr', artist: 'Zoe' })]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'By artist' }))

    expect(screen.getAllByRole('link', { name: /Ashes|Zephyr/ }).map((one) => one.textContent)).toEqual([
      'Zephyr',
      'Ashes',
    ])
  })

  it('offers no sorting where there is nothing to sort', async () => {
    renderPage(stub())

    await screen.findByText(/Nothing in the book yet/)
    expect(screen.queryByRole('button', { name: 'By artist' })).toBeNull()
  })

  it('links each song to its own page', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Ashes' })]))

    expect((await screen.findByRole('link', { name: 'Ashes' })).getAttribute('href')).toBe('/songs/s-1')
  })

  it('says there is somewhere to hear it', async () => {
    renderPage(
      stub({}, [aSong({ id: 's-1', title: 'Ashes', capo: 3, links: [{ url: 'https://example.org/a' }] })]),
    )

    await screen.findByRole('link', { name: 'Ashes' })
    expect(screen.getByTitle('There is somewhere to hear it')).toBeTruthy()
  })

  it('says nothing about the capo, which is knowledge for once the song is open', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Ashes', capo: 3 })]))

    await screen.findByRole('link', { name: 'Ashes' })
    expect(screen.queryByText('capo 3')).toBeNull()
  })

  it('filters by a category, and back to everything', async () => {
    renderPage(
      stub({}, [
        aSong({ id: 's-1', title: 'Ashes', category_ids: ['c-1'] }),
        aSong({ id: 's-2', title: 'Zephyr', category_ids: ['c-2'] }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Chant' }))

    expect(screen.getByRole('link', { name: 'Ashes' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Zephyr' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))

    expect(screen.getByRole('link', { name: 'Zephyr' })).toBeTruthy()
  })

  it('shows a song filed under either category while either chip is lit', async () => {
    // The rule the row is shared on (#472): show what matches *any* lit chip. A card on the
    // feed has one kind, so this is the half only the songbook exercises.
    renderPage(
      stub({}, [
        aSong({ id: 's-1', title: 'Ashes', category_ids: ['c-1', 'c-2'] }),
        aSong({ id: 's-2', title: 'Zephyr', category_ids: ['c-2'] }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Chant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Song' }))

    expect(screen.getByRole('link', { name: 'Ashes' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zephyr' })).toBeTruthy()
  })

  it('says the book is empty rather than leaving a gap', async () => {
    renderPage(stub())

    expect(await screen.findByText(/Nothing in the book yet/)).toBeTruthy()
  })

  it('tells a filter apart from an empty book', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Ashes', category_ids: ['c-1'] })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Song' }))

    expect(screen.getByText('Nothing filed under that yet.')).toBeTruthy()
  })

  it('adds a song with nothing but a title', async () => {
    const addSong = vi.fn<SongsApi['addSong']>(() =>
      Promise.reject(new Error('the page reloads the book, so the response is not read')),
    )
    renderPage(stub({ addSong }))

    fireEvent.input(await screen.findByLabelText('Add a song'), {
      target: { value: '  Fire in the sky  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => expect(addSong).toHaveBeenCalledWith({ title: 'Fire in the sky' }))
  })

  it('refuses to add one with no title, and says why', async () => {
    const addSong = vi.fn<SongsApi['addSong']>()
    renderPage(stub({ addSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Add it' }))

    expect(await screen.findByText(/A song needs a title/)).toBeTruthy()
    expect(addSong).not.toHaveBeenCalled()
  })

  it('keeps what was taken out under its own heading, with a way back', async () => {
    const restoreSong = vi.fn<SongsApi['restoreSong']>(() =>
      Promise.reject(new Error('the page reloads the book, so the response is not read')),
    )
    renderPage(stub({ restoreSong }, [aSong({ id: 's-1', title: 'Ashes', deleted_at: daysAgo(2) })]))

    expect(await screen.findByRole('heading', { name: 'Recently taken out' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Put Ashes back in the book' }))

    await waitFor(() => expect(restoreSong).toHaveBeenCalledWith('s-1'))
  })

  it('means recently, so one taken out months ago is not still listed as it', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Ashes', deleted_at: daysAgo(RECENTLY_GONE_DAYS + 1) })]))

    expect(await screen.findByText(/Nothing in the book yet/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Recently taken out' })).toBeNull()
  })

  it('leaves out the taken-out heading when nothing has been', async () => {
    renderPage(stub({}, [aSong({ id: 's-1', title: 'Ashes' })]))

    await screen.findByRole('link', { name: 'Ashes' })
    expect(screen.queryByRole('heading', { name: 'Recently taken out' })).toBeNull()
  })

  it('shows a signed-out visitor nothing of it', () => {
    renderPage(stub(), { status: 'signed-out' })

    expect(screen.queryByRole('button', { name: 'Add it' })).toBeNull()
  })
})

describe('what counts as recently taken out', () => {
  const NOW = Date.parse('2026-08-10T12:00:00.000Z')

  it('takes one from today and drops one from before the bound', () => {
    expect(recentlyGone('2026-08-10T00:00:00.000Z', NOW)).toBe(true)
    expect(recentlyGone('2026-06-01T00:00:00.000Z', NOW)).toBe(false)
  })

  it('is nothing at all for a song that is still in the book', () => {
    expect(recentlyGone(null, NOW)).toBe(false)
  })

  it('holds right up to the bound and not on it', () => {
    const bound = RECENTLY_GONE_DAYS * 24 * 60 * 60 * 1000

    expect(recentlyGone(new Date(NOW - bound + 1).toISOString(), NOW)).toBe(true)
    expect(recentlyGone(new Date(NOW - bound).toISOString(), NOW)).toBe(false)
  })
})
