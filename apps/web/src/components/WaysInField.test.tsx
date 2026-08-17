import type { Identity } from '@sage-burner/shared'

import { linkingOutcomes } from '@sage-burner/shared'
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
  it('has a sentence for every outcome that can land on this page', () => {
    for (const outcome of linkingOutcomes) {
      expect(outcomeMessage(outcome), outcome).toBeDefined()
    }
  })

  it('says what each one was', () => {
    expect(outcomeMessage('linked')).toContain('linked')
    expect(outcomeMessage('taken')).toContain('already linked to somebody')
    expect(outcomeMessage('refused')).toContain('did not work')
  })

  it('says so when a link put a handle in the list, since nobody asked it to', () => {
    const said = outcomeMessage('reached')

    expect(said).toContain('how people can reach you')
    expect(said).toContain('Remove it from that list')
  })

  it('says nothing for an ordinary visit', () => {
    expect(outcomeMessage(null)).toBeUndefined()
    expect(outcomeMessage('something-else')).toBeUndefined()
  })
})

describe('the ways in on your own details page', () => {
  it('is not there at all where the installation has set none up', async () => {
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

  it('says a failed load failed, rather than offering to link what is already linked', async () => {
    show(stub({ getMyIdentities: () => Promise.reject(new Error('offline')) }), ['discord'])

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your ways in')
    expect(screen.queryByRole('link', { name: 'Link it' })).toBeNull()
  })

  it('says which are linked and offers to take those off', async () => {
    show(stub({}, [{ provider: 'discord', created_at: '2026-08-01T00:00:00.000Z' }]), ['discord', 'facebook'])

    expect(await screen.findByRole('button', { name: /Take Discord off/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Link it' }).getAttribute('href')).toBe('/api/me/oauth/facebook')
  })

  it('takes one off', async () => {
    let held: Identity[] = [{ provider: 'discord', created_at: '2026-08-01T00:00:00.000Z' }]
    const removeMyIdentity = vi.fn((provider: string) => {
      held = held.filter((row) => row.provider !== provider)
      return Promise.resolve(undefined)
    })
    show({ getMyIdentities: () => Promise.resolve({ identities: [...held] }), removeMyIdentity }, ['discord'])

    fireEvent.click(await screen.findByRole('button', { name: /Take Discord off/ }))
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

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
    ;(await screen.findByRole('button', { name: /^Really /u })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('only way')
  })

  it('sends somebody to the handle box, which is the link that works for anybody', async () => {
    show(stub(), ['facebook'])

    expect(await screen.findByText(/add\s+your Facebook name/)).toBeTruthy()
    expect(screen.getByText(/only\s+opens\s+for\s+people\s+already\s+logged\s+in/)).toBeTruthy()
  })

  it('says nothing of the sort for Discord alone', async () => {
    show(stub(), ['discord'])

    await screen.findByRole('link', { name: 'Link it' })
    expect(screen.queryByText(/add\s+your Facebook name/)).toBeNull()
  })

  it('says it is as well as a password, not instead of one', async () => {
    show(stub(), ['discord'])

    expect(await screen.findByText(/As well as your password/)).toBeTruthy()
  })
})

describe('what the page says when a provider refuses', () => {
  it('names a setting an organiser can fix, and what to quote', () => {
    expect(outcomeMessage('misconfigured', 'req-8s')).toContain('not set up correctly here')
    expect(outcomeMessage('misconfigured', 'req-8s')).toContain('Mention req-8s.')
  })

  it('does not say the provider refused, since on one path it was never asked', () => {
    expect(outcomeMessage('misconfigured')).not.toMatch(/refus|reject|declin/iu)
  })

  it('tells somebody to try again when the provider could not be reached', () => {
    const said = outcomeMessage('unreachable', 'req-8s')

    expect(said).toContain('Try again in a moment')
    expect(said).toContain('Mention req-8s.')
  })

  it('quotes nothing when there is nothing to quote', () => {
    expect(outcomeMessage('misconfigured', null)).not.toContain('Mention')
  })
})
