import type { ChangelogResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Where `CHANGELOG.md` sits, resolved relative to this file.
 *
 * The same trick `migrationsFolder` uses, and for the same reason: a checkout and the
 * container do not share a working directory, but both put the repository root four
 * levels above `src/routes` — `/app` in the image, where the Dockerfile copies the file.
 */
export const changelogFile = path.join(import.meta.dirname, '..', '..', '..', '..', 'CHANGELOG.md')

/**
 * The changelog as text, or empty where the image has none.
 *
 * Read once, at boot, like the shell: the file is part of the image and cannot change
 * under a running process. Empty rather than a throw — a missing changelog is a page
 * with nothing on it, not a container that refuses to start, which is the opposite
 * trade from `WEB_ROOT` because nothing here is load-bearing.
 */
export const readChangelog = (file: string = changelogFile): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * `GET /api/changelog` — what the new-version notification leads to (#325).
 *
 * Public, like `/api/version`: release notes for an app with a public homepage, holding
 * nobody's data. Served rather than bundled, because a tab that has just been told
 * there is a new version is still running the old bundle and the entry it wants is the
 * one that came with the build it has not loaded yet.
 *
 * The text is passed in rather than read here, so a test can hand it a changelog
 * without writing a file.
 */
export const registerChangelogRoutes = (app: FastifyInstance, { markdown }: { markdown: string }) => {
  app.get(apiRoutes.getChangelog.fastify, async (_request, reply) => {
    // `no-cache`, not `no-store`, exactly as `/api/events/active`: the notification
    // that sends somebody here fires on a redeploy, so a heuristically-fresh copy of
    // the previous build's changelog is the one thing this must not serve.
    void reply.header('cache-control', 'no-cache')

    return { markdown } satisfies ChangelogResponse
  })
}
