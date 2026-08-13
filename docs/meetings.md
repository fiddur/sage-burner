# Meetings

Replaces the spreadsheet's meeting tab — _Talking point / Details / By / Decisions_ — with a
burn-scoped page: what we need to talk about, when we are talking, and what was settled.

## A point is addressed when it has a decision

`meeting_point.decision` is the whole of it. There is no status column beside it, because a
status and a decision are two things that can disagree, and the one nobody updates is the
status. Clearing the decision reopens the point; that is not a special route, it is the same
`PUT /api/points/:id/decision` with `decision: null`, which is why the field is a value somebody
sends rather than one they may leave out.

`decided_note` is free text — "Planning call Oct 20", "settled in the thread" — and deliberately
not a foreign key to a meeting. The spreadsheet's own column was loose in exactly this way, and
half the decisions here are made between meetings.

## The discussion is the thread, not a column

A point raised is a feed card, the sixth `thread_entity_type`, so the conversation about it uses
the machinery every other card has: comments, @-mentions, hearts, follow, the card bell. Points
raised between meetings already got discussed in comment threads; this makes that the mechanism
rather than a workaround for it.

Two entry kinds carry it. `raised` is written when the point is created, so the card has
something in it from the start. `decided` is written when a decision is recorded, with the
decision as its body — so the feed shows _what was settled_, in the timeline of the discussion
that led to it, without anybody having to open the page.

**The column stays canonical.** The entry is a notification of a decision, not the decision. A
decision edited twice leaves two entries and one truth, which is the right way round: the
timeline is history and the column is now.

**No activity line.** The card is the feed presence when a point is raised and the `decided`
entry bumps it when it is addressed; a one-liner beside it would put one thing on the feed twice.

## Whose it is

Any approved member raises a point, schedules a meeting and records a decision — the
shared-furniture default. The agenda of a gathering is not an admin's to hold, and the app is
replacing a spreadsheet everyone could edit. What stays narrow is the same as everywhere: only
the author edits the wording of their own point, and the author or an admin takes it off.

Everything refuses a burn that has ended, through `openEventNow` — a decision recorded against
last summer is a typo, not an intention.

## Meetings are scheduled, not discussed

`meeting` has no thread. It is a title, a start, an optional end, an optional link and a note:
what the next-meeting banner reads and what the calendar feed carries. "Next" is derived rather
than stored, so nothing has to be moved when one passes.

**Derived from the end, not the start.** A meeting people are joining as it runs is exactly when
the link is wanted, so it stays the next meeting until it has finished — dropping it the moment it
began would take the banner away at 19:00 for a call at 19:00.

**An end nobody gave means an hour**, and `meetingEnds` is the one place that says so, read by the
banner through `nextMeeting` and by the feed directly. Stored as null rather than filled in on the
way in, so changing the default later moves every meeting that never had one.

**The link is https or nothing.** It is member-authored and it lands in an `href` that somebody
else's browser follows, which is the same shape as a song link or a profile URL — so it takes the
same `isProfileUrl` refusal. A `javascript:` link in an `href` is stored script, not a bad link.

## In the calendar feed

Meetings become `VEVENT`s beside the dreams in `GET /calendar/:token/schedule.ics`, through
their own allowlist: `publicMeetingSchema`, key set pinned in `schemas.test.ts` the way
`publicSessionSchema`'s is. `SUMMARY` is the title, `DTSTART`/`DTEND` the run, `DESCRIPTION` the
joining link.

**The notes stay off it.** The feed is readable by whoever holds the address — that is what a
calendar subscription is — and the note is where somebody writes the door code. The link is on
it because a meeting invitation without one is a reminder to go and look somewhere else, and the
feed already exposes session details on the same reasoning.
