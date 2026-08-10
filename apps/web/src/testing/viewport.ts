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
