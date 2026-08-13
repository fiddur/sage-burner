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

## A meeting is a time, and a conversation about it

`meeting` is a title, a start, an optional end, an optional link and a note: what the next-meeting
banner reads, what the calendar feed carries, and — since #597 — what a feed card is about. "Next"
is derived rather than stored, so nothing has to be moved when one passes.

It had no thread for a day, on the reasoning that a meeting is scheduled rather than discussed.
That was wrong in the way that mattered: the discussion a meeting needs is _whether that time
works_, and there was nowhere to say it.

**Derived from the end, not the start.** A meeting people are joining as it runs is exactly when
the link is wanted, so it stays the next meeting until it has finished — dropping it the moment it
began would take the banner away at 19:00 for a call at 19:00.

**An end nobody gave means an hour**, and `meetingEnds` is the one place that says so, read by the
banner through `nextMeeting` and by the feed directly. Stored as null rather than filled in on the
way in, so changing the default later moves every meeting that never had one.

**The link is https or nothing.** It is member-authored and it lands in an `href` that somebody
else's browser follows, which is the same shape as a song link or a profile URL — so it takes the
same `isProfileUrl` refusal. A `javascript:` link in an `href` is stored script, not a bad link.

**A card, like everything else on the feed** (#597). It was a line for a day: an `activity` row
rendered with the pre-#480 chip, so a meeting was the one thing on the feed nobody could reply to —
backwards for the thing most likely to need _I can't make that time_. `meeting` is the seventh
`ThreadEntityType` now, so it gets comments, hearts, follow and the card bell for free, and there is
no line beside it, which would put one thing on the feed twice.

The entry kind is `scheduled`, which already existed for a dream being put in the timetable and
already coalesces — so a meeting moved three times is one line saying it moved, not four. Moving it
bumps the card; rewording the note does not, because a time that has changed is the half worth
hearing. Renaming it renames the thread, so the card cannot go on showing the old title.

`meeting.author_account_id` was added for this: a card says whose it is, and `participantsOf` needs
somebody to tell when a reply lands. Rows written before it keep a null one, exactly as a post whose
author has left does.

**Taking one out takes its card with it** (#608). A meeting and a talking point are the only
thread-carrying things deleted outright: a post, a song and a bring item are all withdrawn, which is
why their tombstone card is deliberate and the conversation under it survives. `thread` is
polymorphic — `entity_type` and `entity_id`, no foreign key — so nothing cascades, and the card
outlived the meeting until the delete started removing the thread in the same transaction.
`thread_entry`, `thread_support` and `thread_follow` all cascade from `thread`, so that is the whole
cleanup.

**One at a time in the banner.** The next meeting is where it is edited and where it is taken out
of the diary, because that is the one anybody is looking at; everything else is a line under it.
Meetings that have already been sit in a list of their own rather than mixed into the ones still
ahead — a diary reads forwards.

## In the calendar feed

Meetings become `VEVENT`s beside the dreams in `GET /calendar/:token/schedule.ics`, through
their own allowlist: `publicMeetingSchema`, key set pinned in `schemas.test.ts` the way
`publicSessionSchema`'s is. `SUMMARY` is the title, `DTSTART`/`DTEND` the run, `DESCRIPTION` the
joining link.

**The notes stay off it.** The feed is readable by whoever holds the address — that is what a
calendar subscription is — and the note is where somebody writes the door code. The link is on
it because a meeting invitation without one is a reminder to go and look somewhere else, and the
feed already exposes session details on the same reasoning.
