import { describe, expect, it } from 'vitest'

import { applicationSchema } from './application.ts'
import { slugSchema } from './common.ts'
import { eventFields, eventSchema, withEventDateOrder } from './event.ts'
import { formQuestionSchema } from './form-question.ts'
import { memberFields, memberSchema, withMemberStayOrder } from './member.ts'
import {
  publicSessionFields,
  publicSessionSchema,
  sessionFields,
  sessionSchema,
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
    const parsed = eventSchema.safeParse({ ...anEvent, start_date: '2026-10-02', end_date: '2026-10-02' })
    expect(parsed.success).toBe(true)
  })

  it('rejects an event that ends before it starts', () => {
    const parsed = eventSchema.safeParse({ ...anEvent, start_date: '2026-10-04', end_date: '2026-10-02' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['end_date'])
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
  const anApplication = {
    id: ID,
    event_id: OTHER_ID,
    answers: { [OTHER_ID]: 'because it sounds wonderful' },
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
    const answers = { [ID]: 'a long answer', [OTHER_ID]: true }
    expect(applicationSchema.safeParse({ ...anApplication, answers }).success).toBe(true)
  })

  it('rejects answers keyed by something that is not a question id', () => {
    const answers = { 'not-a-uuid': 'value' }
    expect(applicationSchema.safeParse({ ...anApplication, answers }).success).toBe(false)
  })
})

describe('memberSchema', () => {
  const aMember = {
    id: ID,
    event_id: OTHER_ID,
    account_id: ID,
    name: 'Someone',
    contact: 'someone@example.org',
    allergies_notes: 'gluten. Sensitive to red lentils.',
    arrival_date: '2026-10-02',
    departure_date: '2026-10-04',
    lodging: 'My own (tent/van/...)',
    shift_preference: 'Either/both',
    notes: null,
    payment_status: 'paid',
    payment_date: '2026-09-01',
    invite_token_id: OTHER_ID,
  }

  it('accepts a fully filled member', () => {
    expect(memberSchema.safeParse(aMember).success).toBe(true)
  })

  it('accepts a member who has not yet decided anything but is invited', () => {
    const sparse = {
      ...aMember,
      allergies_notes: null,
      arrival_date: null,
      departure_date: null,
      lodging: null,
      shift_preference: null,
      payment_status: 'unpaid',
      payment_date: null,
    }
    expect(memberSchema.safeParse(sparse).success).toBe(true)
  })

  it('takes lodging and shift preference as free text, so new options need no deploy', () => {
    const novel = { ...aMember, lodging: 'Hammock in the barn', shift_preference: 'Sauna tending' }
    expect(memberSchema.safeParse(novel).success).toBe(true)
  })

  it('rejects a payment status outside the vocabulary', () => {
    expect(memberSchema.safeParse({ ...aMember, payment_status: 'refunded' }).success).toBe(false)
  })

  it('rejects a departure before the arrival, so no one records a negative stay', () => {
    const backwards = { ...aMember, arrival_date: '2026-10-04', departure_date: '2026-10-02' }
    const parsed = memberSchema.safeParse(backwards)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['departure_date'])
  })

  it('accepts arriving and departing on the same day', () => {
    const dayTrip = { ...aMember, arrival_date: '2026-10-03', departure_date: '2026-10-03' }
    expect(memberSchema.safeParse(dayTrip).success).toBe(true)
  })

  it('does not compare dates when only one end is known', () => {
    expect(memberSchema.safeParse({ ...aMember, departure_date: null }).success).toBe(true)
    expect(memberSchema.safeParse({ ...aMember, arrival_date: null }).success).toBe(true)
  })
})

describe('optionalText', () => {
  const aMemberWith = (notes: unknown) => ({
    id: ID,
    event_id: OTHER_ID,
    account_id: ID,
    name: 'Someone',
    contact: 'someone@example.org',
    allergies_notes: null,
    arrival_date: null,
    departure_date: null,
    lodging: null,
    shift_preference: null,
    notes,
    payment_status: 'unpaid',
    payment_date: null,
    invite_token_id: OTHER_ID,
  })

  it('collapses empty and whitespace-only input to null, so "not set" has one representation', () => {
    for (const blank of ['', '   ', '\t\n']) {
      const parsed = memberSchema.parse(aMemberWith(blank))
      expect(parsed.notes).toBeNull()
    }
  })

  it('keeps real text, trimmed', () => {
    expect(memberSchema.parse(aMemberWith('  bring a drum  ')).notes).toBe('bring a drum')
  })

  it('still accepts an explicit null', () => {
    expect(memberSchema.parse(aMemberWith(null)).notes).toBeNull()
  })
})

describe('sessionSchema', () => {
  const aSession = {
    id: ID,
    event_id: OTHER_ID,
    title: 'Cacao ceremony',
    host_member_id: ID,
    description: 'Bring a cup.',
    time_slot_start: '2026-10-03T09:00:00Z',
    time_slot_end: '2026-10-03T10:30:00Z',
    location: 'Temple',
  }

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

  it('derives a member patch body that still enforces the stay order', () => {
    const patchMember = withMemberStayOrder(memberFields.partial())
    expect(patchMember.safeParse({ notes: 'just this one field' }).success).toBe(true)

    const backwards = { arrival_date: '2026-10-04', departure_date: '2026-10-02' }
    expect(patchMember.safeParse(backwards).success).toBe(false)
    expect(memberFields.partial().safeParse(backwards).success).toBe(true)
  })

  it('derives a session create body that still enforces the time slot rules', () => {
    const createSession = withValidTimeSlot(sessionFields.omit({ id: true }))

    const halfASlot = {
      event_id: OTHER_ID,
      title: 'Cacao ceremony',
      host_member_id: ID,
      description: '',
      time_slot_start: '2026-10-03T10:00:00Z',
      time_slot_end: null,
      location: null,
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
      host_member_id: ID,
      allergies_notes: 'gluten',
    })
    expect(parsed).not.toHaveProperty('host_member_id')
    expect(parsed).not.toHaveProperty('allergies_notes')
  })
})
