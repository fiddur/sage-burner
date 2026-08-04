import type { ComponentChildren } from 'preact'

import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'

/**
 * The page shell every role-gated page opened with, written once.
 *
 * Three states came before the content on seventeen pages — viewer still
 * resolving, signed out, signed in without the role — and the copies had drifted
 * into four different wordings of the same three things. Worse than untidy: only
 * four of the nine admin pages gave a signed-out visitor a login link, and the
 * other five told them to "ask someone who already has admin", which is advice
 * for somebody who is already signed in. `Admin.tsx`'s own comment said that was
 * the wrong message for that state, on a page that got it right.
 *
 * **This decides what to render, never what is allowed.** Every route behind these
 * pages enforces its own guard server-side; hiding a page is a courtesy to the
 * person looking at it.
 */
export const GuardedPage = ({
  title,
  require,
  children,
}: {
  title: string
  /**
   * `approved` is `member` or `admin`, matching `requireApproved` on the API — an
   * organiser who is not attending holds `admin` alone, and the burn's shared
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
        // or an organiser who holds one role and not the other. Telling them to log
        // in would be advice they have already taken.
        <p>
          This is for {require === 'admin' ? 'organisers' : 'members'}. If it should be open to you, ask
          someone who already has access.
        </p>
      )}
    </section>
  )
}
