import type { Passkey } from '@sage-burner/shared'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Ceremony } from '../passkey.ts'
import type { PasskeysApi } from './PasskeysField.tsx'

import { apiError } from '../api/client.ts'
import { PasskeysField } from './PasskeysField.tsx'

afterEach(cleanup)

const REGISTRATION: RegistrationResponseJSON = {
  id: 'cred-1',
  rawId: 'cred-1',
  response: { clientDataJSON: 'client', attestationObject: 'attestation' },
  clientExtensionResults: {},
  type: 'public-key',
}

const CREATION_OPTIONS: PublicKeyCredentialCreationOptionsJSON = {
  rp: { name: 'The Burning Sage', id: 'burn.example.org' },
  user: { id: 'dS1pZA', name: 'ada@example.org', displayName: 'Ada' },
  challenge: 'from-the-server',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
}

const aPasskey = (over: Partial<Passkey> = {}): Passkey => ({
  id: 'pk-1',
  label: 'Phone',
  created_at: '2026-08-01T10:00:00.000Z',
  last_used_at: null,
  ...over,
})

const ceremony: Ceremony = {
  register: () => Promise.resolve(REGISTRATION),
  authenticate: () => Promise.reject(new Error('not used here')),
}

const stub = (over: Partial<PasskeysApi> = {}): PasskeysApi => ({
  getMyPasskeys: () => Promise.resolve({ passkeys: [] }),
  startPasskeyRegistration: () => Promise.resolve({ options: CREATION_OPTIONS }),
  addPasskey: () => Promise.reject(new Error('addPasskey is not stubbed here')),
  removePasskey: () => Promise.reject(new Error('removePasskey is not stubbed here')),
  startPasskeyLogin: () => Promise.reject(new Error('startPasskeyLogin is not stubbed here')),
  finishPasskeyLogin: () => Promise.reject(new Error('finishPasskeyLogin is not stubbed here')),
  ...over,
})

const renderField = (api: PasskeysApi, supported = true) =>
  render(<PasskeysField api={api} ceremony={ceremony} supported={supported} />)

describe('PasskeysField', () => {
  it('lists the ones already registered', async () => {
    renderField(stub({ getMyPasskeys: () => Promise.resolve({ passkeys: [aPasskey({ label: 'Pixel' })] }) }))

    expect(await screen.findByText('Pixel')).toBeTruthy()
  })

  it('says so when there are none', async () => {
    renderField(stub())

    expect(await screen.findByText('You have no passkeys yet.')).toBeTruthy()
  })

  it('says a failed load failed, rather than showing an empty list', async () => {
    // "You have no passkeys yet" for a request that never answered invites somebody to
    // register a device that is already here (#395).
    renderField(stub({ getMyPasskeys: () => Promise.reject(new Error('offline')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your passkeys')
    expect(screen.queryByText('You have no passkeys yet.')).toBeNull()
  })

  it('registers one and shows what came back', async () => {
    // The stub keeps a list, because the field re-reads after a write rather than
    // trusting the response — the pattern every page here follows.
    const held: Passkey[] = []
    const add = vi.fn(() => {
      held.push(aPasskey({ label: 'Work laptop' }))
      return Promise.resolve({ passkeys: [...held] })
    })
    renderField(stub({ addPasskey: add, getMyPasskeys: () => Promise.resolve({ passkeys: [...held] }) }))

    await screen.findByText('You have no passkeys yet.')
    fireEvent.input(screen.getByLabelText('Name this device'), { target: { value: 'Work laptop' } })
    screen.getByRole('button', { name: 'Add a passkey' }).click()

    expect(await screen.findByText('Work laptop')).toBeTruthy()
    expect(add).toHaveBeenCalledWith({ label: 'Work laptop', response: REGISTRATION })
  })

  it('offers nothing to press until the device has a name', async () => {
    renderField(stub())

    await screen.findByText('You have no passkeys yet.')

    const button = screen.getByRole('button', { name: 'Add a passkey' })
    expect(button.hasAttribute('disabled')).toBe(true)

    fireEvent.input(screen.getByLabelText('Name this device'), { target: { value: 'Phone' } })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('says nothing when the member closes the dialog', async () => {
    // Closing it is an ordinary thing to do. An error message there is the page
    // telling somebody off for changing their mind.
    const aborted = new Error('cancelled')
    aborted.name = 'NotAllowedError'
    render(
      <PasskeysField
        api={stub()}
        ceremony={{ register: () => Promise.reject(aborted), authenticate: ceremony.authenticate }}
        supported
      />,
    )

    await screen.findByText('You have no passkeys yet.')
    fireEvent.input(screen.getByLabelText('Name this device'), { target: { value: 'Phone' } })
    screen.getByRole('button', { name: 'Add a passkey' }).click()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a passkey' }).hasAttribute('disabled')).toBe(false),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes one', async () => {
    let held = [aPasskey()]
    const remove = vi.fn((id: string) => {
      held = held.filter((key) => key.id !== id)
      return Promise.resolve({ passkeys: [...held] })
    })
    renderField(
      stub({
        getMyPasskeys: () => Promise.resolve({ passkeys: [...held] }),
        removePasskey: remove,
      }),
    )

    ;(await screen.findByRole('button', { name: 'Remove Phone' })).click()
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

    expect(await screen.findByText('You have no passkeys yet.')).toBeTruthy()
    expect(remove).toHaveBeenCalledWith('pk-1')
  })

  it('explains a refusal to remove the last way in', async () => {
    // The server answers 409 rather than locking somebody out. The generic
    // "that did not work" would send them trying again forever.
    renderField(
      stub({
        getMyPasskeys: () => Promise.resolve({ passkeys: [aPasskey()] }),
        removePasskey: () => Promise.reject(apiError(409, 'conflict', 'Conflict.')),
      }),
    )

    ;(await screen.findByRole('button', { name: 'Remove Phone' })).click()
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('only way you have left')
  })

  it('offers nothing at all where passkeys cannot work', async () => {
    // An old browser, or a page not on HTTPS. Offering a button that cannot work
    // is the wrong affordance.
    renderField(stub(), false)

    expect(await screen.findByText(/cannot use passkeys/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).toBeNull()
  })
})
