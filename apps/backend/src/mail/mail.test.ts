import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../db/index.ts'
import type { Message, Send, Transport } from './mail.ts'

import { fromAddress, NOT_CONFIGURED, post, reasonFor, transportFor } from './mail.ts'

const SETTINGS = {
  id: 'installation',
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  username: 'burn',
  password: 'hunter2',
  from_email: 'burn@example.org',
  from_name: 'The Burning Sage',
  updated_at: '2026-08-07T10:00:00.000Z',
}

const dbAnswering = (row: typeof SETTINGS | undefined): Database => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row === undefined ? [] : [row]),
  }

  return { select: () => chain } as unknown as Database
}

const A_MESSAGE: Message = {
  to: 'ada@example.org',
  subject: 'Hello',
  text: 'Hello.',
  html: '<p>Hello.</p>',
}

describe('the from address', () => {
  it('is the bare address when nobody has named the installation', () => {
    expect(fromAddress('', 'burn@example.org')).toBe('burn@example.org')
  })

  it('carries the name beside it', () => {
    expect(fromAddress('The Burning Sage', 'burn@example.org')).toBe('"The Burning Sage" <burn@example.org>')
  })

  it('quotes a name a comma would otherwise split', () => {
    expect(fromAddress('Sage, Burning', 'burn@example.org')).toBe('"Sage, Burning" <burn@example.org>')
  })

  it('escapes a quote and a backslash rather than letting them end the string', () => {
    expect(fromAddress('The "Sage"\\', 'burn@example.org')).toBe('"The \\"Sage\\"\\\\" <burn@example.org>')
  })

  it('takes a newline out, since no encoding of one belongs in a name', () => {
    expect(fromAddress('Sage\r\nBcc: someone@example.org', 'burn@example.org')).toBe(
      '"Sage Bcc: someone@example.org" <burn@example.org>',
    )
  })
})

describe('the transport', () => {
  it('is the row, with the from address already built', () => {
    expect(transportFor(SETTINGS)).toEqual({
      host: 'smtp.example.org',
      port: 587,
      secure: false,
      username: 'burn',
      password: 'hunter2',
      from: '"The Burning Sage" <burn@example.org>',
    } satisfies Transport)
  })
})

describe('what a failure is reported as', () => {
  it('is the server’s own words, which name the problem', () => {
    expect(reasonFor(new Error('535 5.7.8 Authentication failed'))).toBe('535 5.7.8 Authentication failed')
  })

  it('falls back for anything that is not an error with something to say', () => {
    const silent = new Error('placeholder')
    silent.message = ''

    expect(reasonFor('nope')).toBe('The mail server refused it.')
    expect(reasonFor(silent)).toBe('The mail server refused it.')
  })
})

describe('posting', () => {
  it('says so, and sends nothing, when nobody has set a server up', async () => {
    const send = vi.fn<Send>(() => Promise.resolve())

    expect(await post({ db: dbAnswering(undefined), send }, A_MESSAGE)).toEqual({
      sent: false,
      reason: NOT_CONFIGURED,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('hands the message to the transport when one is set up', async () => {
    const send = vi.fn<Send>(() => Promise.resolve())

    expect(await post({ db: dbAnswering(SETTINGS), send }, A_MESSAGE)).toEqual({
      sent: true,
      reason: null,
    })
    expect(send).toHaveBeenCalledWith(transportFor(SETTINGS), A_MESSAGE)
  })

  it('never throws — a refusal comes back as an answer', async () => {
    const send = vi.fn<Send>(() => Promise.reject(new Error('connect ECONNREFUSED')))

    expect(await post({ db: dbAnswering(SETTINGS), send }, A_MESSAGE)).toEqual({
      sent: false,
      reason: 'connect ECONNREFUSED',
    })
  })
})
