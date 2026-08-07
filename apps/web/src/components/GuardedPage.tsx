import type { ComponentChildren } from 'preact'

import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'

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
   */
  require: 'admin' | 'approved' | 'member'
  children: ComponentChildren
}) => {
  const viewer = useViewer()
  const held =
    require === 'admin' ? isAdmin(viewer) : require === 'member' ? isMember(viewer) : isApproved(viewer)

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
      {viewer.status === 'signed-out' ? (
        <p>
          This is for members. <a href="/login">Log in</a> to see it.
        </p>
      ) : (
        // Signed in without the role — an applicant checking on their application,
        // or an admin who holds one role and not the other. Telling them to log
        // in would be advice they have already taken.
        <p>
          This is for {require === 'admin' ? 'admins' : 'members'}. If it should be open to you, ask someone
          who already has access.
        </p>
      )}
    </section>
  )
}
