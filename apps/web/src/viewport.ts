import { useEffect, useState } from 'preact/hooks'

/**
 * The one breakpoint, and the same one the stylesheet uses (#337).
 *
 * Two things have to agree about what a phone is: the bottom bar's layout, which is
 * CSS, and what the bar and the bell *render*, which is not — a nav that hid its
 * links with `display: none` would leave a second copy of every page link in the
 * accessibility tree, and a bell that only hid its panel would still have opened one
 * off-screen. So the query is written here as well, and any change has to move both.
 */
export const PHONE = '(max-width: 45rem)'

/**
 * Whether this is a phone-sized viewport, kept current as it changes.
 *
 * `matchMedia` is optional the way `install.ts` treats it: a browser without it
 * answers "not a phone", which is the layout everything worked in before.
 */
export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.(PHONE).matches === true)

  useEffect(() => {
    const query = globalThis.matchMedia?.(PHONE)
    if (query === undefined) return undefined

    const answer = (change: MediaQueryListEvent) => setPhone(change.matches)
    // Read again rather than trusting the first render's answer: a rotation between
    // mount and effect would otherwise sit wrong until the *next* one.
    setPhone(query.matches)
    query.addEventListener('change', answer)

    return () => query.removeEventListener('change', answer)
  }, [])

  return phone
}
