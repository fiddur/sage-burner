import { z } from 'zod'

/**
 * Every entity id is a UUID rather than a sequential integer, so an id in a URL
 * leaks neither how many records exist nor whether a neighbouring one does.
 */
export const idSchema = z.uuid()

/** Calendar day, `YYYY-MM-DD`. Lexicographic order matches chronological order. */
export const dateSchema = z.iso.date()

/**
 * Time of day, `HH:MM`, local to wherever the burn is.
 *
 * Fixed width on purpose: the burn's start and end are compared as strings both
 * in Zod and in a CHECK, and that is only sound while `09:00` cannot also arrive
 * as `9:00`.
 */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time, HH:MM')

/** Instant, ISO 8601. Dates cross the API boundary as strings, never as `Date`. */
export const dateTimeSchema = z.iso.datetime()

/** URL-safe event identifier, e.g. `summer-2026`. */
export const slugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words separated by single hyphens')

/**
 * Required free text: trimmed, non-empty, and bounded so a field cannot be used
 * as storage.
 *
 * Named `nonEmptyText` rather than `text` because this package's exports land
 * in the same namespace as everything else a file imports, and `text` collides
 * with `drizzle-orm/sqlite-core`'s column builder — which every schema file in
 * the backend imports.
 */
export const nonEmptyText = (max: number) => z.string().trim().min(1).max(max)

/**
 * Optional free text: trimmed and bounded, with an explicit `null` for "not set".
 *
 * Empty and whitespace-only input collapses to `null` so "not set" has exactly
 * one representation. Otherwise `''`, `'   '` and `null` all mean the same
 * thing while comparing unequal, and the database, the API and the web app each
 * have to remember to handle all three.
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value))
