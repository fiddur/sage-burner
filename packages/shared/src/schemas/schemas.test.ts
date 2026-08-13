import { describe, expect, it } from 'vitest'

import { MAX_ASKED_QUESTIONS } from '../answers.ts'
import {
  MAX_CAPO,
  MAX_CONTACT,
  MAX_INTRODUCTION,
  MAX_LOCATION,
  MAX_NOTES,
  MAX_PERSON_NAME,
  MAX_QUESTION_LABEL,
  MAX_SLUG,
  MAX_SONG_BODY,
  MAX_SONG_CATEGORIES,
  MAX_SONG_LINKS,
  MAX_TITLE,
  MAX_WELCOME_LENGTH,
} from '../limits.ts'
import { applicationCreateSchema, applicationSchema } from './application.ts'
import { bringCreateSchema, bringUpdateSchema } from './bring.ts'
import { slugSchema } from './common.ts'
import {
  DEFAULT_TRANSFER_INFO,
  eventCreateSchema,
  eventFields,
  eventSchema,
  withEventDateOrder,
} from './event.ts'
import { formQuestionSchema } from './form-question.ts'
import { publicMeetingFields, publicMeetingSchema } from './meeting.ts'
import {
  attendanceFields,
  attendanceSchema,
  myBurnSchema,
  profileSchema,
  rosterResponseSchema,
  withStayOrder,
} from './membership.ts'
import {
  publicSessionFields,
  publicSessionSchema,
  sessionFields,
  sessionSchema,
  sessionUpdateSchema,
  withValidTimeSlot,
} from './session.ts'
import { songCreateSchema, songUpdateSchema } from './song.ts'

const ID = '0b8a1d4e-3f2c-4a6b-9c1d-5e7f8a9b0c1d'
const OTHER_ID = '1c9b2e5f-4a3d-4b7c-8d2e-6f8a9b0c1d2e'

const anEvent = {
  id: ID,
  name: 'The Burning Sage @ Hökås',
  slug: 'burning-sage-autumn-2026',
  start_date: '2026-10-02',
  end_date: '2026-10-04',
  start_time: '15:00',
  end_time: '12:00',
  location: 'Hökås',
  welcome_markdown: '# Welcome!',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-28T10:00:00Z',
}

describe('slugSchema', () => {
  it('accepts lowercase hyphenated words', () => {
    for (const slug of ['summer-2026', 'autumn', 'a1-b2-c3']) {
      expect(slugSchema.safeParse(slug).success).toBe(true)
    }
  })

  it('rejects anything that would be ugly or ambiguous in a URL', () => {
    for (const slug of ['Summer 2026', 'summer_2026', '-leading', 'trailing-', 'double--hyphen', '']) {
      expect(slugSchema.safeParse(slug).success).toBe(false)
    }
  })
})

