/**
 * What somebody is told when a page is not theirs — and it differs by *why*.
 *
 * Signed out, the way in is the way in. Signed in without the role — an applicant
 * waiting on a decision, or an admin who holds one role and not the other — telling
 * them to log in would be advice they have already taken.
 *
 * Its own component because `GuardedPage` is not the only page that has to say this:
 * the Schedule renders its own frame around the grid, so it cannot be wrapped in one,
 * and it had drifted to offering an applicant a log-in link (#200).
 */
export const NotForYou = ({ signedOut, who }: { signedOut: boolean; who: 'admins' | 'members' }) =>
  signedOut ? (
    <p>
      This is for {who}. <a href="/login">Log in</a> to see it.
    </p>
  ) : (
    <p>This is for {who}. If it should be open to you, ask someone who already has access.</p>
  )
