import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message, Send, Transport } from '../mail/mail.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, INSTALLATION_ID, mailSetting, notification } from '../db/schema.ts'

const SECRET = 'm'.repeat(40)
const NOW = '2026-08-07T10:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

/** Every send in this file goes here. Nothing in the suite opens a socket. */
const posted: { transport: Transport; message: Message }[] = []

const build = async (
  send: Send = (transport, message) => {
    posted.push({ transport, message })
    return Promise.resolve()
  },
) => {
  posted.length = 0
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    send,
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['admin'], email?: string) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: email ?? `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const SETTINGS = {
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  username: 'burn',
  password: 'hunter2',
  from_email: 'burn@example.org',
  from_name: 'The Burning Sage',
}

const read = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/admin/installation/mail', headers: { cookie } })

const write = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PUT', url: '/api/admin/installation/mail', headers: { cookie }, payload })

const drop = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'DELETE', url: '/api/admin/installation/mail', headers: { cookie } })

const test = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'POST', url: '/api/admin/installation/mail/test', headers: { cookie } })

describe('the mail settings', () => {
  it('are null before anybody sets one up, which is the ordinary state', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await read(server, cookie)).json().mail).toBeNull()
  })

  it('come back after a save, without the password', async () => {
    // `has_password` is what the form needs. The value itself is a password for
    // somebody else's server and never leaves this process.
    const server = await build()
    const cookie = await givenAccount()

    await write(server, cookie, SETTINGS)
    const body = (await read(server, cookie)).json()

    expect(body.mail).toMatchObject({ host: 'smtp.example.org', port: 587, has_password: true })
    expect(JSON.stringify(body)).not.toContain('hunter2')
  })

  it('keep the stored password when the save leaves it out', async () => {
    // A form that had to re-type the password to change the port would end up with
    // it in a text input on every visit.
    const server = await build()
    const cookie = await givenAccount()
    await write(server, cookie, SETTINGS)

    const { password: _password, ...withoutPassword } = SETTINGS
    await write(server, cookie, { ...withoutPassword, port: 465, secure: true })

    const [row] = await db().select().from(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID))
    expect(row?.password).toBe('hunter2')
    expect(row?.port).toBe(465)
  })

  it('clear the password when the save says to, which an omission cannot', async () => {
    // The passing sibling for the rule above: absent means keep, empty means clear.
    const server = await build()
    const cookie = await givenAccount()
    await write(server, cookie, SETTINGS)

    await write(server, cookie, { ...SETTINGS, password: '' })

    const [row] = await db().select().from(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID))
    expect(row?.password).toBe('')
    expect((await read(server, cookie)).json().mail.has_password).toBe(false)
  })

  it('save with no password at all, for a relay that authenticates by network', async () => {
    const server = await build()
    const cookie = await givenAccount()

    const { password: _password, ...withoutPassword } = SETTINGS
    const saved = await write(server, cookie, { ...withoutPassword, username: '' })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().mail.has_password).toBe(false)
  })

  it('go back to nothing on delete', async () => {
    const server = await build()
    const cookie = await givenAccount()
    await write(server, cookie, SETTINGS)

    expect((await drop(server, cookie)).json().mail).toBeNull()
    expect((await read(server, cookie)).json().mail).toBeNull()
  })

  it('refuse a body with a key nobody recognises', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await write(server, cookie, { ...SETTINGS, smtp_host: 'x' })).statusCode).toBe(400)
  })

  it('refuse a port outside the range', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await write(server, cookie, { ...SETTINGS, port: 0 })).statusCode).toBe(400)
    expect((await write(server, cookie, { ...SETTINGS, port: 70_000 })).statusCode).toBe(400)
  })

  it('refuse a from address that is not one', async () => {
    const server = await build()
    const cookie = await givenAccount()

    expect((await write(server, cookie, { ...SETTINGS, from_email: 'not-an-address' })).statusCode).toBe(400)
  })

  it('are admin’s, through the prefix and with no way round it', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await read(server, member)).statusCode).toBe(403)
    expect((await write(server, member, SETTINGS)).statusCode).toBe(403)
    expect((await drop(server, member)).statusCode).toBe(403)
    expect((await test(server, member)).statusCode).toBe(403)
  })

  it('refuse an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/admin/installation/mail' })).statusCode).toBe(401)
  })

  it('refuse a second row, whatever the caller', async () => {
    // The CHECK, exercised by a write that skips the API — the API only ever writes
    // the one id, so nothing above this could tell whether the constraint exists.
    await build()

    expect(() =>
      client()
        .prepare(
          'INSERT INTO mail_setting (id, host, port, secure, username, password, from_email, from_name, updated_at) ' +
            "VALUES ('second', 'smtp.example.org', 587, 0, '', '', 'burn@example.org', '', ?)",
        )
        .run(NOW),
    ).toThrow(/CHECK constraint failed/i)
  })

  it('accept the one row the API writes, by the same path', async () => {
    // The passing sibling: the statement above is refused for its id, not its shape.
    await build()

    expect(() =>
      client()
        .prepare(
          'INSERT INTO mail_setting (id, host, port, secure, username, password, from_email, from_name, updated_at) ' +
            "VALUES ('installation', 'smtp.example.org', 587, 0, '', '', 'burn@example.org', '', ?)",
        )
        .run(NOW),
    ).not.toThrow()
  })
})

describe('the test message', () => {
  it('goes to the admin’s own address, not one they name', async () => {
    // A send-to box on an admin page is an open relay with extra steps, and the
    // question the button asks is answered just as well by a message to the asker.
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)

    const answer = await test(server, cookie)

    expect(answer.json()).toEqual({ sent: true, to: 'admin@example.org', reason: null })
    expect(posted).toHaveLength(1)
    expect(posted[0]?.message.to).toBe('admin@example.org')
    expect(posted[0]?.transport.from).toBe('"The Burning Sage" <burn@example.org>')
  })

  it('says so rather than 500ing when no server has been set up', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')

    const answer = await test(server, cookie)

    expect(answer.statusCode).toBe(200)
    expect(answer.json().sent).toBe(false)
    expect(answer.json().reason).toMatch(/no mail server/i)
  })

  it('passes the server’s own refusal through, since that is what names the problem', async () => {
    // "535 authentication failed" and "connect ECONNREFUSED" want completely
    // different fixes, and "could not send" sends somebody after the wrong one.
    const send = vi.fn<Send>(() => Promise.reject(new Error('535 5.7.8 Authentication failed')))
    const server = await build(send)
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)

    const answer = await test(server, cookie)

    expect(answer.statusCode).toBe(200)
    expect(answer.json()).toEqual({
      sent: false,
      to: 'admin@example.org',
      reason: '535 5.7.8 Authentication failed',
    })
  })
})

describe('the digest preview', () => {
  const preview = (server: FastifyInstance, cookie: string, hours: number) =>
    server.inject({
      method: 'POST',
      url: '/api/admin/installation/mail/digest',
      headers: { cookie },
      payload: { hours },
    })

  const givenNotification = async (accountId: string, at: string, body = 'Ada offered a dream') => {
    await db().insert(notification).values({
      id: randomUUID(),
      account_id: accountId,
      category: 'dream_offered',
      body,
      link: '/dreams',
      created_at: at,
      seen_at: at,
    })
  }

  const idFor = async (email: string) => {
    const [row] = await db().select({ id: account.id }).from(account).where(eq(account.email, email))

    return row?.id ?? ''
  }

  it('shows what an admin has already seen, or it would be empty every time', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)
    await givenNotification(await idFor('admin@example.org'), '2026-08-07T02:00:00.000Z')

    const answer = await preview(server, cookie, 24)

    expect(answer.json()).toEqual({ sent: true, to: 'admin@example.org', reason: null })
    expect(posted[0]?.message.text).toContain('Ada offered a dream')
  })

  it('takes the stretch it is given, and nothing older', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)
    const me = await idFor('admin@example.org')
    await givenNotification(me, '2026-08-05T10:00:00.000Z', 'a day and a half back')
    await givenNotification(me, '2026-08-07T02:00:00.000Z', 'this morning')

    await preview(server, cookie, 24)

    expect(posted[0]?.message.text).toContain('this morning')
    expect(posted[0]?.message.text).not.toContain('a day and a half back')
  })

  it('says so rather than posting an empty one', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)

    const answer = await preview(server, cookie, 24)

    expect(answer.json().sent).toBe(false)
    expect(answer.json().reason).toMatch(/nothing has happened/i)
    expect(posted).toHaveLength(0)
  })

  it('does not spend the real digest', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)
    const me = await idFor('admin@example.org')
    await givenNotification(me, '2026-08-07T02:00:00.000Z')

    await preview(server, cookie, 24)

    const [row] = await db().select({ sent: account.digest_sent_at }).from(account).where(eq(account.id, me))
    expect(row?.sent).toBeNull()
  })

  it('refuses a stretch outside what the schema allows', async () => {
    const server = await build()
    const cookie = await givenAccount(['admin'], 'admin@example.org')
    await write(server, cookie, SETTINGS)

    expect((await preview(server, cookie, 0)).statusCode).toBe(400)
  })

  it('turns away somebody who is not an admin', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'], 'admin@example.org')
    await write(server, admin, SETTINGS)
    const member = await givenAccount(['member'], 'member@example.org')

    expect((await preview(server, member, 24)).statusCode).toBe(403)
  })
})

describe('what the public installation says about it', () => {
  const publicInstallation = (server: FastifyInstance) =>
    server.inject({ method: 'GET', url: '/api/installation' })

  it('is false before anybody sets one up', async () => {
    const server = await build()

    expect((await publicInstallation(server)).json().installation.sends_email).toBe(false)
  })

  it('is true afterwards, and false again once it is removed', async () => {
    const server = await build()
    const cookie = await givenAccount()

    await write(server, cookie, SETTINGS)
    expect((await publicInstallation(server)).json().installation.sends_email).toBe(true)

    await drop(server, cookie)
    expect((await publicInstallation(server)).json().installation.sends_email).toBe(false)
  })

  it('says nothing else about it — the host and the address are admin’s', async () => {
    const server = await build()
    const cookie = await givenAccount()
    await write(server, cookie, SETTINGS)

    const body = (await publicInstallation(server)).body

    expect(body).not.toContain('smtp.example.org')
    expect(body).not.toContain('burn@example.org')
    expect(body).not.toContain('hunter2')
  })
})
