import type { DocumentResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The markdown files the image ships with, each at a public URL (#325, #402, #419).
 *
 * `documentResponseSchema` carries why all three are public and served rather than bundled.
 * One module for the three because they differ in nothing but which file they read: the
 * changelog and the privacy policy were the same forty lines twice before the terms would
 * have made it three.
 */

/**
 * Where a served file sits, resolved relative to this one.
 *
 * The same trick `migrationsFolder` uses, and for the same reason: a checkout and the
 * container do not share a working directory, but both put the repository root four levels
 * above `src/routes` — `/app` in the image, where the Dockerfile copies these.
 */
const documentFile = (name: string): string => path.join(import.meta.dirname, '..', '..', '..', '..', name)

/**
 * One of them as text, or empty where the image has none.
 *
 * Read once, at boot: the file is part of the image and cannot change under a running
 * process. Empty rather than a throw — a missing file is a page with nothing on it, not a
 * container that refuses to start, which is the opposite trade from `WEB_ROOT` because
 * nothing here is load-bearing.
 */
export const readDocument = (name: string): string => {
  try {
    return readFileSync(documentFile(name), 'utf8')
  } catch {
    return ''
  }
}

export interface Documents {
  changelog: string
  privacy: string
  terms: string
}

/**
 * The text is passed in rather than read here, so a test can hand one over without writing a
 * file.
 */
export const registerDocumentRoutes = (app: FastifyInstance, documents: Documents) => {
  const serve = ({ fastify }: { fastify: string }, markdown: string) => {
    app.get(fastify, async (_request, reply) => {
      // `no-cache`, not `no-store`, exactly as `/api/events/active`: the notification that
      // sends somebody to the changelog fires on a redeploy, so a heuristically-fresh copy of
      // the previous build's text is the one thing this must not serve. The policy and the
      // terms want the same — whoever is shown one after an update should be shown the
      // current one.
      void reply.header('cache-control', 'no-cache')

      return { markdown } satisfies DocumentResponse
    })
  }

  serve(apiRoutes.getChangelog, documents.changelog)
  serve(apiRoutes.getPrivacy, documents.privacy)
  serve(apiRoutes.getTerms, documents.terms)
}
