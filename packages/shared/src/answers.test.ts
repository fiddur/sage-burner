import { describe, expect, it } from 'vitest'

import type { FormQuestion } from './schemas/form-question.ts'

import { answerProblems, looksLikeEmail, MAX_ANSWER_LENGTH } from './answers.ts'

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
    expect(answerProblems([optional, agree], { 'q-agree': true })).toEqual([])
  })

  it('rejects a required question with no answer', () => {
    expect(answerProblems([text], {})).toEqual([{ question_id: 'q-text', reason: 'missing' }])
  })

  it('rejects a required question answered with whitespace', () => {
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
    expect(answerProblems([text], { 'q-text': 'Fredrik', 'q-gone': 'x' })).toEqual([
      { question_id: 'q-gone', reason: 'unknown' },
    ])
  })

  it('reports every problem, not just the first', () => {
    expect(answerProblems([text, agree], {})).toEqual([
      { question_id: 'q-text', reason: 'missing' },
      { question_id: 'q-agree', reason: 'unchecked' },
    ])
  })

  it('accepts an empty form', () => {
    expect(answerProblems([], {})).toEqual([])
  })
})

describe('whether something is shaped like an address', () => {
  it('accepts an ordinary one', () => {
    expect(looksLikeEmail('ada@example.org')).toBe(true)
  })

  it('accepts one with a plus tag and a subdomain, which people really use', () => {
    expect(looksLikeEmail('ada+burn@mail.example.co.uk')).toBe(true)
  })

  it('ignores space around it, as the form does before sending', () => {
    expect(looksLikeEmail('  ada@example.org ')).toBe(true)
  })

  it('rejects the things the old free-text box held', () => {
    // Phone numbers and Discord handles, which is what "how can we reach you" got
    // before this was an address field (#30).
    expect(looksLikeEmail('+46 70 123 45 67')).toBe(false)
    expect(looksLikeEmail('@ada on discord')).toBe(false)
    expect(looksLikeEmail('ada')).toBe(false)
  })

  it('rejects one with no dot after the @, which is not a deliverable domain', () => {
    expect(looksLikeEmail('ada@localhost')).toBe(false)
  })

  it('rejects a blank', () => {
    expect(looksLikeEmail('   ')).toBe(false)
  })
})
