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
})

export const installationResponseSchema = z.object({
  installation: installationSchema,
})

/**
 * What an admin may change here: the name, and nothing else.
 *
 * `banner_updated_at` is omitted rather than left to `.strict()` to reject, because
 * the two are not the same statement — omitting says the field is not this route's to
 * write, and keeps that true if a second read-only field is added beside it.
 */
export const installationUpdateSchema = installationSchema
  .omit({ banner_updated_at: true })
  .partial()
  .strict()

export type Installation = z.infer<typeof installationSchema>
export type InstallationResponse = z.infer<typeof installationResponseSchema>
export type InstallationUpdate = z.infer<typeof installationUpdateSchema>
