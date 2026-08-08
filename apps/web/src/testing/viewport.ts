/**
 * Resizing the window a test runs in, so the responsive layouts are exercised by the
 * real media query rather than by a stubbed answer to it.
 *
 * happy-dom resolves `matchMedia` against its own viewport and dispatches `change` to
 * the listeners `usePhone` attaches, so a resize here drives the same code path a
 * rotation does in a browser.
 *
 * **Reset it after every test that changes it.** The viewport belongs to the window,
 * which outlives one test, so a narrow one left behind reads as a mobile layout in the
 * file's remaining tests. `PHONE_WIDTH` and `DESKTOP_WIDTH` sit either side of the
 * `45rem` in `PHONE`.
 */
const setViewport = (width: number) => {
  const happyDom: unknown = Reflect.get(globalThis, 'happyDOM')

  if (
    typeof happyDom !== 'object' ||
    happyDom === null ||
    !('setViewport' in happyDom) ||
    typeof happyDom.setViewport !== 'function'
  ) {
    throw new Error('No happy-dom viewport to set — is this suite running in another environment?')
  }

  happyDom.setViewport({ width })
}

export const PHONE_WIDTH = 380
export const DESKTOP_WIDTH = 1024

export const onAPhone = () => setViewport(PHONE_WIDTH)
export const onADesktop = () => setViewport(DESKTOP_WIDTH)
