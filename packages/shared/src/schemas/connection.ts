import { z } from 'zod'

import { connectionKinds, isProfileUrl } from '../enums.ts'
import { MAX_CONNECTION_LABEL, MAX_CONNECTION_VALUE } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText } from './common.ts'

/**
 * One way somebody has said they can be reached (#388). Why rows rather than a column per
 * network, and why every one of these is published to approved members while
 * `account.email` is not: "The ways somebody can be reached" in `docs/accounts.md`.
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
   *
   * Trimmed here rather than only in the form, so what is stored does not depend on the
   * client being ours — `nameOf` trims again at render and would otherwise be the only
   * thing standing between `"  photos  "` and the column.
   */
  label: z.string().trim().max(MAX_CONNECTION_LABEL),
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

/** Every id this list holds, in the order it should read. See `idOrderSchema`. */
export const connectionOrderSchema = idOrderSchema
export type ConnectionOrder = z.infer<typeof connectionOrderSchema>
