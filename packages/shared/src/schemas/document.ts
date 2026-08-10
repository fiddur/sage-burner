import { z } from 'zod'

export const documentResponseSchema = z.object({ markdown: z.string() })
export type DocumentResponse = z.infer<typeof documentResponseSchema>

export const changelogResponseSchema = documentResponseSchema
export type ChangelogResponse = DocumentResponse

export const privacyResponseSchema = documentResponseSchema
export type PrivacyResponse = DocumentResponse

export const termsResponseSchema = documentResponseSchema
export type TermsResponse = DocumentResponse
