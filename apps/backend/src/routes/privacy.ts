import type { PrivacyResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Where `PRIVACY.md` sits, resolved relative to this file.
 *
 * `changelogFile`'s trick and its reasoning: a checkout and the container do not share a
 * working directory, but both put the repository root four levels above `src/routes`.
 */
export const privacyFile = path.join(import.meta.dirname, '..', '..', '..', '..', 'PRIVACY.md')

/**
 * The policy as text, or empty where the image has none.
 *
 * Read once, at boot, like the changelog: the file is part of the image and cannot change
 * under a running process. Empty rather than a throw — a missing policy is a page that says
 * so, not a container that refuses to start.
 */
export const readPrivacy = (file: string = privacyFile): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * `GET /api/privacy` — the URL Facebook's app review requires (#402).
 *
 * Public, which is the whole point: a reviewer opens it as a stranger, and so does anybody
 * deciding whether to apply. A privacy policy behind a login is not one.
 *
 * The text is passed in rather than read here, so a test can hand it a policy without
 * writing a file.
 */
export const registerPrivacyRoutes = (app: FastifyInstance, { markdown }: { markdown: string }) => {
  app.get(apiRoutes.getPrivacy.fastify, async (_request, reply) => {
    // Public prose that changes only with a deploy, so it may be cached — but revalidated,
    // because the version somebody is shown after an update should be the current one.
    void reply.header('cache-control', 'no-cache')

    return { markdown } satisfies PrivacyResponse
  })
}
