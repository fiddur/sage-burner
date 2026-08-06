/**
 * A dot on the tab icon when something is waiting (#248).
 *
 * Drawn rather than swapped between two files: the icon is an emoji in an SVG, so
 * the badged version is the same emoji with a circle over it and there is no second
 * asset to keep in step. A data URL, so nothing is fetched and the tab does not
 * flicker through a blank icon while it loads.
 *
 * Returns a function restoring the plain one, so a caller in an effect can hand it
 * straight back as the cleanup.
 */
const ICON_ID = 'app-favicon'

const svg = (badged: boolean) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<text y="52" font-size="52">🔥</text>` +
      (badged ? `<circle cx="50" cy="16" r="13" fill="#dc2626" stroke="#fff" stroke-width="3"/>` : '') +
      `</svg>`,
  )}`

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
