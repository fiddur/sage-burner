import { apiRoutes } from '@sage-burner/shared'
import { useRef, useState } from 'preact/hooks'

import { isApiError } from './api/client.ts'
import { resizedImage } from './image.ts'

/**
 * What every placeholder starts with, and the whole of how one is recognised later.
 *
 * One constant rather than a builder and a matcher that have to agree: `stillUploading`
 * is what stops a half-finished picture being saved, and a matcher written out
 * separately is the kind of thing that survives a change to the wording above it.
 */
const PLACEHOLDER_PREFIX = '![Uploading '

/** What stands in the text while the bytes are still going up, as GitHub's does. */
export const uploadPlaceholder = (name: string): string => `${PLACEHOLDER_PREFIX}${name}…]()`

/**
 * Whether this text still has a picture on the way.
 *
 * Read off the value rather than off the hook's `busy`, because the value is the one
 * thing every call site already holds — the save buttons live in six different parents,
 * and it is what must not be saved that matters rather than which component is busy. A
 * comment stored mid-upload keeps the placeholder for good and orphans the picture that
 * lands a moment later.
 *
 * Somebody who types the prefix themselves gets a disabled save until they change it,
 * which is recoverable and not worth a stricter match.
 */
export const stillUploading = (value: string): boolean => value.includes(PLACEHOLDER_PREFIX)

/**
 * A placeholder that is not already in the text.
 *
 * Two pictures dropped at once are often two versions of one name, and the finished
 * upload replaces its placeholder by matching the text rather than by remembering an
 * offset — because the offset is wrong the moment somebody types while it is in flight.
 * Identical placeholders would make the first upload to land replace the wrong one.
 */
export const freePlaceholder = (value: string, name: string): string => {
  let candidate = uploadPlaceholder(name)

  for (let attempt = 2; value.includes(candidate); attempt += 1) {
    candidate = uploadPlaceholder(`${name} (${attempt})`)
  }

  return candidate
}

export const insertAt = (value: string, at: number, text: string): string => {
  const cursor = Math.max(0, Math.min(at, value.length))

  return `${value.slice(0, cursor)}${text}${value.slice(cursor)}`
}

export const replaceFirst = (value: string, find: string, replacement: string): string => {
  const at = value.indexOf(find)
  if (at === -1) return value

  return `${value.slice(0, at)}${replacement}${value.slice(at + find.length)}`
}

/** What a stored picture looks like in the markdown. */
export const imageMarkdown = (id: string): string => `![](${apiRoutes.storedImage.path(id)})`

/**
 * The most room the finished markdown can need.
 *
 * Built from `imageMarkdown` rather than counted, so a change to the path in `routes.ts`
 * moves this with it. The id is a v4 UUID — 36 characters, none of which encoding
 * lengthens.
 */
export const STORED_MARKDOWN_LENGTH = imageMarkdown('0'.repeat(36)).length

/**
 * Why the picture did not go up.
 *
 * The format advice is only right for a failure that is actually about the file, and it
 * is expensive to get wrong: it sends somebody with a perfectly good photograph off to
 * re-export it, and the second attempt fails the same way. Anything that is not an
 * `ApiError` never reached the network — `resizedImage` throws when the browser cannot
 * decode what was chosen, which is the one case that advice fits.
 */
export const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not read that picture. A JPEG, PNG or WebP works best.'
  if (failure.status === 415) return 'That is not a picture we can use. A JPEG, PNG or WebP works best.'
  if (failure.status === 413) return 'That picture is too large to send.'
  if (failure.status === 409) return 'You have stored as many pictures as one account may hold.'
  if (failure.status === 401) return 'You have been signed out. Sign in again and have another go.'
  if (failure.code === 'network') return failure.message

  return 'Could not send that picture. Please try again.'
}

const TOO_LONG = 'There is not room for a picture in this field.'

/**
 * The one `image/*` the server refuses outright, refused here too.
 *
 * Left to `resizedImage` it fails at `createImageBitmap` and reads as "could not read
 * that picture" — true, and no use to somebody who picked a perfectly good logo. Named
 * rather than narrowed to `IMAGE_TYPES`, because a phone's HEIC is not on that list and
 * the canvas turns it into one of them.
 */
const REFUSED_TYPE = 'image/svg+xml'

