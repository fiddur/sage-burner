import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Told } from './notify.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, installation, INSTALLATION_ID, notificationSetting } from '../db/schema.ts'
import { announceDeploy } from './deploy.ts'

const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('given() first')
  return found
}

const given = () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  return handle.db
}

const givenAccount = async (wantsIt?: boolean) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })

  if (wantsIt !== undefined) {
    await db()
      .insert(notificationSetting)
      .values({ account_id: id, category: 'new_version', enabled: wantsIt })
  }

  return id
}

const collector = () => {
  const told: { accountId: string; body: string; link: string | null }[] = []

  return {
    told,
    notify: (accountId: string, what: Told) => {
      told.push({ accountId, body: what.body, link: what.link })
      return Promise.resolve()
    },
  }
}

const storedSha = async () => {
  const [row] = await db()
    .select({ sha: installation.last_build_sha })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  return row?.sha
}

describe('announcing a redeploy', () => {
  it('says nothing on the first boot, but remembers what it booted on', async () => {
    given()
    await givenAccount(true)
    const heard = collector()

    expect(await announceDeploy(db(), 'sha-one', heard.notify)).toBe('first-boot')

    expect(heard.told).toEqual([])
    expect(await storedSha()).toBe('sha-one')
  })

  it('tells whoever asked, once the build changes', async () => {
    given()
    const ada = await givenAccount(true)
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)

    expect(await announceDeploy(db(), 'sha-two', heard.notify)).toBe('announced')

    expect(heard.told.map((one) => one.accountId)).toEqual([ada])
    expect(heard.told[0]?.body).toContain('new version')
    expect(heard.told[0]?.link).toBe('/changelog')
  })

  it('says nothing at all on a restart of the same build', async () => {
    given()
    await givenAccount(true)
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)

    expect(await announceDeploy(db(), 'sha-one', heard.notify)).toBe('unchanged')

    expect(heard.told).toEqual([])
  })

  it('offers it to every account, and lets the notifier decide', async () => {
    given()
    const ada = await givenAccount(true)
    const bea = await givenAccount(false)
    const cai = await givenAccount()
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)

    await announceDeploy(db(), 'sha-two', heard.notify)

    expect(heard.told.map((one) => one.accountId).sort()).toEqual([ada, bea, cai].sort())
  })

  it('does not announce a build going backwards to unknown', async () => {
    given()
    await givenAccount(true)
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)

    expect(await announceDeploy(db(), 'unknown', heard.notify)).toBe('unchanged')

    expect(heard.told).toEqual([])
  })

  it('does not let an unknown build make the next boot look like a release', async () => {
    given()
    await givenAccount(true)
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)
    await announceDeploy(db(), 'unknown', heard.notify)

    expect(await announceDeploy(db(), 'sha-one', heard.notify)).toBe('unchanged')

    expect(heard.told).toEqual([])
  })

  it('still announces a genuinely new build after an unknown one', async () => {
    given()
    await givenAccount(true)
    const heard = collector()
    await announceDeploy(db(), 'sha-one', heard.notify)
    await announceDeploy(db(), 'unknown', heard.notify)

    expect(await announceDeploy(db(), 'sha-two', heard.notify)).toBe('announced')

    expect(heard.told).toHaveLength(1)
  })
})
