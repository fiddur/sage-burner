import { flameIcon } from '@sage-burner/shared'

/**
 * A dot on the tab icon when something is waiting (#248).
 *
 * Drawn rather than swapped between two files: the icon is an emoji in an SVG, so
 * the badged version is the same emoji with a circle over it and there is no second
 * asset to keep in step. A data URL, so nothing is fetched and the tab does not
 * flicker through a blank icon while it loads.
 *
 * The mark itself comes from `@sage-burner/shared`, which is also where the backend
 * reads it to serve the home-screen icon (#256) — the tab and the installed app are
 * the same app.
 *
 * **Deliberately not the uploaded icon.** An admin's logo is what an installed copy
 * wears; this stays the flame, because the badge is drawn into the SVG and an SVG
 * data URL cannot reference an external image to draw a dot on top of.
 *
 * Returns a function restoring the plain one, so a caller in an effect can hand it
 * straight back as the cleanup.
 */
const ICON_ID = 'app-favicon'

const svg = (badged: boolean) => `data:image/svg+xml,${encodeURIComponent(flameIcon({ badged }))}`

export const markFavicon = (badged: boolean): (() => void) => {
  const head = globalThis.document?.head
  if (head === undefined) return () => undefined

  const link =
    head.querySelector<HTMLLinkElement>(`link#${ICON_ID}`) ??
    (() => {
      const made = globalThis.document.createElement('link')
      made.id = ICON_ID
      made.rel = 'icon'
      head.append(made)
      return made
    })()

  link.href = svg(badged)

  return () => {
    link.href = svg(false)
  }
}
