import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'

import type { ApiClient } from './api/client.ts'

import { isApiError } from './api/client.ts'

export type PasskeyApi = Pick<
  ApiClient,
  'addPasskey' | 'finishPasskeyLogin' | 'startPasskeyLogin' | 'startPasskeyRegistration'
>

/**
 * The two ceremonies, each as one call.
 *
 * Both are three steps — ask for a challenge, hand it to the browser, send back
 * what the authenticator signed — and the middle one is the only part that cannot
 * run in a test environment. Keeping them here rather than in the components
 * means a page holds no knowledge of the shape of a ceremony, and that
 * `@simplewebauthn/browser` is reached from exactly one module.
 *
 * `ceremony` is injectable for the suite: `navigator.credentials` is absent under
 * happy-dom, so a component test that drove the real one would exercise the
 * failure path and nothing else.
 */
export interface Ceremony {
  register: typeof startRegistration
  authenticate: typeof startAuthentication
}

export const browserCeremony = (): Ceremony => ({
  register: startRegistration,
  authenticate: startAuthentication,
})

/** Whether this browser has WebAuthn at all — an old one, or a page not on HTTPS. */
export const passkeysWork = (): boolean => browserSupportsWebAuthn()

export const addPasskey = async (api: PasskeyApi, label: string, ceremony: Ceremony = browserCeremony()) => {
  const { options } = await api.startPasskeyRegistration()
  const response = await ceremony.register({ optionsJSON: options })

  return api.addPasskey({ label, response })
}

export const signInWithPasskey = async (api: PasskeyApi, ceremony: Ceremony = browserCeremony()) => {
  const { options } = await api.startPasskeyLogin()
  const response = await ceremony.authenticate({ optionsJSON: options })

  return api.finishPasskeyLogin({ response })
}

/**
 * What to say when a ceremony does not finish.
 *
 * The one that matters is the member closing the dialog or letting it time out:
 * the browser raises `NotAllowedError` for both, it is by far the most common
 * outcome, and it is not a failure worth an alarming sentence. `@simplewebauthn`
 * wraps it as `ERROR_CEREMONY_ABORTED`, but the underlying name is checked too —
 * the wrapping only happens for errors it recognises.
 *
 * An API error keeps its own message, since the server said something specific;
 * everything else gets one line, because the browser's own text names internals a
 * member has no use for.
 */
export const messageForCeremony = (failure: unknown, fallback: string): string | undefined => {
  if (isAborted(failure)) return undefined
  if (isApiError(failure)) return failure.message

  return fallback
}

const isAborted = (failure: unknown): boolean => {
  if (!(failure instanceof Error)) return false
  if (failure.name === 'NotAllowedError' || failure.name === 'AbortError') return true

  return 'code' in failure && failure.code === 'ERROR_CEREMONY_ABORTED'
}
