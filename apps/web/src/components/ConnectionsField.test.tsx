import type { Connection } from '@sage-burner/shared'

import { MAX_CONNECTIONS } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionsApi } from './ConnectionsField.tsx'

import { apiError } from '../api/client.ts'
import { ConnectionsField, messageForFailure, nameOf, problemWith } from './ConnectionsField.tsx'

afterEach(cleanup)

const aRow = (over: Partial<Connection> & Pick<Connection, 'id'>): Connection => ({
  account_id: 'a-1',
  kind: 'discord',
  value: 'wren',
  label: '',
  order: 0,
  ...over,
})

const stub = (over: Partial<ConnectionsApi> = {}, rows: Connection[] = []): ConnectionsApi => ({
  getMyConnections: () => Promise.resolve({ connections: rows }),
  addMyConnection: () => Promise.reject(new Error('addMyConnection is not stubbed here')),
  updateMyConnection: () => Promise.reject(new Error('updateMyConnection is not stubbed here')),
  removeMyConnection: () => Promise.reject(new Error('removeMyConnection is not stubbed here')),
  reorderMyConnections: () => Promise.reject(new Error('reorderMyConnections is not stubbed here')),
  ...over,
})

describe('what a row is called', () => {
  it('is the network for every kind but one', () => {
    expect(nameOf({ kind: 'discord', label: '' })).toBe('Discord')
    // A label on a kind that has its own name is ignored rather than trusted: the
    // network is what the list has to say, and only `link` has nothing else to go on.
    expect(nameOf({ kind: 'instagram', label: 'my photos' })).toBe('Instagram')
  })

  it('is what somebody called their own link', () => {
    expect(nameOf({ kind: 'link', label: 'my band' })).toBe('my band')
  })

  it('falls back to the kind for a link with no name yet', () => {
    expect(nameOf({ kind: 'link', label: '  ' })).toBe('Somewhere else')
  })
})

describe('what the form refuses before sending', () => {
  it('wants something to reach you on', () => {
    expect(problemWith({ kind: 'discord', value: '   ', label: '' })).toContain('Fill in')
  })

  it('leaves an ordinary handle alone', () => {
    expect(problemWith({ kind: 'discord', value: 'wren', label: '' })).toBeUndefined()
  })

  it('wants a link to be somewhere a browser should be sent', () => {
    expect(problemWith({ kind: 'link', value: 'javascript:alert(1)', label: 'x' })).toContain('https://')
    expect(problemWith({ kind: 'link', value: 'http://insecure.example', label: 'x' })).toContain('https://')
  })

  it('wants a link to say what it is', () => {
    expect(problemWith({ kind: 'link', value: 'https://wren.example', label: ' ' })).toContain('a name')
  })

  it('takes an https link with a name', () => {
    expect(problemWith({ kind: 'link', value: 'https://wren.example', label: 'photos' })).toBeUndefined()
  })
})

describe('why it could not be saved', () => {
  it('tells the two 409s apart, which the status alone does not', () => {
    expect(messageForFailure(apiError(409, 'conflict', 'conflict'), false)).toContain('already listed')
    expect(messageForFailure(apiError(409, 'conflict', 'conflict'), true)).toContain('as many ways')
  })

  it('says a refused value is worth another look rather than repeating the code', () => {
    expect(messageForFailure(apiError(400, 'bad_request', 'bad_request'), false)).toContain('another look')
  })
})

