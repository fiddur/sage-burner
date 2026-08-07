import type { MailSettings, MailSettingsUpdate } from '@sage-burner/shared'

import {
  MAX_EMAIL,
  MAX_FROM_NAME,
  MAX_SMTP_HOST,
  MAX_SMTP_PASSWORD,
  MAX_SMTP_USERNAME,
} from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSetInstallationSendsEmail } from '../installation.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError, useFormError } from './FormError.tsx'
import { PendingButton } from './PendingButton.tsx'

export type MailApi = Pick<
  ApiClient,
  'getMailSettings' | 'removeMailSettings' | 'sendTestEmail' | 'updateMailSettings'
>

/** What the form holds, which is the settings plus a password box that is usually blank. */
interface Draft {
  host: string
  port: string
  secure: boolean
  username: string
  password: string
  from_email: string
  from_name: string
}

/** 587 with STARTTLS is what almost every provider wants; 465 is the implicit-TLS one. */
const BLANK: Draft = {
  host: '',
  port: '587',
  secure: false,
  username: '',
  password: '',
  from_email: '',
  from_name: '',
}

const draftFrom = (mail: MailSettings): Draft => ({
  host: mail.host,
  port: String(mail.port),
  secure: mail.secure,
  username: mail.username,
  // Never filled in from the server, which does not send it. Blank means "leave what
  // is stored", which is what the route reads an absent password as.
  password: '',
  from_email: mail.from_email,
  from_name: mail.from_name,
})

const bodyFrom = (draft: Draft): MailSettingsUpdate => ({
  host: draft.host.trim(),
  port: Number(draft.port),
  secure: draft.secure,
  username: draft.username.trim(),
  from_email: draft.from_email.trim(),
  from_name: draft.from_name.trim(),
  // Omitted rather than sent empty: empty is a password being cleared, and typing
  // nothing into a box that was already blank is not that.
  ...(draft.password === '' ? {} : { password: draft.password }),
})

/**
 * Where this installation posts from (#30).
 *
 * Nothing about this app requires it: with no server set up, no invite is emailed, no
 * notification is, and the email column on the notification settings is not drawn.
 * Which is why the form starts empty rather than pre-filled with a guess — there is
 * no sensible default host, and the whole point of the feature is that it is optional.
 *
 * **Test before trusting it.** A wrong password fails silently otherwise: the next
 * approval posts nothing, the admin sees the invite link as usual, and the applicant
 * waits. The button posts to the admin's own address, so the failure surfaces here.
 */
export const MailField = ({ api }: { api: MailApi }) => {
  const setSendsEmail = useSetInstallationSendsEmail()
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [stored, setStored] = useState<MailSettings | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | undefined>(undefined)
  const [error, setError] = useFormError()

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMailSettings(controller.signal)
      .then(({ mail }) => {
        if (controller.signal.aborted) return
        setStored(mail)
        setDraft(mail === null ? BLANK : draftFrom(mail))
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })

    return () => controller.abort()
    // `setError` is a fresh function on every render, so depending on it would refetch
    // after each one — and each refetch replaces the draft, throwing away what is
    // being typed. A read failure gets its own flag for that reason.
  }, [api])

  if (draft === undefined) {
    return (
      <section>
        <h2>Email</h2>
        {loadFailed ? (
          <ErrorText message="Could not load the mail settings. Please reload the page." />
        ) : (
          <p class="form-note">Loading…</p>
        )}
      </section>
    )
  }

  const settled = (mail: MailSettings | null) => {
    setStored(mail)
    setDraft(mail === null ? BLANK : draftFrom(mail))
    setSendsEmail(mail !== null)
  }

  const save = async () => {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      settled((await api.updateMailSettings(bodyFrom(draft))).mail)
      setResult('Saved.')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      settled((await api.removeMailSettings()).mail)
      setResult('Removed. Nothing is posted from here now.')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not remove that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setError(undefined)
    setResult(undefined)
    try {
      const answer = await api.sendTestEmail()
      setResult(answer.sent ? `Sent to ${answer.to}. Check your inbox.` : `Not sent: ${answer.reason ?? ''}`)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not send the test. Please try again.')
    } finally {
      setTesting(false)
    }
  }

  const field = (key: keyof Draft, value: string) => setDraft({ ...draft, [key]: value })

  return (
    <section>
      <h2>Email</h2>

      <p class="form-note">
        Optional. With a server here, approving an application posts the invite to the applicant, and members
        can ask for their notifications by email. With none, nothing is posted and nothing else changes.
      </p>

      <form
        class="form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          void save()
        }}
      >
        <FormError error={error} />

        <label class="field">
          <span>Server</span>
          <input
            type="text"
            name="host"
            maxLength={MAX_SMTP_HOST}
            aria-required
            placeholder="smtp.example.org"
            value={draft.host}
            onInput={(inputEvent) => field('host', inputEvent.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Port</span>
          <input
            type="number"
            name="port"
            min="1"
            max="65535"
            aria-required
            value={draft.port}
            onInput={(inputEvent) => field('port', inputEvent.currentTarget.value)}
          />
        </label>

        <label class="row">
          <input
            type="checkbox"
            name="secure"
            checked={draft.secure}
            onChange={(changeEvent) => setDraft({ ...draft, secure: changeEvent.currentTarget.checked })}
          />
          <span>TLS from the start (port 465)</span>
        </label>

        <p class="form-note">
          Leave that unticked for 587 and 25, which start in the clear and upgrade on their own.
        </p>

        <label class="field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            maxLength={MAX_SMTP_USERNAME}
            autocomplete="off"
            value={draft.username}
            onInput={(inputEvent) => field('username', inputEvent.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            maxLength={MAX_SMTP_PASSWORD}
            autocomplete="new-password"
            placeholder={stored?.has_password === true ? 'Stored — leave blank to keep it' : ''}
            value={draft.password}
            onInput={(inputEvent) => field('password', inputEvent.currentTarget.value)}
          />
        </label>

        <p class="form-note">
          Leave both blank for a relay that lets this machine send without asking.
          {stored?.has_password === true && ' A password is stored; typing nothing here keeps it.'}
        </p>

        <label class="field">
          <span>From address</span>
          <input
            type="email"
            name="from_email"
            maxLength={MAX_EMAIL}
            aria-required
            value={draft.from_email}
            onInput={(inputEvent) => field('from_email', inputEvent.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>From name</span>
          <input
            type="text"
            name="from_name"
            maxLength={MAX_FROM_NAME}
            value={draft.from_name}
            onInput={(inputEvent) => field('from_name', inputEvent.currentTarget.value)}
          />
        </label>

        {result !== undefined && (
          <p class="form-note" role="status">
            {result}
          </p>
        )}

        <p class="row">
          <PendingButton busy={busy} label="Save" busyLabel="Saving…" type="submit" disabled={testing} />
          {stored !== null && (
            <PendingButton
              busy={testing}
              label="Send a test to me"
              busyLabel="Sending…"
              type="button"
              disabled={busy}
              onClick={() => void test()}
            />
          )}
          {stored !== null && (
            <button
              type="button"
              class="link-button"
              disabled={busy || testing}
              onClick={() => void remove()}
            >
              Remove
            </button>
          )}
        </p>
      </form>
    </section>
  )
}
