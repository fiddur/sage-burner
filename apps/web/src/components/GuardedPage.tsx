import type { ComponentChildren } from 'preact'

import type { Viewer } from '../viewer.tsx'

import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'
import { NotForYou } from './NotForYou.tsx'

const holds = {
  admin: isAdmin,
  approved: isApproved,
  member: isMember,
  'signed-in': (viewer: Viewer) => viewer.account !== undefined,
} satisfies Record<string, (viewer: Viewer) => boolean>

export const GuardedPage = ({
  title,
  require,
  children,
}: {
  title: string
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
