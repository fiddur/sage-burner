import { Avatar } from './Avatar.tsx'

/** What somebody is called when they have not filled a name in yet. */
export const NAMELESS = 'Someone without a name yet'

/**
 * Somebody's face and their name, as one thing (#301).
 *
 * Someone with no picture gets the initials circle, which is what `Avatar` already
 * draws for them, so a list of people is the same height whether or not anybody in
 * it has uploaded anything.
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
  <span class="person-badge">
    <Avatar accountId={accountId} name={name} avatar={avatar} size="person-badge-face" />
    <span>{name ?? NAMELESS}</span>
  </span>
)
