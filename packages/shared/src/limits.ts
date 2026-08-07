/**
 * Length limits both sides need, with no Zod in reach.
 *
 * The schemas bound the field and every form that edits it sets `maxLength` from
 * the same number, so a paste the API would refuse is refused in the textarea
 * instead. Written out separately they drift, and the drift is silent in the worse
 * direction: tighten a schema and the form keeps letting people type past it, so a
 * friendly stop at the keyboard becomes a blank `bad_request` on submit. The
 * welcome text had two editors and one of them carried no limit at all until this
 * was shared.
 *
 * Zod-free on purpose: `apps/web` imports runtime values only from modules that do
 * not pull Zod in, because the barrel is what the homepage's chunk goes through.
 *
 * **Named by what the field is, not by its number.** Several are 200 today and
 * that is a coincidence rather than a fact — a person's name and a lane's label
 * have no reason to move together, and one constant for both would turn changing
 * either into changing both.
 */

/** A person's name, wherever one is stored. An applicant's too. */
export const MAX_PERSON_NAME = 200

/** How to reach a person: a phone number, a Discord handle, a sentence of both. */
export const MAX_CONTACT = 500

/**
 * Free text about a person or their stay — allergies, notes, a question's help
 * text. A paragraph or two, not an essay.
 */
export const MAX_NOTES = 2000

/** A question on the application form. Longer than a label: some ask a lot. */
export const MAX_QUESTION_LABEL = 500

/** What something is called in a list: a lodging option, a helping task, a lane. */
export const MAX_OPTION_LABEL = 200

/** The name of a burn, a dream, or the installation itself. */
export const MAX_TITLE = 200

/** Where a burn is held, as a person would say it: a farm, a village, an address. */
export const MAX_LOCATION = 200

/** A schedule lane's name. Shorter than a label: it has to fit a grid column. */
export const MAX_PLACE_NAME = 100

/** A lane's emoji. Sixteen, because one emoji can be several code points. */
export const MAX_EMOJI = 16

/** What a dream is about. The longest thing a member writes, short of the welcome. */
export const MAX_DESCRIPTION = 20_000

/** A burn's slug, which lives in URLs. Also `slugSchema`'s bound. */
export const MAX_SLUG = 64

/** A burn's welcome text. Long enough for a page of markdown, short of a book. */
export const MAX_WELCOME_LENGTH = 100_000

/** What a member calls one of their passkeys: "Phone", "Work laptop". */
export const MAX_PASSKEY_LABEL = 100
