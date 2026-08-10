import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'

import type { ApiClient } from './api/client.ts'

import { isApiError } from './api/client.ts'

export type PasskeyApi = Pick<
  ApiClient,
  'addPasskey' | 'finishPasskeyLogin' | 'startPasskeyLogin' | 'startPasskeyRegistration'
>

export interface Ceremony {
  register: typeof startRegistration
  authenticate: typeof startAuthentication
}

export const browserCeremony = (): Ceremony => ({
  register: startRegistration,
  authenticate: startAuthentication,
})

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
