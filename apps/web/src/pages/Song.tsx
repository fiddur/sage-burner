import type { Song, SongCategory, SongLink, Thread } from '@sage-burner/shared'

import {
  capoSuggestion,
  isProfileUrl,
  MAX_CAPO,
  MAX_SONG_BODY,
  MAX_SONG_LINK_LABEL,
  MAX_SONG_LINK_URL,
  MAX_SONG_LINKS,
  MAX_TITLE,
  musicHost,
  songbookPage,
} from '@sage-burner/shared'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Mentionable } from '../mentioning.ts'

import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import {
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  pixelsPerTick,
  rememberedSpeed,
  rememberSpeed,
  shifted,
  songLines,
  TICK_MS,
} from '../songbook.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type SongApi = Pick<
  ApiClient,
  | 'getSong'
  | 'getSongCategories'
  | 'updateSong'
  | 'deleteSong'
  | 'restoreSong'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
  | 'getApprovedAccounts'
>

interface Held {
  song: Song
  thread: Thread | null
  categories: readonly SongCategory[]
  people: readonly { account_id: string; name: string | null }[]
}

export const SongPage = ({ api, songId }: { api: SongApi; songId: string }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)

  const { loaded, refreshing, reload } = useLoad<Held>(
    async (signal) => {
      const [one, listed, people] = await Promise.all([
        api.getSong(songId, signal),
        api.getSongCategories(signal),
        api.getApprovedAccounts(signal),
      ])

      return {
        song: one.song,
        thread: one.thread,
        categories: listed.categories,
        people: people.accounts,
      }
    },
    { enabled: approved, key: songId, fallback: 'Could not load that song.', remember: 'song' },
  )

  const { busy, error, run } = useAction(reload)
  const [editing, setEditing] = useState(false)

  if (loaded.status === 'loading') {
    return (
      <GuardedPage title="Song" require="approved">
        <p class="form-note">Loading…</p>
      </GuardedPage>
    )
  }

  if (loaded.status === 'failed') {
    return (
      <GuardedPage title="Song" require="approved">
        <ErrorText message={loaded.message} />
        <p>
          <a href={songbookPage()}>Back to the songbook</a>
        </p>
      </GuardedPage>
    )
  }

  const { song, categories, people, thread } = loaded.data
  const filed = categories.filter((category) => song.category_ids.includes(category.id))

  return (
    <GuardedPage title={song.title} require="approved">
      <p class="form-note">
        <a href={songbookPage()}>← Songbook</a>
      </p>

      <h1>
        {song.title} <Refreshing on={refreshing} />
      </h1>

      <p class="song-marks">
        {song.capo !== null && <span class="song-capo">capo {song.capo}</span>}
        {filed.map((category) => (
          <span key={category.id} class="chip is-on">
            {category.label}
          </span>
        ))}
      </p>

      {song.deleted_at !== null && (
        <p class="form-note">
          This one has been taken out of the book.{' '}
          <button
            type="button"
            class="link-button"
            disabled={busy}
            onClick={() => run(() => api.restoreSong(song.id), 'Could not put that back.')}
          >
            Put it back
          </button>
        </p>
      )}

      <Links links={song.links} />

      <ErrorText message={error} />

      {editing ? (
        <Fields
          song={song}
          categories={categories}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(changes) =>
            run(async () => {
              await api.updateSong(song.id, changes)
              setEditing(false)
            }, 'Could not save that. Please try again.')
          }
        />
      ) : (
        <>
          <Words body={song.body} />

          {song.deleted_at === null && (
            <p class="row">
              <button type="button" class="link-button" disabled={busy} onClick={() => setEditing(true)}>
                Edit it
              </button>
              <button
                type="button"
                class="link-button"
                disabled={busy}
                aria-label={`Take ${song.title} out of the book`}
                onClick={() => run(() => api.deleteSong(song.id), 'Could not take that out.')}
              >
                Take it out
              </button>
            </p>
          )}
        </>
      )}

      <Talk api={api} thread={thread} people={people} viewerId={viewer.account?.id} admin={isAdmin(viewer)} />
    </GuardedPage>
  )
}

