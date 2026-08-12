import type { FormQuestion } from '@sage-burner/shared'

import { MAX_ANSWER_LENGTH, MAX_APPLICANT_EMAIL_LENGTH, MAX_APPLICANT_NAME_LENGTH } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { renderMarkdown as realRenderMarkdown } from '../markdown.ts'
import type { Viewer } from '../viewer.tsx'
import type { ApplyApi } from './Apply.tsx'

import { apiError } from '../api/client.ts'
import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'

// Counts calls while still rendering for real, so the markdown assertions below
// stay assertions about markdown.
const renderMarkdown = vi.hoisted(() => vi.fn())
vi.mock('../markdown.ts', async (importOriginal) => {
  const actual: { renderMarkdown: typeof realRenderMarkdown } = await importOriginal()
  renderMarkdown.mockImplementation(actual.renderMarkdown)

  return { renderMarkdown }
})
import { Apply } from './Apply.tsx'

/**
 * The public application form.
 *
 * The property #14 exists for is that nothing about the questions is hardcoded:
 * an admin adds one in the admin UI and it appears here with no deploy. So
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
  getMyApplication: () => Promise.resolve({ mine: { application: null, messages: [], organisers: [] } }),
  signUp: () => Promise.reject(new Error('signUp is not stubbed here')),
  sendMyApplicationMessage: () => Promise.reject(new Error('sendMyApplicationMessage is not stubbed here')),
  getPushKey: () => Promise.resolve({ public_key: null }),
  subscribeToPush: () => Promise.reject(new Error('subscribeToPush is not stubbed here')),
  unsubscribeFromPush: () => Promise.reject(new Error('unsubscribeFromPush is not stubbed here')),
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  ...over,
})

/** Somebody who has signed up and not yet applied, which is who the form is for since #476. */
const APPLICANT: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Fredrik', avatar: null, roles: [] },
}

const renderPage = (api: ApplyApi, viewer: Viewer = APPLICANT) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Apply api={api} />
    </ViewerProvider>,
  )

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
  fill('Your email address', 'fredrik@example.org')
}

const send = () => screen.getByRole('button', { name: 'Send application' }).click()

