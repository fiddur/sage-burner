# The schedule

Meals, dreams, the lead roles register, and the places they all happen in.

What is _not_ here: applying and invites are in [accounts.md](./accounts.md), and
coming to a burn is in [burns.md](./burns.md). Both sat under `## Places` in the old
README, mis-nested, and reading this file is how that was found.

[← back to the README](../README.md)

## Meals

Who cooks, who helps and who washes up — the spreadsheet's Meal tab (#210).

**`meal_slot` is a template, `meal` is a sitting.** An admin sets the times once
per burn — Lunch 13:00, Dinner 18:00, and for some burns a Morning cleanup at 09:00,
which is why a slot carries a **kind**. Generating from those writes the rows.

**Generated, not derived**, and that was reversed mid-build. Deriving each sitting
from its slot means nothing to keep in sync — and means every sitting is identical to
its template forever: no postponing Saturday's dinner, no dropping lunch on the day
everybody leaves, no adding a late supper. Each would have needed an exceptions table,
which is worse than the rows it would be excepting.

Generating **adds what is missing and touches nothing else**, so it is safe to press
again after adding a slot or moving the dates. It **never removes** one: somebody may
already have signed up to cook it. A sitting already exists when the burn has one that
day with that name, which a unique index says too — so a sitting moved to another
**time** stays put when generating runs again.

Moved to another **day** it does not, and that follows from the same rule rather than
working around it: dragging Saturday's dinner to Sunday leaves Saturday without one,
and the slot still says Saturday has a dinner, so the next run makes it. Recognising a
sitting wherever it went would mean carrying the slot id on the meal — the link back
that "copied with no link back" below deliberately does without.

The slot's values are **copied with no link back**. Renaming a slot leaves what it has
already made alone, the same call the repeatable dream makes about its copies.

**Which days a sitting falls on comes from the burn's hours, not its days.** A 13:00
lunch on a day the gates open at 16:00 is not a meal anyone eats, and a day that ends
at noon has no dinner — which is why the spreadsheet's own plan starts at a Sunday
dinner and ends at a Sunday lunch.

### The table itself

