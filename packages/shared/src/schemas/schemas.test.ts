import { describe, expect, it } from 'vitest'

import { applicationSchema } from './application.ts'
import { slugSchema } from './common.ts'
import { eventSchema } from './event.ts'
import { formQuestionSchema } from './form-question.ts'
import { memberSchema } from './member.ts'
import { publicSessionSchema, sessionSchema } from './session.ts'

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
    event_id: OTHER_ID,
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
})

describe('publicSessionSchema', () => {
  it('carries no member identity, so the unauthenticated ICS feed cannot leak one', () => {
    const leaky = new Set(['host_member_id', 'event_id', 'contact', 'allergies_notes', 'payment_status'])
    for (const field of Object.keys(publicSessionSchema.shape)) {
      expect(leaky.has(field)).toBe(false)
    }
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
