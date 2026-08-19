import { MIN_PASSWORD } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

export const SetPassword = ({
  api,
  email,
  accountId,
  onSet,
}: {
  api: Pick<ApiClient, 'setAccountPassword'>
  email: string
  accountId: string
  onSet?: () => void | Promise<void>
}) => {
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'done' | 'failed' | 'idle' | 'saving'>('idle')

  const save = async () => {
    setState('saving')
    try {
      await api.setAccountPassword(accountId, { password })
    } catch {
      setState('failed')
      return
    }
    setPassword('')
    setState('done')
    await onSet?.()
  }

  return (
    <span class="row">
      <input
        type="text"
        autocomplete="off"
        aria-label={`New password for ${email}`}
        placeholder={`New password (${MIN_PASSWORD}+)`}
        minLength={MIN_PASSWORD}
        value={password}
        disabled={state === 'saving'}
        onInput={(inputEvent) => {
          setPassword(inputEvent.currentTarget.value)
          setState('idle')
        }}
      />
      <button
        type="button"
        disabled={state === 'saving' || password.length < MIN_PASSWORD}
        onClick={() => void save()}
      >
        Set it
      </button>
      {state === 'done' && (
        <span class="form-note" role="status">
          Set. Tell them what it is — nobody else can read it back.
        </span>
      )}
      {state === 'failed' && (
        <span class="form-error" role="alert">
          Could not set that password.
        </span>
      )}
    </span>
  )
}
