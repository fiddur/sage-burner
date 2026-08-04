/**
 * Length limits both sides need, with no Zod in reach.
 *
 * The schemas bound the field and every form that edits it sets `maxLength` from
 * the same number, so a paste the API would refuse is refused in the textarea
 * instead. Written out separately they drift — the welcome text has two editors,
 * and one of them carried no limit at all until this was shared.
 *
 * Zod-free on purpose: `apps/web` imports runtime values only from modules that do
 * not pull Zod in, because the barrel is what the homepage's chunk goes through.
 * `answers.ts` carries the application form's limits for the same reason; #150 is
 * the pass that would bring the rest here.
 */

/** A burn's welcome text. Long enough for a page of markdown, short of a book. */
export const MAX_WELCOME_LENGTH = 100_000
