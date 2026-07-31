import { describe, expect, it } from 'vitest'

import type { FormQuestion } from './schemas/form-question.ts'

import { MAX_ANSWER_LENGTH, answerProblems } from './answers.ts'

const question = (over: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'type'>): FormQuestion => ({
  order: 0,
  label: 'A question',
  help_text: null,
  required: false,
  options: null,
  ...over,
})

const text = question({ id: 'q-text', type: 'text', required: true })
const optional = question({ id: 'q-opt', type: 'textarea' })
const agree = question({ id: 'q-agree', type: 'agreement', required: true })
const box = question({ id: 'q-box', type: 'checkbox' })

describe('answerProblems', () => {
  it('accepts a complete submission', () => {
    expect(
      answerProblems([text, optional, agree, box], {
        'q-text': 'Fredrik',
        'q-opt': 'see you there',
        'q-agree': true,
        'q-box': false,
      }),
    ).toEqual([])
  })

  it('accepts an optional question left out entirely', () => {
    // Absent is how an unanswered optional question arrives — the answers record
    // is partial precisely so this is expressible.
    expect(answerProblems([optional, agree], { 'q-agree': true })).toEqual([])
  })

  it('rejects a required question with no answer', () => {
    expect(answerProblems([text], {})).toEqual([{ question_id: 'q-text', reason: 'missing' }])
  })

  it('rejects a required question answered with whitespace', () => {
    // Otherwise `required` means "the key was present", which is not what an
    // organiser reading the application needs it to mean.
    expect(answerProblems([text], { 'q-text': '   ' })).toEqual([
      { question_id: 'q-text', reason: 'missing' },
    ])
  })

  it('rejects an unticked agreement, which is the whole point of the type', () => {
    expect(answerProblems([agree], { 'q-agree': false })).toEqual([
      { question_id: 'q-agree', reason: 'unchecked' },
    ])
  })

  it('rejects a missing agreement the same way as an unticked one', () => {
    // Absent and false mean the same thing for a tick box, and answering
    // otherwise would let a submitter skip the agreement by omitting the key.
    expect(answerProblems([agree], {})).toEqual([{ question_id: 'q-agree', reason: 'unchecked' }])
  })

  it('accepts a checkbox that is absent, since absent means unticked', () => {
    expect(answerProblems([box], {})).toEqual([])
  })

  it('rejects a boolean answer to a text question', () => {
    expect(answerProblems([text], { 'q-text': true })).toEqual([
      { question_id: 'q-text', reason: 'wrong_type' },
    ])
  })

  it('rejects a string answer to a tick box', () => {
    // `'false'` is truthy, so accepting strings here would tick an agreement the
    // applicant did not tick.
    expect(answerProblems([box], { 'q-box': 'false' })).toEqual([
      { question_id: 'q-box', reason: 'wrong_type' },
    ])
  })

  it('rejects an answer longer than the schema allows', () => {
    // The limit lives here rather than only in the Zod schema, so the form can
    // refuse it too. Split, the API rejected a long answer the form had accepted
    // — and a long answer is expected in exactly the "why do you want to come"
    // field.
    expect(answerProblems([optional], { 'q-opt': 'x'.repeat(MAX_ANSWER_LENGTH + 1) })).toEqual([
      { question_id: 'q-opt', reason: 'too_long' },
    ])
  })

  it('accepts an answer exactly at the limit', () => {
    // The passing sibling: an off-by-one here refuses a legitimate answer, which
    // is the failure nobody reports because they just give up.
    expect(answerProblems([optional], { 'q-opt': 'x'.repeat(MAX_ANSWER_LENGTH) })).toEqual([])
  })

  it('rejects an answer to a question that does not exist', () => {
    // A deleted or invented id. Storing it would put a key in `answers` that
    // nothing can ever label, which is the orphaning the DELETE handler warns of.
    expect(answerProblems([text], { 'q-text': 'Fredrik', 'q-gone': 'x' })).toEqual([
      { question_id: 'q-gone', reason: 'unknown' },
    ])
  })

  it('reports every problem, not just the first', () => {
    // The form marks all of them at once; returning one would walk the applicant
    // through their mistakes one submission at a time.
    expect(answerProblems([text, agree], {})).toEqual([
      { question_id: 'q-text', reason: 'missing' },
      { question_id: 'q-agree', reason: 'unchecked' },
    ])
  })

  it('accepts an empty form', () => {
    expect(answerProblems([], {})).toEqual([])
  })
})
