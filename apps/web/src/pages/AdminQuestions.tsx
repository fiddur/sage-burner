import type { QuestionsApi } from '../components/QuestionEditor.tsx'

import { GuardedPage } from '../components/GuardedPage.tsx'
import { QuestionEditor } from '../components/QuestionEditor.tsx'

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
  return (
    <GuardedPage title="Application questions" require="admin">
      <h1>Application questions</h1>
      <p class="form-note">
        What someone answers when applying to join. One set for the community — applying is not tied to a
        particular burn.
      </p>

      <QuestionEditor api={api} />
    </GuardedPage>
  )
}
