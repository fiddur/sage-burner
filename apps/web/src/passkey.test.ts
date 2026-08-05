import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

import { describe, expect, it, vi } from 'vitest'

import type { Ceremony, PasskeyApi } from './passkey.ts'

import { apiError } from './api/client.ts'
import { addPasskey, messageForCeremony, signInWithPasskey } from './passkey.ts'

/**
 * The two ceremonies as three steps each, with the middle one — the browser's —
 * injected. `navigator.credentials` does not exist under happy-dom, so a test
 * driving the real one would only ever exercise the failure branch.
 */

const REGISTRATION: RegistrationResponseJSON = {
  id: 'cred-1',
  rawId: 'cred-1',
  response: { clientDataJSON: 'client', attestationObject: 'attestation' },
  clientExtensionResults: {},
  type: 'public-key',
}

const ASSERTION: AuthenticationResponseJSON = {
  id: 'cred-1',
  rawId: 'cred-1',
  response: { clientDataJSON: 'client', authenticatorData: 'auth', signature: 'signature' },
  clientExtensionResults: {},
  type: 'public-key',
}

const CREATION_OPTIONS: PublicKeyCredentialCreationOptionsJSON = {
  rp: { name: 'The Burning Sage', id: 'burn.example.org' },
  user: { id: 'dS1pZA', name: 'ada@example.org', displayName: 'Ada' },
  challenge: 'from-the-server',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
}

const REQUEST_OPTIONS: PublicKeyCredentialRequestOptionsJSON = {
  challenge: 'from-the-server',
  rpId: 'burn.example.org',
}

const ceremonyOf = (over: Partial<Ceremony> = {}): Ceremony => ({
  register: () => Promise.resolve(REGISTRATION),
  authenticate: () => Promise.resolve(ASSERTION),
  ...over,
})

const apiOf = (over: Partial<PasskeyApi> = {}): PasskeyApi => ({
  startPasskeyRegistration: () => Promise.reject(new Error('not stubbed')),
  addPasskey: () => Promise.reject(new Error('not stubbed')),
  startPasskeyLogin: () => Promise.reject(new Error('not stubbed')),
  finishPasskeyLogin: () => Promise.reject(new Error('not stubbed')),
  ...over,
})

describe('addPasskey', () => {
  it('hands the server’s options to the browser and its answer back', async () => {
    // The whole value of the module: neither end invents an option object, so a
    // ceremony cannot be started against a challenge the server never minted.
    const register = vi.fn(() => Promise.resolve(REGISTRATION))
    const add = vi.fn(() => Promise.resolve({ passkeys: [] }))

    await addPasskey(
      apiOf({
        startPasskeyRegistration: () => Promise.resolve({ options: CREATION_OPTIONS }),
        addPasskey: add,
      }),
      'Phone',
      ceremonyOf({ register }),
    )

    expect(register).toHaveBeenCalledWith({ optionsJSON: CREATION_OPTIONS })
    expect(add).toHaveBeenCalledWith({ label: 'Phone', response: REGISTRATION })
  })
})

describe('signInWithPasskey', () => {
  it('sends back what the authenticator signed', async () => {
    const authenticate = vi.fn(() => Promise.resolve(ASSERTION))
    const finish = vi.fn(() => Promise.resolve({ viewer: null }))

    await signInWithPasskey(
      apiOf({
        startPasskeyLogin: () => Promise.resolve({ options: REQUEST_OPTIONS }),
        finishPasskeyLogin: finish,
      }),
      ceremonyOf({ authenticate }),
    )

    expect(authenticate).toHaveBeenCalledWith({ optionsJSON: REQUEST_OPTIONS })
    expect(finish).toHaveBeenCalledWith({ response: ASSERTION })
  })
})

describe('messageForCeremony', () => {
  it('says nothing when the member closed the dialog', () => {
    // By far the most common outcome, and not a failure worth an alarming
    // sentence — the form is still there and so is the button.
    const failure = new Error('The operation either timed out or was not allowed.')
    failure.name = 'NotAllowedError'

    expect(messageForCeremony(failure, 'fallback')).toBeUndefined()
  })

  it('says nothing for the wrapper the library raises for the same thing', () => {
    // `@simplewebauthn` renames it, and only for errors it recognises — which is
    // why the underlying name is checked as well.
    expect(
      messageForCeremony(Object.assign(new Error('aborted'), { code: 'ERROR_CEREMONY_ABORTED' }), 'fallback'),
    ).toBeUndefined()
  })

  it('keeps what the server said', () => {
    expect(messageForCeremony(apiError(409, 'conflict', 'Already registered.'), 'fallback')).toBe(
      'Already registered.',
    )
  })

  it('falls back for anything the browser says in its own words', () => {
    // The browser's text names internals a member has no use for.
    expect(messageForCeremony(new Error('NotSupportedError: no algorithms'), 'fallback')).toBe('fallback')
  })
})
