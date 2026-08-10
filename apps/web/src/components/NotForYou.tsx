export const NotForYou = ({ signedOut, who }: { signedOut: boolean; who: 'admins' | 'members' }) =>
  signedOut ? (
    <p>
      This is for {who}. <a href="/login">Log in</a> to see it, or <a href="/apply">apply to join</a>.
    </p>
  ) : (
    <p>This is for {who}. If it should be open to you, ask someone who already has access.</p>
  )