const NOT_A_PICTURE = 'An SVG cannot be used as a picture here. A JPEG, PNG or WebP works.'

/** `api.uploadImage`, named so the components that take it do not each spell it out. */
export type UploadImage = (image: Blob) => Promise<{ id: string }>

export interface ImageUpload {
  /** Whether this field takes pictures at all — false where the public reads it. */
  enabled: boolean
  /** Handed to a `textarea`, so a paste and a drop both land in the field. */
  handlers: {
    onPaste: (event: ClipboardEvent) => void
    onDrop: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
  }
  /** For the picker, which has no cursor to insert at and so writes at the end. */
  take: (files: readonly File[]) => void
  busy: boolean
  error: string | undefined
}

const imagesIn = (files: FileList | null | undefined): File[] =>
  [...(files ?? [])].filter((file) => file.type.startsWith('image/'))

/**
 * Pasting, dropping or choosing a picture in any field that takes markdown (#379).
 *
 * A placeholder goes in at the cursor and the real `![](…)` replaces it when the id comes
 * back, so the field never blocks and what somebody typed meanwhile is kept. A refusal
 * takes the placeholder out again and says why — it must never eat the comment.
 *
 * The value is held in a ref as well as read from the props, because two pictures dropped
 * together both write before the parent has re-rendered either of them.
 */
export const useImageUpload = ({
  value,
  maxLength,
  onInput,
  upload,
}: {
  value: string
  maxLength: number
  onInput: (value: string) => void
  /** Absent where the field is one the public reads — `docs/the-app.md` has why. */
  upload?: UploadImage
}): ImageUpload => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const latest = useRef(value)
  latest.current = value

  const write = (next: string) => {
    latest.current = next
    onInput(next)
  }

  const send = async (file: File, placeholder: string, post: NonNullable<typeof upload>) => {
    try {
      const { id } = await post(await resizedImage(file))
      write(replaceFirst(latest.current, placeholder, imageMarkdown(id)))
    } catch (failure) {
      write(replaceFirst(latest.current, placeholder, ''))
      setError(messageForFailure(failure))
    }
  }

  const take = (files: readonly File[], at?: number) => {
    if (upload === undefined || files.length === 0) return

    setError(undefined)

    const usable = files.filter((file) => file.type !== REFUSED_TYPE)
    if (usable.length < files.length) setError(NOT_A_PICTURE)
    if (usable.length === 0) return

    let cursor = at ?? latest.current.length
    const started: { file: File; placeholder: string }[] = []

    for (const file of usable) {
      const placeholder = freePlaceholder(latest.current, file.name === '' ? 'picture' : file.name)

      // Against whichever of the two is longer, because the placeholder is swapped for
      // the finished markdown in a field nothing truncates. `docs/the-app.md` has why.
      const room = Math.max(placeholder.length, STORED_MARKDOWN_LENGTH)

      if (latest.current.length + room > maxLength) {
        setError(TOO_LONG)
        break
      }

      write(insertAt(latest.current, cursor, placeholder))
      cursor += placeholder.length
      started.push({ file, placeholder })
    }

    if (started.length === 0) return

    setBusy(true)
    void Promise.all(started.map(({ file, placeholder }) => send(file, placeholder, upload))).finally(() => {
      setBusy(false)
    })
  }

  const at = (target: EventTarget | null) =>
    target instanceof HTMLTextAreaElement ? target.selectionStart : undefined

  return {
    enabled: upload !== undefined,
    handlers: {
      onPaste: (event) => {
        const pictures = upload === undefined ? [] : imagesIn(event.clipboardData?.files)
        if (pictures.length === 0) return

        // Only once there is something to take: a paste of ordinary text must still be
        // a paste of ordinary text.
        event.preventDefault()
        take(pictures, at(event.currentTarget))
      },
      onDrop: (event) => {
        const pictures = upload === undefined ? [] : imagesIn(event.dataTransfer?.files)
        if (pictures.length === 0) return

        event.preventDefault()
        take(pictures, at(event.currentTarget))
      },
      // Without this the browser navigates to the file instead, and no drop event ever
      // fires. `types` rather than `files`, which is empty until the drop itself — a
      // dragover that looked at the files would preventDefault on nothing, every time.
      onDragOver: (event) => {
        if (upload === undefined) return
        if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault()
      },
    },
    take,
    busy,
    error,
  }
}
