export const DEFAULT_MEETING_MINUTES = 60

/**
 * An end nobody gave, which the diary and the calendar feed must agree on: a meeting with no end
 * runs an hour. Stored as null rather than filled in on the way in, so lengthening the default
 * later moves every meeting that never had one.
 */
export const meetingEnds = (starts_at: string, ends_at: string | null): string =>
  ends_at ?? new Date(Date.parse(starts_at) + DEFAULT_MEETING_MINUTES * 60_000).toISOString()

export const nextMeeting = <T extends { starts_at: string }>(
  meetings: readonly T[],
  now: Date,
): T | undefined =>
  [...meetings]
    .sort((one, other) => one.starts_at.localeCompare(other.starts_at))
    .find((one) => Date.parse(one.starts_at) >= now.getTime())
