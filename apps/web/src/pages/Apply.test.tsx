import type { FormQuestion } from '@sage-burner/shared'

import {
  MAX_ANSWER_LENGTH,
  MAX_APPLICANT_CONTACT_LENGTH,
  MAX_APPLICANT_NAME_LENGTH,
} from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApplyApi } from './Apply.tsx'

import { apiError } from '../api/client.ts'
import { Apply } from './Apply.tsx'

/**
 * The public application form.
 *
 * The property #14 exists for is that nothing about the questions is hardcoded:
 * an organiser adds one in the admin UI and it appears here with no deploy. So
 * these tests never name a field the way the app would — they assert that
 * whatever the API returns is what gets rendered and sent.
 */

afterEach(cleanup)

const question = (over: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'type'>): FormQuestion => ({
  order: 0,
  label: 'A question',
  help_text: null,
  required: false,
  options: null,
  ...over,
})

const stub = (over: Partial<ApplyApi> = {}): ApplyApi => ({
  getQuestions: () => Promise.resolve({ questions: [] }),
  submitApplication: () => Promise.reject(new Error('submitApplication is not stubbed here')),
  ...over,
})

/**
 * Fields are found by label prefix, because a required question's accessible
 * name carries the visible "· required" marker with it.
 */
const labelled = (label: string) => screen.getByLabelText(label, { exact: false })

/**
 * The submit button is disabled until the questions arrive, so a test that
 * submits has to wait for them — otherwise it clicks a dead button and the
 * assertion times out somewhere far less obvious.
 */
const ready = () =>
  waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send application' })).toHaveProperty('disabled', false),
  )

// `fireEvent.input` with a target, matching `Login.test.tsx` — assigning `.value`
// by hand and dispatching does not survive Preact's reconciliation of a
// controlled input.
const fill = (label: string, value: string) => {
  fireEvent.input(labelled(label), { target: { value } })
}

const tick = (label: string) => {
  const box = labelled(label)
  if (!(box instanceof HTMLInputElement)) throw new Error(`${label} is not a checkbox`)
  // `fireEvent.click`, not `box.click()`: happy-dom does not raise the `change`
  // that a browser fires as the click's default action, so a bare click leaves
  // the component never hearing about it — which passed the "refuses to send"
  // tests for the wrong reason until this one caught it.
  fireEvent.click(box)
}

const identify = () => {
  fill('Your name', 'Fredrik')
  fill('How can we reach you?', 'fredrik@example.org')
}

const send = () => screen.getByRole('button', { name: 'Send application' }).click()

