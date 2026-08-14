import type { MailSettings } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MailApi } from './MailField.tsx'

import { apiError } from '../api/client.ts'
import { MailField } from './MailField.tsx'

afterEach(cleanup)

const STORED: MailSettings = {
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  username: 'burn',
  from_email: 'burn@example.org',
  from_name: 'The Burning Sage',
  has_password: true,
  updated_at: '2026-08-07T10:00:00.000Z',
}

const stub = (over: Partial<MailApi> = {}): MailApi => ({
  getMailSettings: () => Promise.resolve({ mail: null }),
  updateMailSettings: () => Promise.reject(new Error('updateMailSettings is not stubbed here')),
  removeMailSettings: () => Promise.reject(new Error('removeMailSettings is not stubbed here')),
  sendTestEmail: () => Promise.reject(new Error('sendTestEmail is not stubbed here')),
  sendDigestPreview: () => Promise.resolve({ sent: true, to: 'admin@example.org', reason: null }),
  ...over,
})

const fill = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label), { target: { value } })
}

describe('the mail settings form', () => {
  it('starts empty, on the port almost every provider wants', async () => {
    render(<MailField api={stub()} />)

    expect(await screen.findByLabelText('Server')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Port')).toHaveProperty('value', '587')
  })

  it('offers no test and no remove until there is something to test', async () => {
    render(<MailField api={stub()} />)

    await screen.findByLabelText('Server')
    expect(screen.queryByRole('button', { name: 'Send a test to me' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('fills itself in from what is stored, minus the password', async () => {
    render(<MailField api={stub({ getMailSettings: () => Promise.resolve({ mail: STORED }) })} />)

    expect(await screen.findByLabelText('Server')).toHaveProperty('value', 'smtp.example.org')
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Password').getAttribute('placeholder')).toMatch(/leave blank/i)
  })

  it('leaves the password out of a save that did not touch it', async () => {
    // Absent means "keep what is stored". Sending an empty string would clear it,
    // which is not what typing nothing into a blank box means.
    const updateMailSettings = vi.fn<MailApi['updateMailSettings']>(() => Promise.resolve({ mail: STORED }))
    render(
      <MailField
        api={stub({ getMailSettings: () => Promise.resolve({ mail: STORED }), updateMailSettings })}
      />,
    )

    await screen.findByLabelText('Port')
    fill('Port', '465')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMailSettings).toHaveBeenCalled())
    expect(updateMailSettings.mock.calls[0]?.[0]).not.toHaveProperty('password')
  })

  it('sends the password when one has been typed', async () => {
    // The passing sibling: the omission above is about a box nobody touched.
    const updateMailSettings = vi.fn<MailApi['updateMailSettings']>(() => Promise.resolve({ mail: STORED }))
    render(
      <MailField
        api={stub({ getMailSettings: () => Promise.resolve({ mail: STORED }), updateMailSettings })}
      />,
    )

    await screen.findByLabelText('Password')
    fill('Password', 'hunter2')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMailSettings).toHaveBeenCalled())
    expect(updateMailSettings.mock.calls[0]?.[0]).toMatchObject({ password: 'hunter2' })
  })

  it('sends the port as a number, which is what the schema takes', async () => {
    const updateMailSettings = vi.fn<MailApi['updateMailSettings']>(() => Promise.resolve({ mail: STORED }))
    render(<MailField api={stub({ updateMailSettings })} />)

    await screen.findByLabelText('Server')
    fill('Server', 'smtp.example.org')
    fill('Port', '465')
    fill('From address', 'burn@example.org')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMailSettings).toHaveBeenCalled())
    expect(updateMailSettings.mock.calls[0]?.[0]).toMatchObject({ port: 465 })
  })

  it('says what the server said when a test does not get out', async () => {
    // The reason names the problem and this app cannot: bad credentials and a
    // refused connection want completely different fixes.
    render(
      <MailField
        api={stub({
          getMailSettings: () => Promise.resolve({ mail: STORED }),
          sendTestEmail: () =>
            Promise.resolve({ sent: false, to: 'admin@example.org', reason: '535 Authentication failed' }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Send a test to me' }))

    expect((await screen.findByRole('status')).textContent).toContain('535 Authentication failed')
  })

  it('says where a test went when it got out', async () => {
    render(
      <MailField
        api={stub({
          getMailSettings: () => Promise.resolve({ mail: STORED }),
          sendTestEmail: () => Promise.resolve({ sent: true, to: 'admin@example.org', reason: null }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Send a test to me' }))

    expect((await screen.findByRole('status')).textContent).toContain('admin@example.org')
  })

  it('goes back to an empty form on remove', async () => {
    render(
      <MailField
        api={stub({
          getMailSettings: () => Promise.resolve({ mail: STORED }),
          removeMailSettings: () => Promise.resolve({ mail: null }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: /^Really /u }))

    await waitFor(() => expect(screen.getByLabelText('Server')).toHaveProperty('value', ''))
    expect(screen.queryByRole('button', { name: 'Send a test to me' })).toBeNull()
  })

  it('says a refused save was refused, and keeps what was typed', async () => {
    render(
      <MailField
        api={stub({
          updateMailSettings: () => Promise.reject(apiError(400, 'bad_request', 'That port is not one.')),
        })}
      />,
    )

    await screen.findByLabelText('Server')
    fill('Server', 'smtp.example.org')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That port is not one.')
    expect(screen.getByLabelText('Server')).toHaveProperty('value', 'smtp.example.org')
  })
})

describe('the digest preview', () => {
  const LABEL = 'Send me a digest of the last'

  it('asks for a day by default, and sends the number in the field', async () => {
    const preview = vi.fn(() => Promise.resolve({ sent: true, to: 'admin@example.org', reason: null }))
    render(
      <MailField
        api={stub({ getMailSettings: () => Promise.resolve({ mail: STORED }), sendDigestPreview: preview })}
      />,
    )

    const hours = await screen.findByLabelText(new RegExp(LABEL))
    expect(hours).toHaveProperty('value', '24')

    fireEvent.input(hours, { target: { value: '72' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))

    await waitFor(() => expect(preview).toHaveBeenCalledWith({ hours: 72 }))
  })

  it('is not offered where no mail server has been set up', async () => {
    render(<MailField api={stub()} />)

    await screen.findByRole('button', { name: 'Save' })

    expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull()
  })
})
