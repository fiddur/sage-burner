export const DEFAULT_MEETING_MINUTES = 60

/**
 * An end nobody gave, which the diary and the calendar feed must agree on: a meeting with no end
 * runs an hour. Stored as null rather than filled in on the way in, so lengthening the default
 * later moves every meeting that never had one.
 */
export const meetingEnds = (starts_at: string, ends_at: string | null): string =>
  ends_at ?? new Date(Date.parse(starts_at) + DEFAULT_MEETING_MINUTES * 60_000).toISOString()

/**
 * The one still to come, and the one happening right now: a meeting people are joining as it runs
 * is exactly when the link is wanted, so it stays until it has ended rather than until it starts.
 */
export const nextMeeting = <T extends { starts_at: string; ends_at: string | null }>(
  meetings: readonly T[],
  now: Date,
): T | undefined =>
  [...meetings]
    .sort((one, other) => one.starts_at.localeCompare(other.starts_at))
    .find((one) => Date.parse(meetingEnds(one.starts_at, one.ends_at)) > now.getTime())
