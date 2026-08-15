import type { Song, SongCategory, SongLink, Thread } from '@sage-burner/shared'
import type { RefObject } from 'preact'

import {
  capoSuggestion,
  isProfileUrl,
  MAX_CAPO,
  MAX_SONG_BODY,
  MAX_SONG_LINK_URL,
  MAX_SONG_LINKS,
  MAX_TITLE,
  musicHost,
  songbookPage,
} from '@sage-burner/shared'
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Mentionable } from '../mentioning.ts'

import { Destroy } from '../components/Destroy.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Heart } from '../components/Heart.tsx'
import { Icon } from '../components/Icon.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MusicIcon } from '../components/MusicIcon.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import {
  columnsFitting,
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  MOST_SEMITONES,
  rememberedSpeed,
  rememberSpeed,
  scrollStep,
  shifted,
  songRows,
  TICK_MS,
  wrappedRows,
} from '../songbook.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'
import { RECENTLY_GONE_DAYS } from './Songs.tsx'

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
  | 'supportThread'
  | 'withdrawSupportForThread'
  | 'supportComment'
  | 'withdrawSupportForComment'
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

      {song.artist !== null && <p class="song-artist">{song.artist}</p>}

      <p class="song-marks">
        {song.capo !== null && song.capo > 0 && <span class="song-capo">capo {song.capo}</span>}
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
              <IconButton
                icon="edit"
                label={`Edit ${song.title}`}
                disabled={busy}
                onClick={() => setEditing(true)}
              />
              <TakeItOut
                title={song.title}
                busy={busy}
                onTakeOut={() => run(() => api.deleteSong(song.id), 'Could not take that out.')}
              />
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
    <p class="song-links">
      {links.map((link) => {
        const host = musicHost(link.url)
        const said = host === undefined ? 'Listen elsewhere' : `Listen on ${host.label}`

        return (
          <a
            key={link.url}
            class="song-link"
            href={link.url}
            rel="noreferrer noopener"
            target="_blank"
            title={said}
            aria-label={said}
          >
            <MusicIcon mark={host?.mark ?? 'elsewhere'} />
          </a>
        )
      })}
    </p>
  )
}

const TakeItOut = ({ title, busy, onTakeOut }: { title: string; busy: boolean; onTakeOut: () => void }) => (
  <Destroy
    what={title}
    verb="Take out"
    because={
      <>
        It goes to <em>Recently taken out</em> at the foot of the songbook, where anybody can put it back for{' '}
        {RECENTLY_GONE_DAYS} days.
      </>
    }
    busy={busy}
    onDestroy={onTakeOut}
  />
)

const useColumns = (box: RefObject<HTMLElement | null>, ruler: RefObject<HTMLElement | null>): number => {
  const [columns, setColumns] = useState(Number.POSITIVE_INFINITY)

  useEffect(() => {
    const measure = () =>
      setColumns(
        columnsFitting(box.current?.clientWidth ?? 0, ruler.current?.getBoundingClientRect().width ?? 0),
      )

    measure()

    if (typeof ResizeObserver === 'undefined') return undefined

    const watching = new ResizeObserver(measure)
    for (const watched of [box.current, ruler.current]) if (watched !== null) watching.observe(watched)

    return () => watching.disconnect()
  }, [box, ruler])

  return columns
}

