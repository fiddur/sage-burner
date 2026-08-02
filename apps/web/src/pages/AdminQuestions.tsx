import type { QuestionsApi } from '../components/QuestionEditor.tsx'

import { QuestionEditor } from '../components/QuestionEditor.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'

/**
 * The application questions, on their own page.
 *
 * They used to live under an individual event, which encoded the wrong model:
 * an application is to the community, not to a burn, so there is one set of
 * questions rather than one per event. Under an event they would also have
 * implied that editing them for the summer burn left the winter one alone.
 *
 * The role check decides what to render, not who may read: `/api/questions` is
 * public, and every write behind it refuses a non-admin server-side.
 */
export const AdminQuestions = ({ api }: { api: QuestionsApi }) => {
  const viewer = useViewer()

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Application questions</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-out') {
    return (
      <section class="page">
        <h1>Application questions</h1>
        <p>
          <a href="/login">Log in</a> to see this.
        </p>
      </section>
    )
  }

  if (!isAdmin(viewer)) {
    return (
      <section class="page">
        <h1>Application questions</h1>
        <p>This is an admin page. If it should be open to you, ask someone who already has admin.</p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Application questions</h1>
      <p class="form-note">
        What someone answers when applying to join. One set for the community — applying is not tied to a
        particular burn.
      </p>

      <QuestionEditor api={api} />
    </section>
  )
}
