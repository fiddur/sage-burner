import { z } from 'zod'

import { connectionKinds, isProfileUrl } from '../enums.ts'
import { MAX_CONNECTION_LABEL, MAX_CONNECTION_VALUE } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

/**
 * One way somebody has said they can be reached (#388).
 *
 * Rows rather than a column per network: the list is ordered, and the order is half the
 * point — the first one is where somebody is actually reached, and the profile page is
 * meant to answer *how do I get hold of this person* rather than list everything they
 * have ever signed up to. Columns would also be a migration per network.
 *
 * **Every one of these is published to approved members.** That is what distinguishes
 * the list from `account.email`, which is the login identity and stays out of what other
 * members read (#159): a connection is something the person chose to put up, including
 * the `email` kind, which is an address they typed rather than the one they sign in with.
 *
 * `value` holds what was typed — a handle, a number, an address — and the URL is built
 * at render from `connectionKindInfo`. A network changing its domain is then one line
 * there rather than a data migration.
 */
export const connectionSchema = z.object({
  id: idSchema,
  account_id: idSchema,
  kind: z.enum(connectionKinds),
  value: nonEmptyText(MAX_CONNECTION_VALUE),
  /**
   * What the person calls it, for the one kind that is not a network: a `link` is
   * "my band" or "photos". Empty for every other kind, whose label is the network's.
   */
  label: z.string().max(MAX_CONNECTION_LABEL),
  order: z.int().nonnegative(),
})

export type Connection = z.infer<typeof connectionSchema>

export const connectionsResponseSchema = z.object({ connections: z.array(connectionSchema) })
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>

/** One row, for the write that made or changed it. The page reloads the list either way. */
export const connectionResponseSchema = z.object({ connection: connectionSchema })
export type ConnectionResponse = z.infer<typeof connectionResponseSchema>

/**
 * `account_id` comes from the session and `order` from the server, so neither is offered.
 *
 * A `link` must carry a URL worth putting in an `href` — `https` only, which
 * `isProfileUrl` decides — and it is checked here rather than only in the form, because
 * the field's whole purpose is to become an anchor and `javascript:` is what that has to
 * refuse. The other kinds are handles and numbers, bounded and otherwise as typed:
 * guessing at what a valid Discord username looks like would refuse real ones.
 */
export const connectionCreateSchema = connectionSchema
  .omit({ id: true, account_id: true, order: true })
  .strict()
  .refine((row) => row.kind !== 'link' || isProfileUrl(row.value), {
    error: 'a link must be an https:// address',
    path: ['value'],
  })
  .refine((row) => row.kind !== 'link' || row.label.trim() !== '', {
    error: 'a link needs a name, so the list says what it is',
    path: ['label'],
  })

export type ConnectionCreate = z.infer<typeof connectionCreateSchema>

/**
 * The same rules on an edit, and the whole row rather than a patch.
 *
 * `kind`, `value` and `label` decide each other — a `link` needs a URL and a name, an
 * Instagram handle needs neither — so a partial body would let one arrive without the
 * fields its own validity depends on. There are three of them and a form that has them
 * all, so sending all three costs nothing.
 */
export const connectionUpdateSchema = connectionCreateSchema

export type ConnectionUpdate = z.infer<typeof connectionUpdateSchema>

/** Every id this list holds, in the order it should read. `ordered.ts` refuses any other. */
export const connectionOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type ConnectionOrder = z.infer<typeof connectionOrderSchema>