describe('Apply', () => {
  it('renders whatever questions the API returns', async () => {
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-1', type: 'text', label: 'What is your name in the dust?' }),
                question({ id: 'q-2', type: 'textarea', label: 'Why do you want to come?' }),
              ],
            }),
        })}
      />,
    )

    expect(await screen.findByLabelText('What is your name in the dust?')).toBeTruthy()
    expect(labelled('Why do you want to come?')).toBeTruthy()
  })

  it('renders the questions in the order the API serves them', async () => {
    // Not re-sorted here: `GET /api/questions` already serves display order, and
    // a second ordering rule on this side is one that can disagree with the one
    // the stored answers use. The backend test pins the order itself.
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-2', type: 'text', label: 'Second', order: 1 }),
                question({ id: 'q-1', type: 'text', label: 'First', order: 0 }),
              ],
            }),
        })}
      />,
    )

    // Arrival order deliberately contradicts `order`: a fixture where the two
    // agree cannot tell a re-added client sort from leaving the list alone.
    await screen.findByLabelText('Second')
    expect(screen.getAllByRole('textbox').map((field) => field.getAttribute('name'))).toEqual([
      'applicant_name',
      'applicant_contact',
      'q-2',
      'q-1',
    ])
  })

  it('shows help text when the question has it', async () => {
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-1', type: 'text', label: 'Allergies?', help_text: 'We cook together.' }),
              ],
            }),
        })}
      />,
    )

    expect(await screen.findByText('We cook together.')).toBeTruthy()
  })

  it('sends the answers keyed by question id', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(
      <Apply
        api={stub({
          submitApplication,
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-1', type: 'text', label: 'Your dust name', required: true }),
                question({ id: 'q-2', type: 'agreement', label: 'I agree', required: true, order: 1 }),
              ],
            }),
        })}
      />,
    )

    await ready()
    identify()
    fill('Your dust name', 'Sage')
    tick('I agree')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith({
        applicant_name: 'Fredrik',
        applicant_contact: 'fredrik@example.org',
        answers: { 'q-1': 'Sage', 'q-2': true },
      }),
    )
  })

  it('refuses to send while a required question is unanswered', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(
      <Apply
        api={stub({
          submitApplication,
          getQuestions: () =>
            Promise.resolve({
              questions: [question({ id: 'q-1', type: 'text', label: 'Your dust name', required: true })],
            }),
        })}
      />,
    )

    await ready()
    identify()
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('refuses to send while an agreement is unticked', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(
      <Apply
        api={stub({
          submitApplication,
          getQuestions: () =>
            Promise.resolve({
              questions: [question({ id: 'q-1', type: 'agreement', label: 'I agree', required: true })],
            }),
        })}
      />,
    )

    await ready()
    identify()
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('confirms after submitting, and says what happens next', async () => {
    render(<Apply api={stub({ submitApplication: () => Promise.resolve({ application: {} as never }) })} />)

    await ready()
    identify()
    send()

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toContain('Thank you')
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('keeps the answers on screen when the request fails', async () => {
    render(
      <Apply
        api={stub({
          submitApplication: () => Promise.reject(new TypeError('Failed to fetch')),
          getQuestions: () =>
            Promise.resolve({ questions: [question({ id: 'q-1', type: 'textarea', label: 'Why?' })] }),
        })}
      />,
    )

    await ready()
    identify()
    fill('Why?', 'a long and heartfelt answer')
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Why?')).toHaveProperty('value', 'a long and heartfelt answer')
  })

  it('says so when the form has no questions yet', async () => {
    render(<Apply api={stub()} />)

    await ready()
    expect(screen.getByText(/no questions on the form yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send application' })).toBeTruthy()
  })

  it('refuses a name of only spaces, rather than letting the server say no', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(<Apply api={stub({ submitApplication })} />)

    await ready()
    fill('Your name', '   ')
    fill('How can we reach you?', 'fredrik@example.org')
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('caps every text control at the length the API accepts', async () => {
    // The API caps an answer at MAX_ANSWER_LENGTH and the identity fields at
    // their own limits. Without `maxLength` an applicant could write past them
    // and be told "the questions changed, reload" — discarding a very long
    // answer they had just written, and failing identically on the retry.
    //
    // Asserted as attributes because that is where the fix lives: the browser
    // enforces them while typing *and* on paste, so the over-length state is
    // never reached rather than being caught afterwards. `answerProblems` also
    // carries a `too_long` rule, which keeps the two sides agreeing if a
    // submission ever arrives from somewhere other than this form.
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-1', type: 'textarea', label: 'Why?' }),
                question({ id: 'q-2', type: 'text', label: 'Dust name', order: 1 }),
              ],
            }),
        })}
      />,
    )

    await ready()
    expect(labelled('Why?').getAttribute('maxlength')).toBe(String(MAX_ANSWER_LENGTH))
    expect(labelled('Dust name').getAttribute('maxlength')).toBe(String(MAX_ANSWER_LENGTH))
    expect(labelled('Your name').getAttribute('maxlength')).toBe(String(MAX_APPLICANT_NAME_LENGTH))
    expect(labelled('How can we reach you?').getAttribute('maxlength')).toBe(
      String(MAX_APPLICANT_CONTACT_LENGTH),
    )
  })

  it('sends the name and contact trimmed, which is what the server stores', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(<Apply api={stub({ submitApplication })} />)

    await ready()
    fill('Your name', '  Fredrik  ')
    fill('How can we reach you?', '  fredrik@example.org ')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith({
        applicant_name: 'Fredrik',
        applicant_contact: 'fredrik@example.org',
        answers: {},
      }),
    )
  })

  it('tells the applicant to reload when the server rejects, not to try again', async () => {
    // A 400 means the questions changed since the page loaded, so both sides ran
    // the same rules against different lists. "Try again" is false advice there:
    // the identical body fails identically.
    render(
      <Apply api={stub({ submitApplication: () => Promise.reject(apiError(400, 'bad_request', 'nope')) })} />,
    )

    await ready()
    identify()
    send()

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
  })

  it('says a transport failure is worth retrying, unlike a rejection', async () => {
    render(
      <Apply api={stub({ submitApplication: () => Promise.reject(new TypeError('Failed to fetch')) })} />,
    )

    await ready()
    identify()
    send()

    expect((await screen.findByRole('alert')).textContent).toContain('try again')
  })

  it('marks which questions are required', async () => {
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({ id: 'q-1', type: 'text', label: 'Needed', required: true }),
                question({ id: 'q-2', type: 'text', label: 'Optional', order: 1 }),
              ],
            }),
        })}
      />,
    )

    expect((await screen.findByText(/Needed/)).textContent).toContain('required')
    expect(screen.getByText(/Optional/).textContent).not.toContain('required')
  })

  it('links the error to the field it belongs to', async () => {
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [question({ id: 'q-1', type: 'text', label: 'Needed', required: true })],
            }),
        })}
      />,
    )

    await ready()
    identify()
    send()

    await screen.findByRole('alert')
    const field = labelled('Needed')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toContain('q-1-error')
  })

  it('keeps the help text reachable when the field also has an error', async () => {
    render(
      <Apply
        api={stub({
          getQuestions: () =>
            Promise.resolve({
              questions: [
                question({
                  id: 'q-1',
                  type: 'text',
                  label: 'Needed',
                  required: true,
                  help_text: 'Any name works.',
                }),
              ],
            }),
        })}
      />,
    )

    await ready()
    identify()
    send()

    await screen.findByRole('alert')
    const described = labelled('Needed').getAttribute('aria-describedby')
    expect(described).toContain('q-1-help')
    expect(described).toContain('q-1-error')
  })

  it('will not send before the questions have loaded', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    render(<Apply api={stub({ submitApplication, getQuestions: () => new Promise(() => undefined) })} />)

    identify()
    const button = screen.getByRole('button', { name: 'Send application' })
    expect(button).toHaveProperty('disabled', true)

    button.click()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load the questions rather than showing an empty form', async () => {
    render(<Apply api={stub({ getQuestions: () => Promise.reject(new Error('nope')) })} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
