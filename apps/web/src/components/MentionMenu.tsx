import type { Candidate } from '../mentioning.ts'

export const MentionMenu = ({
  candidates,
  subject,
  onChoose,
}: {
  candidates: readonly Candidate[]
  subject: string
  onChoose: (candidate: Candidate) => void
}) => {
  if (candidates.length === 0) return null

  return (
    <ul class="mention-menu" aria-label={`Who to name in ${subject}`}>
      {candidates.map((candidate) => (
        <li key={candidate.target}>
          <button type="button" class="link-button" onClick={() => onChoose(candidate)}>
            @{candidate.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
