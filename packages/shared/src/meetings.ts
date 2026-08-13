export const DEFAULT_MEETING_MINUTES = 60

export const meetingEnds = (starts_at: string, ends_at: string | null): string =>
  ends_at ?? new Date(Date.parse(starts_at) + DEFAULT_MEETING_MINUTES * 60_000).toISOString()

export const nextMeeting = <T extends { starts_at: string; ends_at: string | null }>(
  meetings: readonly T[],
  now: Date,
): T | undefined =>
  [...meetings]
    .sort((one, other) => one.starts_at.localeCompare(other.starts_at))
    .find((one) => Date.parse(meetingEnds(one.starts_at, one.ends_at)) > now.getTime())