describe('Apply', () => {
  it('renders whatever questions the API returns', async () => {
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'text', label: 'What is your name in the dust?' }),
              question({ id: 'q-2', type: 'textarea', label: 'Why do you want to come?' }),
            ],
          }),
      }),
    )

    expect(await screen.findByLabelText('What is your name in the dust?')).toBeTruthy()
    expect(labelled('Why do you want to come?')).toBeTruthy()
  })

  it('renders the questions in the order the API serves them', async () => {
    // Not re-sorted here: `GET /api/questions` already serves display order, and
    // a second ordering rule on this side is one that can disagree with the one
    // the stored answers use. The backend test pins the order itself.
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-2', type: 'text', label: 'Second', order: 1 }),
              question({ id: 'q-1', type: 'text', label: 'First', order: 0 }),
            ],
          }),
      }),
    )

    // Arrival order deliberately contradicts `order`: a fixture where the two
    // agree cannot tell a re-added client sort from leaving the list alone.
    await screen.findByLabelText('Second')
    expect(screen.getAllByRole('textbox').map((field) => field.getAttribute('name'))).toEqual([
      'applicant_name',
      'applicant_email',
      'q-2',
      'q-1',
    ])
  })

  it('shows help text when the question has it', async () => {
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'text', label: 'Allergies?', help_text: 'We cook together.' }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('We cook together.')).toBeTruthy()
  })

  it('renders help text as markdown, so a list of principles reads as a list', async () => {
    // The 10+1 principles are a list, and an applicant should see one rather
    // than a run of literal dashes.
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({
                id: 'q-1',
                type: 'agreement',
                label: 'I agree to the principles',
                required: true,
                help_text: '- Radical inclusion\n- Leave no trace',
              }),
            ],
          }),
      }),
    )

    await ready()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Radical inclusion',
      'Leave no trace',
    ])
  })

  it("renders each question's markdown once, not once per keystroke", async () => {
    // `answer()` sets `answers`, so this component re-renders on every character
    // typed, and the help text is the longest thing on the form.
    renderMarkdown.mockClear()
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [question({ id: 'q-1', type: 'text', label: 'Why?', help_text: 'Tell us.' })],
          }),
      }),
    )

    await ready()
    const afterLoad = renderMarkdown.mock.calls.length
    fill('Why?', 'a')
    fill('Why?', 'ab')
    fill('Why?', 'abc')

    expect(afterLoad).toBe(1)
    expect(renderMarkdown.mock.calls.length).toBe(afterLoad)
  })

  it('sends the answers keyed by question id', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(
      stub({
        submitApplication,
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'text', label: 'Your dust name', required: true }),
              question({ id: 'q-2', type: 'agreement', label: 'I agree', required: true, order: 1 }),
            ],
          }),
      }),
    )

    await ready()
    identify()
    fill('Your dust name', 'Sage')
    tick('I agree')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith({
        applicant_name: 'Fredrik',
        applicant_email: 'fredrik@example.org',
        answers: { 'q-1': 'Sage', 'q-2': true },
        asked: ['q-1', 'q-2'],
      }),
    )
  })

  it('names every question it showed, including the ones left blank', async () => {
    // What the server stores an entry for. An optional question the applicant
    // skipped was still asked, and has to be told apart from one added after this
    // page loaded — which they never saw.
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(
      stub({
        submitApplication,
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'text', label: 'Your dust name', required: true }),
              question({ id: 'q-2', type: 'text', label: 'Allergies?', required: false, order: 1 }),
            ],
          }),
      }),
    )

    await ready()
    identify()
    fill('Your dust name', 'Sage')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { 'q-1': 'Sage' }, asked: ['q-1', 'q-2'] }),
      ),
    )
  })

  it('refuses to send while a required question is unanswered', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(
      stub({
        submitApplication,
        getQuestions: () =>
          Promise.resolve({
            questions: [question({ id: 'q-1', type: 'text', label: 'Your dust name', required: true })],
          }),
      }),
    )

    await ready()
    identify()
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('refuses to send while an agreement is unticked', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(
      stub({
        submitApplication,
        getQuestions: () =>
          Promise.resolve({
            questions: [question({ id: 'q-1', type: 'agreement', label: 'I agree', required: true })],
          }),
      }),
    )

    await ready()
    identify()
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('confirms after submitting, and says what happens next', async () => {
    renderPage(stub({ submitApplication: () => Promise.resolve({ application: {} as never }) }))

    await ready()
    identify()
    send()

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toContain('Thank you')
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('names email as a way of hearing only where the installation posts', async () => {
    // The copy has to be true either way: with no mail server nothing arrives, and saying
    // otherwise is a promise the installation cannot keep (#30). It promised an invite until
    // #476 — there is no invite now, only the answer.
    render(
      <InstallationProvider sendsEmail>
        <ViewerProvider viewer={APPLICANT}>
          <Apply api={stub({ submitApplication: () => Promise.resolve({ application: {} as never }) })} />
        </ViewerProvider>
      </InstallationProvider>,
    )

    await ready()
    identify()
    send()

    expect((await screen.findByRole('status')).textContent).toContain('or an email')
  })

  it('names only the notification where it does not', async () => {
    render(
      <InstallationProvider sendsEmail={false}>
        <ViewerProvider viewer={APPLICANT}>
          <Apply api={stub({ submitApplication: () => Promise.resolve({ application: {} as never }) })} />
        </ViewerProvider>
      </InstallationProvider>,
    )

    await ready()
    identify()
    send()

    const confirmation = await screen.findByRole('status')
    expect(confirmation.textContent).toContain('If you do not get a notification')
    expect(confirmation.textContent).not.toContain('email')
  })

  it('keeps the answers on screen when the request fails', async () => {
    renderPage(
      stub({
        submitApplication: () => Promise.reject(new TypeError('Failed to fetch')),
        getQuestions: () =>
          Promise.resolve({ questions: [question({ id: 'q-1', type: 'textarea', label: 'Why?' })] }),
      }),
    )

    await ready()
    identify()
    fill('Why?', 'a long and heartfelt answer')
    send()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Why?')).toHaveProperty('value', 'a long and heartfelt answer')
  })

  it('says so when the form has no questions yet', async () => {
    renderPage(stub())

    await ready()
    expect(screen.getByText(/no questions on the form yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send application' })).toBeTruthy()
  })

  it('links the privacy policy beside the button', async () => {
    // The one page where somebody hands over contact details before having an account, so
    // it is where the policy has to be reachable before the click rather than after it.
    renderPage(stub())

    await ready()
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('refuses a name of only spaces, rather than letting the server say no', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(stub({ submitApplication }))

    await ready()
    fill('Your name', '   ')
    fill('Your email address', 'fredrik@example.org')
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
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'textarea', label: 'Why?' }),
              question({ id: 'q-2', type: 'text', label: 'Dust name', order: 1 }),
            ],
          }),
      }),
    )

    await ready()
    expect(labelled('Why?').getAttribute('maxlength')).toBe(String(MAX_ANSWER_LENGTH))
    expect(labelled('Dust name').getAttribute('maxlength')).toBe(String(MAX_ANSWER_LENGTH))
    expect(labelled('Your name').getAttribute('maxlength')).toBe(String(MAX_APPLICANT_NAME_LENGTH))
    expect(labelled('Your email address').getAttribute('maxlength')).toBe(String(MAX_APPLICANT_EMAIL_LENGTH))
  })

  it('sends the name and address trimmed, which is what the server stores', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(stub({ submitApplication }))

    await ready()
    fill('Your name', '  Fredrik  ')
    fill('Your email address', '  fredrik@example.org ')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith({
        applicant_name: 'Fredrik',
        applicant_email: 'fredrik@example.org',
        answers: {},
        asked: [],
      }),
    )
  })

  it('tells the applicant to reload when the server rejects, not to try again', async () => {
    // A 400 means the questions changed since the page loaded, so both sides ran
    // the same rules against different lists. "Try again" is false advice there:
    // the identical body fails identically.
    renderPage(stub({ submitApplication: () => Promise.reject(apiError(400, 'bad_request', 'nope')) }))

    await ready()
    identify()
    send()

    expect((await screen.findByRole('alert')).textContent).toContain('reload')
  })

  it('says a transport failure is worth retrying, unlike a rejection', async () => {
    renderPage(stub({ submitApplication: () => Promise.reject(new TypeError('Failed to fetch')) }))

    await ready()
    identify()
    send()

    expect((await screen.findByRole('alert')).textContent).toContain('try again')
  })

  it('marks which questions are required', async () => {
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [
              question({ id: 'q-1', type: 'text', label: 'Needed', required: true }),
              question({ id: 'q-2', type: 'text', label: 'Optional', order: 1 }),
            ],
          }),
      }),
    )

    expect((await screen.findByText(/Needed/)).textContent).toContain('required')
    expect(screen.getByText(/Optional/).textContent).not.toContain('required')
  })

  it('links the error to the field it belongs to', async () => {
    renderPage(
      stub({
        getQuestions: () =>
          Promise.resolve({
            questions: [question({ id: 'q-1', type: 'text', label: 'Needed', required: true })],
          }),
      }),
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
    renderPage(
      stub({
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
      }),
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
    renderPage(stub({ submitApplication, getQuestions: () => new Promise(() => undefined) }))

    const button = await screen.findByRole('button', { name: 'Send application' })
    identify()
    expect(button).toHaveProperty('disabled', true)

    button.click()
    expect(submitApplication).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load the questions rather than showing an empty form', async () => {
    renderPage(stub({ getQuestions: () => Promise.reject(new Error('nope')) }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('is a column before and after sending', async () => {
    const { container } = renderPage(
      stub({ submitApplication: () => Promise.resolve({ application: {} as never }) }),
    )

    await ready()
    expect(container.querySelector('article')?.className).toBe('column')

    identify()
    send()

    await screen.findByRole('status')
    expect(container.querySelector('article')?.className).toBe('column')
  })
})

describe('the way in, before the form', () => {
  it('offers to make an account, since applying starts with one', async () => {
    renderPage(stub(), { status: 'signed-out' })

    expect(await screen.findByRole('button', { name: 'Sign up' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('signs somebody up and shows them the form', async () => {
    const signUp = vi.fn<ApplyApi['signUp']>(() =>
      Promise.resolve({ viewer: { account_id: 'a-1', name: 'Fredrik', avatar: null, roles: [] } }),
    )
    renderPage(stub({ signUp }), { status: 'signed-out' })

    fill('Your name', 'Fredrik')
    fill('Your email address', 'fredrik@example.org')
    fill('A password', 'a-long-enough-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign up' }))

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        name: 'Fredrik',
        email: 'fredrik@example.org',
        password: 'a-long-enough-password',
      }),
    )
    expect(await screen.findByRole('button', { name: 'Send application' })).toBeTruthy()
  })

  it('says an address already in use is one, rather than "that did not work"', async () => {
    renderPage(stub({ signUp: () => Promise.reject(apiError(409, 'conflict', 'conflict')) }), {
      status: 'signed-out',
    })

    fill('Your name', 'Fredrik')
    fill('Your email address', 'fredrik@example.org')
    fill('A password', 'a-long-enough-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign up' }))

    expect((await screen.findByRole('alert')).textContent).toContain('already an account')
  })

  it('says what the server would not take, rather than blaming the connection', async () => {
    renderPage(stub({ signUp: () => Promise.reject(apiError(400, 'bad_request', 'bad_request')) }), {
      status: 'signed-out',
    })

    fill('Your name', 'Fredrik')
    fill('Your email address', 'fredrik@example.org')
    fill('A password', 'a-long-enough-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign up' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('at least 10 characters')
    expect(alert.textContent).not.toContain('connection')
  })
})

describe('where an application already stands', () => {
  const anApplication = (status: 'pending' | 'approved' | 'rejected') => ({
    id: 'app-1',
    account_id: 'a-1',
    answers: [],
    status,
    applicant_name: 'Fredrik',
    applicant_email: 'fredrik@example.org',
    submitted_at: '2026-07-02T00:00:00Z',
    decided_at: null,
  })

  it('shows the wait rather than the form once one has been sent', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('pending'), messages: [], organisers: [] } }),
      }),
    )

    expect((await screen.findByRole('status')).textContent).toContain(
      'We read them together before each burn',
    )
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('starts the name from the account rather than asking for it a second time', async () => {
    renderPage(stub())

    await screen.findByRole('button', { name: 'Send application' })
    expect(labelled('Your name')).toHaveProperty('value', 'Fredrik')
  })

  it('says so once it has been accepted, and that the coming burn was joined with it', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('approved'), messages: [], organisers: [] } }),
      }),
    )

    const said = (await screen.findByRole('status')).textContent
    expect(said).toContain('You are a member')
    expect(said).toContain('added to')
    expect(said).toContain('leave the burn')
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe('/profile')
  })

  it('says who to ask once it has not been', async () => {
    // A rejection with no recourse is a door closing in silence, so the page names the
    // organisers and how to reach them.
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({
            mine: {
              application: anApplication('rejected'),
              messages: [],
              organisers: [{ account_id: 'a-9', name: 'Ada', contact: 'ada on discord' }],
            },
          }),
      }),
    )

    expect((await screen.findByRole('status')).textContent).toContain('not been accepted')
    expect(screen.getByText(/Ada — ada on discord/)).toBeTruthy()
  })
})

describe('coming back from a provider that gave no address', () => {
  it('says why, and points at the way that works', async () => {
    history.replaceState(null, '', '/apply?from=no-address')

    render(
      <LocationProvider>
        <ViewerProvider viewer={{ status: 'signed-out' }}>
          <Apply api={stub()} />
        </ViewerProvider>
      </LocationProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('did not give us an email address')
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeTruthy()
  })
})
