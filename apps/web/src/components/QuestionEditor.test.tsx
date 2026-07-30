import type { FormQuestion } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuestionsApi } from './QuestionEditor.tsx'

import { apiError } from '../api/client.ts'
import { QuestionEditor } from './QuestionEditor.tsx'

afterEach(cleanup)

const EVENT = 'e-1'

const q = (id: string, label: string, order: number, over: Partial<FormQuestion> = {}): FormQuestion => ({
  id,
  event_id: EVENT,
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

const renderEditor = (api: QuestionsApi) => render(<QuestionEditor api={api} eventId={EVENT} />)

describe('QuestionEditor', () => {
  it('says the form will be empty when there are no questions', async () => {
    renderEditor(stub())

    expect(await screen.findByText(/No questions yet/)).toBeTruthy()
  })

  it('lists the questions in the order the API returned', async () => {
    // Server order, not a local sort — `order` is the server's to assign.
    renderEditor(
      stub({
        getQuestions: () =>
          Promise.resolve({ questions: [q('a', 'First', 0), q('b', 'Second', 1), q('c', 'Third', 2)] }),
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
      expect(addQuestion).toHaveBeenCalledWith(EVENT, {
        label: 'New one',
        type: 'textarea',
        help_text: null,
        required: true,
        options: null,
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
      expect(addQuestion).toHaveBeenCalledWith(EVENT, expect.objectContaining({ type: 'agreement' }))
    })
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
      expect(reorderQuestions).toHaveBeenCalledWith(EVENT, ['b', 'a', 'c'])
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
      expect(reorderQuestions).toHaveBeenCalledWith(EVENT, ['a', 'c', 'b'])
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
