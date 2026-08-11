import type { Ref } from 'preact'

import { useEffect, useRef, useState } from 'preact/hooks'

import type { Span, SyntaxKind } from '../syntax.ts'

import { written } from '../syntax.ts'

export interface Syntax {
  ref: Ref<HTMLTextAreaElement>
  apply: (kind: SyntaxKind) => void
  handlers: { onKeyDown: (event: KeyboardEvent) => void }
}

const SHORTCUTS: Record<string, SyntaxKind> = { b: 'bold', i: 'italic' }

export const useSyntax = ({
  value,
  maxLength,
  onInput,
}: {
  value: string
  maxLength?: number
  onInput: (value: string) => void
}): Syntax => {
  const box = useRef<HTMLTextAreaElement>(null)
  const [wanted, setWanted] = useState<Span | undefined>(undefined)

  useEffect(() => {
    if (wanted === undefined) return

    box.current?.focus()
    box.current?.setSelectionRange(wanted.start, wanted.end)
    setWanted(undefined)
  }, [wanted])

  const apply = (kind: SyntaxKind) => {
    const node = box.current
    const selection =
      node === null
        ? { start: value.length, end: value.length }
        : { start: node.selectionStart, end: node.selectionEnd }

    const next = written(kind, value, selection, maxLength)
    onInput(next.value)
    setWanted({ start: next.start, end: next.end })
  }

  return {
    ref: box,
    apply,
    handlers: {
      onKeyDown: (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return

        const kind = SHORTCUTS[event.key.toLowerCase()]
        if (kind === undefined) return

        event.preventDefault()
        apply(kind)
      },
    },
  }
}

const BUTTONS: readonly { kind: SyntaxKind; label: string; face: string; class: string }[] = [
  { kind: 'bold', label: 'Bold', face: 'B', class: 'syntax-button is-bold' },
  { kind: 'italic', label: 'Italic', face: 'I', class: 'syntax-button is-italic' },
  { kind: 'link', label: 'Link', face: '🔗', class: 'syntax-button' },
  { kind: 'list', label: 'List', face: '☰', class: 'syntax-button' },
]

export const SyntaxToolbar = ({
  syntax,
  subject,
  disabled = false,
}: {
  syntax: Syntax
  subject: string
  disabled?: boolean
}) => (
  <div class="syntax-row">
    {BUTTONS.map((button) => (
      <button
        key={button.kind}
        type="button"
        class={button.class}
        aria-label={`${button.label} in ${subject}`}
        title={button.label}
        disabled={disabled}
        onClick={() => syntax.apply(button.kind)}
      >
        {button.face}
      </button>
    ))}
  </div>
)