Five columns — **Meal**, **Food**, **Lead**, **Help**, **Cleanup** (#286). The day and
the time share the first, the day short (`Sat 1`) and only on the first sitting of it,
the way the spreadsheet merged those cells; the sitting's own name sits above the food
idea in the second. It was six, with _When_ and _Meal_ saying one thing between them
and _Meal_ and _Food idea_ saying another, which is one column too many for a phone.

**It scrolls itself**, with a sticky header, exactly as the grid does: five columns of
crew lists run past the bottom of a phone, and scrolling to the last of them used to
take the page along and leave the header names behind. That is also why the borders
are `separate` — a collapsed border belongs to the table, so it scrolls out from under
a stuck header and leaves it hanging with no line beneath it.

### Who may do what

Any approved member takes a lead, hands one over, stands for the helpers or the
cleanup crew, writes a food idea, moves a sitting or renames it, and rewrites the
words above the table. This replaces a tab everyone could edit, and the lead-roles
register made the same call.

**Adding and dropping a sitting stay admin's**, under `/api/admin/`: those decide
whether people get fed. Moving one does not, because the schedule is the members' to
arrange (#20) — a meal you could see in the grid but not nudge would be the one block
on it nobody could touch.

Roles reference an `attendance`, so only somebody coming can be on one and withdrawing
takes them off everything. One lead per sitting, which a partial unique index enforces;
the other two are unbounded, because nothing runs out of people willing to wash up.

### The kitchen is not a place

It is a lane the schedule draws itself, from the meals. So **nothing but cooking,
fetching food and washing up can be put in it** — a dream dropped there does not land,
and a meal dropped in an ordinary lane does not either. A burn with no meals gets no
column at all, which is also the on/off switch: there is no setting.

Each sitting draws three blocks — two hours cooking, the hour of eating, the hour
washing up. A `chore` draws one hour of itself, because cooking for a morning cleanup
is nonsense.

**Dragging any block moves the meal, and the block lands where it was dropped**: pull
the cooking block to 12:00 and the meal is at 14:00. **There is no resize handle** —
the three blocks come from one time, so there is nothing to make longer; changing the
length would mean changing what "cooking" means.

## Dreams

The workshops, ceremonies and happenings members offer each other. **A dream with
no time slot is offered but not yet scheduled** — that is where most of them sit
right up until the burn, and it is the normal state, not an error.

**Anyone who is in.** `/api/events/:eventId/sessions` and `/api/sessions/:id` are
behind `requireApproved`, because the schedule belongs to the people coming: any
member may reschedule any dream, not only the one who offered it. Gated on a role
rather than on having an `attendance` row, so someone can help plan next burn's
programme before they have said they are coming.

`requireApproved` rather than `requireMember` since #200. The two roles are
independent, so an organiser can hold `admin` without `member` — and `getMyBurns` is
`requireApproved`, so that account gets a working burn selector and then found every
page it chose a burn for turning it away, while the lanes, the register and the
options beside them were open. Putting a hand up still needs an `attendance` at that
burn: the checks behind the guard answer that with a **400**, which is a different
sentence from "you are not welcome here".

The **facilitator** is who runs it, and is **assignable** (#198). It was
`host_account_id` — whoever wrote the dream down, taken from the session and refused
in the body, so that a dream in someone else's name was a 400 rather than an edit
anyone could make by hand. Offering something for another member to run is exactly
that edit, and it is what was wanted, so the field was renamed and opened.

It is **nullable**: a dream can be offered before anyone has said they will run it,
which is how most of them start. Whoever is named must be **coming to this burn** —
the same rule the lead-roles register applies to a lead, and the same picker feed,
`GET /api/events/:eventId/attendees`. A 400 rather than a 404: the account exists,
the pairing is what is wrong.

Since #23 the **column is an `attendance`**, `facilitator_attendance_id`, with
`ON DELETE SET NULL`. Leaving a burn takes you off everything you signed up for
there; every other role already held that by foreign key, and the facilitator was
the one exception — the old column named an `account` and its comment said a
withdrawal "leaves the name here for somebody to notice", which #247's take-it
control made unnecessary. The wire field is still `facilitator_account_id`: every
reader wants the person, so `dreamColumns` in `sessions.ts` joins back through
`attendance` and is the only place that knows the difference.

The rename was a table rebuild rather than `ALTER TABLE … RENAME COLUMN`, because the
column also lost `NOT NULL` and SQLite cannot drop a constraint in place. Every
existing row carried its host across — there was no way to name anyone else, so that
person was in practice the one expected to run it.

The schedule shows the facilitator as the initials circle, with the name on hover and
read aloud; nothing at all when nobody has been handed it, since an empty circle would
read as somebody whose name is missing.

### A dream that can be planned more than once

The check-in happens every morning and circling twice in a weekend is ordinary, so
`repeatable` is a flag on the dream (#198). Dropping a repeatable dream into the grid
writes a **copy** and leaves the original in "Not placed yet"; the copy has the flag
**off**, or dragging it afterwards would stamp again. One entry then becomes four
mornings, each with its own time, place, facilitator and description to edit.

A flag rather than a recurrence rule, and no back-reference to what a copy came from.
A different facilitator on Sunday than on Saturday is the point of copying rather than
repeating, and a parent link would only be something to keep consistent.

A dream toggled repeatable _after_ it was scheduled is asymmetric, and deliberately:
dragged within the grid it stamps a copy and the original stays put, while dragged to
the pool it unschedules the original rather than copying. Both follow from the two
rules above, and neither is reachable by the ordinary flow, since copies are created
with the flag off.

**The copying is the page's, not the API's.** Nothing server-side treats the flag
specially — placing, moving and unplacing a dream are all one `PATCH`, so a server
that copied on write would first have to decide which of those a given body is. The
pool therefore does not empty as things are planned in, which is expected: the last
repeatable dream is withdrawn by hand once it has been planned in everywhere.

Chips carry a ↻, in the pool and on the Dreams list, so it is visible which ones
behave that way before anyone drags one.

### Helpers, and the ❤️‍🔥

Two tables, `session_helper` and `session_support`, both keyed on `attendance`
rather than `account` — the same reason a lead role's team is. Only somebody coming
can carry the cushions, and withdrawing from the burn takes their offers of help and
their hearts with them rather than leaving names nobody can reach.

**The support count is not a column.** A row per person makes the primary key the
whole "one heart each" rule, so a double click cannot inflate it and nothing can
drift. The number is derived on every read, and `supported_by_me` is the _reader's_
answer — one dream reads differently to two people, which is what makes a filled
heart mean "mine" rather than "somebody's".

Four routes, all `/me`: `POST`/`DELETE` on `/api/sessions/:id/helpers/me` and
`/api/sessions/:id/support/me`. The caller speaks for themselves; signing somebody
else up for work is what the lead-roles register is for, and it asks first. Each is
idempotent, and each answers with the dream as it now stands.

A caller who is not coming to that burn gets a **400**, not a 403: they may be a
member in good standing, and the pairing is what is wrong. A dream at a burn that
has ended is a 404, like every other member-facing write here.

`helpers` carries account ids, so whether the reader is on the list is derived from
it; `supported_by_me` exists because the supporters are a count and nothing more. A
`helping_me` beside the list would be a second thing to keep true.

### Clicking a chip

Clicking a dream opens a panel over the grid: when and where, the description as
markdown, the ❤️‍🔥, and two 🙋/👉 strips — one for whoever is facilitating, one for
the helpers. It edits and withdraws too, and the Dreams page opens this
same panel (#342) rather than a form of its own — see below.

**A drag leaves a click behind, and that click is not a click** — Google Calendar's
rule. A ref is set on `dragstart` and cleared on `mousedown`, so the click ending a
drag is swallowed and the next real press opens as usual. `dragend` would not do:
it fires _before_ any click, so a flag cleared there is already false by the time the
click arrives.

Not a `<dialog>`: `showModal` is an imperative call on a ref, and the focus trap it
brings is then a second thing to keep in step with the component's own open state.
`role="dialog"` with `aria-modal` says the same to a screen reader, and Escape and
the backdrop are the two ways out people reach for. A click on the panel stops
there — without that, reading the description would close the thing you opened to
read it.

**While the edit form is open they go back one step first** (#207): the first press
leaves the form and the second closes the panel. With nothing to go back to the first
press closes, because reading a dream and pressing Escape is the common case and a
press that did nothing would be worse than what it guards. The panel for _offering_ a
dream has no step of its own, so Escape there still closes it — the one place a stray
press still costs typing.

The heart is on the chip as well as in the panel, placed or not: something can want
support long before anybody has decided when it happens. Its click is stopped at the
button, or every heart would also open the panel.

Escape is bound on the **document**, not on the panel. Clicking anything in the panel
disables it for the length of the write, and a disabled button drops focus to
`<body>` — so a handler waiting for the key to bubble up from inside stopped hearing
it after the first thing you did, which is when you most want it.

### Everything a dream needs, without leaving the grid

The panel edits and withdraws as well as reads. **✏️** swaps in `DreamFields`, and
**🗑️** withdraws behind a confirmation, for scheduled and unscheduled dreams alike.

**The Dreams page opens this same panel** (#342), through `OpenedDream` — the state,
the writes and the markup are one thing rather than two. It used to swap a row for an
edit form of its own, so a dream had two ways to be read and two to be edited, and
only this one had #205's "keep what was typed when the save is refused" and #207's
two-step Escape. The list showed a title, a time and a place: the description, the
supporters and both helper strips were reachable only from the grid, and the row's own
✏️ and 🗑️ wrapped onto a third line on a phone, under a title they no longer sat
beside. The row is a single button that opens the panel now, and withdrawing is inside
it — one confirmation, `WithdrawDream`, so the same act cannot end up guarded on one
page and not the other (#209).

**Facilitating is a 🙋/👉 strip like every other job** (#283), not a field only the
edit form could reach. One person holds it, so a filled spot offers only ✕ and a
handover is unassign then assign — two steps, and each tells the person it happened
to. Never the person who clicked.

Offering one has two ways in: **＋** beside "Not placed yet", and **clicking an empty
hour**, which prefills that slot and that lane the way a calendar does. Only an
_empty_ cell — a chip's click bubbles to the cell it sits in, so without the check
opening a dream would also open the offer panel on top of it.

**A create sends every field; an edit sends only what changed.** The diff exists to
protect a concurrent editor's work, and a dream that does not exist yet has none to
protect — while a slot prefilled from the clicked cell would be diffed away as
unchanged and the new dream would land nowhere.

**Every write closes the panel only once it has landed**, never on the click. Closing
on the click threw away everything the member had typed whenever the server said no,
and that is an ordinary path rather than a corner: filling _Starts_ and leaving _Ends_
empty is half a slot, which the schema refuses with a 400. The failure is shown
**inside** the panel, because `.dream-modal` is a fixed overlay and the page's own
error renders under it; the page suppresses its copy while a panel is open, so the
message is never announced twice.

### Pinching it

Two fingers on the grid scale it, on a touch screen only (#284). **One factor for
both axes**, not a guess at which direction the pinch meant: fingers apart make the
hours taller and the lanes wider, fingers together squeeze a burn with more places
than a phone is wide until they all fit — accepting that very little text will.

The CSS is where that lands. `--zoom` multiplies `.schedule-cell`'s height and the
`min-width` the lanes are floored at, so one number moves both and nothing measures
anything. Zooming out stops narrowing the lanes once they all fit, because the table
is `width: 100%` and a `min-width` below that changes nothing — the right floor, and
the hours go on shrinking past it.

`touch-action: pan-x pan-y` on the wrapper is what makes the gesture reachable: it
leaves one finger scrolling and takes the browser's own pinch-zoom off this box only.
**A desktop pointer is untouched** — there is no wheel handler, so ctrl+wheel stays
the browser's page zoom, which is what the issue asked for.

The zoom is not remembered between visits. It is a gesture for reading the grid the
way you want it now, and one restored from last time would greet somebody with a
timetable they do not remember setting.

The arithmetic is `pinch.ts`, apart from the event wiring, so what a pinch _means_ is
tested without a `TouchEvent`: measured from the gap at `touchstart` rather than
accumulated per move, so letting go and pinching again from the same place lands
where it was.

### Pulling the bottom edge

A placed chip carries a handle on its bottom edge. Dragging it changes the length in
**whole hours** — a row is an hour, so a grid cannot show a dream finishing at 20:40
and must not let anyone set one from here. The Dreams form is where a
minute-precision end is typed. A dream never goes under the hour it already is: it
has to occupy the row it starts in.

The row height is measured off the anchor cell, which spans `rowspan` rows, rather
than read from a number the CSS and the component would both have to hold.

**Arrow keys do the same thing**, one hour at a time, exactly as ⠿ on the Places
page does for reordering: a resize nobody can do without a mouse is one half the
people here cannot do.

`draggable` is on the chip, so grabbing the handle would otherwise pick the whole
dream up and drop it in whichever lane the pointer ended over. `dragstart` is
cancelled while the handle is held.

**The pointer half is not unit-tested and cannot be.** happy-dom computes no layout,
so every row measures nought pixels tall — `rowsDragged` and `resizedEnd` are pure
and carry the arithmetic, the keyboard path is tested through the page, and the drag
itself wants one click-through in a browser. The guard against dragging the dream
away is asserted through the drop it would cause, since the `dragstart` that
testing-library builds is not cancelable and its return value says nothing.

`session.location` was free text; it is now `place_id`, referencing #78's places.
The scheduling grid draws one column per place, and a column cannot be spelled
three ways. The column has no `onDelete`, so **deleting a place a dream stands in
is refused with a 409** rather than quietly unscheduling it; `places.ts`
translates the foreign key failure. Not a pre-read, which would be check-then-act
— the dream can be created between the read and the delete.

### The slot rule, applied to the row as it would be

A slot is both ends or neither, and the end comes after the start.
`withValidTimeSlot` enforces both at the boundary whenever both keys are present.
A PATCH carrying **one** end cannot be judged on its own, so the handler reads the
row, merges the update onto it, and runs `hasValidTimeSlot` — the same rule, one
copy of it.

Deliberately **not** composed into the `UPDATE`'s `WHERE`, unlike
`stayOrderCondition` in `profile.ts`.
Those compare calendar dates, which are fixed-width `YYYY-MM-DD` and so sort
correctly as SQL strings. These are ISO **instants**, where
`'…T09:00:00.500Z' < '…T09:00:00Z'` is true lexicographically — a string
comparison would accept a slot ending half a second before it starts. Reading the
row and comparing with `Date.parse` is both simpler and the only sound option.

Two bugs lived here, and both were single-user, no concurrency needed:

- `hasWholeSlot` used `== null`, so an **absent** key read the same as a null one
  and every single-ended reschedule was a 400 before the row was consulted. An
  absent key now defers to the merged-row check, exactly as
  `violatesTickBoxRules` already did for the tick-box pair.
- The first attempt at the merged rule only checked that the _other_ end existed,
  never that the two were in order — so `PATCH { time_slot_start: '23:00' }` on an
  18:00–20:00 dream stored an inverted slot and answered 200.

### Editing is scoped to the burn that is open

`PATCH` and `DELETE` take a session id, and both check that the dream belongs to
the active event, the way every other member-facing route does. A finished burn's
programme is history; an id noted while it was current is not a way to rewrite
it.

### Editing sends only what changed

The edit form seeds its state once, at mount. Sending all five fields back would
carry the values it loaded — so fixing a typo in a title would put the place and
slot back as they were then, undoing whatever another member scheduled in the
meantime. Concurrent editing is the _premise_ of this page, so that is the
ordinary case rather than a rare one. The form sends only the fields it changed, which
`sessionUpdateSchema`'s `.partial()` already accepts. An untouched save sends
`{}`, the documented no-op read.

Each field is compared **in the form's own units**. Comparing a round-tripped
timestamp against the stored one instead calls an untouched slot changed whenever
the stored value carries seconds — the inputs are minute-precision — and quietly
zeroes them.

This is not optimistic locking and does not pretend to be: two members editing
the same _field_ still last-writer-wins. It removes the case where they edit
different fields and one loses anyway.

### The timetable

`/schedule` draws places across and hours down, over **the hours the burn is
actually open** — `start_date`/`start_time` through `end_date`/`end_time`. A burn
that opens midday Friday and closes midday Sunday is 49 rows, not three whole
days of mostly-empty grid.

Those hours are the admin's, set on the event form beside the dates. They
replaced a guess: the grid used to run 00:00 on the first day through the last
hour of the day _after_ `end_date`, the extra day being a stand-in for a last
night that carries past midnight. An admin who can say "ends 04:00 on the
6th" does not need the app inventing anything.

Rows are walked by adding an hour to an instant rather than by setting hours on a
date, which also disposed of a bug: on the spring-forward day `setHours(2)` lands
on 03:00, so 03:00 appeared twice and two rows shared a key. Crossing the gap by
addition passes it exactly once, and the deduplication that used to paper over it
is gone.

Editing an event reads the row, merges the patch onto it, and checks the result.
A body carrying one date — or only a time — cannot be judged on its own: a
multi-day burn may legitimately run 22:00 to 10:00, and narrowing it to a single
day makes that pair invalid without the body saying anything. The condition this
replaced was composed into the `UPDATE ... WHERE`, which handled one date against
the stored other but could not see the times at all, so those patches reached the
database and came back as a **500** from `event_date_order_check`.

The times are `HH:MM`, fixed width, and both Zod and a CHECK compare them as
strings — sound only because `09:00` cannot also arrive as `9:00`, which is why
the format is enforced in both places. The ordering rule compares the **pair**:
times decide it only when the days are equal, since across days an end earlier on
the clock than the start is the ordinary case.

**A dream occupies every row it runs through**, via `rowSpan`. Drawn only in its
start row, a three-hour session reads as an hour long — which is exactly how one
was misread. The rows underneath must then render no cell at all, or the whole
column shifts sideways; `laneCells` returns `covered` for those. Two dreams
starting in the same hour share a cell, and one starting inside another's block
joins it rather than disappearing, because an overlap in one lane is an
admin's mistake to see.

Each chip also carries its own `18:00–21:00`, so the length is readable without
counting rows.

The page opts out of the site's reading measure — `--measure` is a width for
prose and squeezes a timetable into a sliver on a wide screen. **That one is not
covered by a test**: the suite renders in happy-dom, which applies no CSS, so
nothing here can tell a styled grid from an unstyled one.

**The pool holds whatever the grid does not draw**, derived rather than guessed.
Missing a time or a place is the common case, but a dream can also be timed
outside the days on show, and guessing "unplaced means a null field" left that one
in neither the grid nor the pool — gone from the page while still fine on
`/dreams`. Deriving it means nothing can vanish whatever the date.

The grid runs from the burn's own `start_time` to its `end_time`, so an admin
who says midday Friday to midday Sunday gets 49 rows rather than three whole days.
A burn whose last night carries into the small hours says so by ending at 02:00 on
the day after, which is a date the admin types rather than a day the grid adds.

Dragging an already-scheduled dream to another lane **keeps the length it had**.
Forcing an hour would quietly shorten a two-hour session for the crime of being
moved.

Both drag sources write to `dataTransfer` on `dragstart`. The id travels in
component state, so nothing reads it back — but Firefox refuses to begin a drag
whose data store was never written to, so without it the gesture simply does not
start there. Test it in Firefox as well as Chrome.

**Dragging is not really unit-tested, and cannot be.** `fireEvent.drop` exercises
these handlers, not a browser's drag implementation — so the tests prove the
wiring and the drag itself wants one click-through in a browser. The panel is the
precise route and the accessible one — from either page: a place and two datetime
fields, reachable by keyboard, which is what anyone who cannot drag should use.

### Times are UTC, wall clocks are not

The API stores and transports UTC; `<input type="datetime-local">` has no timezone
at all and speaks the browser's wall clock. `apps/web/src/datetime.ts` converts
both ways. Slicing the ISO string is the obvious-looking shortcut and is wrong by
the UTC offset everywhere but London in winter.

The web suite is pinned to `Europe/Stockholm` in `vite.config.ts` for exactly this
reason: **in UTC every wrong implementation of that conversion looks right**, so
running the suite in UTC would silently stop testing it. Verified — with the pin,
the slicing shortcut fails whatever the ambient `TZ`; without it, it passes in CI.

## Roles

The spreadsheet's roles tab: who is looking after what at this burn. `/roles`,
open to any approved member.

A role carries a title, a **purpose** and a **tasks include** — both markdown,
like every longer field shown to other people — three independent effort answers
for before, during and after, and a **wanted team size**. It has one lead and may
be vacant, and one person may lead several roles and be on several teams.

**Any approved member may add, edit and remove any role, staffed or not.** This is
a deliberate divergence from every other structural edit here, which is admin's:
the events are co-created, and at forty-odd people trust is the mechanism rather
than a permission table. There is no undo, which is the accepted cost — the page
asks before removing, and the removal takes the team's sign-ups with it.

**The wanted team size is advisory and the API never enforces it.** The page shows
"2 of 4 wanted" and still offers "join the team" at 4 of 4. That is the opposite of
the lodging list, which disables a full option, and the difference is the point: a
bed is finite and a pair of hands is not.

The lead and the team reference **`attendance`, not `account`**, so only somebody
coming to that burn can hold something in its register, and withdrawing vacates
the role and drops the team membership through the foreign keys rather than through
a cleanup somebody has to remember. The role itself stays, vacant. Handing a role
to an account with no attendance on that burn is a **400** rather than a 404 — the
account exists, it is the pairing that is wrong.

Names are resolved at read time from `account`, never copied into the register: a
name corrected on the profile page is corrected here too.

### One table, at every width

The register used to become a card per role below 60rem, which turned six short
cells into a column of labelled paragraphs — a page you scrolled for a minute to
read what a screen and a half of table says. It is one table now (#307), scrolling
sideways on a phone like the meal plan and the grid, with the role's name held
still on the left so you always know whose row you are in.

Two compactions paid for that:

- **The three effort answers are one cell.** They had a column each — three
  headings of two words for one word of content, wider between them than both prose
  columns together. Now an icon per phase (🌱 before, 🔥 during, 🧹 after) and a
  three-segment bar for how much. The words are still in the `title`, for a screen
  reader, and — since #317 — in a one-line legend above the table, which is the only one
  of the three a sighted touch user gets: a hover needs a pointer and
  `.visually-hidden` needs a screen reader, so on the device this compaction was for,
  🌱🔥🧹 sat under a heading reading only "Effort". Above the table rather than under it,
  and outside the wrapper that scrolls sideways, or it would slide out of view with the
  columns it explains. A register nobody can read is not compact, it is broken. An unfilled bar stays drawn, because "none" has to look like
  an answer somebody gave rather than a cell nobody filled in.
- **The lead and the team share a column.** They are one question — who is on this —
  and side by side they cost the width of two. They sit side by side _inside_ the
  cell where there is room and stack where there is not, so a desktop row is no
  taller than it was. Each half names itself now that the shared header cannot.

### Seeding a new burn from a previous one

Fifteen roles retyped four times a year is the friction worth removing.
`POST /api/events/:eventId/roles/copy` takes a `from_event_id` and brings the
definitions — titles, purpose, tasks, effort, team sizes — and **none of the
people**: who led the sauna last summer is a fact about last summer.

It answers **409** when this register already has roles. Merging two registers is a
decision nobody asked for, and "copy into empty" is the case that removes the
retyping. The page offers the control only while the register is empty, for the
same reason.

`GET /api/events/:eventId/roles/sources` is what fills that picker: the other burns
that already have a register, newest first, with their name and how many roles they
hold. It exists because `GET /api/admin/events` is admin-only and a member picking
a burn to copy from would otherwise have nothing to choose between. Only burns with
a register appear, and only their name — a burn's dates and cap stay admin's.

## Places

Somewhere a dream can happen — the Temple, the Sauna, the Front Lawn. Rows
rather than code, the same as the application questions: the site changes
between burns and adding a place must never need a redeploy. **One grid per
event**, seeded from a previous burn.

That was one central list until #156, on the reasoning that the venue outlives the
burn. Half right: the venue does, the set in use does not. Some spots are
summer-only and a large event tent is there some years and not others, so a global
list meant every schedule grid carried lanes that do not exist at this burn — and
the grid is the thing the list exists to build. The same shape `event_option`
already had for lodging and helping: definitions per burn, seeded rather than
retyped.

`/places`, for the burn the selector is pointing at — reached from Schedule, since
the lanes are what the grid draws, and from ⚙️.
A pencil edits, a trashcan removes, and the ⠿ handle
reorders — by dragging, and by ArrowUp/ArrowDown while it has focus. The handle
takes keys as well as drags because a reorder only a pointer can do is one some
people cannot do at all.

Each place carries an emoji and a colour, which is how a lane is recognised at a
glance in the scheduling grid (#20) and what the ICS feed will carry alongside
the location (#21).

The colour is a **name from a fixed palette** — `red`, `orange`, `yellow`,
`green`, `blue`, `purple`, `pink`, `grey` — not free hex. An admin who
picked `#fefefe` for a lane would produce unreadable text that nothing in the
app could correct, and naming the colour rather than valuing it lets light and
dark themes each choose their own shade. A CHECK generated from the same
vocabulary keeps the database from drifting.

The emoji is bounded but not pattern-matched. A ZWJ sequence such as 👩‍🚀 is
several code points and the set grows with every Unicode release, so a regex
would reject valid input on a schedule nobody could fix without a deploy.

`GET /api/events/:eventId/places` is **public**, like `/api/questions`: the ICS
feed publishes a session's location to anyone holding the link, so the list of
places is already public by design. Writes are open to any approved member — the
lanes are the burn's furniture, not admin's. Editing and deleting stay on
`/api/places/:id`, since an id already names one burn's lane.

**Every write needs the burn to be open — to have not ended yet** (#171). A
finished burn's grid is the record of what happened there, and an id noted while
that burn was current should not still be a way to rewrite it. The rule is "has
not ended" rather than "is the active burn", which is what the dreams routes use:
a lane is laid down per burn, and that is how a burn still months off gets its
grid set up, so scoping to the single soonest-ending burn would refuse the setup
the copy exists for. A burn ending _today_ is still open, so the last day is not
too late. All five writes are scoped the same way — closing only the two that
take a bare id would be an archive half shut. Reading is untouched, including
reading a finished grid in order to copy it forward.

`order` is the server's to assign, so `POST` refuses a caller that sends one —
otherwise two places could claim the same lane. `event_id` is refused for the same
kind of reason: the path already says which burn, and a body naming another would
be a second, disagreeing opinion. New places land after **this burn's** last row,
assigned inside a transaction so two simultaneous adds cannot both read it; each
burn therefore numbers from zero rather than continuing wherever the previous one
stopped. `PUT /api/events/:eventId/places/order` takes **every** place of that
burn exactly once; a partial list would renumber some rows and leave the rest on
stale positions, and an id from another burn is refused rather than allowed to
reach into a grid the request is not about. Deleting does not renumber the
survivors: `order` only has to sort, not be contiguous.

**A dream can only stand in its own burn's lane.** The foreign key cannot say
that — it only knows the place exists — so `sessions.ts` checks the pairing and
answers 400. Without it a dream could hold a lane the grid does not draw, and it
would vanish from the page while still holding a row.

### Seeding a grid from a previous burn

`POST /api/events/:eventId/places/copy` takes a `from_event_id` and brings the
lanes, **carrying their order** so the copied grid reads left to right the way the
burn it came from did. Never the dreams standing in them: which burn's Temple a
dream was in is a fact about that burn. It answers **409** into a grid that already
has lanes, and the page offers the control only while the grid is empty — merging
two grids is a decision nobody asked for. The _target_ has to be open; the source
does not, since copying forward out of a finished burn is the case it was built
for.

`GET /api/events/:eventId/places/sources` fills that picker, and
`GET /api/events/:eventId/roles/sources` is the same query for the roles register;
both go through `copySourcesFor`. It exists because `GET /api/admin/events` is
admin-only, so a member choosing a burn to copy from would otherwise have nothing
to choose between. Only burns that already hold something appear, and only their
name and count — a burn's dates and cap stay admin's.

### The migration

`place` gained `event_id NOT NULL`, and existing rows went to **the last created
event**, ordered by `created_at` — there was one event, and every row belonged to
it. `created_at` rather than `start_date` because "last created" is what was
decided, and it does not change meaning when somebody edits a burn's dates.

The SQL is hand-written, which is unusual here. drizzle-kit emits
`ALTER TABLE place ADD event_id text NOT NULL REFERENCES event(id)`, and SQLite
refuses that outright — _Cannot add a NOT NULL column with default value NULL_ —
with nowhere to put the backfill even if it did not. So it is the
create-copy-drop-rename rebuild, which is also what lets the foreign key carry
`on delete cascade`.

**With no event, the places are dropped.** The join selects nothing. That is the
right answer rather than a loss: no event means no `session` rows either, since
they reference one, so the places are unreferenced decoration — but it is worth
saying out loud, because "the migration deleted my lanes" is otherwise a surprise
on a fresh install that happened to seed places.

A data migration is only tested by running it over the old shape with rows in it,
so `db.integration.test.ts` stages a migrations folder holding everything up to but
excluding the rebuild, seeds through the old table, and then runs the full set. It
asserts the staged set does not contain the rebuild — a mistyped tag would stage
every migration and every one of those tests would pass while proving nothing.
