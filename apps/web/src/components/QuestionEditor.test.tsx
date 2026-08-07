import type { FormQuestion } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuestionsApi } from './QuestionEditor.tsx'

import { apiError } from '../api/client.ts'
import { QuestionEditor } from './QuestionEditor.tsx'

afterEach(cleanup)

const q = (id: string, label: string, order: number, over: Partial<FormQuestion> = {}): FormQuestion => ({
  id,
  order,
  type: 'textarea',
  label,
  help_text: null,
  required: true,
  options: null,
  ...over,
})

const stub = (over: Partial<QuestionsApi> = {}): QuestionsApi => ({
  getQuestions: () => Promise.resolve({ questions: [] }),
  addQuestion: () => Promise.reject(new Error('addQuestion is not stubbed here')),
  updateQuestion: () => Promise.reject(new Error('updateQuestion is not stubbed here')),
  deleteQuestion: () => Promise.reject(new Error('deleteQuestion is not stubbed here')),
  reorderQuestions: () => Promise.reject(new Error('reorderQuestions is not stubbed here')),
  ...over,
})

const renderEditor = (api: QuestionsApi) => render(<QuestionEditor api={api} />)

describe('QuestionEditor', () => {
  it('says the form will be empty when there are no questions', async () => {
    renderEditor(stub())

    expect(await screen.findByText(/No questions yet/)).toBeTruthy()
  })

  it('lists the questions in the order the API returned', async () => {
    // Server order, not a local sort — `order` is the server's to assign.
    //
    // The array deliberately disagrees with the `order` values: `First` carries
    // order 2 and arrives first. A component sorting locally by `order` would
    // render `Second` first and fail. With a pre-sorted fixture (0, 1, 2) a local
    // sort passed identically, so the comment claimed something the test could
    // not see.
    renderEditor(
      stub({
        getQuestions: () =>
          Promise.resolve({ questions: [q('a', 'First', 2), q('b', 'Second', 0), q('c', 'Third', 1)] }),
      }),
    )

    const items = await waitFor(() => {
      const found = screen.getAllByRole('listitem')
      expect(found).toHaveLength(3)
      return found
    })
    expect(items.map((node) => node.textContent?.startsWith('First') ?? false)[0]).toBe(true)
    expect(items[2]?.textContent).toContain('Third')
  })

  it('adds a question, sending null for an empty help text', async () => {
    // "Not set" has exactly one representation; an empty box must not become ''.
    const addQuestion = vi.fn(() => Promise.resolve({ question: q('n', 'New one', 0) }))
    renderEditor(stub({ addQuestion }))
    await screen.findByText(/No questions yet/)

    fireEvent.input(screen.getByLabelText('New question'), { target: { value: 'New one' } })
    screen.getByRole('button', { name: 'Add question' }).click()

    await waitFor(() => {
      // No `options` key: it is optional in the request shape now. Sending an
      // explicit `null` for a column no question type consumes was ceremony, and
      // the update path never sent it — so the two halves of this editor
      // disagreed about whether it is a field you send.
      expect(addQuestion).toHaveBeenCalledWith({
        label: 'New one',
        type: 'textarea',
        help_text: null,
        required: true,
      })
    })
  })

  it('sends the chosen type', async () => {
    const addQuestion = vi.fn(() => Promise.resolve({ question: q('n', 'Agree', 0) }))
    renderEditor(stub({ addQuestion }))
    await screen.findByText(/No questions yet/)

    fireEvent.input(screen.getByLabelText('New question'), { target: { value: 'I agree' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'agreement' } })
    screen.getByRole('button', { name: 'Add question' }).click()

    await waitFor(() => {
      expect(addQuestion).toHaveBeenCalledWith(expect.objectContaining({ type: 'agreement' }))
    })
  })

  it('reports a saved question whose list reload failed as saved', async () => {
    // The inverse of the failure this component otherwise guards: the write
    // succeeded, so "Could not add the question." would send an admin to add
    // it a second time.
    let calls = 0
    const getQuestions = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ questions: [] })
        : Promise.reject(apiError(500, 'internal_error', 'boom'))
    })
    renderEditor(stub({ getQuestions, addQuestion: () => Promise.resolve({ question: q('n', 'New', 0) }) }))
    await screen.findByText(/No questions yet/)

    fireEvent.input(screen.getByLabelText('New question'), { target: { value: 'New' } })
    screen.getByRole('button', { name: 'Add question' }).click()

    expect((await screen.findByRole('alert')).textContent).toBe('Saved, but the list could not be reloaded.')
  })

  it('will not let an agreement be optional', async () => {
    // The API refuses the combination; this makes the rule visible rather than
    // turning a tick into a 400.
    renderEditor(stub())
    await screen.findByText(/No questions yet/)

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'agreement' } })

    const required = screen.getByLabelText<HTMLInputElement>(/^Required/)
    expect(required.hasAttribute('disabled')).toBe(true)
    expect(required.checked).toBe(true)
  })

  it('will not add a question whose label is only whitespace', async () => {
    // `required` passes `'   '`, so without the disabled guard the form submits
    // and `nonEmptyText(500)` trims it to `''` server-side — an unmapped 400 for
    // input the browser could have refused.
    const addQuestion = vi.fn(() => Promise.resolve({ question: q('n', 'x', 0) }))
    renderEditor(stub({ addQuestion }))
    await screen.findByText(/No questions yet/)

    fireEvent.input(screen.getByLabelText('New question'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Add question' }).hasAttribute('disabled')).toBe(true)
    expect(addQuestion).not.toHaveBeenCalled()
  })

  it('will not let a checkbox be required', async () => {
    // The other half of the same rule: a checkbox always has an answer, so
    // "required" can only mean "must be ticked" — which is what `agreement` is.
    // The API and the database both refuse it, so the control says so rather than
    // turning a tick into a 400.
    renderEditor(stub())
    await screen.findByText(/No questions yet/)

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'checkbox' } })

    const required = screen.getByLabelText<HTMLInputElement>(/^Required/)
    expect(required.hasAttribute('disabled')).toBe(true)
    expect(required.checked).toBe(false)
  })

  it('re-reads after a change rather than patching local state', async () => {
    // What is on screen has to be what the public form will render, including
    // the `order` the server assigned.
    const getQuestions = vi.fn(() => Promise.resolve({ questions: [q('a', 'Only', 0)] }))
    renderEditor(stub({ getQuestions, deleteQuestion: () => Promise.resolve(undefined) }))
    await screen.findByText('Only')

    screen.getByRole('button', { name: 'Remove' }).click()

    await waitFor(() => {
      expect(getQuestions).toHaveBeenCalledTimes(2)
    })
  })

  it('sends the whole id list when moving a question down', async () => {
    // A partial list is rejected by the API — moving one question renumbers
    // several, and half a reorder is an order nobody chose.
    const reorderQuestions = vi.fn(() => Promise.resolve({ questions: [] }))
    renderEditor(
      stub({
        getQuestions: () =>
          Promise.resolve({ questions: [q('a', 'First', 0), q('b', 'Second', 1), q('c', 'Third', 2)] }),
        reorderQuestions,
      }),
    )
    await screen.findByText('First')

    screen.getByRole('button', { name: 'Move "First" down' }).click()

    await waitFor(() => {
      expect(reorderQuestions).toHaveBeenCalledWith(['b', 'a', 'c'])
    })
  })

  it('sends the whole id list when moving a question up', async () => {
    const reorderQuestions = vi.fn(() => Promise.resolve({ questions: [] }))
    renderEditor(
      stub({
        getQuestions: () =>
          Promise.resolve({ questions: [q('a', 'First', 0), q('b', 'Second', 1), q('c', 'Third', 2)] }),
        reorderQuestions,
      }),
    )
    await screen.findByText('Third')

    screen.getByRole('button', { name: 'Move "Third" up' }).click()

    await waitFor(() => {
      expect(reorderQuestions).toHaveBeenCalledWith(['a', 'c', 'b'])
    })
  })

  it('cannot move the first question up or the last one down', async () => {
    renderEditor(
      stub({ getQuestions: () => Promise.resolve({ questions: [q('a', 'First', 0), q('b', 'Last', 1)] }) }),
    )
    await screen.findByText('First')

    expect(screen.getByRole('button', { name: 'Move "First" up' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move "Last" down' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move "First" down' }).hasAttribute('disabled')).toBe(false)
  })

  it('edits an existing question', async () => {
    const updateQuestion = vi.fn(() => Promise.resolve({ question: q('a', 'Reworded', 0) }))
    renderEditor(
      stub({ getQuestions: () => Promise.resolve({ questions: [q('a', 'Original', 0)] }), updateQuestion }),
    )
    await screen.findByText('Original')

    screen.getByRole('button', { name: 'Edit' }).click()
    fireEvent.input(await screen.findByLabelText('Label'), { target: { value: 'Reworded' } })
    screen.getByRole('button', { name: 'Save question' }).click()

    await waitFor(() => {
      expect(updateQuestion).toHaveBeenCalledWith('a', {
        label: 'Reworded',
        type: 'textarea',
        help_text: null,
        required: true,
      })
    })
  })

  it('re-reads after a failure so the editor can recover', async () => {
    // The dead end this closes: another admin adds a question, this list is
    // stale, every reorder rebuilds the same short id list and the API answers
    // 400 forever. Without a re-read the only way out was reloading the page,
    // and the message did not say so.
    const getQuestions = vi.fn(() => Promise.resolve({ questions: [q('a', 'Only', 0), q('b', 'Two', 1)] }))
    renderEditor(
      stub({
        getQuestions,
        reorderQuestions: () => Promise.reject(apiError(400, 'bad_request', 'Request failed (400).')),
      }),
    )
    await screen.findByText('Only')

    screen.getByRole('button', { name: 'Move "Only" down' }).click()

    await waitFor(() => {
      expect(getQuestions).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('will not save a question with an empty label', async () => {
    // `QuestionFields` is a div, not a form, and Save is type="button", so there
    // is no constraint validation — without this the request goes out, the shared
    // schema rejects it, and the admin reads an unmapped "Request failed
    // (400)". The add form is disabled on the same input, which is what makes the
    // two halves behave alike; `required` alone would not, since `'   '` passes
    // browser validation.
    const updateQuestion = vi.fn(() => Promise.resolve({ question: q('a', 'x', 0) }))
    renderEditor(
      stub({ getQuestions: () => Promise.resolve({ questions: [q('a', 'Original', 0)] }), updateQuestion }),
    )
    await screen.findByText('Original')

    screen.getByRole('button', { name: 'Edit' }).click()
    fireEvent.input(await screen.findByLabelText('Label'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Save question' }).hasAttribute('disabled')).toBe(true)
    expect(updateQuestion).not.toHaveBeenCalled()
  })

  it('surfaces a failure instead of pretending the change took', async () => {
    renderEditor(
      stub({
        getQuestions: () => Promise.resolve({ questions: [q('a', 'Only', 0)] }),
        deleteQuestion: () =>
          Promise.reject(apiError(500, 'internal_error', 'Something went wrong at our end.')),
      }),
    )
    await screen.findByText('Only')

    screen.getByRole('button', { name: 'Remove' }).click()

    expect((await screen.findByRole('alert')).textContent).toContain('went wrong')
    expect(screen.getByText('Only')).toBeTruthy()
  })

  it('shows a load failure rather than an empty form', async () => {
    renderEditor(stub({ getQuestions: () => Promise.reject(apiError(403, 'forbidden', 'No access.')) }))

    expect((await screen.findByRole('alert')).textContent).toBe('No access.')
  })
})
