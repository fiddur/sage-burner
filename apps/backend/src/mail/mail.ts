import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { installation, INSTALLATION_ID, mailSetting } from '../db/schema.ts'

export interface Message {
  to: string
  subject: string
  text: string
  html: string
}

export interface Transport {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from: string
}

export type Send = (transport: Transport, message: Message) => Promise<void>

export interface MailDeps {
  db: Database
  send: Send
}

export interface Posted {
  sent: boolean
  reason: string | null
}

export const NOT_CONFIGURED = 'No mail server has been set up.'

export const NO_ORIGIN = 'This installation does not know its own address. Set PUBLIC_ORIGIN.'

export const mailSettingsFor = async (db: Database) => {
  const [row] = await db.select().from(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID)).limit(1)

  return row
}

export const installationTitle = async (db: Database): Promise<string> => {
  const [row] = await db
    .select({ title: installation.title })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  return row?.title ?? ''
}

export const fromAddress = (name: string, email: string): string => {
  const clean = name.replaceAll(/[\r\n]+/gu, ' ').trim()
  if (clean === '') return email

  return `"${clean.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${email}>`
}

export const transportFor = (row: {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from_email: string
  from_name: string
}): Transport => ({
  host: row.host,
  port: row.port,
  secure: row.secure,
  username: row.username,
  password: row.password,
  from: fromAddress(row.from_name, row.from_email),
})

export const reasonFor = (failure: unknown): string =>
  failure instanceof Error && failure.message !== '' ? failure.message : 'The mail server refused it.'

export const post = async ({ db, send }: MailDeps, message: Message): Promise<Posted> => {
  const settings = await mailSettingsFor(db)
  if (settings === undefined) return { sent: false, reason: NOT_CONFIGURED }

  try {
    await send(transportFor(settings), message)

    return { sent: true, reason: null }
  } catch (failure) {
    return { sent: false, reason: reasonFor(failure) }
  }
}
