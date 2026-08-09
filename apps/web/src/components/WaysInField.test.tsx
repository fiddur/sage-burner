import type { Identity } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WaysInApi } from './WaysInField.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { messageForRemoval, outcomeMessage, WaysInField } from './WaysInField.tsx'

afterEach(cleanup)

const stub = (over: Partial<WaysInApi> = {}, identities: Identity[] = []): WaysInApi => ({
  getMyIdentities: () => Promise.resolve({ identities }),
  removeMyIdentity: () => Promise.reject(new Error('removeMyIdentity is not stubbed here')),
  ...over,
})

const show = (api: WaysInApi, socialLogins: ('discord' | 'facebook')[] = ['discord', 'facebook']) =>
  render(
    <InstallationProvider socialLogins={socialLogins}>
      <WaysInField api={api} />
    </InstallationProvider>,
  )

describe('why a way in could not be taken off', () => {
  it('says what to do about the last one, rather than "that did not work"', () => {
    const message = messageForRemoval(apiError(409, 'conflict', 'conflict'))

    expect(message).toContain('only way')
    expect(message).toContain('password')
  })

  it('passes anything else through', () => {
    expect(messageForRemoval(apiError(500, 'internal', 'Something broke.'))).toBe('Something broke.')
  })
})

describe('what a round trip that came back says', () => {
  it('has a sentence for each outcome the routes can send', () => {
    expect(outcomeMessage('linked')).toContain('linked')
    expect(outcomeMessage('taken')).toContain('already linked to somebody')
    expect(outcomeMessage('refused')).toContain('did not work')
  })

  it('says nothing for an ordinary visit', () => {
    expect(outcomeMessage(null)).toBeUndefined()
    expect(outcomeMessage('something-else')).toBeUndefined()
  })
})

describe('the ways in on your own details page', () => {
  it('is not there at all where the installation has set none up', async () => {
    // A button that cannot work reads as a promise — #30's rule about the email column.
    const { container } = show(stub(), [])

    await waitFor(() => expect(container.textContent).not.toContain('sign in'))
    expect(screen.queryByRole('heading', { name: /Other ways to sign in/ })).toBeNull()
  })

  it('offers only the providers that are set up', async () => {
    show(stub(), ['discord'])

    await waitFor(() => expect(screen.getByRole('link', { name: 'Link it' })).toBeTruthy())
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.queryByText('Facebook')).toBeNull()
  })

  it('links out rather than fetching, because the point is to leave the page', async () => {
    show(stub(), ['discord'])

    const link = await screen.findByRole('link', { name: 'Link it' })

    expect(link.getAttribute('href')).toBe('/api/me/oauth/discord')
  })

  it('says which are linked and offers to take those off', async () => {
    show(stub({}, [{ provider: 'discord', created_at: '2026-08-01T00:00:00.000Z' }]), ['discord', 'facebook'])

    expect(await screen.findByRole('button', { name: /Take Discord off/ })).toBeTruthy()
    // Facebook is set up and not linked, so it offers the other thing.
    expect(screen.getByRole('link', { name: 'Link it' }).getAttribute('href')).toBe('/api/me/oauth/facebook')
  })

  it('takes one off', async () => {
    const removeMyIdentity = vi.fn(() => Promise.resolve(undefined))
    show(stub({ removeMyIdentity }, [{ provider: 'discord', created_at: '2026-08-01T00:00:00.000Z' }]), [
      'discord',
    ])

    fireEvent.click(await screen.findByRole('button', { name: /Take Discord off/ }))

    await waitFor(() => expect(removeMyIdentity).toHaveBeenCalledWith('discord'))
    expect(await screen.findByRole('link', { name: 'Link it' })).toBeTruthy()
  })

  it('says what the server refused when it is the only way in', async () => {
    show(
      stub({ removeMyIdentity: () => Promise.reject(apiError(409, 'conflict', 'conflict')) }, [
        { provider: 'discord', created_at: '2026-08-01T00:00:00.000Z' },
      ]),
      ['discord'],
    )

    fireEvent.click(await screen.findByRole('button', { name: /Take Discord off/ }))

    expect((await screen.findByRole('alert')).textContent).toContain('only way')
  })

  it('says linking Facebook signs you in and nothing more', async () => {
    // It used to write a Messenger row from the id Facebook returns — which is app-scoped and
    // points at nobody outside this installation's Meta app. Both the row and the profile
    // link now come from the handle somebody types, so this says where to type it.
    show(stub(), ['facebook'])

    expect(await screen.findByText(/signs you in and nothing more/)).toBeTruthy()
    expect(screen.getByText(/add\s+your Facebook name/)).toBeTruthy()
  })

  it('says nothing of the sort for Discord alone', async () => {
    show(stub(), ['discord'])

    await screen.findByRole('link', { name: 'Link it' })
    expect(screen.queryByText(/signs you in and nothing more/)).toBeNull()
  })

  it('says it is as well as a password, not instead of one', async () => {
    // #9's rule, and the sentence somebody needs before they click: this adds a way in.
    show(stub(), ['discord'])

    expect(await screen.findByText(/As well as your password/)).toBeTruthy()
  })
})
