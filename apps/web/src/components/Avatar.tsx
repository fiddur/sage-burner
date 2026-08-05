import { initials } from '../initials.ts'

/**
 * Somebody's picture, or their initials.
 *
 * `avatar` is a version rather than a flag: it is when the picture last changed, and
 * it goes in the URL. A new picture is therefore a new URL, which is what lets the
 * route send a week-long `max-age` on data that is otherwise `no-store` — no cache
 * has to be persuaded to let go of the old one.
 *
 * Null means initials, and it spares every account without a picture a request that
 * would only 404.
 */
export const Avatar = ({
  accountId,
  name,
  avatar,
  size,
}: {
  accountId: string
  name: string | null
  avatar: string | null
  /** An extra class for the smaller circles — the schedule's chips use one. */
  size?: string
}) => {
  const classes = size === undefined ? 'avatar' : `avatar ${size}`

  if (avatar === null) {
    return (
      <span class={classes}>
        <span aria-hidden="true">{initials(name)}</span>
      </span>
    )
  }

  return (
    <img
      class={classes}
      src={`/api/accounts/${encodeURIComponent(accountId)}/avatar?v=${encodeURIComponent(avatar)}`}
      // The name is beside it wherever this is drawn — on the chip as a title, in the
      // corner as the link's label — so repeating it here would have a screen reader
      // say it twice.
      alt=""
      width={64}
      height={64}
    />
  )
}
