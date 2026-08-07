import { theirVersion } from '../stale.ts'

/**
 * What the other person wrote, beside what you were about to overwrite (#274).
 *
 * Only for the longer fields. A refused click — taking a job, moving a dream — is
 * answered by the warning and the page catching up, because there is nothing there
 * worth reading twice. A paragraph somebody spent five minutes on is different: what
 * was typed stays in the box, and this is what it has to be reconciled against.
 *
 * Plain text rather than rendered markdown. This is a diff to read, not a preview,
 * and rendering it would hide exactly the marks two authors are most likely to have
 * fought over.
 */
export const TheirVersion = ({ failure, at }: { failure: unknown; at: readonly string[] }) => {
  const text = theirVersion(failure, at)
  if (text === undefined) return null

  return (
    <div class="their-version">
      <p class="form-note">What is saved now, by whoever got there first:</p>
      <blockquote>{text.trim() === '' ? 'Nothing at all.' : text}</blockquote>
      <p class="form-note">Yours is still below — take what you want from theirs and save again.</p>
    </div>
  )
}
