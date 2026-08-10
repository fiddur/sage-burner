import { ROUTE_TO } from '../worker-message.ts'

export const HOME = '/'

export interface OpenWindow {
  focus: () => Promise<unknown>
  postMessage: (message: unknown) => void
  url: string
}

export interface WindowClients {
  matchAll: (options: { includeUncontrolled: boolean; type: 'window' }) => Promise<OpenWindow[]>
  openWindow: (url: string) => Promise<unknown>
}

const showing = (client: OpenWindow, path: string, origin: string): boolean => {
  try {
    const asked = new URL(path, origin)
    const at = new URL(client.url)

    if (at.pathname !== asked.pathname) return false

    return asked.search === '' || at.search === asked.search
  } catch {
    return false
  }
}

export const landOn = async (
  clients: WindowClients,
  origin: string,
  path: string | undefined,
): Promise<unknown> => {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const [anywhere] = windows

  if (path === undefined) {
    return anywhere === undefined ? clients.openWindow(HOME) : anywhere.focus()
  }

  const already = windows.find((client) => showing(client, path, origin))
  if (already !== undefined) return already.focus()

  if (anywhere === undefined) return clients.openWindow(path)

  await anywhere.focus()
  anywhere.postMessage({ type: ROUTE_TO, path })

  return anywhere
}

export const UNREADABLE = 'Something needs your attention.'

export interface Alert {
  body: string
  path?: string
  tag: string
}

const stringAt = (raw: unknown, key: string): string | undefined => {
  if (typeof raw !== 'object' || raw === null || !(key in raw)) return undefined

  const found = Reflect.get(raw, key)

  return typeof found === 'string' ? found : undefined
}

const NOWHERE = 'https://app.invalid'

const pathIn = (link: string | undefined): string | undefined => {
  if (link === undefined) return undefined

  try {
    const asked = new URL(link, NOWHERE)

    return asked.origin === NOWHERE ? `${asked.pathname}${asked.search}${asked.hash}` : undefined
  } catch {
    return undefined
  }
}

export const alertFrom = (raw: unknown): Alert => {
  const category = stringAt(raw, 'category')

  return {
    body: stringAt(raw, 'body') ?? UNREADABLE,
    path: pathIn(stringAt(raw, 'link')),
    tag: category === undefined ? 'sage-burner' : `sage-burner-${category}`,
  }
}
