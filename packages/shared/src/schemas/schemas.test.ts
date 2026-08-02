import { describe, expect, it } from 'vitest'

import { applicationCreateSchema, applicationSchema } from './application.ts'
import { slugSchema } from './common.ts'
import { eventFields, eventSchema, withEventDateOrder } from './event.ts'
import { formQuestionSchema } from './form-question.ts'
import { attendanceFields, attendanceSchema, profileSchema, withStayOrder } from './membership.ts'
import {
  publicSessionFields,
  publicSessionSchema,
  sessionFields,
  sessionSchema,
  sessionUpdateSchema,
  withValidTimeSlot,
} from './session.ts'

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
  welcome_markdown: '# Welcome!',
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
    answers: [anAnswer],
    status: 'pending',
    applicant_name: 'Someone',
    applicant_contact: 'someone@example.org',
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
    applicant_contact: 'someone@example.org',
    answers: { [OTHER_ID]: 'because it sounds wonderful' },
  }

  it('accepts answers keyed by question id', () => {
    expect(applicationCreateSchema.safeParse(aSubmission).success).toBe(true)
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
  }

  it('accepts a person with their allergies recorded once', () => {
    expect(profileSchema.safeParse(aProfile).success).toBe(true)
  })

  it('accepts a person who has not said anything about allergies', () => {
    expect(profileSchema.safeParse({ ...aProfile, allergies_notes: null }).success).toBe(true)
  })

  it('requires a name and a contact, since an organiser has to reach them', () => {
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
    // that an organiser can count who is sleeping where, which a typed-in string
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
    host_account_id: ID,
    description: 'Bring a cup.',
    time_slot_start: '2026-10-03T09:00:00Z',
    time_slot_end: '2026-10-03T10:30:00Z',
    place_id: OTHER_ID,
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
      host_account_id: ID,
      description: '',
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
      host_account_id: ID,
      allergies_notes: 'gluten',
    })
    expect(parsed).not.toHaveProperty('host_account_id')
    expect(parsed).not.toHaveProperty('allergies_notes')
  })
})
