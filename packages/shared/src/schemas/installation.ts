import { z } from 'zod'

import { MAX_TITLE } from '../limits.ts'
import { nonEmptyText } from './common.ts'

/**
 * What this particular installation calls itself.
 *
 * Distinct from the software's name: one deployment is "The Burning Sage", the
 * next is something else, and neither should need a fork to say so. There is
 * exactly one of these — it is the deployment, not a record within it.
 */
export const installationSchema = z.object({
  title: nonEmptyText(MAX_TITLE),
})

export const installationResponseSchema = z.object({
  installation: installationSchema,
})

export const installationUpdateSchema = installationSchema.partial().strict()

export type Installation = z.infer<typeof installationSchema>
export type InstallationResponse = z.infer<typeof installationResponseSchema>
export type InstallationUpdate = z.infer<typeof installationUpdateSchema>