const Links = ({ links }: { links: readonly SongLink[] }) => {
  if (links.length === 0) return null

  return (
    <ul class="song-links">
      {links.map((link) => {
        const host = musicHost(link.url)

        return (
          <li key={link.url}>
            {host !== undefined && <span aria-hidden="true">{host.icon} </span>}
            <a href={link.url} rel="noreferrer noopener" target="_blank">
              {link.label === '' ? (host?.label ?? link.url) : link.label}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

const Words = ({ body }: { body: string }) => {
  const [semitones, setSemitones] = useState(0)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [rolling, setRolling] = useState(false)
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    setSpeed(rememberedSpeed(globalThis.localStorage))
  }, [])

  useEffect(() => {
    if (!rolling) return undefined

    const timer = setInterval(() => {
      globalThis.scrollBy({ top: pixelsPerTick(speed) })
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [rolling, speed])

  if (body.trim() === '') {
    return <p class="form-note">No words yet. Paste them in — chords on their own lines above the words.</p>
  }

  const lines = songLines(body, semitones)
  const anyChords = lines.some((line) => line.chords)

  return (
    <>
      <p class="song-aids">
        {anyChords && (
          <>
            <IconButton
              icon="♭"
              label="A semitone down"
              disabled={semitones <= -11}
              onClick={() => setSemitones(shifted(semitones, -1))}
            />
            <span class="song-key">
              {semitones === 0 ? 'as written' : `${semitones > 0 ? '+' : ''}${semitones}`}
            </span>
            <IconButton
              icon="♯"
              label="A semitone up"
              disabled={semitones >= 11}
              onClick={() => setSemitones(shifted(semitones, 1))}
            />
            {semitones !== 0 && (
              <button type="button" class="link-button" onClick={() => setSemitones(0)}>
                Back to how it is written
              </button>
            )}
          </>
        )}

        <button type="button" class="link-button" aria-pressed={rolling} onClick={() => setRolling(!rolling)}>
          {rolling ? '⏸ Stop scrolling' : '▶️ Scroll it'}
        </button>

        <label class="song-speed">
          <span>Speed</span>
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            value={speed}
            onInput={(typed) => {
              const wanted = Number(typed.currentTarget.value)
              setSpeed(wanted)
              rememberSpeed(globalThis.localStorage, wanted)
            }}
          />
        </label>
      </p>

      <pre class="song-body">
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key -- a line has nothing else to be keyed by
          <span key={index} class={line.chords ? 'song-line is-chords' : 'song-line'}>
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
    </>
  )
}

const Fields = ({
  song,
  categories,
  busy,
  onCancel,
  onSave,
}: {
  song: Song
  categories: readonly SongCategory[]
  busy: boolean
  onCancel: () => void
  onSave: (changes: {
    title: string
    body: string
    capo: number | null
    links: SongLink[]
    category_ids: string[]
  }) => void
}) => {
  const [title, setTitle] = useState(song.title)
  const [body, setBody] = useState(song.body)
  const [capo, setCapo] = useState(song.capo === null ? '' : String(song.capo))
  const [links, setLinks] = useState<SongLink[]>([...song.links])
  const [filed, setFiled] = useState<string[]>([...song.category_ids])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')

  const suggested = capoSuggestion(body)
  const linkable = isProfileUrl(url) && !links.some((one) => one.url === url.trim())

  return (
    <form
      class="form"
      onSubmit={(submitted) => {
        submitted.preventDefault()
        if (title.trim() === '') return

        onSave({
          title: title.trim(),
          body,
          capo: capo === '' ? null : Number(capo),
          links,
          category_ids: filed,
        })
      }}
    >
      <label class="field">
        <span>What it is called</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          value={title}
          onInput={(typed) => setTitle(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>The words, with chords on their own lines above them</span>
        <textarea
          class="song-editor"
          maxLength={MAX_SONG_BODY}
          rows={rowsFor(body, 12)}
          spellcheck={false}
          value={body}
          onInput={(typed) => setBody(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Capo</span>
        <select value={capo} onChange={(changed) => setCapo(changed.currentTarget.value)}>
          <option value="">Nobody has said</option>
          {Array.from({ length: MAX_CAPO + 1 }, (_unused, fret) => (
            <option key={fret} value={String(fret)}>
              {fret === 0 ? 'No capo' : `Capo ${fret}`}
            </option>
          ))}
        </select>
      </label>

      {suggested !== undefined && String(suggested.capo) !== capo && (
        <p class="form-note">
          Capo {suggested.capo} would play as {suggested.shapes.join(' ')}.{' '}
          <button type="button" class="link-button" onClick={() => setCapo(String(suggested.capo))}>
            Use that
          </button>
        </p>
      )}

      {categories.length > 0 && (
        <fieldset class="field">
          <legend>Filed under</legend>
          {categories.map((category) => (
            <label key={category.id} class="tick">
              <input
                type="checkbox"
                checked={filed.includes(category.id)}
                onChange={(changed) =>
                  setFiled((current) =>
                    changed.currentTarget.checked
                      ? [...current, category.id]
                      : current.filter((one) => one !== category.id),
                  )
                }
              />
              <span>{category.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset class="field">
        <legend>Somewhere to hear it</legend>

        {links.length > 0 && (
          <ul class="song-links">
            {links.map((link) => (
              <li key={link.url}>
                {link.label === '' ? link.url : `${link.label} — ${link.url}`}
                <IconButton
                  icon="🗑️"
                  label={`Take off the link to ${link.url}`}
                  onClick={() => setLinks(links.filter((one) => one.url !== link.url))}
                />
              </li>
            ))}
          </ul>
        )}

        {links.length < MAX_SONG_LINKS && (
          <p class="row">
            <input
              type="url"
              aria-label="A link to this song"
              placeholder="https://open.spotify.com/…"
              maxLength={MAX_SONG_LINK_URL}
              value={url}
              onInput={(typed) => setUrl(typed.currentTarget.value)}
            />
            <input
              type="text"
              aria-label="What to call that link"
              placeholder="What to call it"
              maxLength={MAX_SONG_LINK_LABEL}
              value={label}
              onInput={(typed) => setLabel(typed.currentTarget.value)}
            />
            <button
              type="button"
              disabled={!linkable}
              onClick={() => {
                setLinks([...links, { url: url.trim(), label: label.trim() }])
                setUrl('')
                setLabel('')
              }}
            >
              Add the link
            </button>
          </p>
        )}

        {url.trim() !== '' && !isProfileUrl(url) && (
          <p class="form-note">A link has to start with https:// — the server refuses anything else.</p>
        )}
      </fieldset>

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="submit"
          disabled={title.trim() === ''}
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  )
}

const Talk = ({
  api,
  thread,
  people,
  viewerId,
  admin,
}: {
  api: SongApi
  thread: Thread | null
  people: readonly Mentionable[]
  viewerId: string | undefined
  admin: boolean
}) => {
  const [said, setSaid] = useState<Thread | undefined>(undefined)
  const { busy, error, run } = useAction()

  const held = said ?? thread
  if (held === null) return null

  const setThread = (one: Thread) => setSaid(one)

  return (
    <section>
      <h2>What people say</h2>
      <ErrorText message={error} />

      <DreamThread
        thread={held}
        viewerId={viewerId}
        admin={admin}
        busy={busy}
        more={held.entry_count > held.entries.length}
        upload={api.uploadImage}
        people={people}
        onSay={(body) =>
          run(async () => setThread((await api.postComment(held.id, { body })).thread), 'Could not say that.')
        }
        onRewrite={(id, body) =>
          run(async () => setThread((await api.updateComment(id, { body })).thread), 'Could not save that.')
        }
        onRemove={(id) =>
          run(async () => setThread((await api.deleteComment(id)).thread), 'Could not take that back.')
        }
        onShowAll={() =>
          run(async () => setThread((await api.getThread(held.id)).thread), 'Could not load the rest of it.')
        }
      />
    </section>
  )
}
