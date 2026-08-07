/**
 * Offering to install the app, where the browser makes that possible (#281).
 *
 * **Chromium only, deliberately.** `beforeinstallprompt` is the one API that opens a
 * browser's own install flow, and Firefox and Safari have no equivalent — there is no
 * way to open Firefox's "Add to Home screen" or iOS Safari's Share sheet from a page.
 * So this offers a real button where there is one to offer and says nothing anywhere
 * else, rather than instructions that go stale as menu wording moves.
 */

/** What the browser hands over, narrowed to the one method that is used. */
export interface InstallOffer {
  prompt: () => Promise<unknown>
}

/**
 * The offer inside a `beforeinstallprompt` event, if that is what this is.
 *
 * Asked of the object rather than cast to a type this app cannot import — the event
 * is Chromium's and has no lib.dom definition — and the same shape as `routeAsked`.
 */
export const offerIn = (event: unknown): InstallOffer | undefined => {
  if (typeof event !== 'object' || event === null) return undefined

  const prompt = Reflect.get(event, 'prompt')
  if (typeof prompt !== 'function') return undefined

  // Bound back to the event: `prompt()` is a method on it, and calling it detached
  // throws an illegal-invocation in Chrome.
  return { prompt: async () => Promise.resolve(prompt.call(event)) }
}

/**
 * What the page can be told about installing, watched from before it renders.
 *
 * A built object rather than a module's variables, for the reason `createRemembered`
 * gives: two suites in one process would otherwise share one. It is built in
 * `main.tsx` and handed to `App`, so a test that renders `App` without it simply has
 * nothing to offer.
 *
 * **Watching starts before the first render, and that is the point.**
 * `beforeinstallprompt` fires once, when the browser decides the site qualifies, and
 * that can be before a component's effect has run. A listener attached in an effect
 * would miss it and the button would never appear — a race that would show up as
 * "works on my machine" rather than as a failure.
 */
export interface InstallWatch {
  /** The offer, or nothing: not Chromium, already installed, or already taken. */
  offer: () => InstallOffer | undefined
  /** Told when that changes. Returns the unsubscribe. */
  onChange: (listener: () => void) => () => void
  /** Forget the offer — it may be prompted once, and is spent afterwards. */
  taken: () => void
}

export const watchInstalls = ({
  listen = (name: string, handler: (event: Event) => void) => {
    globalThis.addEventListener(name, handler)
    return () => globalThis.removeEventListener(name, handler)
  },
  installed = () => globalThis.matchMedia?.('(display-mode: standalone)').matches === true,
}: {
  listen?: (name: string, handler: (event: Event) => void) => () => void
  installed?: () => boolean
} = {}): InstallWatch => {
  let offer: InstallOffer | undefined
  const listeners = new Set<() => void>()

  const announce = () => {
    for (const listener of listeners) listener()
  }

  // Not watched at all once the app is running as an installed copy: the browser
  // would not fire the event anyway, and asking spares the page a listener that can
  // never be useful.
  if (!installed()) {
    listen('beforeinstallprompt', (event) => {
      // Or Chrome shows its own bar as well as ours, and the two say the same thing
      // in different places.
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

/** Where a dismissal is remembered, so declining is not asked again next visit. */
export const DISMISSED_AT = 'sage-burner:install-dismissed'

/**
 * Whether somebody has already said no.
 *
 * Wrapped because `localStorage` throws rather than returning nothing when a browser
 * is set to block storage, and a page that will not render is a worse answer than a
 * nudge somebody has to dismiss twice.
 */
export const dismissedInstall = (store = globalThis.localStorage): boolean => {
  try {
    return store?.getItem(DISMISSED_AT) !== null
  } catch {
    return false
  }
}

export const dismissInstall = (store = globalThis.localStorage): void => {
  try {
    store?.setItem(DISMISSED_AT, 'yes')
  } catch {
    // Nothing to do about it, and nothing worth saying: the offer comes back next
    // visit, which is the same as never having stored it.
  }
}
