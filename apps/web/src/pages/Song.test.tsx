import type { Song, SongCategory, Thread } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { SongApi } from './Song.tsx'

import { createRemembered, RememberedProvider } from '../remembered.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { SongPage } from './Song.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const CHANT: SongCategory = { id: 'c-1', order: 0, label: 'Chant' }

const CHORUS = 'Am      F\ncome and sing with me\nC       G'

const aSong = (over: Partial<Song> = {}): Song => ({
  id: 's-1',
  title: 'Fire in the sky',
  body: CHORUS,
  capo: null,
  links: [],
  category_ids: [],
  author_account_id: 'a-1',
  deleted_at: null,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const aThread = (over: Partial<Thread> = {}): Thread => ({
  id: 't-1',
  event_id: null,
  burn: null,
  entity_type: 'song',
  entity_id: 's-1',
  title: 'Fire in the sky',
  link: '/songs/s-1',
  body: null,
  own: true,
  gone: false,
  entry_count: 1,
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  followed_by_me: false,
  last_at: '2026-07-02T00:00:00.000Z',
  entries: [
    {
      id: 'e-1',
      kind: 'added',
      author: { account_id: 'a-1', name: 'Ada' },
      body: 'put it in the book',
      created_at: '2026-07-02T00:00:00.000Z',
      edited_at: null,
    },
  ],
  ...over,
})

const stub = (
  over: Partial<SongApi> = {},
  song: Song = aSong(),
  thread: Partial<Thread> = {},
  categories: SongCategory[] = [CHANT],
): SongApi => ({
  getSong: () => Promise.resolve({ song, thread: aThread(thread) }),
  getSongCategories: () => Promise.resolve({ categories }),
  getApprovedAccounts: () => Promise.resolve({ accounts: [{ account_id: 'a-2', name: 'Bo', avatar: null }] }),
  updateSong: () => Promise.reject(new Error('updateSong is not stubbed here')),
  deleteSong: () => Promise.reject(new Error('deleteSong is not stubbed here')),
  restoreSong: () => Promise.reject(new Error('restoreSong is not stubbed here')),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  supportThread: () => Promise.reject(new Error('supportThread is not stubbed here')),
  withdrawSupportForThread: () => Promise.reject(new Error('withdrawSupportForThread is not stubbed here')),

  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  ...over,
})

const renderPage = (api: SongApi, viewer: Viewer = ADA) =>
  render(
    <RememberedProvider remembered={createRemembered()}>
      <ViewerProvider viewer={viewer}>
        <SongPage api={api} songId="s-1" />
      </ViewerProvider>
    </RememberedProvider>,
  )

describe('a song’s page', () => {
  it('heads with the title and lays the words out as authored', async () => {
    renderPage(stub())

    expect(await screen.findByRole('heading', { name: /Fire in the sky/ })).toBeTruthy()
    expect(screen.getByText('come and sing with me')).toBeTruthy()
  })

  it('keeps the columns the author typed, so a chord stays above its syllable', async () => {
    const { container } = renderPage(stub())

    await screen.findByRole('heading', { name: /Fire in the sky/ })
    expect(container.querySelector('.song-body')?.textContent).toBe(`${CHORUS}\n`)
  })

  it('marks the chord lines apart from the words', async () => {
    const { container } = renderPage(stub())

    await screen.findByRole('heading', { name: /Fire in the sky/ })
    expect([...container.querySelectorAll('.song-line.is-chords')].map((line) => line.textContent)).toEqual([
      'Am      F\n',
      'C       G\n',
    ])
  })

  it('says the capo when somebody has, and nothing when nobody has', async () => {
    renderPage(stub({}, aSong({ capo: 2 })))
    expect(await screen.findByText('capo 2')).toBeTruthy()

    cleanup()
    renderPage(stub())
    await screen.findByRole('heading', { name: /Fire in the sky/ })
    expect(screen.queryByText(/^capo /)).toBeNull()
  })

  it('says nothing about a capo of 0, which is the absence rather than a value', async () => {
    renderPage(stub({}, aSong({ capo: 0 })))

    await screen.findByRole('heading', { name: /Fire in the sky/ })
    expect(screen.queryByText(/capo/)).toBeNull()
  })

  it('names what it is filed under', async () => {
    renderPage(stub({}, aSong({ category_ids: ['c-1'] })))

    expect(await screen.findByText('Chant')).toBeTruthy()
  })

  it('shows a link as the icon of the site it goes to, named for whoever cannot see it', async () => {
    renderPage(stub({}, aSong({ links: [{ url: 'https://open.spotify.com/track/1' }] })))

    const link = await screen.findByRole('link', { name: 'Listen on Spotify' })
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/1')
    expect(link.textContent).toBe('🎧')
  })

  it('has an icon for a site it does not know, rather than no link', async () => {
    renderPage(stub({}, aSong({ links: [{ url: 'https://example.org/a' }] })))

    expect((await screen.findByRole('link', { name: 'Listen elsewhere' })).textContent).toBe('🎶')
  })

  it('transposes the chords and leaves the words where they are', async () => {
    const { container } = renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'A semitone up' }))

    expect(container.querySelector('.song-body')?.textContent).toBe(
      'A#m     F#\ncome and sing with me\nC#      G#\n',
    )
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('goes back to how it is written', async () => {
    const { container } = renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'A semitone up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to how it is written' }))

    expect(container.querySelector('.song-body')?.textContent).toBe(`${CHORUS}\n`)
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('offers no transposing for a song with no chords in it', async () => {
    renderPage(stub({}, aSong({ body: 'just the words, all of them' })))

    await screen.findByText('just the words, all of them')
    expect(screen.queryByRole('button', { name: 'A semitone up' })).toBeNull()
    expect(screen.getByRole('button', { name: /Scroll it/ })).toBeTruthy()
  })

  it('scrolls the page while it is playing, and stops when told', async () => {
    vi.useFakeTimers()
    try {
      const scrollBy = vi.fn()
      Object.defineProperty(globalThis, 'scrollBy', { value: scrollBy, writable: true })
      renderPage(stub())

      await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Scroll it/ })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Scroll it/ }))

      vi.advanceTimersByTime(200)
      expect(scrollBy).toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: /Stop scrolling/ }))
      scrollBy.mockClear()
      vi.advanceTimersByTime(200)
      expect(scrollBy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves what was edited, whitespace in the words and all', async () => {
    const updateSong = vi.fn<SongApi['updateSong']>(() => Promise.resolve({ song: aSong(), thread: null }))
    renderPage(stub({ updateSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fire in the sky' }))
    fireEvent.input(screen.getByLabelText('What it is called'), { target: { value: 'Fire on the water' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSong).toHaveBeenCalledWith('s-1', {
        title: 'Fire on the water',
        body: CHORUS,
        capo: null,
        links: [],
        category_ids: [],
      }),
    )
  })

  it('files it under a category that is ticked', async () => {
    const updateSong = vi.fn<SongApi['updateSong']>(() => Promise.resolve({ song: aSong(), thread: null }))
    renderPage(stub({ updateSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fire in the sky' }))
    fireEvent.click(screen.getByLabelText('Chant'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSong).toHaveBeenCalledWith('s-1', expect.objectContaining({ category_ids: ['c-1'] })),
    )
  })

  it('adds a link, and takes one off again', async () => {
    const updateSong = vi.fn<SongApi['updateSong']>(() => Promise.resolve({ song: aSong(), thread: null }))
    renderPage(stub({ updateSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fire in the sky' }))
    fireEvent.input(screen.getByLabelText('A link to this song'), {
      target: { value: 'https://youtu.be/abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add the link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSong).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ links: [{ url: 'https://youtu.be/abc' }] }),
      ),
    )
  })

  it('offers the capo that would open the shapes up', async () => {
    const updateSong = vi.fn<SongApi['updateSong']>(() => Promise.resolve({ song: aSong(), thread: null }))
    renderPage(stub({ updateSong }, aSong({ body: 'Bb   Eb   F' })))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fire in the sky' }))

    expect(screen.getByText(/Capo 1 would play as A D E/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use that' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSong).toHaveBeenCalledWith('s-1', expect.objectContaining({ capo: 1 })))
  })

  it('asks before taking a song out, and says where it goes', async () => {
    const deleteSong = vi.fn<SongApi['deleteSong']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take Fire in the sky out of the book' }))

    expect(screen.getByText(/Recently taken out/)).toBeTruthy()
    expect(deleteSong).not.toHaveBeenCalled()
  })

  it('takes it out once that is answered', async () => {
    const deleteSong = vi.fn<SongApi['deleteSong']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take Fire in the sky out of the book' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really take Fire in the sky out' }))

    await waitFor(() => expect(deleteSong).toHaveBeenCalledWith('s-1'))
  })

  it('keeps it where the question is answered the other way', async () => {
    const deleteSong = vi.fn<SongApi['deleteSong']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteSong }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take Fire in the sky out of the book' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(deleteSong).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Take Fire in the sky out of the book' })).toBeTruthy()
  })

  it('offers no editing of one that is out, only putting it back', async () => {
    const restoreSong = vi.fn<SongApi['restoreSong']>(() => Promise.resolve({ song: aSong(), thread: null }))
    renderPage(stub({ restoreSong }, aSong({ deleted_at: '2026-07-03T00:00:00.000Z' })))

    expect(await screen.findByText(/has been taken out of the book/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Fire in the sky' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }))

    await waitFor(() => expect(restoreSong).toHaveBeenCalledWith('s-1'))
  })

  it('offers a heart on the song, with whoever has given one', async () => {
    renderPage(
      stub({}, aSong(), {
        support_count: 2,
        supported_by_me: true,
        supporters: [
          { account_id: 'a-1', name: 'Ada', avatar: null },
          { account_id: 'a-2', name: 'Bea', avatar: null },
        ],
      }),
    )

    const heart = await screen.findByRole('button', { name: 'Take back your heart for Fire in the sky' })
    expect(heart.getAttribute('aria-pressed')).toBe('true')
    expect(heart.textContent).toContain('2')
    expect(screen.getByRole('link', { name: 'Ada' })).toBeTruthy()
  })

  it('gives one', async () => {
    const supportThread = vi.fn<SongApi['supportThread']>(() => Promise.resolve({ thread: aThread() }))
    renderPage(stub({ supportThread }))

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Fire in the sky' }))

    await waitFor(() => expect(supportThread).toHaveBeenCalledWith('t-1'))
  })

  it('draws the conversation the song came with, and says something on it', async () => {
    const postComment = vi.fn<SongApi['postComment']>(() => Promise.resolve({ thread: aThread() }))
    renderPage(stub({ postComment }))

    expect(await screen.findByText(/put it in the book/)).toBeTruthy()

    fireEvent.input(screen.getByLabelText(/Say something/), { target: { value: 'we sang this at dawn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))

    await waitFor(() => expect(postComment).toHaveBeenCalledWith('t-1', { body: 'we sang this at dawn' }))
  })

  it('says so when the song is not there rather than drawing an empty page', async () => {
    renderPage(stub({ getSong: () => Promise.reject(new Error('gone')) }))

    expect(await screen.findByRole('link', { name: 'Back to the songbook' })).toBeTruthy()
  })
})
