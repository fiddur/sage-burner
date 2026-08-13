import { describe, expect, it } from 'vitest'

import { meetingEnds, nextMeeting } from './meetings.ts'

const aMeeting = (starts_at: string, ends_at: string | null = null) => ({ starts_at, ends_at })

describe('when a meeting ends', () => {
  it('runs an hour where nobody said', () => {
    expect(meetingEnds('2026-10-03T17:00:00.000Z', null)).toBe('2026-10-03T18:00:00.000Z')
  })

  it('keeps the end somebody did give', () => {
    expect(meetingEnds('2026-10-03T17:00:00.000Z', '2026-10-03T19:30:00.000Z')).toBe(
      '2026-10-03T19:30:00.000Z',
    )
  })
})

describe('which meeting is next', () => {
  it('is the soonest one still ahead', () => {
    const soonest = aMeeting('2026-10-03T17:00:00.000Z')

    expect(
      nextMeeting([aMeeting('2026-10-05T17:00:00.000Z'), soonest], new Date('2026-10-01T00:00:00.000Z')),
    ).toBe(soonest)
  })

  it('is the one happening right now, which is when the link is wanted', () => {
    const running = aMeeting('2026-10-03T17:00:00.000Z')

    expect(nextMeeting([running], new Date('2026-10-03T17:30:00.000Z'))).toBe(running)
  })

  it('lets one go once it has ended', () => {
    expect(
      nextMeeting([aMeeting('2026-10-03T17:00:00.000Z')], new Date('2026-10-03T18:30:00.000Z')),
    ).toBeUndefined()
  })

  it('reads the end somebody gave rather than the hour it assumes', () => {
    const long = aMeeting('2026-10-03T17:00:00.000Z', '2026-10-03T21:00:00.000Z')

    expect(nextMeeting([long], new Date('2026-10-03T19:00:00.000Z'))).toBe(long)
  })

  it('is nothing at all where the diary is empty', () => {
    expect(nextMeeting([], new Date('2026-10-03T19:00:00.000Z'))).toBeUndefined()
  })
})
