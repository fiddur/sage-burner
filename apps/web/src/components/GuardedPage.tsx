import type { ComponentChildren } from 'preact'

import type { Viewer } from '../viewer.tsx'

import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'
import { NotForYou } from './NotForYou.tsx'

/** What a page may ask of whoever is looking, and how each is answered. */
const holds = {
  admin: isAdmin,
  approved: isApproved,
  member: isMember,
  'signed-in': (viewer: Viewer) => viewer.account !== undefined,
} satisfies Record<string, (viewer: Viewer) => boolean>

/**
 * The three states that come before a role-gated page's content: viewer still
 * resolving, signed out, signed in without the role.
 *
 * **This decides what to render, never what is allowed.** Every route behind these
 * pages enforces its own guard server-side; hiding a page is a courtesy to the
 * person looking at it, not access control.
 */
export const GuardedPage = ({
  title,
  require,
  children,
}: {
  title: string
  /**
   * `approved` is `member` or `admin`, matching `requireApproved` on the API —
   * somebody organising but not attending holds `admin` alone, and the burn's shared
   * furniture has to stay open to them.
   *
   * `signed-in` asks for no role at all, which is what the notifications page needs
   * (#336): an applicant waiting on a decision is told when it arrives, and telling
   * them the page announcing it is for members would be the app refusing to show
   * somebody a message it sent them.
   */
  require: keyof typeof holds
  children: ComponentChildren
}) => {
  const viewer = useViewer()
  const held = holds[require](viewer)

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>{title}</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (held) return <section class="page">{children}</section>

  return (
    <section class="page">
      <h1>{title}</h1>
      <NotForYou
        signedOut={viewer.status === 'signed-out'}
        who={require === 'admin' ? 'admins' : 'members'}
      />
    </section>
  )
}
