# The schedule

Meals, dreams, the lead roles register, and the places they all happen in.

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

**Members**, not admins. `/api/events/:eventId/sessions` and `/api/sessions/:id` are
behind `requireMember`, because the schedule belongs to the people coming: any
member may reschedule any dream, not only the one who offered it. Gated on the
`member` role rather than on having an `attendance` row, so someone can help plan
next burn's programme before they have said they are coming.

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
the helpers. It edits and withdraws too, so nothing about a dream needs the Dreams
page; that page keeps the same form for its list view.

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

The panel edits and withdraws as well as reads. **✏️** swaps in the same form the
Dreams page uses — `DreamFields`, one component, so the two cannot drift — and **🗑️**
withdraws behind a confirmation, for scheduled and unscheduled dreams alike. The
confirmation is `WithdrawDream`, which both pages use, so the same act cannot end up
guarded on one and not the other (#209).

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
wiring and the drag itself wants one click-through in a browser. The Dreams page
is the precise route and the accessible one: a form with a place and two datetime
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

### Applying

`POST /api/applications` is the only public write in the app, and that is the
point — an applicant has no account yet. Everything in the body is therefore
attacker-controlled, so two things are true by construction:

- **The submitter names their answers and which questions they were shown, and
  nothing else.** `id`, `status` and the timestamps are the server's. The schema
  is `.strict()`, so an attempt at any of them is a 400 rather than a quietly
  dropped key — a request that tried to approve itself must not look like it
  succeeded. What `asked` is allowed to decide — and what it is not — is set out
  below.
- **The questions are re-read from the database on every submission**, never
  taken from the request.

**Answers store the question, not a reference to it.** Each entry is
`{ question_id, label, type, value }`: the id so a reviewer can line the same
question up across applications, and the wording exactly as that applicant saw
it. A bare reference does not survive the form changing, and the form is meant to
change — questions are rows precisely so admins can retune them between
burns. Without the snapshot, editing a question would silently re-file every past
answer under wording nobody was shown, and deleting one would leave answers that
cannot be labelled at all. Neither is recoverable afterwards, which is why the
cost is paid on write.

One entry is stored per question **asked**, answered or not, so a reviewer can
tell "said no" from "was never asked". An absent tick box stores `false`; an
absent optional text answer stores `""`.

**"Asked" means the form said so, not that the question exists now.** The
submission carries `asked` — the ids the page actually rendered — and only those
get an entry. Without it, a question an admin added while someone was filling
the form in was stored against them as `""` or `false`, which reads as "asked and
declined" about a question they never saw.

`asked` narrows what is **stored**, never what is **checked**. Validation runs
against the server's own list, or "I wasn't shown that" would be the way to skip a
required question or an agreement — so a required question added in that window
still answers 400, and the form still says to reload rather than to try again.

An answer naming a question outside `asked` is a **400** rather than a dropped
key: the body disagrees with itself, and silently discarding it would lose what
somebody typed.

An id in `asked` that the server no longer has is a question deleted while the
form was open, and what happens then depends on whether it was answered:

- **with no answer key in the body, it is a 201** with no entry. There is nothing
  to store — the wording comes from the question row, and the row is gone.
- **with a key, it is a 400**, and not by the `asked` rule at all: `answerProblems`
  sees an answer naming no question it holds and says `unknown`, before the
  filtering is reached. The form's advice for a 400 — reload and send again — is
  right for it.

The distinction is the key, not what the field looked like. `Apply.tsx` writes
`answers[id]` on every keystroke, so a text question typed into and then cleared
sends `''` — a key, and therefore the 400 — while one never touched sends
nothing.

**The wording is still read at submission, not sent.** All of the above is about
which questions get an entry; the label on each one comes from the question row
as it is when the application lands. So an admin who _edits_ a question's text
while someone is filling the form in has that answer stored under the new
wording, against a question they were shown the old one for. That is the trade
`asked` does not touch and deliberately: taking the wording from the body would
let a submission record a question in words nobody wrote, which is the worse of
the two. #85's fix narrows what is stored, not where the words come from.

What this does _not_ claim: a crafted body can omit an optional question it was
shown and left blank, so it records as never-asked rather than as `false` or
`""`. Understating your own application is not an attack worth defending against,
and the direction that matters is closed — nothing can be recorded as answered
that the body does not claim was asked.

**What makes a submission valid** lives in `answerProblems`, in
`packages/shared`, and both sides use it: the server refuses on it, and the form
marks its fields with it. Written twice they drift, and the drift is a form that
says everything is fine against an API that answers 400. The rules:

- a `required` question must have a non-blank answer — trimmed, so `required`
  means "said something" rather than "sent the key";
- an `agreement` must be ticked, which is the entire reason the type exists.
  Absent counts as unticked, because that is what a browser sends for a box
  nobody touched;
- a tick box takes a boolean and a text question a string — `'false'` is truthy,
  so accepting a string for a tick box would tick an agreement nobody ticked;
- an answer to a question that was not asked is refused rather than stored.

The module is deliberately free of Zod so the browser can import it — see the
`sideEffects` note under [Shared schemas and types](AGENTS.md#shared-schemas-and-types-packagesshared).

The form itself hardcodes nothing about the questions: it renders whatever
`GET /api/questions` returns, in `order`. Adding a question in the admin UI makes
it appear on the public form with no deploy, which is the acceptance criterion
`form_question` exists for.

There is **no email**. Nothing is sent on submission and nothing is sent on
approval, so the confirmation screen says so outright rather than leaving an
applicant waiting for a message that will never arrive.

### Reviewing applications

`GET /api/admin/applications` lists everything sent in, newest first, with the
answers as stored — the question wording included, so an admin reads what the
applicant was actually asked rather than what the form says today.

Approving and rejecting are the same shape, and the shape is the point:

```sql
UPDATE application SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
```

Zero affected rows means someone already decided it, which is answered `409`
rather than silently re-deciding. The decision and the guard against
re-deciding are **one statement**, so there is no window between them — a
double-clicked Approve mints one invite, not two. `invite_token_application_idx`
is the backstop underneath that, and the page tells the admin to reload
rather than to try again, since retrying cannot help.

**Approval mints the invite.** 32 CSPRNG bytes, base64url, valid 30 days. Only
the SHA-256 digest is stored, so the raw token exists in that one response and
nowhere else — a leaked backup or a stray copy of the volume hands out no
invites. The admin copies it into Discord or Messenger themselves; there is
no email.

**A lost link is re-issued, not worked around.**
`POST /api/admin/applications/:id/invite` mints a replacement and shows it once,
the same way approving does. The link is shown in a paragraph that vanishes on
reload and the admin has to paste it into Discord before navigating away, so
losing it is a realistic accident rather than carelessness.

**The row is updated, not replaced**, which is what makes this safe. One invite per
application stays the invariant `invite_token_application_idx` already enforces, and
rewriting `token_hash` kills the lost link in the same statement that mints its
replacement — the old token no longer hashes to anything stored.

That matters because of what the previous workaround cost. Until this route,
recovery meant minting a _direct_ invite with `POST /api/admin/invites`, and:

- **the original link stayed live.** It is the token that is lost, not the row, and
  `DELETE /api/admin/invites/:id` refuses an application's invite precisely because
  it belongs to one. A lost link turning up later could still be redeemed — with a
  _different_ email, since the same address answers `409` against the account they
  now have. An invite is forwardable and whoever holds it is a stranger, so that was
  the likelier shape anyway: a second, unrelated account off an approval meant for
  one person (#137).
- **the answers were orphaned.** A direct invite carries no `application_id`, so
  what they wrote was not tied to the account they ended up with.

Re-issuing closes both by construction. Direct invites remain, for the person who
never applied through the form.

**Refused once the invite has been used.** By then they are already in, and a fresh
link would be a second account by another name — the same hole from the other end.
An application that is pending or rejected is refused too: pending is approved
instead, and rejected is not reopened by a side door.

The copy button is deliberately silent on failure rather than claiming a copy
that did not happen.

The link is assembled in the browser from `window.location.origin`, so the API
needs no notion of its own public URL.

**An invite carries no `event_id`.** It admits you to the community, not to a
burn — the application has no event either — and which burns you then come to is
a separate decision each time.

### Direct invites

For people already known — returning members, partners — who should skip the form
entirely. `POST /api/admin/invites` mints the **same** token an approval does, so
both kinds redeem through one path: CSPRNG bytes, digest stored, raw value
returned once. The default is 30 days; an admin can set `expires_at`, and one
already in the past is refused rather than stored, since it would be a link
nobody could use.

`GET /api/admin/invites` lists them with a **derived** status — `outstanding`,
`used`, `expired`. Derived rather than stored, because an invite becomes expired
by time passing, not by anyone writing to it, and a stored status would be a
value in the database that quietly stops being true. `used` beats `expired`: a
redeemed invite that later lapses is spent, and calling it expired would suggest
re-issuing a link to someone who is already in.

The list never carries the digest, let alone the token.

**Only an unredeemed direct invite can be revoked.** The other two cases are
refused with `409`, for different reasons:

- a **redeemed** invite is the record of how someone got in, and `account`
  references it — deleting it would rewrite how the group formed;
- an **application's** invite is the only one that application will ever have, so
  revoking it would leave that applicant with nothing to redeem. A direct invite
  gets them in; what cannot be recovered is the tie back to what they wrote, and
  #91 owns re-issuing against the application itself.

The admin UI offers Revoke on exactly those — every unredeemed direct invite,
**expired ones included**, since an expired link is still a row worth clearing
out and the route deletes it happily.

### Redeeming an invite

`/invite/:token` is where both membership paths converge. Unauthenticated, and the
token is the only credential — an invite is unguessable but **forwardable**, so
whoever holds it is a stranger until they redeem.

`GET /api/invites/:token` answers `200` with one of four statuses —
`outstanding`, `expired`, `used`, `unknown` — and **nothing else**. Not a 404 for
an unknown token, and not who the invite was minted for: either would turn a
leaked link into a way of probing for live ones, or into a disclosure. The page
needs the distinction because the three dead ends want three different things
done about them: an expired link can be re-sent, a used one usually means you
already have an account, an unknown one is usually a truncated paste.

`POST /api/invites/:token/redeem` creates the account, fills in the person-level
fields, grants the `member` role and signs them in. **One transaction**, because
half a redemption is the worst outcome: a spent token with no account behind it
leaves the person unable to finish with the link they were sent, and that link
cannot be re-sent — somebody with admin has to notice and mint a direct invite
(#91).

Two races are closed, and each has a test that fails without it:

- **Two people, one link.** Both requests read the invite as outstanding, then
  both spend ~230ms in `scrypt` before writing, so they genuinely interleave. The
  stamp is `UPDATE … WHERE id = ? AND used_at IS NULL` requiring one affected
  row, so the loser's transaction rolls back whole.
- **Two links, one email.** Both pass the email pre-check before either writes, so
  the loser's insert meets the `UNIQUE` and its stamp rolls back with it — leaving
  that invite still usable.

The password is hashed _outside_ the transaction. Holding a write transaction open
across 230ms of scrypt would block every other writer for that long.

It is also hashed **before** the check for an address that already has an
account, so the refusal costs what a success costs. `POST /api/auth/login` is
shaped the same way.

**This throttles an enumeration channel; it does not close one, and the
difference is worth stating plainly.** A `409` does not spend the token, so
whoever holds one unspent invite can ask "does this address have an account?"
about address after address — and the _status code_ answers that regardless of
timing: `409` for a member, `201` for anyone else. Latency was a redundant second
copy of an answer the status line already gives. What the ordering buys is cost:
each probe now spends a gated scrypt. With `SCRYPT_GATE`'s two slots and scrypt at
~230ms that is a ceiling of **about nine probes a second**, shared with every
login — against thousands a second when the refusal was free. #57 is what would bound it
properly, and there is a test that pins the residual so this paragraph cannot
quietly go stale.

Spending the token on the taken-address refusal would cap a held invite at one
probe. It is deliberately not done: someone who typos an address that happens to
belong to a member would lose their invite over it, and a new one needs an admin.

That hash goes through the **same gate as login**, not one of its own — the gate
bounds concurrent scrypt against libuv's four threads, so two gates of two slots
would spend the whole pool between them. There is a test holding the only slot
from the redemption side and asserting login is shed, which fails if they ever
drift apart. Over the bound both answer `429` with `Retry-After`.

The `POST` gives **one answer** — `409` — for unknown, expired and spent alike.
Not to hide which it is: the `GET` above says so plainly to anyone who asks, and
could not usefully do otherwise. It is that the client has nothing to do with the
difference at this point — the page has already read the status, and by the time
it POSTs all three mean the same thing, that this link cannot be spent.

**The form offers the upcoming burn, ticked** (#224). Almost everybody spending an
invite is coming to the burn that is next, so the form says so by name and asks for
the stay — arrival, lodging, helping — in the same breath, rather than leaving a new
member to find a second page. Offered rather than assumed: being on the list is a
commitment, and an admin setting a burn up need not be attending it, so the box
unticks and the stay questions go with it. No burn coming, no checkbox.

It needs no new disclosure to do this. `/api/events/active` and
`/api/events/:eventId/options` are **already public** — the second for the reason the
places are, that nothing in it is about a person — so an unauthenticated form can name
the burn and draw its lodging list without the invite route learning to hand out
anything new. Both reads fail soft: somebody who cannot be offered a burn can still
become a member and pick one afterwards.

**Joining happens after the transaction, never inside it.** That transaction spends a
token which cannot be spent again, so nothing optional may be given the power to roll
it back. A burn that ended while the form was open leaves the account made and the
response's `attendance` null, and the page says which happened. The stay details are a
second write for the same reason — their failure reads "you are in, but…" rather than
as a signup that failed. Redeeming with the box unticked still creates no `attendance`
at all: being a member and coming to a particular burn stay separate acts.

A signed-in visitor is not offered the form — redeeming would create a second
account for the same human, and the page cannot tell whether that was meant.

### Coming to a burn

Being in the community and coming to a _particular_ burn are separate acts.
Approval admits you once; then you decide, burn by burn. `attendance` is that
second decision, keyed `(event, account)`, and it is what arrival dates, dreams
and shifts hang off later.

A member says it for themselves on their own details page, one section per burn:

- `GET /api/events/mine` — `{ coming, past }`. `coming` is every burn that has not
  ended, joined or not, since joining is what the page is for; `past` is only the
  ones they actually came to, because a burn somebody never joined is not their
  history. The **server** splits them: that is a comparison against a clock, and a
  browser deciding it from `end_date` would answer differently either side of
  midnight depending on the reader's timezone.
- `POST /api/events/:eventId/attendance/me` — **idempotent**. Saying it twice is the
  same statement, not an error: a double click, a retried request and a second tab
  all land there.
- `DELETE /api/events/:eventId/attendance/me` — withdrawing, but **only while nothing
  has been paid**. What a refund means is a real decision and #31 owns it; deleting
  the row here would quietly discard the record that money changed hands.
- `PATCH /api/events/:eventId/attendance/me` — the stay itself.

**Named by event id, not by "active"** (#184). These were `…/events/active/attendance`
while there was one place to see a burn and it was whichever came next. The details
page lists every burn still to come and offers to join any of them, and the second
one on that list is by definition not the soonest-ending — so an active-scoped join
could not say yes to it. All three refuse a burn that has **ended**, and answer 404
for that and for an id that never existed alike, so an id cannot be probed for
existence.

An admin can do it for someone, because people ask over Discord and an
admin should not have to talk them through a UI:
`POST|DELETE /api/admin/events/:eventId/attendance`. The admin delete carries **no
payment guard** — undoing a mistaken add has to be possible, and an admin
doing it is making the call deliberately.

**Being able to sign in is not being a member.** These routes are behind
`requireMember`, so an account with no roles — invited but not yet redeemed — and
an admin who is not also a member are both refused. The two roles are separate
rows in `account_role`, and redemption grants only `member`. `admin:create`
grants both, and the accounts table under Organise is where either is added or
taken away afterwards.

### A stay starts as the whole burn

Joining writes `arrival_date` and `departure_date` from the event, rather than
leaving them null for everyone to type in what the event already knows. The
admin adding someone gets the same default.

Written on join, not merely prefilled in the form. Prefilling keeps "never said"
distinguishable from "said the whole burn", but it leaves the roster showing
blanks for almost everyone — which is the column an admin is reading it for.
The people arriving late or leaving early are the ones who should have to change
something.

It is a default, not a decision: the dates stay editable, and the ordering rule
still applies to whatever replaces them.

### Every date pair binds to its partner

`arrival`/`departure`, a burn's `start`/`end`, and a dream's slot each set `min`
or `max` from the other end, so the picker will not offer an inverted range. No
date library — two native inputs bound to each other were enough, which is worth
knowing before anyone reaches for a dependency.

**A hint, not a rule.** A `max` is something a keyboard can walk straight past and
an API client never sees, so `withStayOrder`, `withEventDateOrder` and
`hasValidTimeSlot` all still decide it, along with their CHECKs. What this removes
is the ordinary way to produce an invalid pair and be told off afterwards.

One detail with a test on it: an unset partner means the attribute is **absent**,
not empty. `max=""` is not reliably "no maximum".

### Members maintain their own record

Two pages, because the record has two lifetimes.

`/profile` edits the **person**: name, contact, allergies. These follow you from
burn to burn, so correcting an allergy corrects it everywhere — which is the
whole reason they live on `account` rather than per stay.

The same page edits the **stay**, in a section per burn: arrival, departure,
lodging, shift preference, notes, for each burn you have said you are coming to.

**Whose row is written comes from the session, never from the body.** There is no
id in either request to guess at or tamper with, and `account_id` in a profile
PATCH is a 400 rather than a redirect of the write.

`payment_status` and `payment_date` are omitted from what a member may send. A
member who could write them could mark themselves paid, so the page shows the
status and offers no control for it — a control that always failed would be worse
than none.

`email` is not editable here either: it is the login identity, and changing it is
a different act with verification nothing implements yet. The page says so rather
than offering a field that fails.

**A partial date edit is checked against the row, not against the body.** A PATCH
carrying only `departure_date` can invert the stored pair without ever containing
both values, so the schema's refinement cannot see it. The condition is composed
into the `UPDATE ... WHERE`, which is sound here because both are fixed-width
calendar dates. `events.ts` and `sessions.ts` read the row and check the merge
instead, their rules having grown to span fields a string comparison cannot
judge.

### Who is coming, and who has a place

`/admin/roster` is the spreadsheet's Members tab. Person-level fields are joined
in from `account` rather than copied, so an allergy corrected on someone's own
profile page is corrected here in the same moment.

**The order decides who gets a place:**

> Paid first, then unpaid. Within each group, order of joining that burn. The
> first `member_cap` entries have a place; everything below the line is waiting.

The consequence is the point rather than a side effect: **paying moves you above
every unpaid member**, regardless of who joined first — so an unpaid member can
be pushed onto the waiting list by someone else paying, without doing anything
themselves. That is what makes paying the thing that secures a place, and it is
why recording a payment reloads the whole list rather than ticking one row.

**The cut is derived, never stored.** A `waiting` flag would go stale the moment
anyone paid, and the whole rule is that paying re-sorts the list. `withPlaces` in
`packages/shared` computes it — placed there rather than in the route because
#79's member-facing list has to give the same answer, and two pages telling
someone different things about where they stand is worse than one of them being
absent.

Both lists **draw the line where the places run out** (#23), as a row inside the
one table rather than a second table below it: the order is the answer to who has
a place, so splitting it in two would be two chances to disagree about that.

**Ordered by `joined_at` within each group, not by payment time.** #23's sketch
said payment timestamp; `payment_date` is written as `todayIso(now)` — a date, not
a timestamp — so an admin recording a batch in one sitting gives every one of
them the same key and the tie breaks on nothing.

### Handing a place over

Withdrawing is refused once you have paid, because what a refund means is #31's
question. That left a paid member who could not come with no way out and their
place unreachable by the waiting list, so `POST
/api/events/:eventId/attendance/me/transfer` is the exit: it moves the payment to
somebody unpaid at that burn and **deletes the giver's attendance row**.

One-sided and immediate — the money is settled between the two of them offline,
which is what the burn's transfer text tells them to do, so an accept step would
only let a place sit in limbo. The taker is notified; the giver is not, having
clicked it themselves.

**Leaving takes you off everything you signed up for there.** The row's foreign
keys do it: helping ticks, meal shifts, lead-role teams and dream helpers cascade,
a `lead_attendance_id` is set null, and since #23 so is the dream you were
facilitating — that column named an `account` until then and was the one role a
withdrawal left behind. The dream itself stays, vacant, and #247's control is what
lets somebody pick it up.

The payment date is **carried over rather than restamped**: the burn received one
payment, on that date, and the place changing hands is not a second one.

Once `member_cap` **paid** members are in, the Members page shows the burn's
`transfer_info_markdown` in place of `payment_info_markdown` — telling somebody
how to pay when paying no longer gets them in is the wrong thing to leave up. Both
are per-burn and admin-editable; the transfer text defaults to
`DEFAULT_TRANSFER_INFO` rather than being blank, so a burn always has something to
say there — which means the create form must **not** send the field at all, since
`.default(…)` only applies to an absent key. `AdminEvents.tsx` sends
`payment_info_markdown: ''` and deliberately omits this one; the exact-body
assertion in its test is what stops the key coming back.

Counted on `payment_status`, not on `waiting`. `withPlaces` sets `waiting` by
position alone, so a **full list is not a paid-full burn** — and while places
remain unpaid, paying still secures one, which makes the payment instructions
exactly what the members above the line need. The first version of this counted
non-waiting entries and got it backwards; `HowToPay` owns the decision now, so
there is one place that knows the rule.

Recording a payment sends **the status and nothing else** — an admin
recording money received has no business rewriting an arrival date in the same
request. `payment_date` is not accepted at all: it is derived from the status and
the server's clock in the same statement that writes the status, the way
`joined_at` already is, so unmarking clears the date and one can never outlive the
payment it recorded.

That is the invariant as a property of the write rather than of the caller. It
used to be neither: the schema was `.partial()` over both columns, so
`{ payment_status: 'unpaid' }` alone left yesterday's date standing and a date
alone recorded a payment the status denied. Nothing enforced it and no `CHECK`
linked the columns — it held because the one caller always sent both.

**Backdating is deliberately not supported.** An admin recording a transfer
that landed last week is a real need, and the answer to it is a field with the
status validated against it, not one the server silently overrides. Sending
`payment_date` is a `400` rather than an ignored key, so nobody can believe they
backdated something that in fact reads as today.

**`partial` is gone from the payment vocabulary.** Two values, not three: a
half-payment is chased out of band. It was never set by anything, drove a
database CHECK and a branch in the member's page, and an unreachable value every
consumer has to handle is the trap the error-code vocabulary already argues
against.

CSV export quotes every field unconditionally rather than only when needed.
Allergies and notes are free text that will contain commas, quotes and newlines,
and a rule applied some of the time is one that gets tested some of the time.

### Markdown is escaped, not filtered

`welcome_markdown` is written by **any approved member** and rendered to every
public visitor, so it is treated as untrusted. That is the plain reason now rather
than a hypothetical one: forty-odd people can edit it. It was already treated this
way when only admins could — an admin account is one phished password away from
belonging to someone else — which is why opening the field widened who writes it
without widening what the renderer has to withstand.

**Raw HTML in the welcome text is escaped and shows as visible text.** The usual
build is `marked` + DOMPurify, and that was the first attempt — but DOMPurify
needs a real DOM, and under happy-dom (the test environment) it reports
`isSupported: true` while doing nothing useful:
`sanitize('<h1>a</h1><script>b</script>')` returns `a<script>b</script>`,
dropping the safe tag and keeping the dangerous one. A sanitiser the suite cannot
exercise is a security control held on trust, and that one was actively wrong
where the tests run.

Escaping needs no DOM, so it behaves identically in Node, in tests and in the
browser — and the tests prove it rather than assuming it. It is also the stricter
rule: no allowlist to get wrong, and no gap between how a sanitiser parses the
input and how the browser does.

Link and image URLs are checked separately against a scheme allowlist
(`https:`, `http:`, `mailto:`, site-relative and anchors), because escaping does
nothing about `[click](javascript:…)` — that is markdown, not HTML. A denylist
would have to know about `data:text/html`, `vbscript:` and friends individually.

The cost is that a literal `<br>` renders as text. Markdown already has emphasis,
headings, lists and links, which is the whole vocabulary this field needs.

Content headings are shifted down one level: a `#` renders as `<h2>`, clamped at
`<h6>`. The page owns `<h1>` (the site name) and `<h2>` (the event name), so an
unshifted `#` would put a second `<h1>` underneath an `<h2>` and break the outline
screen readers navigate by.

Site-relative links must be genuinely site-relative: `//evil.com` and
`/\evil.com` are rejected, since both navigate off-site while reading as local
in the markdown source. Control characters are stripped before the check —
`marked`'s angle-bracket destination form accepts tabs, and the browser discards
them while parsing a URL, so `</\t/evil.com>` would otherwise arrive as
`//evil.com`. No privilege is gained either way — whoever writes this
field could link `https://evil.com` outright — but the allowlist should mean what
it says.

**Remote images are allowed, and that is a deliberate trade.** `img-src` is
`'self' data: https:` rather than helmet's default `'self' data:`, because the
URL allowlist admits `https://` image sources and the two disagreeing meant an
image was rendered into the page and then blocked by the browser — which reads as
a bug rather than a policy. Images therefore have a _stricter_ allowlist than
links: `https://` or site-relative only, since a plain `http://` image would hit
that same mismatch. Links still accept `http://` — `img-src` does not govern
navigation. There is no upload feature, so the alternative is
that images do not work at all. The cost: an image host a member links to sees the
IP of every homepage visitor. It is the only external request a _visitor's browser_
makes; the server makes one of its own when it sends a push notification, which is
under Notifications above. Narrow this back to `'self' data:` if uploads ever
land.
