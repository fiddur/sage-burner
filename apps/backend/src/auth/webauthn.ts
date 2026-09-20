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

// Not the library's `AuthenticatorTransport`, which has no `cable` or `smart-card`.
const transports = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'] as const

export type KnownTransport = (typeof transports)[number]

const isTransport = (value: string): value is KnownTransport => transports.some((known) => known === value)

export const knownTransports = (reported: readonly string[] | undefined): KnownTransport[] | undefined =>
  reported?.filter(isTransport)
