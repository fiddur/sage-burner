import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'

export interface RelyingParty {
  id: string
  origin: string
}

export const relyingParty = (
  configured: string | undefined,
  requestOrigin: string | undefined,
): RelyingParty | undefined => {
  const raw = configured ?? requestOrigin
  if (raw === undefined || raw === 'null') return undefined

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  if (url.hostname === '') return undefined

  return { id: url.hostname, origin: url.origin }
}

const transports: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]

const isTransport = (value: string): value is AuthenticatorTransportFuture =>
  transports.some((known) => known === value)

export const knownTransports = (
  reported: readonly string[] | undefined,
): AuthenticatorTransportFuture[] | undefined => reported?.filter(isTransport)
