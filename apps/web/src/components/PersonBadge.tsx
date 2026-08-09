import { profilePage } from '@sage-burner/shared'

import { Avatar } from './Avatar.tsx'

/** What somebody is called when they have not filled a name in yet. */
export const NAMELESS = 'Someone without a name yet'

/**
 * Somebody's face and their name, as one thing (#301), and a link to their page (#389).
 *
 * Someone with no picture gets the initials circle, which is what `Avatar` already draws
 * for them, so a list of people is the same height whether or not anybody in it has
 * uploaded anything.
 *
 * **The link is here rather than at each call site**, which is most of what made #389 small:
 * a dream's helpers, a meal's crew and a lead role's team all draw this, so they were all
 * linked at once — and anything built with it later is linked without anybody remembering
 * to. The corner of the bar is the one face that deliberately does not go here: it is
 * reliably you, and it goes to where you change yourself.
 */
export const PersonBadge = ({
  accountId,
  name,
  avatar,
}: {
  accountId: string
  name: string | null
  /** When their picture last changed, or null for the initials. */
  avatar: string | null
}) => (
  <a class="person-badge" href={profilePage(accountId)}>
    <Avatar accountId={accountId} name={name} avatar={avatar} size="person-badge-face" />
    <span>{name ?? NAMELESS}</span>
  </a>
)
