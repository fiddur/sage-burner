import type { QuestionsApi } from '../components/QuestionEditor.tsx'

import { GuardedPage } from '../components/GuardedPage.tsx'
import { QuestionEditor } from '../components/QuestionEditor.tsx'

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
