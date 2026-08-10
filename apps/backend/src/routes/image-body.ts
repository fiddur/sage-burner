import type { FastifyInstance } from 'fastify'

import { BANNER_TYPE, ICON_TYPES, IMAGE_TYPES } from '@sage-burner/shared'

import { AVATAR_TYPES } from './avatars.ts'

export const IMAGE_BODY_TYPES = [
  ...new Set<string>([...AVATAR_TYPES, ...ICON_TYPES, ...IMAGE_TYPES, BANNER_TYPE]),
]

export const registerImageBodyParser = (app: FastifyInstance) => {
  // No `bodyLimit`: a parser's limit beats the route's, so one number here would cap all four
  // image routes and make each one's own limit unreachable. No test would catch it.
  app.addContentTypeParser(IMAGE_BODY_TYPES, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })
}