describe('eventSchema', () => {
  it('accepts a well-formed event', () => {
    expect(eventSchema.safeParse(anEvent).success).toBe(true)
  })

  it('accepts a single-day event', () => {
    const parsed = eventSchema.safeParse({
      ...anEvent,
      start_date: '2026-10-02',
      end_date: '2026-10-02',
      start_time: '10:00',
      end_time: '22:00',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an event that ends before it starts', () => {
    const parsed = eventSchema.safeParse({ ...anEvent, start_date: '2026-10-04', end_date: '2026-10-02' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['end_date'])
  })

  it('accepts an end time earlier in the clock than the start, across days', () => {
    // The ordinary case, and the reason the times only decide it when the days
    // are equal: 15:00 Friday to 12:00 Sunday is a normal burn.
    expect(eventSchema.safeParse(anEvent).success).toBe(true)
  })

  it('rejects a one-day burn that ends earlier in the day than it starts', () => {
    const parsed = eventSchema.safeParse({
      ...anEvent,
      start_date: '2026-10-02',
      end_date: '2026-10-02',
      start_time: '22:00',
      end_time: '10:00',
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts a one-day burn that runs forwards', () => {
    expect(
      eventSchema.safeParse({
        ...anEvent,
        start_date: '2026-10-02',
        end_date: '2026-10-02',
        start_time: '10:00',
        end_time: '22:00',
      }).success,
    ).toBe(true)
  })

  it('rejects a time that is not a 24-hour clock time', () => {
    for (const bad of ['9:00', '24:00', '10:60', '1000', '10:00:00', '']) {
      expect(eventSchema.safeParse({ ...anEvent, start_time: bad }).success, bad).toBe(false)
    }
  })

  it('rejects a non-positive member cap', () => {
    expect(eventSchema.safeParse({ ...anEvent, member_cap: 0 }).success).toBe(false)
    expect(eventSchema.safeParse({ ...anEvent, member_cap: -1 }).success).toBe(false)
  })
})

describe('formQuestionSchema', () => {
  const aQuestion = {
    id: ID,
    order: 0,
    type: 'agreement',
    label: 'I agree to the 10+1 principles',
    help_text: null,
    required: true,
    options: null,
  }

  it('accepts each supported question type', () => {
    for (const type of ['text', 'textarea', 'checkbox', 'agreement']) {
      expect(formQuestionSchema.safeParse({ ...aQuestion, type }).success).toBe(true)
    }
  })

  it('rejects a question type the form cannot render', () => {
    expect(formQuestionSchema.safeParse({ ...aQuestion, type: 'select' }).success).toBe(false)
  })

  it('rejects a negative order', () => {
    expect(formQuestionSchema.safeParse({ ...aQuestion, order: -1 }).success).toBe(false)
  })
})

describe('applicationSchema', () => {
  const anAnswer = {
    question_id: OTHER_ID,
    label: 'Why do you want to come?',
    type: 'text',
    value: 'because it sounds wonderful',
  }

  const anApplication = {
    id: ID,
    account_id: null,
    answers: [anAnswer],
    status: 'pending',
    applicant_name: 'Someone',
    applicant_email: 'someone@example.org',
    submitted_at: '2026-07-28T10:00:00Z',
    decided_at: null,
  }

  it('accepts a pending application with no decision timestamp', () => {
    expect(applicationSchema.safeParse(anApplication).success).toBe(true)
  })

  it('accepts both text and boolean answers', () => {
    const answers = [anAnswer, { question_id: ID, label: 'I agree', type: 'agreement', value: true }]
    expect(applicationSchema.safeParse({ ...anApplication, answers }).success).toBe(true)
  })

  it('requires the wording, not just a reference', () => {
    // The whole reason answers are stored as a snapshot: an application that kept
    // only `question_id` stops being readable the moment a question is edited or
    // deleted, and that is not recoverable afterwards.
    const { label: _label, ...withoutLabel } = anAnswer
    expect(applicationSchema.safeParse({ ...anApplication, answers: [withoutLabel] }).success).toBe(false)
  })

  it('rejects an answer whose question id is not a uuid', () => {
    const answers = [{ ...anAnswer, question_id: 'not-a-uuid' }]
    expect(applicationSchema.safeParse({ ...anApplication, answers }).success).toBe(false)
  })

  it('rejects a question type the form cannot render', () => {
    const answers = [{ ...anAnswer, type: 'select' }]
    expect(applicationSchema.safeParse({ ...anApplication, answers }).success).toBe(false)
  })
})

describe('applicationCreateSchema', () => {
  const aSubmission = {
    applicant_name: 'Someone',
    applicant_email: 'someone@example.org',
    answers: { [OTHER_ID]: 'because it sounds wonderful' },
    asked: [OTHER_ID],
  }

  it('accepts answers keyed by question id', () => {
    expect(applicationCreateSchema.safeParse(aSubmission).success).toBe(true)
  })

  it('requires the list of questions the form showed', () => {
    // Not optional: absent, the route would have to fall back to the current
    // question list, which is the assumption that stored a question against
    // someone who never saw it.
    const { asked: _omitted, ...without } = aSubmission
    expect(applicationCreateSchema.safeParse(without).success).toBe(false)
  })

  it('accepts a form that showed a question nobody answered', () => {
    // The passing sibling to the case above: `asked` is required, and an empty
    // `answers` beside a non-empty one is still a valid body. Nothing here
    // relates the two — no schema rule could — so that a question shown and left
    // blank is *stored* as asked is `applications.test.ts`'s to prove.
    expect(applicationCreateSchema.safeParse({ ...aSubmission, answers: {} }).success).toBe(true)
  })

  it('caps how many questions a submission may claim it was shown', () => {
    // Both boundaries, like `MAX_ANSWER_LENGTH` has: without them a `.max()`
    // dropped, or written as `.min()`, fails nothing.
    const ids = (count: number) => Array.from({ length: count }, () => OTHER_ID)

    expect(
      applicationCreateSchema.safeParse({ ...aSubmission, asked: ids(MAX_ASKED_QUESTIONS) }).success,
    ).toBe(true)
    expect(
      applicationCreateSchema.safeParse({ ...aSubmission, asked: ids(MAX_ASKED_QUESTIONS + 1) }).success,
    ).toBe(false)
  })

  it('rejects answers keyed by something that is not a question id', () => {
    const answers = { 'not-a-uuid': 'value' }
    expect(applicationCreateSchema.safeParse({ ...aSubmission, answers }).success).toBe(false)
  })

  it('rejects a submitter who names their own status', () => {
    // `.strict()`, so this is a 400 rather than a dropped key — otherwise the
    // request that approves its own application looks like it succeeded.
    expect(applicationCreateSchema.safeParse({ ...aSubmission, status: 'approved' }).success).toBe(false)
  })

  it('rejects a submitter who supplies the wording', () => {
    // The label is the server's, read from the question rows. Accepting it here
    // would let an application record a question that was never asked.
    //
    // Written in the record shape this schema does take, so the refusal comes
    // from `answerValueSchema` rejecting an object where a string or boolean
    // belongs. An array would be refused too, but for the wrong reason — it would
    // fail identically for `[1, 2, 3]`, which proves nothing about labels.
    const answers = { [OTHER_ID]: { label: 'Something else entirely', value: 'x' } }
    expect(applicationCreateSchema.safeParse({ ...aSubmission, answers }).success).toBe(false)
  })

  it('requires a name and a contact', () => {
    const { applicant_name: _name, ...withoutName } = aSubmission
    expect(applicationCreateSchema.safeParse(withoutName).success).toBe(false)
    expect(applicationCreateSchema.safeParse({ ...aSubmission, applicant_name: '   ' }).success).toBe(false)
  })
})

describe('profileSchema', () => {
  const aProfile = {
    account_id: ID,
    email: 'someone@example.org',
    name: 'Someone',
    contact: 'someone@example.org',
    allergies_notes: 'gluten. Sensitive to red lentils.',
    allergy_item_ids: [],
    introduction: null,
  }

  it('accepts a person with their allergies recorded once', () => {
    expect(profileSchema.safeParse(aProfile).success).toBe(true)
  })

  it('accepts a person who has not said anything about allergies', () => {
    expect(profileSchema.safeParse({ ...aProfile, allergies_notes: null }).success).toBe(true)
  })

  it('requires a name and a contact, since an admin has to reach them', () => {
    expect(profileSchema.safeParse({ ...aProfile, name: '  ' }).success).toBe(false)
    expect(profileSchema.safeParse({ ...aProfile, contact: '' }).success).toBe(false)
  })

  it('carries no event, because you are approved into the community once', () => {
    expect(Object.keys(profileSchema.parse({ ...aProfile, event_id: OTHER_ID }))).not.toContain('event_id')
  })
})

describe('attendanceSchema', () => {
  const aMember = {
    id: ID,
    event_id: OTHER_ID,
    account_id: ID,
    joined_at: '2026-07-02T00:00:00Z',
    arrival_date: '2026-10-02',
    departure_date: '2026-10-04',
    lodging_option_id: OTHER_ID,
    helping_option_ids: [ID],
    helping_other: 'Chopping wood',
    notes: null,
    payment_status: 'paid',
    payment_date: '2026-09-01',
  }

  it('accepts a fully filled attendance', () => {
    expect(attendanceSchema.safeParse(aMember).success).toBe(true)
  })

  it('accepts someone who has said they are coming and nothing else', () => {
    const sparse = {
      ...aMember,
      allergies_notes: null,
      arrival_date: null,
      departure_date: null,
      lodging_option_id: null,
      helping_option_ids: [],
      helping_other: null,
      payment_status: 'unpaid',
      payment_date: null,
    }
    expect(attendanceSchema.safeParse(sparse).success).toBe(true)
  })

  it('takes lodging as a reference and refuses anything that is not one', () => {
    // Free text until the per-event lists existed. The point of the reference is
    // that an admin can count who is sleeping where, which a typed-in string
    // cannot support — so an id is the only thing that parses.
    expect(attendanceSchema.safeParse({ ...aMember, lodging_option_id: null }).success).toBe(true)
    expect(attendanceSchema.safeParse({ ...aMember, lodging_option_id: 'Hammock' }).success).toBe(false)
  })

  it('rejects a payment status outside the vocabulary', () => {
    expect(attendanceSchema.safeParse({ ...aMember, payment_status: 'refunded' }).success).toBe(false)
  })

  it('rejects a departure before the arrival, so no one records a negative stay', () => {
    const backwards = { ...aMember, arrival_date: '2026-10-04', departure_date: '2026-10-02' }
    const parsed = attendanceSchema.safeParse(backwards)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['departure_date'])
  })

  it('accepts arriving and departing on the same day', () => {
    const dayTrip = { ...aMember, arrival_date: '2026-10-03', departure_date: '2026-10-03' }
    expect(attendanceSchema.safeParse(dayTrip).success).toBe(true)
  })

  it('does not compare dates when only one end is known', () => {
    expect(attendanceSchema.safeParse({ ...aMember, departure_date: null }).success).toBe(true)
    expect(attendanceSchema.safeParse({ ...aMember, arrival_date: null }).success).toBe(true)
  })
})

describe('optionalText', () => {
  const aMemberWith = (notes: unknown) => ({
    id: ID,
    event_id: OTHER_ID,
    account_id: ID,
    joined_at: '2026-07-02T00:00:00Z',
    arrival_date: null,
    departure_date: null,
    lodging_option_id: null,
    helping_option_ids: [],
    helping_other: null,
    notes,
    payment_status: 'unpaid',
    payment_date: null,
  })

  it('collapses empty and whitespace-only input to null, so "not set" has one representation', () => {
    for (const blank of ['', '   ', '\t\n']) {
      const parsed = attendanceSchema.parse(aMemberWith(blank))
      expect(parsed.notes).toBeNull()
    }
  })

  it('keeps real text, trimmed', () => {
    expect(attendanceSchema.parse(aMemberWith('  bring a drum  ')).notes).toBe('bring a drum')
  })

  it('still accepts an explicit null', () => {
    expect(attendanceSchema.parse(aMemberWith(null)).notes).toBeNull()
  })
})

describe('sessionSchema', () => {
  const aSession = {
    id: ID,
    event_id: OTHER_ID,
    title: 'Cacao ceremony',
    facilitator_account_id: ID,
    description: 'Bring a cup.',
    repeatable: false,
    time_slot_start: '2026-10-03T09:00:00Z',
    time_slot_end: '2026-10-03T10:30:00Z',
    place_id: OTHER_ID,
    // Read-only, and not columns on `session` — which is why the create and update
    // bodies derive from `sessionFields` rather than from `sessionSchema`.
    helpers: [{ account_id: ID, name: 'Ada' }],
    supporters: [{ account_id: ID, name: 'Ada', avatar: null }],
    support_count: 3,
    supported_by_me: true,
    thread_id: OTHER_ID,
  }

  it('lets a partial edit carry one end of the slot, which only the row can judge', () => {
    // An absent key is not a null one. Conflating them made every single-ended
    // PATCH a 400 before the stored row was ever consulted. `sessions.ts` merges
    // the update onto the row and runs `hasValidTimeSlot` on the result.
    expect(sessionUpdateSchema.safeParse({ time_slot_end: '2026-10-03T10:30:00Z' }).success).toBe(true)
    expect(sessionUpdateSchema.safeParse({ time_slot_start: null }).success).toBe(true)
  })

  it('still refuses half a slot when the edit carries both keys', () => {
    // The passing sibling: deferring the lone-key case must not disarm the rule
    // where it is decidable.
    expect(
      sessionUpdateSchema.safeParse({ time_slot_start: '2026-10-03T09:00:00Z', time_slot_end: null }).success,
    ).toBe(false)
  })

  it('accepts a scheduled session', () => {
    expect(sessionSchema.safeParse(aSession).success).toBe(true)
  })

  it('accepts an unscheduled dream — the normal state before the burn', () => {
    const unscheduled = { ...aSession, time_slot_start: null, time_slot_end: null }
    expect(sessionSchema.safeParse(unscheduled).success).toBe(true)
  })

  it('rejects half a time slot', () => {
    expect(sessionSchema.safeParse({ ...aSession, time_slot_end: null }).success).toBe(false)
    expect(sessionSchema.safeParse({ ...aSession, time_slot_start: null }).success).toBe(false)
  })

  it('rejects a slot that ends before it starts', () => {
    const backwards = {
      ...aSession,
      time_slot_start: '2026-10-03T10:30:00Z',
      time_slot_end: '2026-10-03T09:00:00Z',
    }
    expect(sessionSchema.safeParse(backwards).success).toBe(false)
  })

  it('rejects a zero-length slot', () => {
    const instant = { ...aSession, time_slot_end: aSession.time_slot_start }
    expect(sessionSchema.safeParse(instant).success).toBe(false)
  })

  it('rejects a backwards slot even when the two ends differ in precision', () => {
    // Lexicographically '…T09:00:00.500Z' < '…T09:00:00Z' ('.' sorts before
    // 'Z'), so a string comparison would wave this through despite the slot
    // ending half a second before it starts.
    const mixedPrecision = {
      ...aSession,
      time_slot_start: '2026-10-03T09:00:00.500Z',
      time_slot_end: '2026-10-03T09:00:00Z',
    }
    expect(mixedPrecision.time_slot_start < mixedPrecision.time_slot_end).toBe(true)
    expect(sessionSchema.safeParse(mixedPrecision).success).toBe(false)
  })

  it('accepts a forwards slot whose ends differ in precision', () => {
    const mixedPrecision = {
      ...aSession,
      time_slot_start: '2026-10-03T09:00:00Z',
      time_slot_end: '2026-10-03T09:00:00.500Z',
    }
    expect(sessionSchema.safeParse(mixedPrecision).success).toBe(true)
  })
})

describe('deriving schemas', () => {
  // The write path is the one that matters. Deriving from the unrefined
  // `*Fields` objects is what makes create/update bodies possible at all, but
  // it drops the cross-field refinements unless they are re-applied — so each
  // case below checks the derived schema still rejects, not merely that the
  // derivation succeeded.

  it('derives an event create body that still enforces the date order', () => {
    const createEvent = withEventDateOrder(eventFields.omit({ id: true, created_at: true }))
    const valid = { ...anEvent, id: undefined, created_at: undefined }
    expect(createEvent.safeParse(valid).success).toBe(true)

    const backwards = { ...valid, start_date: '2026-10-04', end_date: '2026-10-02' }
    expect(createEvent.safeParse(backwards).success).toBe(false)
    // Without the wrapper the invariant is silently gone — this is the trap.
    expect(eventFields.omit({ id: true, created_at: true }).safeParse(backwards).success).toBe(true)
  })

  it('defaults the transfer text so a new burn already has something to say when full', () => {
    // Keys deleted rather than set undefined: the create schema is `.strict()`, so
    // an `id: undefined` is an unknown key and the parse fails for the wrong reason.
    const { id: _id, created_at: _created, transfer_info_markdown: _text, ...body } = anEvent

    const parsed = eventCreateSchema.safeParse(body)

    expect(parsed.success && parsed.data.transfer_info_markdown).toBe(DEFAULT_TRANSFER_INFO)
  })

  it('keeps what an admin wrote over the default', () => {
    // The passing sibling: always answering the default would satisfy the test above.
    const { id: _id, created_at: _created, ...body } = anEvent

    const parsed = eventCreateSchema.safeParse({ ...body, transfer_info_markdown: 'Ask Ada.' })

    expect(parsed.success && parsed.data.transfer_info_markdown).toBe('Ask Ada.')
  })

  it('derives an attendance patch body that still enforces the stay order', () => {
    const patchAttendance = withStayOrder(attendanceFields.partial())
    expect(patchAttendance.safeParse({ notes: 'just this one field' }).success).toBe(true)

    const backwards = { arrival_date: '2026-10-04', departure_date: '2026-10-02' }
    expect(patchAttendance.safeParse(backwards).success).toBe(false)
    expect(attendanceFields.partial().safeParse(backwards).success).toBe(true)
  })

  it('derives a session create body that still enforces the time slot rules', () => {
    const createSession = withValidTimeSlot(sessionFields.omit({ id: true }))

    const halfASlot = {
      event_id: OTHER_ID,
      title: 'Cacao ceremony',
      facilitator_account_id: ID,
      description: '',
      repeatable: false,
      time_slot_start: '2026-10-03T10:00:00Z',
      time_slot_end: null,
      place_id: null,
    }
    expect(createSession.safeParse(halfASlot).success).toBe(false)

    const backwards = { ...halfASlot, time_slot_end: '2026-10-03T09:00:00Z' }
    expect(createSession.safeParse(backwards).success).toBe(false)

    const fine = { ...halfASlot, time_slot_end: '2026-10-03T11:00:00Z' }
    expect(createSession.safeParse(fine).success).toBe(true)
  })
})

describe('publicMeetingSchema', () => {
  it('exposes exactly these fields and nothing else', () => {
    expect(Object.keys(publicMeetingFields.shape).sort()).toEqual([
      'ends_at',
      'id',
      'link',
      'starts_at',
      'title',
    ])
  })

  it('keeps the notes off the feed, which is where a meeting says things members only should read', () => {
    const parsed = publicMeetingSchema.safeParse({
      id: ID,
      title: 'Planning call',
      link: null,
      starts_at: '2026-10-03T17:00:00Z',
      ends_at: '2026-10-03T18:00:00Z',
      notes: 'the code is 1234',
    })

    expect(parsed.success).toBe(false)
  })
})

describe('publicSessionSchema', () => {
  it('exposes exactly these fields and nothing else', () => {
    // An allowlist, deliberately, not a denylist of known-sensitive names.
    // This schema is the guard rail for an unauthenticated endpoint, so adding
    // a field must fail this test until someone consciously widens it — a
    // denylist only catches leaks that were thought of in advance, and
    // `host_name` is exactly the field most likely to get added here.
    expect(Object.keys(publicSessionFields.shape).sort()).toEqual([
      'color',
      'description',
      'id',
      'location',
      'time_slot_end',
      'time_slot_start',
      'title',
    ])
  })

  it('inherits its constraints from sessionFields rather than redeclaring them', () => {
    const toolong = 'x'.repeat(20_001)
    expect(publicSessionFields.shape.description.safeParse(toolong).success).toBe(false)
    expect(sessionFields.shape.description.safeParse(toolong).success).toBe(false)
  })

  it('rejects a backwards slot, so the feed cannot emit DTEND before DTSTART', () => {
    const backwards = {
      id: ID,
      title: 'Cacao ceremony',
      description: 'Bring a cup.',
      time_slot_start: '2026-10-03T10:00:00Z',
      time_slot_end: '2026-10-03T09:00:00Z',
      location: 'Temple',
      color: 'yellow',
    }
    expect(publicSessionSchema.safeParse(backwards).success).toBe(false)
  })

  it('strips unknown fields rather than passing them through to the feed', () => {
    const parsed = publicSessionSchema.parse({
      id: ID,
      title: 'Cacao ceremony',
      description: 'Bring a cup.',
      time_slot_start: '2026-10-03T09:00:00Z',
      time_slot_end: '2026-10-03T10:30:00Z',
      location: 'Temple',
      color: 'yellow',
      facilitator_account_id: ID,
      allergies_notes: 'gluten',
    })
    expect(parsed).not.toHaveProperty('facilitator_account_id')
    expect(parsed).not.toHaveProperty('allergies_notes')
  })
})

describe('the named length limits', () => {
  /**
   * Each bound, at the limit and one past it.
   *
   * The point of `limits.ts` is that the schema and the form share one number, and
   * the failure it prevents is silent: tighten a bound and a form still carrying the
   * old literal lets people type past it, so a friendly stop at the keyboard becomes
   * a blank 400 on submit.
   *
   * What these catch is a **schema drifting off the constant** — someone writing
   * `nonEmptyText(150)` again. They deliberately do not catch a change to the
   * constant itself: the schema and the assertion read the same number, so moving
   * it moves both. That half is not testable from here and does not need to be —
   * moving the constant is the intended way to change a bound, and every form
   * follows it because they read it too.
   */
  // Local fixtures: the ones above are scoped to their own describes, and a bound
  // is worth checking against a minimal valid row rather than a shared one that
  // might be edited for another reason.
  const aProfile = {
    account_id: ID,
    email: 'someone@example.org',
    name: 'Someone',
    contact: 'a phone number',
    allergies_notes: null,
    allergy_item_ids: [],
    introduction: null,
  }
  const aQuestion = {
    id: ID,
    order: 0,
    type: 'text',
    label: 'Why do you want to come?',
    help_text: null,
    required: false,
    options: null,
  }

  const bounded: [string, (value: string) => boolean, number][] = [
    ['a person’s name', (v) => profileSchema.safeParse({ ...aProfile, name: v }).success, MAX_PERSON_NAME],
    ['a contact', (v) => profileSchema.safeParse({ ...aProfile, contact: v }).success, MAX_CONTACT],
    ['allergies', (v) => profileSchema.safeParse({ ...aProfile, allergies_notes: v }).success, MAX_NOTES],
    [
      'an introduction',
      (v) => profileSchema.safeParse({ ...aProfile, introduction: v }).success,
      MAX_INTRODUCTION,
    ],
    ['an event name', (v) => eventSchema.safeParse({ ...anEvent, name: v }).success, MAX_TITLE],
    [
      'a welcome text',
      (v) => eventSchema.safeParse({ ...anEvent, welcome_markdown: v }).success,
      MAX_WELCOME_LENGTH,
    ],
    ["a burn's place", (v) => eventSchema.safeParse({ ...anEvent, location: v }).success, MAX_LOCATION],
    [
      'a question label',
      (v) => formQuestionSchema.safeParse({ ...aQuestion, label: v }).success,
      MAX_QUESTION_LABEL,
    ],
  ]

  for (const [what, accepts, limit] of bounded) {
    it(`accepts ${what} of exactly its limit and refuses one more`, () => {
      expect(accepts('x'.repeat(limit)), `${limit}`).toBe(true)
      expect(accepts('x'.repeat(limit + 1)), `${limit + 1}`).toBe(false)
    })
  }

  it('keeps a slug bounded where `slugSchema` says, not where a projection guesses', () => {
    // `rosterResponseSchema`'s event projection used to bound this at 120 while
    // `slugSchema` bounded it at 64 — one fact spelled two ways.
    expect(slugSchema.safeParse('a'.repeat(MAX_SLUG)).success).toBe(true)
    expect(slugSchema.safeParse('a'.repeat(MAX_SLUG + 1)).success).toBe(false)
  })
})

describe('the summaries derived from `eventFields`', () => {
  const anAttendance = {
    id: ID,
    event_id: OTHER_ID,
    account_id: ID,
    joined_at: '2026-07-02T00:00:00Z',
    arrival_date: '2026-10-02',
    departure_date: '2026-10-04',
    lodging_option_id: null,
    helping_option_ids: [],
    helping_other: null,
    notes: null,
    payment_status: 'unpaid',
    payment_date: null,
  }

  it('holds a summarised slug to the same rule as a real one', () => {
    // The divergence this replaced: written out by hand, the summary bounded `slug`
    // as plain text, so it accepted `Not A Slug!` where `slugSchema` — the thing it
    // claims to summarise — accepts only lowercase hyphenated words. The summary
    // moved to `myBurnSchema` when the routes stopped being scoped to "active"; the
    // rule it has to keep did not.
    const withSlug = (slug: string) =>
      myBurnSchema.safeParse({
        event: {
          id: ID,
          name: 'Summer burn',
          slug,
          start_date: '2026-08-01',
          end_date: '2026-08-05',
          start_time: '16:00',
          end_time: '12:00',
        },
        attendance: anAttendance,
      }).success

    expect(withSlug('summer-2026')).toBe(true)
    expect(withSlug('Not A Slug!')).toBe(false)
    expect(withSlug('a'.repeat(MAX_SLUG + 1))).toBe(false)
  })

  it('refuses a member cap the event schema would refuse', () => {
    const withCap = (member_cap: number) =>
      rosterResponseSchema.safeParse({
        event: { id: ID, name: 'Summer burn', member_cap },
        entries: [],
      }).success

    expect(withCap(42)).toBe(true)
    expect(withCap(0)).toBe(false)
    expect(withCap(-1)).toBe(false)
  })
})

describe('something to bring', () => {
  const anItem = (over: Record<string, unknown> = {}) => ({ title: 'Drums to use around the fire', ...over })

  it('needs a name and nothing else, and is an ask until somebody puts a hand up', () => {
    const parsed = bringCreateSchema.safeParse(anItem())

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      title: 'Drums to use around the fire',
      comment: '',
      bringing: false,
    })
  })

  it('is an offer when the person adding it says they are bringing it', () => {
    expect(bringCreateSchema.safeParse(anItem({ bringing: true })).data?.bringing).toBe(true)
  })

  it('refuses a name of nothing but whitespace', () => {
    expect(bringCreateSchema.safeParse(anItem({ title: '   ' })).success).toBe(false)
  })

  it('holds a comment as long as any other note', () => {
    expect(bringCreateSchema.safeParse(anItem({ comment: 'a'.repeat(MAX_NOTES) })).success).toBe(true)
    expect(bringCreateSchema.safeParse(anItem({ comment: 'a'.repeat(MAX_NOTES + 1) })).success).toBe(false)
  })

  it('refuses a field nobody named, so a typo is not silently dropped', () => {
    expect(bringCreateSchema.safeParse(anItem({ wanted: 3 })).success).toBe(false)
    expect(bringUpdateSchema.safeParse({ wanted: 3 }).success).toBe(false)
  })

  it('keeps who added it and whether it is withdrawn off what an edit may say', () => {
    expect(bringUpdateSchema.safeParse({ author_account_id: ID }).success).toBe(false)
    expect(bringUpdateSchema.safeParse({ withdrawn_at: null }).success).toBe(false)
    expect(bringUpdateSchema.safeParse({ bringing: true }).success).toBe(false)
  })

  it('lets an update carry one field alone, and fills nothing in', () => {
    const parsed = bringUpdateSchema.safeParse({ comment: 'A small bowl drum' })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ comment: 'A small bowl drum' })
  })
})