const Words = ({ body }: { body: string }) => {
  const [semitones, setSemitones] = useState(0)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [rolling, setRolling] = useState(false)
  const seeded = useRef(false)
  const box = useRef<HTMLPreElement | null>(null)
  const ruler = useRef<HTMLSpanElement | null>(null)
  const columns = useColumns(box, ruler)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    setSpeed(rememberedSpeed(globalThis.localStorage))
  }, [])

  useEffect(() => {
    if (!rolling) return undefined

    let tenths = 0

    const timer = setInterval(() => {
      const step = scrollStep(tenths, speed)
      tenths = step.tenths
      if (step.move > 0) globalThis.scrollBy({ top: step.move })
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [rolling, speed])

  if (body.trim() === '') {
    return <p class="form-note">No words yet. Paste them in — chords on their own lines above the words.</p>
  }

  const rows = wrappedRows(songRows(body, semitones), columns)
  const anyChords = rows.some((row) => row.chords !== null)

  return (
    <>
      {anyChords && (
        <p class="song-aids">
          <span class="song-key-label">Transpose</span>
          <button
            type="button"
            class="link-button"
            aria-label="A semitone down"
            disabled={semitones <= -MOST_SEMITONES}
            onClick={() => setSemitones(shifted(semitones, -1))}
          >
            ♭
          </button>
          <span class="song-key">{semitones > 0 ? `+${semitones}` : semitones}</span>
          <button
            type="button"
            class="link-button"
            aria-label="A semitone up"
            disabled={semitones >= MOST_SEMITONES}
            onClick={() => setSemitones(shifted(semitones, 1))}
          >
            ♯
          </button>
          {semitones !== 0 && (
            <button type="button" class="link-button" onClick={() => setSemitones(0)}>
              Back to how it is written
            </button>
          )}
        </p>
      )}

      <pre class="song-body" ref={box}>
        <span class="song-ruler" aria-hidden="true" ref={ruler} />
        {rows.map((row, index) => (
          // eslint-disable-next-line react/no-array-index-key -- a row has nothing else to be keyed by
          <Fragment key={index}>
            {row.chords !== null && (
              <span class="song-line is-chords">
                {row.chords}
                {'\n'}
              </span>
            )}
            {row.words !== null && (
              <span class="song-line">
                {row.words}
                {'\n'}
              </span>
            )}
          </Fragment>
        ))}
      </pre>

      <p class="song-play">
        <button type="button" class="link-button" aria-pressed={rolling} onClick={() => setRolling(!rolling)}>
          <Icon name={rolling ? 'pause' : 'play'} /> {rolling ? 'Stop scrolling' : 'Scroll it'}
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
    artist: string | null
    body: string
    capo: number | null
    links: SongLink[]
    category_ids: string[]
  }) => void
}) => {
  const [title, setTitle] = useState(song.title)
  const [artist, setArtist] = useState(song.artist ?? '')
  const [body, setBody] = useState(song.body)
  const [capo, setCapo] = useState(song.capo === null ? '' : String(song.capo))
  const [links, setLinks] = useState<SongLink[]>([...song.links])
  const [filed, setFiled] = useState<string[]>([...song.category_ids])
  const [url, setUrl] = useState('')

  const suggested = capoSuggestion(body)
  const linkable = isProfileUrl(url) && !links.some((one) => one.url === url.trim())

  return (
    <form
      class="form song-form"
      onSubmit={(submitted) => {
        submitted.preventDefault()
        if (title.trim() === '') return

        onSave({
          title: title.trim(),
          artist: artist.trim() === '' ? null : artist.trim(),
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
        <span>Whose song it is</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          placeholder="Nobody has said"
          value={artist}
          onInput={(typed) => setArtist(typed.currentTarget.value)}
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
          <ul class="song-links-edit">
            {links.map((link) => (
              <li key={link.url}>
                {link.url}
                <IconButton
                  icon="destroy"
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
            <button
              type="button"
              disabled={!linkable}
              onClick={() => {
                setLinks([...links, { url: url.trim() }])
                setUrl('')
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
      <div class="song-hearts">
        <Heart
          what={held.title}
          hearted={held.supported_by_me}
          count={held.support_count}
          people={held.supporters}
          busy={busy}
          onHeart={(hearting) =>
            run(
              async () =>
                setThread(
                  (hearting ? await api.supportThread(held.id) : await api.withdrawSupportForThread(held.id))
                    .thread,
                ),
              'Could not do that just now.',
            )
          }
        />
      </div>

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
        onSay={(body, done) =>
          run(async () => {
            setThread((await api.postComment(held.id, { body })).thread)
            done()
          }, 'Could not say that.')
        }
        onRewrite={(id, body) =>
          run(async () => setThread((await api.updateComment(id, { body })).thread), 'Could not save that.')
        }
        onRemove={(id) =>
          run(async () => setThread((await api.deleteComment(id)).thread), 'Could not take that back.')
        }
        onHeart={(id, hearting) =>
          run(
            async () =>
              setThread(
                (hearting ? await api.supportComment(id) : await api.withdrawSupportForComment(id)).thread,
              ),
            'Could not do that just now.',
          )
        }
        onShowAll={() =>
          run(async () => setThread((await api.getThread(held.id)).thread), 'Could not load the rest of it.')
        }
      />
    </section>
  )
}
