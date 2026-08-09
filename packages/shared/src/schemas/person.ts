import { z } from 'zod'

import { idSchema } from './common.ts'
import { connectionSchema } from './connection.ts'

/**
 * Somebody, as the rest of the community sees them (#389).
 *
 * Written out field by field, and that is the safety property rather than tidiness: this
 * is the route every member reads about every other member, so a column added to `account`
 * reaches it only when somebody names it here. `asMemberEntry` in the backend's `roster.ts`
 * is the same argument for the same reason.
 *
 * What is deliberately absent, each because something else already decided it:
 *
 * - **`email`** — the login identity, kept off what members read (#159). The address
 *   somebody wants mail at is a `connection` they chose to publish, which is why the
 *   `mailto:` on this page comes from the list and not from the column.
 * - **`allergies_notes` and `allergy_items`** — the roster is where whoever cooks reads
 *   those, and it asks for them as a list rather than one person at a time.
 * - **`payment_status`** — shown on the roster, where having paid means something about
 *   the burn being read. On a person's own page it would be a fact about them.
 * - **`roles`** — nothing on this page changes with them, and "admin" is not a thing about
 *   a person that other members need.
 */
export const personProfileSchema = z.object({
  account_id: idSchema,
  name: z.string().nullable(),
  /** When their picture last changed, or null for the initials — as the viewer carries it. */
  avatar: z.string().nullable(),
  /**
   * How to reach them, in the order they chose. The first is the answer to the question
   * somebody opening this page actually has.
   */
  connections: z.array(connectionSchema),
  /**
   * The free-text "how can we reach you?" from before the list existed, last of all.
   *
   * Still here because it is required, still filled in for every account, and still the
   * only place a sentence that fits no kind can go. Merging it into the list touches the
   * roster, its CSV and the rideshare board, and is its own change.
   */
  contact: z.string().nullable(),
  /**
   * Who they are, in their own words and pictures (#390) — the one thing on this page that
   * is not a way of reaching somebody. "The introduction" in `docs/accounts.md`.
   */
  introduction: z.string().nullable(),
  /**
   * Where their Facebook page is, built from the handle they typed for Messenger (#393).
   *
   * Not a connection row of its own, deliberately: Facebook as a *way to be reached* is
   * Messenger, and looking at somebody's page is a different act — so it sits beside the name
   * rather than in the list.
   *
   * **Not from a linked Facebook sign-in**, which is the obvious source and the wrong one:
   * `public_profile` answers with an app-scoped id that identifies nobody outside the
   * installation's own Meta app, so a URL built from it would point at nobody. Linking
   * therefore shows nothing here; typing a handle does. The URL is built in the backend, so
   * the page holds no opinion about Facebook's URL shape.
   */
  facebook: z.string().nullable(),
})

export type PersonProfile = z.infer<typeof personProfileSchema>

export const personProfileResponseSchema = z.object({ person: personProfileSchema })
export type PersonProfileResponse = z.infer<typeof personProfileResponseSchema>
