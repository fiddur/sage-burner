import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'

/**
 * Which domain this installation is, as far as a passkey is concerned.
 *
 * WebAuthn binds a credential to a domain and refuses to hand it to any other,
 * which is what makes a passkey unphishable — so this pair is not a formality.
 * `id` is the domain the credential belongs to; `origin` is the exact origin the
 * ceremony has to have happened on.
 */
export interface RelyingParty {
  id: string
  origin: string
}

/**
 * `PUBLIC_ORIGIN` if it is set, and otherwise the origin the browser said it was
 * on.
 *
 * Configured is the answer worth having, and the reason is not only the phishing
 * one: the RP id has to be *stable*, because credentials registered under one are
 * invisible under any other. An installation reachable as both a hostname and an
 * IP would otherwise hand a member two sets of passkeys depending on which link
 * they followed, and only one set would work on any given day.
 *
 * The fallback is deliberate rather than a shortcut, because `docker compose up`
 * has to stay sufficient and a required variable would break that. What it costs
 * is bounded and worth stating plainly: a proxy on another domain that relays
 * this app would have its own origin accepted here. It still cannot use anybody's
 * existing passkey — the authenticator will not sign for a domain the credential
 * was not registered under, so that half holds without our help — but it could
 * have a member register a *new* one scoped to the attacker's domain. Setting
 * `PUBLIC_ORIGIN` closes it.
 *
 * `new URL(...).origin` rather than the raw string, so a trailing slash or a path
 * left on the variable cannot make the configured origin fail to match the one the
 * browser reports.
 */
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

/**
 * The transports we recognise, out of whatever the browser reported.
 *
 * Unknown ones are dropped rather than refused. A transport is a hint about how
 * to reach an authenticator — the browser uses it to decide whether to offer USB
 * or a phone — so a device reporting one this list predates should still be able
 * to register, with one fewer hint.
 */
export const knownTransports = (
  reported: readonly string[] | undefined,
): AuthenticatorTransportFuture[] | undefined => reported?.filter(isTransport)