describe('a song', () => {
  const aSong = (over: Record<string, unknown> = {}) => ({
    title: 'Fire in the sky',
    ...over,
  })

  it('needs a title and nothing else, filling the rest in', () => {
    const parsed = songCreateSchema.safeParse(aSong())

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      title: 'Fire in the sky',
      artist: null,
      body: '',
      capo: null,
      links: [],
      category_ids: [],
    })
  })

  it('refuses a title of nothing but whitespace', () => {
    expect(songCreateSchema.safeParse(aSong({ title: '   ' })).success).toBe(false)
  })

  it('takes an artist, and refuses a blank one where nothing said is null', () => {
    expect(songCreateSchema.safeParse(aSong({ artist: 'The Sagebrush Band' })).data?.artist).toBe(
      'The Sagebrush Band',
    )
    expect(songCreateSchema.safeParse(aSong({ artist: null })).data?.artist).toBeNull()
    expect(songCreateSchema.safeParse(aSong({ artist: '' })).success).toBe(false)
    expect(songCreateSchema.safeParse(aSong({ artist: '   ' })).success).toBe(false)
  })

  it('holds a body as long as a welcome page is short', () => {
    expect(songCreateSchema.safeParse(aSong({ body: 'a'.repeat(MAX_SONG_BODY) })).success).toBe(true)
    expect(songCreateSchema.safeParse(aSong({ body: 'a'.repeat(MAX_SONG_BODY + 1) })).success).toBe(false)
  })

  it('takes a capo on the neck and refuses one off it', () => {
    expect(songCreateSchema.safeParse(aSong({ capo: 0 })).success).toBe(true)
    expect(songCreateSchema.safeParse(aSong({ capo: MAX_CAPO })).success).toBe(true)
    expect(songCreateSchema.safeParse(aSong({ capo: MAX_CAPO + 1 })).success).toBe(false)
    expect(songCreateSchema.safeParse(aSong({ capo: -1 })).success).toBe(false)
    expect(songCreateSchema.safeParse(aSong({ capo: 1.5 })).success).toBe(false)
  })

  it('takes only an https link, so a rendered one cannot carry a script', () => {
    const withLink = (url: string) => songCreateSchema.safeParse(aSong({ links: [{ url }] })).success

    expect(withLink('https://open.spotify.com/track/1')).toBe(true)
    expect(withLink('http://open.spotify.com/track/1')).toBe(false)
    expect(withLink('javascript:alert(1)')).toBe(false)
    expect(withLink('')).toBe(false)
  })

  it('bounds how many links and categories one song carries', () => {
    const links = Array.from({ length: MAX_SONG_LINKS + 1 }, (_unused, at) => ({
      url: `https://example.org/${at}`,
    }))

    expect(songCreateSchema.safeParse(aSong({ links: links.slice(1) })).success).toBe(true)
    expect(songCreateSchema.safeParse(aSong({ links })).success).toBe(false)
    expect(
      songCreateSchema.safeParse(
        aSong({ category_ids: Array.from({ length: MAX_SONG_CATEGORIES + 1 }, () => ID) }),
      ).success,
    ).toBe(false)
  })

  it('refuses a field nobody named, so a typo is not silently dropped', () => {
    expect(songCreateSchema.safeParse(aSong({ lyrics: 'come and sing' })).success).toBe(false)
    expect(songUpdateSchema.safeParse({ lyrics: 'come and sing' }).success).toBe(false)
  })

  it('lets an update carry one field alone, and fills nothing in', () => {
    const parsed = songUpdateSchema.safeParse({ capo: 2 })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ capo: 2 })
  })
})
