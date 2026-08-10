import { MENTION_EVERYBODY, mentionToken } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

export interface Mentionable {
  account_id: string
  name: string | null
}

export interface Candidate {
  target: string
  name: string
}

const MOST = 6

/** What is being typed after an `@`, if the caret is inside one. */
export const fragmentAt = (value: string, caret: number): string | undefined => {
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return undefined

  const word = before.slice(at + 1)
  if (/[\s@[\]]/u.test(word)) return undefined
  if (at > 0 && !/[\s(>]/u.test(before[at - 1] ?? '')) return undefined

  return word
}

export const candidatesFor = (fragment: string, people: readonly Mentionable[]): Candidate[] => {
  const wanted = fragment.trim().toLowerCase()
  const named = people.flatMap((person) =>
    person.name === null ? [] : [{ target: person.account_id, name: person.name }],
  )
  const everybody = { target: MENTION_EVERYBODY, name: MENTION_EVERYBODY }

  return [everybody, ...named].filter(({ name }) => name.toLowerCase().startsWith(wanted)).slice(0, MOST)
}

export const withMentionAt = (
  value: string,
  caret: number,
  candidate: Candidate,
): { value: string; caret: number } => {
  const fragment = fragmentAt(value, caret)
  if (fragment === undefined) return { value, caret }

  const start = caret - fragment.length - 1
  const token = `${mentionToken(candidate.name, candidate.target)} `

  return { value: `${value.slice(0, start)}${token}${value.slice(caret)}`, caret: start + token.length }
}

/**
 * Whether inserting this name would take the body past what the API will accept. A textarea's
 * `maxlength` does not apply to a programmatic insert, so near the limit the menu wrote a body
 * the API then refused with a generic "could not save that" (#457) — the same problem
 * `useImageUpload.take` already refuses on.
 */
const fits = (value: string, fragment: string, candidate: Candidate, maxLength: number | undefined) =>
  maxLength === undefined ||
  value.length - fragment.length - 1 + mentionToken(candidate.name, candidate.target).length + 1 <= maxLength

export const useMentioning = ({
  value,
  people,
  maxLength,
  onInput,
}: {
  value: string
  people: readonly Mentionable[] | undefined
  maxLength?: number
  onInput: (value: string) => void
}) => {
  const [caret, setCaret] = useState<number | undefined>(undefined)

  // No `people` means this field does not do mentions at all, so it offers none — an
  // `@everybody` written where nothing reads it looks like it reached the burn and does not.
  const fragment = caret === undefined ? undefined : fragmentAt(value, caret)
  const candidates =
    people === undefined || fragment === undefined
      ? []
      : candidatesFor(fragment, people).filter((candidate) => fits(value, fragment, candidate, maxLength))

  const choose = (candidate: Candidate) => {
    if (caret === undefined) return

    const next = withMentionAt(value, caret, candidate)
    setCaret(next.caret)
    onInput(next.value)
  }

  const noticing = {
    onKeyUp: (event: { currentTarget: { selectionStart: number | null } }) => {
      setCaret(event.currentTarget.selectionStart ?? undefined)
    },
    onClick: (event: { currentTarget: { selectionStart: number | null } }) => {
      setCaret(event.currentTarget.selectionStart ?? undefined)
    },
  }

  return { candidates, choose, noticing }
}
