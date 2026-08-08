import { z } from 'zod'

import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, nonEmptyText } from './common.ts'

/**
 * What this particular installation calls itself.
 *
 * Distinct from the software's name: one deployment is "The Burning Sage", the
 * next is something else, and neither should need a fork to say so. There is
 * exactly one of these — it is the deployment, not a record within it.
 */
export const installationSchema = z.object({
  title: nonEmptyText(MAX_TITLE),
  /**
   * When the banner was last uploaded, or `null` when there is none (#306).
   *
   * Read rather than written: the banner goes up as image bytes on a route of its
   * own, and this is the `?v=` the homepage quotes so a new one is a new URL. It also
   * answers the question the homepage cannot ask of an image route — whether to draw
   * a banner at all — without a request that 404s in the ordinary case.
   */
  banner_updated_at: dateTimeSchema.nullable(),
  /**
   * The same, for the app icon — so the one `?v=` the manifest quotes is the one the
   * settings page quotes too (#376).
   *
   * Without it that page opened at a literal `?v=current`, which is a second live URL
   * for one picture: the offline cache keeps the newest versioned spelling per path,
   * so the two evicted each other, and the preview could show what somebody else's
   * upload had replaced.
   */
  icon_updated_at: dateTimeSchema.nullable(),
  /**
   * Whether an SMTP server has been set up, and nothing else about it (#30).
   *
   * Public, because the page it changes is the public one: the application form
   * promises "nothing will arrive in your inbox" where there is no mail server, and
   * that promise is broken the moment an admin configures one. A boolean rather than
   * a reason — the host, the port and the address are the admin's business.
   */
  sends_email: z.boolean(),
})

export const installationResponseSchema = z.object({
  installation: installationSchema,
})

/**
 * What an admin may change here: the name, and nothing else.
 *
 * The read-only fields are omitted rather than left to `.strict()` to reject, because
 * the two are not the same statement — omitting says the field is not this route's to
 * write. All are set elsewhere: the banner and the icon by their own image routes, and
 * `sends_email` by whether `/api/admin/installation/mail` has been filled in.
 */
export const installationUpdateSchema = installationSchema
  .omit({ banner_updated_at: true, icon_updated_at: true, sends_email: true })
  .partial()
  .strict()

export type Installation = z.infer<typeof installationSchema>
export type InstallationResponse = z.infer<typeof installationResponseSchema>
export type InstallationUpdate = z.infer<typeof installationUpdateSchema>
