import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './errors.ts'

const database = () => {
  const client = new DatabaseSync(':memory:')
  client.exec('PRAGMA foreign_keys = ON')
  client.exec('CREATE TABLE account (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, handle TEXT)')
  client.exec(
    'CREATE TABLE stay (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), ' +
      'nights INTEGER, CONSTRAINT stay_nights_check CHECK (nights > 0))',
  )
  return { client, db: drizzle({ client }) }
}

const thrown = (attempt: () => void): unknown => {
  try {
    attempt()
    return undefined
  } catch (failure) {
    return failure
  }
}

describe('the constraint a failed write broke', () => {
  it('is read through the wrapper drizzle throws, not just off the top-level message', () => {
    const { db } = database()

    const orphan = thrown(() => db.run(sql`INSERT INTO stay (id, account_id) VALUES ('s1', 'nobody')`))

    expect(orphan instanceof Error && /FOREIGN KEY/i.test(orphan.message)).toBe(false)
    expect(orphan).toBeInstanceOf(Error)
    expect(isForeignKeyViolation(orphan)).toBe(true)
  })

  it('is still read off a bare driver error, which is what `client.exec` throws', () => {
    const { client } = database()

    const orphan = thrown(() => client.exec("INSERT INTO stay (id, account_id) VALUES ('s1', 'nobody')"))

    expect(isForeignKeyViolation(orphan)).toBe(true)
  })

  it('tells a unique violation from a foreign key one', () => {
    const { db } = database()
    db.run(sql`INSERT INTO account (id, email) VALUES ('a', 'ada@example.com')`)

    const duplicate = thrown(() =>
      db.run(sql`INSERT INTO account (id, email) VALUES ('b', 'ada@example.com')`),
    )

    expect(isUniqueViolation(duplicate)).toBe(true)
    expect(isForeignKeyViolation(duplicate)).toBe(false)
  })

  it('names the column the violated constraint actually covers', () => {
    const { db } = database()
    db.run(sql`INSERT INTO account (id, email) VALUES ('a', 'ada@example.com')`)

    const duplicate = thrown(() =>
      db.run(sql`INSERT INTO account (id, email) VALUES ('b', 'ada@example.com')`),
    )

    expect(isUniqueViolation(duplicate, 'account.email')).toBe(true)
    expect(isUniqueViolation(duplicate, 'account.handle')).toBe(false)
  })

  it('does not take a column named in the failed statement as the one that broke', () => {
    const { db } = database()
    db.run(sql`INSERT INTO account (id, email) VALUES ('a', 'ada@example.com')`)

    const duplicate = thrown(() =>
      db.run(sql`INSERT INTO account (id, email, handle) VALUES ('b', 'ada@example.com', 'ada')`),
    )

    expect(isUniqueViolation(duplicate, 'handle')).toBe(false)
  })

  it('finds a named check constraint, and refuses a name that is not the one that failed', () => {
    const { db } = database()
    db.run(sql`INSERT INTO account (id, email) VALUES ('a', 'ada@example.com')`)

    const refused = thrown(() => db.run(sql`INSERT INTO stay (id, account_id, nights) VALUES ('s1', 'a', 0)`))

    expect(isCheckViolation(refused, 'stay_nights_check')).toBe(true)
    expect(isCheckViolation(refused, 'stay_other_check')).toBe(false)
  })

  it('says no to anything that is not a constraint failure', () => {
    expect(isForeignKeyViolation(new Error('disk I/O error'))).toBe(false)
    expect(isUniqueViolation(new Error('disk I/O error'))).toBe(false)
    expect(isCheckViolation(new Error('disk I/O error'), 'stay_nights_check')).toBe(false)
    expect(isForeignKeyViolation('FOREIGN KEY constraint failed')).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
