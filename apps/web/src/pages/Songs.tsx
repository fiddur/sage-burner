import type { SongCategory, SongSummary } from '@sage-burner/shared'

import { MAX_TITLE, songPage } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { ChipRow } from '../components/ChipRow.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type SongsApi = Pick<ApiClient, 'getSongbook' | 'addSong' | 'restoreSong'>

const labelsFor = (categories: readonly SongCategory[], ids: readonly string[]): string[] =>
  categories.flatMap((category) => (ids.includes(category.id) ? [category.label] : []))

export const songSorts = ['title', 'artist'] as const

export type SongSort = (typeof songSorts)[number]

export const songSortLabel: Record<SongSort, string> = {
  title: 'By title',
  artist: 'By artist',
}

export const inSongOrder = (songs: readonly SongSummary[], by: SongSort): SongSummary[] =>
  [...songs].sort((one, other) => {
    if (by === 'artist' && one.artist !== other.artist) {
      if (one.artist === null) return 1
      if (other.artist === null) return -1

      return one.artist.localeCompare(other.artist)
    }

    return one.title.localeCompare(other.title)
  })

export const RECENTLY_GONE_DAYS = 30

export const recentlyGone = (deletedAt: string | null, now: number): boolean =>
  deletedAt !== null && now - Date.parse(deletedAt) < RECENTLY_GONE_DAYS * 24 * 60 * 60 * 1000

export const Songs = ({ api }: { api: SongsApi }) => {
  const approved = isApproved(useViewer())
  const { loaded, refreshing, reload } = useLoad(async (signal) => await api.getSongbook(signal), {
    enabled: approved,
    fallback: 'Could not load the songbook.',
    remember: 'songbook',
  })
  const { busy, error, setError, run } = useAction(reload)

  const [title, setTitle] = useState('')
  const [filed, setFiled] = useState<readonly string[]>([])
  const [sortedBy, setSortedBy] = useState<SongSort>('title')

  const book = loaded.status === 'ready' ? loaded.data : { songs: [], categories: [] }
  const living = book.songs.filter((one) => one.deleted_at === null)
  const gone = book.songs.filter((one) => recentlyGone(one.deleted_at, Date.now()))
  const shown = inSongOrder(
    filed.length === 0 ? living : living.filter((one) => one.category_ids.some((id) => filed.includes(id))),
    sortedBy,
  )

  const put = () => {
    if (title.trim() === '') {
      setError('A song needs a title. Everything else can wait.')
      return
    }

    run(async () => {
      await api.addSong({ title: title.trim() })
      setTitle('')
    }, 'Could not put that in the book.')
  }

  return (
    <GuardedPage title="Songbook" require="approved">
      <h1>
        Songbook <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What we sing together, so whoever has the guitar and whoever has a phone are looking at the same
        words. It belongs to no one burn — everybody here can add a song and everybody can polish one.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
        <ChipRow
          chips={book.categories.map((category) => ({ id: category.id, label: category.label }))}
          lit={filed}
          subject="What to show"
          onChange={setFiled}
        />
      )}

      {loaded.status === 'ready' && living.length > 0 && (
        <p class="row">
          {songSorts.map((by) => (
            <button
              key={by}
              type="button"
              class={by === sortedBy ? 'chip is-on' : 'chip'}
              aria-pressed={by === sortedBy}
              onClick={() => setSortedBy(by)}
            >
              {songSortLabel[by]}
            </button>
          ))}
        </p>
      )}

      {loaded.status === 'ready' && shown.length === 0 && (
        <p class="form-note">
          {living.length === 0
            ? 'Nothing in the book yet. Paste a song in and it is everybody’s.'
            : 'Nothing filed under that yet.'}
        </p>
      )}

      {shown.length > 0 && (
        <ul class="song-list">
          {shown.map((one) => (
            <li key={one.id}>
              <a class="song-row" href={songPage(one.id)}>
                <span class="song-what">{one.title}</span>
                {one.artist !== null && <span class="song-artist">{one.artist}</span>}
                <Marks song={one} categories={book.categories} />
              </a>
            </li>
          ))}
        </ul>
      )}

      <form
        class="form"
        onSubmit={(submitted) => {
          submitted.preventDefault()
          put()
        }}
      >
        <label class="field">
          <span>Add a song</span>
          <input
            type="text"
            name="title"
            maxLength={MAX_TITLE}
            placeholder="Fire in the sky"
            value={title}
            onInput={(typed) => setTitle(typed.currentTarget.value)}
          />
        </label>

        <p class="form-note">The words, the chords and the links go on its own page, once it is in.</p>

        <PendingButton busy={busy} label="Add it" busyLabel="Adding…" type="submit" />
      </form>

      {gone.length > 0 && (
        <section>
          <h2>Recently taken out</h2>
          <p class="form-note">
            Anybody can take a song out and anybody can put it back. Nothing here is deleted for good.
          </p>
          <ul class="song-list">
            {gone.map((one) => (
              <li key={one.id} class="song-row is-gone">
                <a href={songPage(one.id)}>{one.title}</a>
                <IconButton
                  icon="restore"
                  label={`Put ${one.title} back in the book`}
                  disabled={busy}
                  onClick={() => run(() => api.restoreSong(one.id), 'Could not put that back.')}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </GuardedPage>
  )
}

const Marks = ({ song, categories }: { song: SongSummary; categories: readonly SongCategory[] }) => {
  const labels = labelsFor(categories, song.category_ids)

  return (
    <span class="song-marks">
      {song.links.length > 0 && (
        <span class="song-has-links" title="There is somewhere to hear it">
          🎧
        </span>
      )}
      {labels.length > 0 && <span class="form-note">{labels.join(' · ')}</span>}
    </span>
  )
}
