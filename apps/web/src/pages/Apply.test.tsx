import type { FormQuestion, MyBurn } from '@sage-burner/shared'

import { MAX_ANSWER_LENGTH, MAX_APPLICANT_EMAIL_LENGTH, MAX_APPLICANT_NAME_LENGTH } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { renderMarkdown as realRenderMarkdown } from '../markdown.ts'
import type { Viewer } from '../viewer.tsx'
import type { ApplyApi } from './Apply.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'

const renderMarkdown = vi.hoisted(() => vi.fn())
vi.mock('../markdown.ts', async (importOriginal) => {
  const actual: { renderMarkdown: typeof realRenderMarkdown } = await importOriginal()
  renderMarkdown.mockImplementation(actual.renderMarkdown)

  return { renderMarkdown }
})
import { Apply } from './Apply.tsx'

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
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [], digest: 'daily' }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  ...over,
})

const APPLICANT: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Fredrik', avatar: null, roles: [] },
}

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Fredrik', avatar: null, roles: ['member'] },
}

const renderPage = (
  api: ApplyApi,
  viewer: Viewer = APPLICANT,
  burns: MyBurn[] = [],
  status: 'loading' | 'ready' | 'failed' = 'ready',
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider value={{ status, burns, selected: burns[0] }}>
        <Apply api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

const aBurn = (name: string, joined: boolean): MyBurn => ({
  event: {
    id: `e-${name}`,
    name,
    slug: name.toLowerCase(),
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: joined
    ? {
        id: 'att-1',
        event_id: `e-${name}`,
        account_id: 'a-1',
        joined_at: '2026-07-02T00:00:00.000Z',
        arrival_date: null,
        departure_date: null,
        lodging_option_id: null,
        helping_option_ids: [],
        helping_other: null,
        notes: null,
        payment_status: 'unpaid',
        payment_date: null,
      }
    : null,
})

const labelled = (label: string) => screen.getByLabelText(label, { exact: false })

const ready = () =>
  waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send application' })).toHaveProperty('disabled', false),
  )

const fill = (label: string, value: string) => {
  fireEvent.input(labelled(label), { target: { value } })
}

const tick = (label: string) => {
  const box = labelled(label)
  if (!(box instanceof HTMLInputElement)) throw new Error(`${label} is not a checkbox`)
  fireEvent.click(box)
}

const identify = () => {
  fill('Your name', 'Fredrik')
  fill('Your email address', 'fredrik@example.org')
}

const send = () => screen.getByRole('button', { name: 'Send application' }).click()

const submitPastTheFields = () => {
  const form = document.querySelector('form')
  if (form === null) throw new Error('there is no form on the page')

  fireEvent.submit(form)
}

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

  it('sends no address at all where the field is left blank, the account carrying one (#510)', async () => {
    const submitApplication = vi.fn(() => Promise.resolve({ application: {} as never }))
    renderPage(stub({ submitApplication }))

    await ready()
    fill('Your name', 'Fredrik')
    send()

    await waitFor(() =>
      expect(submitApplication).toHaveBeenCalledWith({
        applicant_name: 'Fredrik',
        answers: {},
        asked: [],
      }),
    )
  })

  it('says what a blank address means rather than refusing one', async () => {
    renderPage(stub())

    await ready()

    expect(screen.getByText(/we write to the address you signed in with/)).toBeTruthy()
  })

  it('describes the address box with the note about leaving it blank', async () => {
    renderPage(stub())

    await ready()
    const box = screen.getByLabelText('Your email address')
    const described = box.getAttribute('aria-describedby')?.split(' ') ?? []
    const note = described.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')

    expect(note).toContain('we write to the address you signed in with')
  })

  it('still refuses an address that is not one, past the field’s own check', async () => {
    renderPage(stub())

    await ready()
    fill('Your name', 'Fredrik')
    fill('Your email address', 'not-an-address')
    submitPastTheFields()

    expect((await screen.findByText(/does not look like an email address/)).textContent).toBeTruthy()
  })

  it('shows a second submit where its application stands, rather than the form again', async () => {
    renderPage(
      stub({
        submitApplication: () => Promise.reject(apiError(409, 'already_applied', 'Request failed (409).')),
      }),
    )

    await ready()
    fill('Your name', 'Fredrik')
    send()

    expect(await screen.findByRole('heading', { name: 'Application sent' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('tells a member there is nothing to apply for, where the same status means that instead', async () => {
    renderPage(
      stub({
        submitApplication: () => Promise.reject(apiError(409, 'already_member', 'Request failed (409).')),
      }),
    )

    await ready()
    fill('Your name', 'Fredrik')
    send()

    expect((await screen.findByRole('alert')).textContent).toContain('nothing to apply for')
  })

  it('tells a member there is nothing to apply for, and shows them no form (#531)', async () => {
    renderPage(stub(), {
      status: 'signed-in',
      account: { id: 'a-1', name: 'Fredrik', avatar: null, roles: ['member'] },
    })

    expect(await screen.findByText(/nothing to apply for/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send application' })).toBeNull()
  })

  it('tells the applicant to reload when the server rejects, not to try again', async () => {
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

  it('says so once it has been accepted, and names the burn they are on', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('approved'), messages: [], organisers: [] } }),
      }),
      MEMBER,
      [aBurn('Summer burn', true)],
    )

    const said = (await screen.findByRole('status')).textContent
    expect(said).toContain('You are a member here now')
    expect(said).toContain('You are on Summer burn')
    expect(said).toContain('leave the burn')
    expect(screen.getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe('/profile')
  })

  it('does not say approval put them there, having no record of what approval did (#560)', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('approved'), messages: [], organisers: [] } }),
      }),
      MEMBER,
      [aBurn('Summer burn', true)],
    )

    expect((await screen.findByRole('status')).textContent).not.toContain('added to')
  })

  it('says neither sentence while the burns are still loading', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('approved'), messages: [], organisers: [] } }),
      }),
      MEMBER,
      [],
      'loading',
    )

    // The settle point: the application's own "Loading…" going away is what proves the
    // approved branch has been reached, so the absence below is not an absence of anything.
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('claims no join where none happened, which is approval between burns (#522)', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({ mine: { application: anApplication('approved'), messages: [], organisers: [] } }),
      }),
      MEMBER,
      [aBurn('Summer burn', false)],
    )

    const said = (await screen.findByRole('status')).textContent
    expect(said).toContain('You are a member here now')
    expect(said).not.toContain('added to')
    expect(said).not.toContain('leave the burn')
    expect(said).toContain('join the one you are coming to')
  })

  it('says the membership is not current where the roles have been taken off again (#578)', async () => {
    renderPage(
      stub({
        getMyApplication: () =>
          Promise.resolve({
            mine: {
              application: anApplication('approved'),
              messages: [],
              organisers: [{ account_id: 'a-9', name: 'Bea', contact: 'bea@example.org' }],
            },
          }),
      }),
      APPLICANT,
      [],
    )

    const said = (await screen.findByRole('status')).textContent
    expect(said).not.toContain('You are a member here now')
    expect(said).toContain('not a member here at the moment')
    expect(screen.queryByRole('heading', { name: 'You are in' })).toBeNull()
    expect(screen.getByText(/Bea/)).toBeTruthy()
  })

  it('says who to ask once it has not been', async () => {
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
