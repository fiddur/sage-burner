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

/**
 * One thing somebody says on a thread (#375).
 *
 * `MAX_NOTES`'s number and `MAX_NOTES`'s reasoning: a paragraph or two, not an essay.
 * It is also what bounds the feed — a card carries its newest few entries, so the whole
 * page is at most fifty cards' worth of these, and that is a ceiling the installed app
 * keeps on disk. Somebody with a page to write has a dream description for it.
 */
export const MAX_COMMENT = 2000

/**
 * Who somebody is, in their own words and pictures (#390).
 *
 * Its own number rather than either neighbour's, per this file's own rule: `MAX_NOTES`' 2000
 * is less than what is being asked for and `MAX_DESCRIPTION`'s 20 000 is a dream's whole plan.
 * 10 000 is a page of prose and half a dozen pictures' worth of `![](…)` — those cost 53
 * characters apiece, so the prose is what the number is really for.
 */
export const MAX_INTRODUCTION = 10_000

/** A burn's slug, which lives in URLs. Also `slugSchema`'s bound. */
export const MAX_SLUG = 64

/** A burn's welcome text. Long enough for a page of markdown, short of a book. */
export const MAX_WELCOME_LENGTH = 100_000

/** A question on the burn's FAQ. A heading somebody scans, not a paragraph. */
export const MAX_FAQ_QUESTION = 500

/** An answer on the burn's FAQ. Markdown, and some of them are a page of it. */
export const MAX_FAQ_ANSWER = 100_000

/** What a member calls one of their passkeys: "Phone", "Work laptop". */
export const MAX_PASSKEY_LABEL = 100

/** An SMTP server's hostname. A DNS name's own ceiling, which nothing here beats. */
export const MAX_SMTP_HOST = 253

/** What the SMTP server is told this account is called. */
export const MAX_SMTP_USERNAME = 320

/** An SMTP password, or an app password, which providers make long. */
export const MAX_SMTP_PASSWORD = 500

/**
 * An email address.
 *
 * 254 rather than RFC 5321's 320: that is the length of a path in an SMTP envelope,
 * angle brackets included, and 254 is what the address inside one can be. This is the
 * number `emailSchema` bounds by, rather than a second copy of it beside one.
 */
export const MAX_EMAIL = 254

/** The name beside the from address — "The Burning Sage", not a sentence. */
export const MAX_FROM_NAME = 200

/**
 * Where a journey starts, and when — "Göteborg", "Friday afternoon" (#26).
 *
 * One bound for both, because they are the same kind of thing: a short phrase somebody
 * types so that another member knows whether to ask. Anything longer belongs in the
 * notes beside them.
 */
export const MAX_RIDE_PLACE = 120

/**
 * A handle, a number or an address on one of the ways to reach somebody (#388).
 *
 * Long enough for a Mastodon address on a long instance and for a profile URL with a
 * path, short of anything that is really a sentence.
 */
export const MAX_CONNECTION_VALUE = 200

/** What somebody calls a link of their own: "my band", "photos". Not a sentence. */
export const MAX_CONNECTION_LABEL = 60

/**
 * How many ways to be reached one account may list.
 *
 * A ceiling rather than an absence, since this is a row per click. Well past what
 * anybody has — the vocabulary itself is nine kinds — and low enough that the profile
 * page stays a list somebody reads rather than scrolls.
 */
export const MAX_CONNECTIONS = 12

/**
 * An OAuth client id, as a provider issues it (#393).
 *
 * Discord's is a snowflake and Facebook's is a long number; both are far under this, and
 * a generous bound is right for a field whose format belongs to somebody else.
 */
export const MAX_OAUTH_CLIENT_ID = 200

/** An OAuth client secret. Opaque, provider-shaped, and never read back out. */
export const MAX_OAUTH_CLIENT_SECRET = 500
