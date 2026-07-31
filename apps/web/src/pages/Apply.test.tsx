import type { FormQuestion } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApplyApi } from './Apply.tsx'

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

const fill = (label: string, value: string) => {
  const field = screen.getByLabelText(label)
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`${label} is not a text field`)
  }
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const tick = (label: string) => {
  const box = screen.getByLabelText(label)
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
    expect(screen.getByLabelText('Why do you want to come?')).toBeTruthy()
  })

  it('renders questions in the order the organiser set, not the order they arrive', async () => {
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

    await screen.findByLabelText('First')
    expect(screen.getAllByRole('textbox').map((field) => field.getAttribute('name'))).toEqual([
      'applicant_name',
      'applicant_contact',
      'q-1',
      'q-2',
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

    await screen.findByLabelText('Your dust name')
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
    // The same rule the server enforces, from the same function — the form marks
    // the field rather than letting the applicant discover it via a 400.
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

    await screen.findByLabelText('Your dust name')
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

    await screen.findByLabelText('I agree')
    identify()
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('confirms after submitting, and says what happens next', async () => {
    // No email is sent in v1, so leaving this vague would have applicants waiting
    // for a message that never arrives.
    render(<Apply api={stub({ submitApplication: () => Promise.resolve({ application: {} as never }) })} />)

    await screen.findByRole('button', { name: 'Send application' })
    identify()
    send()

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toContain('Thank you')
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('keeps the answers on screen when the request fails', async () => {
    // Losing a long "why do you want to come" answer to a dropped connection is
    // the one failure here that costs the applicant real work.
    render(
      <Apply
        api={stub({
          submitApplication: () => Promise.reject(new TypeError('Failed to fetch')),
          getQuestions: () =>
            Promise.resolve({ questions: [question({ id: 'q-1', type: 'textarea', label: 'Why?' })] }),
        })}
      />,
    )

    await screen.findByLabelText('Why?')
    identify()
    fill('Why?', 'a long and heartfelt answer')
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Why?')).toHaveProperty('value', 'a long and heartfelt answer')
  })

  it('says so when the form has no questions yet', async () => {
    // The state the app ships in; an empty page would read as broken.
    render(<Apply api={stub()} />)

    expect(await screen.findByRole('button', { name: 'Send application' })).toBeTruthy()
  })

  it('will not send before the questions have loaded', async () => {
    // Otherwise every rule passes vacuously against an empty question list, and
    // the applicant sends a form nobody has seen — which the server, reading the
    // questions itself, then refuses.
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
