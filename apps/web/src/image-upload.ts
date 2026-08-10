import { apiRoutes } from '@sage-burner/shared'
import { useRef, useState } from 'preact/hooks'

import { isApiError } from './api/client.ts'
import { resizedImage } from './image.ts'

const PLACEHOLDER_PREFIX = '![Uploading '

export const uploadPlaceholder = (name: string): string => `${PLACEHOLDER_PREFIX}${name}…]()`

export const stillUploading = (value: string): boolean => value.includes(PLACEHOLDER_PREFIX)

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

export const imageMarkdown = (id: string): string => `![](${apiRoutes.storedImage.path(id)})`

export const STORED_MARKDOWN_LENGTH = imageMarkdown('0'.repeat(36)).length

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

const REFUSED_TYPE = 'image/svg+xml'

const NOT_A_PICTURE = 'An SVG cannot be used as a picture here. A JPEG, PNG or WebP works.'

export type UploadImage = (image: Blob) => Promise<{ id: string }>

export interface ImageUpload {
  enabled: boolean
  handlers: {
    onPaste: (event: ClipboardEvent) => void
    onDrop: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
  }
  take: (files: readonly File[]) => void
  busy: boolean
  error: string | undefined
}

const imagesIn = (files: FileList | null | undefined): File[] =>
  [...(files ?? [])].filter((file) => file.type.startsWith('image/'))

export const useImageUpload = ({
  value,
  maxLength,
  onInput,
  upload,
}: {
  value: string
  maxLength: number
  onInput: (value: string) => void
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

        event.preventDefault()
        take(pictures, at(event.currentTarget))
      },
      onDrop: (event) => {
        const pictures = upload === undefined ? [] : imagesIn(event.dataTransfer?.files)
        if (pictures.length === 0) return

        event.preventDefault()
        take(pictures, at(event.currentTarget))
      },
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
