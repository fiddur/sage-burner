export interface InstallOffer {
  prompt: () => Promise<unknown>
}

export const offerIn = (event: unknown): InstallOffer | undefined => {
  if (typeof event !== 'object' || event === null) return undefined

  const prompt = Reflect.get(event, 'prompt')
  if (typeof prompt !== 'function') return undefined

  return { prompt: async () => Promise.resolve(prompt.call(event)) }
}

export interface InstallWatch {
  offer: () => InstallOffer | undefined
  offersItself: () => boolean
  standalone: () => boolean
  onChange: (listener: () => void) => () => void
  taken: () => void
}

export const isStandalone = (): boolean =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches === true ||
  Reflect.get(globalThis.navigator ?? {}, 'standalone') === true

export const hasInstallOffer = (host: object = globalThis): boolean => 'onbeforeinstallprompt' in host

export const watchInstalls = ({
  listen = (name: string, handler: (event: Event) => void) => {
    globalThis.addEventListener(name, handler)
    return () => globalThis.removeEventListener(name, handler)
  },
  installed = isStandalone,
  offers = hasInstallOffer,
}: {
  listen?: (name: string, handler: (event: Event) => void) => () => void
  installed?: () => boolean
  offers?: () => boolean
} = {}): InstallWatch => {
  let offer: InstallOffer | undefined
  const listeners = new Set<() => void>()

  const announce = () => {
    for (const listener of listeners) listener()
  }

  if (!installed()) {
    listen('beforeinstallprompt', (event) => {
      event.preventDefault()

      offer = offerIn(event)
      announce()
    })

    listen('appinstalled', () => {
      offer = undefined
      announce()
    })
  }

  return {
    offer: () => offer,
    offersItself: () => offers(),
    standalone: () => installed(),
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    taken: () => {
      offer = undefined
      announce()
    },
  }
}

export const DISMISSED_KEY = 'sage-burner:install-dismissed'

export const dismissedInstall = (store?: Storage): boolean => {
  try {
    const held = store ?? globalThis.localStorage

    return typeof held?.getItem(DISMISSED_KEY) === 'string'
  } catch {
    return false
  }
}

export const dismissInstall = (store?: Storage): void => {
  try {
    const held = store ?? globalThis.localStorage

    held?.setItem(DISMISSED_KEY, 'yes')
  } catch {}
}