describe('the list on your own details page', () => {
  it('says so when there is nothing in it yet', async () => {
    render(<ConnectionsField api={stub()} />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
  })

  it('says a failed load failed, rather than showing an empty list', async () => {
    // "You have not added any yet" for a request that never answered invites an Add that
    // then 409s against a row nobody can see (#395).
    render(<ConnectionsField api={stub({ getMyConnections: () => Promise.reject(new Error('offline')) })} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your ways')
    expect(screen.queryByText(/have not added any yet/)).toBeNull()
  })

  it('keeps what was typed when the save is refused', async () => {
    // #205: a refusal must not take the form away with it. The 409 here is the duplicate
    // one, which is exactly the case somebody fixes by editing what is still on screen.
    render(
      <ConnectionsField
        api={stub({ addMyConnection: () => Promise.reject(apiError(409, 'conflict', 'Conflict.')) })}
      />,
    )

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    fireEvent.input(screen.getByLabelText('Handle for a new way to reach you'), { target: { value: 'wren' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('already listed')
    expect(screen.getByLabelText('Handle for a new way to reach you')).toHaveProperty('value', 'wren')
  })

  it('fills in the sign-in address in one press, for the one kind it is', async () => {
    // #388 asked for this and it did not land in #394. The address comes from the page
    // around the field, since `/api/auth/me` deliberately does not carry it.
    render(<ConnectionsField api={stub()} loginAddress="wren@example.org" />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    const handle = screen.getByLabelText('Handle for a new way to reach you')
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Kind of a new way to reach you'), { target: { value: 'email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use my sign-in address' }))

    expect(handle).toHaveProperty('value', 'wren@example.org')
    // Gone once it has been used: a button that would do nothing is furniture.
    expect(screen.queryByRole('button', { name: 'Use my sign-in address' })).toBeNull()
  })

  it('draws what is stored, in the order it came back', async () => {
    render(
      <ConnectionsField
        api={stub({}, [
          aRow({ id: 'c-1', kind: 'discord', value: 'wren' }),
          aRow({ id: 'c-2', kind: 'instagram', value: '@wren', order: 1 }),
        ])}
      />,
    )

    await waitFor(() => expect(screen.getByText('Discord')).toBeTruthy())
    expect(screen.getByText('Instagram')).toBeTruthy()
    expect(screen.getByText('@wren')).toBeTruthy()
  })

  it('adds one and reloads rather than guessing what the server stored', async () => {
    const addMyConnection = vi.fn(() => Promise.resolve({ connection: aRow({ id: 'c-1' }) }))
    render(<ConnectionsField api={stub({ addMyConnection })} />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    fireEvent.input(screen.getByLabelText('Handle for a new way to reach you'), {
      target: { value: ' wren ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addMyConnection).toHaveBeenCalledWith({ kind: 'discord', value: 'wren', label: '' }),
    )
  })

  it('sends what will be stored, so a pasted profile URL goes as the handle', async () => {
    const addMyConnection = vi.fn(() => Promise.resolve({ connection: aRow({ id: 'c-1' }) }))
    render(<ConnectionsField api={stub({ addMyConnection })} />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Kind of a new way to reach you'), {
      target: { value: 'instagram' },
    })
    fireEvent.input(screen.getByLabelText('Handle for a new way to reach you'), {
      target: { value: 'https://instagram.com/wren/' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addMyConnection).toHaveBeenCalledWith({ kind: 'instagram', value: 'wren', label: '' }),
    )
  })

  it('refuses a bad link at the keyboard rather than sending it', async () => {
    const addMyConnection = vi.fn(() => Promise.resolve({ connection: aRow({ id: 'c-1' }) }))
    render(<ConnectionsField api={stub({ addMyConnection })} />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Kind of a new way to reach you'), { target: { value: 'link' } })
    fireEvent.input(screen.getByLabelText('Handle for a new way to reach you'), {
      target: { value: 'javascript:alert(1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => expect(screen.getByText(/needs to start with https/)).toBeTruthy())
    expect(addMyConnection).not.toHaveBeenCalled()
  })

  it('asks a link what it is called, and nothing else', async () => {
    render(<ConnectionsField api={stub()} />)

    await waitFor(() => expect(screen.getByText(/have not added any yet/)).toBeTruthy())
    expect(screen.queryByLabelText('Name for a new way to reach you')).toBeNull()

    fireEvent.change(screen.getByLabelText('Kind of a new way to reach you'), { target: { value: 'link' } })

    expect(screen.getByLabelText('Name for a new way to reach you')).toBeTruthy()
  })

  it('takes one off', async () => {
    const removeMyConnection = vi.fn(() => Promise.resolve(undefined))
    render(<ConnectionsField api={stub({ removeMyConnection }, [aRow({ id: 'c-1' })])} />)

    await waitFor(() => expect(screen.getByText('Discord')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Remove Discord' }))

    await waitFor(() => expect(removeMyConnection).toHaveBeenCalledWith('c-1'))
  })

  it('sends the whole order when a row is moved', async () => {
    const reorderMyConnections = vi.fn(() => Promise.resolve({ connections: [] }))
    render(
      <ConnectionsField
        api={stub({ reorderMyConnections }, [
          aRow({ id: 'c-1' }),
          aRow({ id: 'c-2', kind: 'instagram', value: '@wren', order: 1 }),
        ])}
      />,
    )

    await waitFor(() => expect(screen.getByText('Instagram')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Move Instagram up' }))

    await waitFor(() => expect(reorderMyConnections).toHaveBeenCalledWith(['c-2', 'c-1']))
  })

  it('offers no more to add once the list is as long as it may be', async () => {
    const full = Array.from({ length: MAX_CONNECTIONS }, (_, index) =>
      aRow({ id: `c-${index}`, kind: 'link', value: `https://n${index}.example`, label: `n${index}` }),
    )
    render(<ConnectionsField api={stub({}, full)} />)

    await waitFor(() => expect(screen.getByText('n0')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Add it' })).toBeNull()
  })

  it('says what the list is for, and that the sign-in address is not in it', async () => {
    // The one thing on the page that has to be unambiguous: this list is for other members
    // to reach somebody on, and `account.email` deliberately is not (#159). Written as what
    // it is for rather than who can see it today — the page that shows anybody else's is
    // #389, and people are filling this in now.
    render(<ConnectionsField api={stub()} />)

    await waitFor(() => expect(screen.getByText(/how other members will reach you/)).toBeTruthy())
    expect(screen.getByText(/address you sign in with is shown to nobody/)).toBeTruthy()
  })
})
