import type { DocumentResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const documentFile = (name: string): string => path.join(import.meta.dirname, '..', '..', '..', '..', name)

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

export const registerDocumentRoutes = (app: FastifyInstance, documents: Documents) => {
  const serve = ({ fastify }: { fastify: string }, markdown: string) => {
    app.get(fastify, async (_request, reply) => {
      void reply.header('cache-control', 'no-cache')

      return { markdown } satisfies DocumentResponse
    })
  }

  serve(apiRoutes.getChangelog, documents.changelog)
  serve(apiRoutes.getPrivacy, documents.privacy)
  serve(apiRoutes.getTerms, documents.terms)
}
