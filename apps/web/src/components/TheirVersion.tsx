import { theirVersion } from '../stale.ts'

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
