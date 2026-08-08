/**
 * What somebody is told when a page is not theirs, which differs by *why*: signed in
 * without the role, telling them to log in is advice they have already taken.
 *
 * Its own component because `GuardedPage` is not the only page that says it — the
 * Schedule renders its own frame around the grid, so it cannot be wrapped in one, and
 * its copy had drifted to offering an applicant that log-in link (#200).
 *
 * **Applying is offered beside logging in** (#180), and not behind a prop: a signed-out
 * visitor on any page this renders on is a plausible applicant, and log-in is not a door
 * somebody with no account has.
 */
export const NotForYou = ({ signedOut, who }: { signedOut: boolean; who: 'admins' | 'members' }) =>
  signedOut ? (
    <p>
      This is for {who}. <a href="/login">Log in</a> to see it, or <a href="/apply">apply to join</a>.
    </p>
  ) : (
    <p>This is for {who}. If it should be open to you, ask someone who already has access.</p>
  )
