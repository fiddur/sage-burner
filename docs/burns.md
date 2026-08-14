# Burns

Events, who is coming to one and who has a place, where they sleep, what they help
with, and the calendar feed.

[← back to the README](../README.md)

## Events

There is never "the" event. `event` rows exist from day one and the app is built
around recurrence — up to four burns a year, each with its own members and
payments.

Applications are the exception, and deliberately so: you apply to the community
once, not to a burn. Approval admits you to any of them, so `application` and
`form_question` carry no `event_id` and outlive any single event.

### Who a person is, and which burns they come to

Two different lifetimes, so two different places.

**The `account` carries the person.** `name`, `contact`, `allergies_notes` and the
invite they came in on live there, one row per human. They are nullable because an
account can exist before anyone fills them in — the bootstrap admin is created
from the CLI with an email and nothing else.

**`attendance` carries one stay**, keyed `(event, account)`: arrival and
departure, lodging, shift preference, notes, and payment. Payment is per burn and
never a flag on a person.

The split is not cosmetic. Held per burn, `allergies_notes` meant a copy for every
burn someone attended, and correcting one left the others wrong — on data that
exists to keep people safe. It is also what the central application model implies:
you are approved into the community once, so the details describing _you_ cannot
hang off a single event.

### Allergies are a list and a free-text box

`allergy_item` is a **global**, admin-editable vocabulary (#254), seeded with five;
`account_allergy` is what one person ticked. Global rather than per burn for the
same reason `allergies_notes` is: what somebody cannot eat is a fact about them, and
a per-burn list would mean re-ticking it every time. Rows rather than an enum, so a
sixth item is an afternoon rather than a deploy.

`allergies_notes` did not go anywhere. It sits beside the ticks as **Other**,
because a vocabulary is never complete and the cost of it being wrong here is
somebody's dinner. Nothing was parsed out of it by the migration — turning free text
into items would be a guess, on the one kind of data where a wrong guess matters.

**Removing an item somebody has ticked is refused.** `account_allergy.item_id`
carries no `ON DELETE`, so SQLite objects and `allergies.ts` answers 409; the admin
page says to rename it instead. This is the one place the roster's usual pattern is
inverted — `attendance_helping` cascades from its option, because losing a shift
preference is an inconvenience and losing an allergy is not. Reading the list is
public like `/api/questions`; writing is **admin's**, not the burn's-furniture
default, because renaming an item rewrites what everybody who ticked it is taken to
have said.

An invite's single use is enforced by a **partial unique index on
`account.invite_token_id`** — partial because NULLs compare distinct in SQLite and
every CLI-created account has none. Deleting the account would stop the index
objecting, so redemption stamps `used_at` in the same transaction; neither
mechanism is sufficient alone.

### Every burn-scoped route takes an event id

`activeEvent` decides one thing now: what the **public** homepage and the ICS feed
are about. Everything a signed-in member looks at names its burn in the path —
`/api/events/:eventId/{places,sessions,members,roles,options,attendance/me}` — and
the selector in the bar is what supplies the id.

The routes that take a bare id instead (`/api/places/:id`, `/api/sessions/:id`,
`/api/roles/:id`, `/api/meals/:id`) resolve the burn from the row and refuse one that
has **ended**, through `openEvent`. So does `/api/events/:id/welcome`, which is keyed
by the burn itself.

That last pair is worth saying plainly: this paragraph described the register and the
welcome text as refusing an ended burn before either of them did. The claim was
written here first and the code caught up in #218 and #219 — which is why the sentence
records it rather than simply reading as though it had always been true.

Not `activeEvent`: the selector offers every burn still to come, so a dream can be
offered for the one after next and a grid laid out months ahead. What is closed is the
archive.

### Which event is active

The public homepage needs one event, so the rule is written down rather than
inferred per call site. (The application form does not — it is not tied to a
burn, so it works with no events at all.)

> The **active event** is the soonest-ending event whose end date has not passed.
> Ties break on start date, then slug.

Consequences worth knowing:

- An event **running today is still active** — mid-burn is when the homepage
  matters most, and a rule keyed on the start date would drop it the moment it
  began.
- An event **ending today is still active**, until UTC midnight. The comparison
  is in UTC rather than a configured timezone: the only thing it decides is when
  an event stops being the active one, and a few hours either way on the closing
  day is not something an admin would notice. A timezone setting would be a
  config knob, a migration and a test matrix bought for that.
- Once **every** event has ended there is no active event. The endpoint answers
  `{ "event": null }`, and it deliberately does not fall back to the most recent
  past event — that would leave last year's welcome text served as though it
  were an invitation. Creating the next event is what fills the gap.

`GET /api/events/active` is public and answers `{ "event": null }` rather than a
404 before the first event exists — that is the ordinary state of a fresh
deployment, not an error.

### Editing an event

Organise → **Events**. Create burns there, and edit any of it afterwards — name,
dates, hours, where it is held, member cap and the welcome text are all on the
same form. The hours in particular need to be editable: a burn created before
anyone thought about them takes the whole-day default, and the schedule grid is
drawn from them.

`location` is free text in whatever words somebody would say it in — "Sagegården,
outside Rättvik" — and it is **per burn** rather than per installation, because the
same people meet at a different farm next time (#306). It is public: the homepage
says it beside the dates, and the card a shared link draws carries it as the
schema.org `Place` that puts the burn on a map. So it holds a place, not a gate
code. Empty until somebody fills it in.

The public homepage renders it: the banner above, then name, dates, place and the
welcome markdown, with "Apply to join" and "Log in" for a signed-out visitor. The
burn's name is the page's heading — what the installation calls itself is in the
bar above, on every page. The editor's preview uses the same renderer, so what it
shows is what a visitor gets.

A slug collision answers **409** rather than a generic failure — the slug appears
in URLs, so it is something the admin fixes by choosing another.

Four more things the write routes do, for anyone writing a second client:

- **An unrecognised key is a 400**, on create and update alike. A body is not
  filtered down to what the schema knows: `welcome` instead of `welcome_markdown`
  is refused rather than silently dropped, which on create would have produced an
  event whose welcome text was quietly empty and on update a "saved" that saved
  nothing.
- **An empty PATCH body (`{}`) is a 200** for an event that exists, returning it
  unchanged, and a **404** for one that does not. It is a no-op rather than an
  error, and it is the only body that reads instead of writing.
- **A PATCH names only what it changes.** Reading an event, editing the object and
  sending the whole thing back is therefore a 400 on `id` and `created_at`.
- **A date move that would invert the range answers 400**, not a 500 from the
  database. That holds for a body carrying one date as well as two — the check for
  a one-sided move rides in the `UPDATE` itself, so a second admin moving the
  other date concurrently cannot slip between a read and a write.

A PATCH responds with the event **as written**, not with the body merged onto what
was read a moment earlier — so if another admin's change landed in between, the
response reflects it rather than reporting a value nobody stored.

A row that disappears before the `UPDATE` reaches it answers **404**, the same as
one that was already gone — the body was not the problem, whatever it contained. The
two causes of a failed write are told apart by re-reading the row afterwards rather
than inferred from the request, so a well-ordered date move against an event someone
else has just deleted does not come back as "check the dates".

### The application form's questions

`form_question` rows, never code — and **one central set**, not one per burn.
Someone applies to join the community once, the way they would be let into the
Discord server; attending a particular burn is a separate act afterwards (#76).
Admins retune the questions between burns, so adding, editing, reordering or
removing one must never need a redeploy, and the web app renders whatever it is
handed rather than knowing the questions.

Organise → **Application questions**. Types in v1: short text, long text,
checkbox, and _agreement_ — a checkbox that must be ticked to submit.

Two rules that are the server's, not the browser's:

- **`order` is assigned by the server.** A new question goes last; a client
  cannot pick a position. Two admins adding at once would otherwise collide
  over a number neither of them chose, so the read and the insert run in one
  transaction.
- **Reordering sends the complete list of ids**, in the order wanted, and a
  partial list is rejected with 400. Moving one question renumbers several, so a
  request naming only some of them would leave the rest on stale positions — an
  order nobody chose. The renumbering itself runs in a transaction, so a reorder
  is all-or-nothing.

  The check deciding _whether_ to renumber is evaluated before that transaction
  opens, so the check-and-apply as a whole is not atomic the way `POST`'s
  read-and-insert is. That is fine rather than overlooked: a question created
  concurrently takes `order = max + 1` and still sorts after the positions being
  written, and one deleted concurrently updates zero rows and leaves a gap, which
  `order` tolerates because it only has to sort.

`GET /api/questions` is public — the application form is public, so its questions
are — and `no-cache`, so a question added a moment ago is not hidden behind a
stale response. Every write is admin-only.

**Help text is markdown**, edited in the same composer as everything else — a textarea with a
toolbar that writes the syntax, and a preview below it once there is any. It
carries the things that need more than a line — the 10+1 principles an
`agreement` asks someone to accept, for instance — so it needs lists and
paragraphs. It was a 2000-character single-line `<input>`, which made writing
them impossible.

The label stays plain single-line text: it is the field's accessible name, and a
list inside a `<label>` is not markup a screen reader can make sense of. Long
text belongs in the help text below it.

Rendering is the same `renderMarkdown` the welcome text uses — raw HTML escaped
rather than filtered, link and image URLs checked against an allowlist. See
[Markdown is escaped, not filtered](./the-app.md#markdown-is-escaped-not-filtered).

**`required` is decided by the type for the two tick-box kinds, not chosen.**

- An **`agreement`** is always required. The type exists because submission is
  blocked when it is unticked, so `{ type: 'agreement', required: false }`
  contradicts itself.
- A **`checkbox`** is never required. It always has an answer — `false` is one —
  so "must be present" is vacuous, and the only other reading of a required
  checkbox is "must be ticked", which is what `agreement` already means. Two
  spellings of one rule is the ambiguity, so the second is refused.

The API rejects both combinations, on create and on any PATCH that would produce
one — including a PATCH naming only `type` or only `required`. The schema cannot
decide a lone key, so that case is settled **inside the `UPDATE` statement**
rather than by re-reading the row and checking in JavaScript: a check either side
of an `await` is check-then-act, and two concurrent patches could each pass their
own before either wrote.
`db/schema.ts` carries a CHECK for each, because `required` has `.default(false)`
and an insert that omits it never touches a Zod schema. The editor disables the
control with a note rather than letting a tick become a 400.

All four places derive from one function, `tickBoxRequired`, rather than restating
it — including the database, whose CHECKs are generated from the vocabulary the
same way the type constraint is. Written out separately the copies drifted within
the hour: the handler covered `agreement` and not `checkbox`, and the gap surfaced
as a 500 from the CHECK instead of a 400. Generating the SQL matters for the same
reason it mattered in the API — a fifth type with a fixed `required` would
otherwise be enforced everywhere except the one place that is supposed to hold
when nothing else does.

`options` exists as a JSON column for future select/radio types and is not yet
consumed by any type. Both it and `help_text` are optional in a create body —
`.nullable()` does not make a key optional, so omitting them used to be a bare
`bad_request` naming no field. `required` is enforced server-side on submission,
which is [#14]'s half of the work.

[#14]: https://github.com/fiddur/sage-burner/issues/14

## The Q&A

The spreadsheet's other tab: how to get there by public transport, what to bring,
what taking part actually asks of you. `/faq`, open to any approved member.

**Per burn**, like the places and the lead-roles register — the practical answers
change with the site and the year, and last summer's directions are wrong for the
next one. A burn with none offers to seed itself from a previous one, which is where
most of them come from; it refuses to copy into a list that already has some, for the
reason the register gives.

**Questions are always visible; answers are folded away behind them.** The list is
read by somebody looking for one thing, so it is a column of headings they scan and
open. It is a native `<details>`, not state of the page's own, which keeps the
browser's find-in-page working — half of finding an answer is Ctrl-F.

**Anyone may ask, and anyone may answer**, including a question somebody else asked.
The person with the question is rarely the person with the answer, so asking is one
field, an entry may have no answer at all, and the page says where one is still
wanted. That default — the burn's shared furniture is every member's — is the same
call #27 made for the register.

The **question is plain text** and the **answer is markdown**, which is the split
every pair like this has here: the short one is a heading and the long one is written
for other people to read. The CHECK is on the question alone, since an unanswered one
is worth having on the page.

**The order is somebody's arrangement**, not the order things were typed: a FAQ is
read top to bottom and the question people have first belongs first. It is draggable,
with the arrow keys on the handle doing the same for anybody not using a mouse, and
the copy carries the arrangement rather than re-deriving one. Every write needs the
burn to be open — a finished burn's Q&A is the record of what was asked — and goes
through the same `If-Match` guard as the rest of the shared furniture.

**Members, not the public.** The homepage's welcome text is this app's public
surface; these are the answers written for people who are already coming, and some of
them say exactly where the gate is. Opening it later is moving one route out from
behind the guard, which is a smaller decision than taking it back.

**But it does not need a burn you are in** (#321). Every burn-scoped page takes its
burn from the bar, which listed only the ones you had said you were coming to — so an
approved member who had joined none landed on "you are not coming to a burn yet" and
could read nothing. #503 has since opened the bar to every coming burn, so that is no
longer how somebody ends up without one; the fallback to the active burn stays, for the
case where no burn is coming at all. This is the page that answers "what does taking part actually ask
of me?", which is read _before_ deciding, so when the bar has nothing the next burn
answers instead: `GET /api/events/active`, which is public, so nothing is disclosed
that was not already. The page says which burn it is showing whenever the bar did not
choose it — two burns' answers read alike — and it says it as a fact about the bar
rather than about the reader, since a failed burns fetch leaves what they are coming to
unknown here too.

Writes are unchanged and still any approved member's, on an open burn: somebody who
knows how the bus works can answer the question whether or not they are coming, and the
guard was never attendance.

**Removing one takes two clicks** (#323), like a lead role and unlike a schedule lane.
One row holds a paragraph somebody else wrote and nobody has another copy of.

## The calendar feed

`GET /calendar/:token/schedule.ics` is the programme as a calendar subscription,
so people can put it in their phone rather than reloading a page. The token is
`event.feed_token` and deliberately not the burn's id — see below.

The **Schedule page carries the link**, for the burn selected in the bar, with a
copy button beside it (#258). Until then nothing in `apps/web` referenced the feed at
all, so it existed and was reachable only by typing a URL with a UUID in it.

**The link is `webcal://`, the copy button gives `https://`** (#298), and the split is
not arbitrary. `webcal` is what asks an operating system to _subscribe_ to a live
feed; following the `https` URL downloads a snapshot that never updates, which is the
opposite of the point. Apple Calendar on macOS and iOS, Outlook on the desktop and
Thunderbird all take `webcal`. Google Calendar on Android does not, and wants a URL
pasted into _Other calendars → From URL_ — so the copy button keeps the `https` form.

It used to fix a routing bug as a side effect, and no longer has to: the client-side
router swallowed the `https` link and rendered "Nothing here" until `ROUTER_SCOPE` put
`/calendar/` outside what it may claim (#422). Either form reaches the backend now, so
`webcal` is chosen for what it does rather than for what it avoided.

**Unauthenticated**, because a calendar client cannot hold a session — subscribing
is a URL a phone re-fetches on its own. So the address is the only thing protecting
it, and it is **`event.feed_token`, not the burn's id** (#408).

Keyed by the id, it was not protected at all for the burn being planned:
`GET /api/events/active` has no guard, answers the whole row with `id` in it, and the
public homepage fetches it on every anonymous visit — so a stranger could read the id
off the front page and build the `.ics` URL. `CalendarFeed` had been saying "the UUID
is the only thing protecting the feed" the whole time, which was true and, for the
active burn, worth nothing.

The token is 32 CSPRNG bytes, in no response the public reads, and **rotatable** —
which is the part an id could never give. `GET /api/events/:eventId/calendar` answers
it to an approved member, `POST /api/admin/events/:id/calendar` gives a new one, and
every calendar already subscribed to the old address then stops updating with nothing
to tell it. That is what rotating is for, and the button says so.

Still: **do not post it anywhere outside the gathering.** That is the trade that lets
descriptions go out in full — the difference is that now there is something to do
about it when somebody does.

What leaves the building is the title, the description, the times, and the place's
name, emoji and colour. No facilitator, no contact details, no allergies, no payment
state.

Two guards, catching different things:

- **The route parses every row through `publicSessionSchema`**, which strips what
  it does not name. Widening the `select` cannot widen the feed — the extra
  column is dropped before rendering. Adding the field to that schema instead
  fails `schemas.test.ts`, which pins its exact key set. So a field reaches the
  feed only if someone deliberately edits the allowlist and its test.
- **A denylist in `schedule.test.ts`**, asserted against the **rendered feed**
  rather than the query. It only catches what someone thought of, so it is seeded
  with every field the fixtures carry.

The first was written before the feed existed and then not wired in: the schema
was declared "the guard rail for an unauthenticated endpoint" while the route
hand-built the same shape beside it, so the key-set test gated nothing anyone
used. It is invoked now, and a test bypasses the parse to prove the feed depends
on it.

### Choices worth knowing

**Everything is emitted in UTC `Z` form.** No `VTIMEZONE`, nothing to get wrong
across a DST boundary: an instant is an instant and the client renders it wherever
the reader is. Emitting Europe/Stockholm wall-clock time would mean shipping
timezone rules that go stale. There is a test for an October burn, which is where
a local-time renderer drifts by an hour.

**No `SEQUENCE`.** It exists for iTIP — emailed invitations, where a client has to
tell a newer copy of one event from an older one. A subscription feed is refetched
whole and replaced by `UID`, so there is nothing for it to decide, and there is no
version column to derive an honest number from. Always-`0` would look like
handling and be none.

**`grey` is emitted as `gray`.** RFC 7986 `COLOR` takes CSS3 names, and a name
outside that list is silently ignored — the lane would just lose its colour with
nothing to say why.

Folding counts **octets, not characters**, per RFC 5545: a place emoji is four
bytes, so a line that looks short can be well over the 75-octet limit, and a fold
in the middle of a multi-byte sequence corrupts it.

## Coming to a burn

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

## A stay starts as the whole burn

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

## Every date pair binds to its partner

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

## Members maintain their own record

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

## Who is coming, and who has a place

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

**A tie breaks on the account id** (#506), which sounds arbitrary because it is: what matters is
that it is _decided_. A burn that opens on a Sunday gives every `joined_at` the same second, and a
`SELECT` with no `ORDER BY` hands those rows over in whatever order the index it chose gives — so
without a last resort in the comparison, the line falls in a different place from one read to the
next, and a member watching the page sees it move with nothing having changed.

**The notification asks a plainer question than the line does** (#565): is there a place left to
pay for? Among unpaid members the order decides nothing — the list is paid-first, so any of them can
jump all the others by paying — so "unpaid, third, has a place" and "unpaid, fifth, waiting" are the
same situation, and telling those two people different things implies a queue position no rule
honours. Both messages therefore go to **every** unpaid member, and split on `member_cap - paid`:

- places left, and few enough to be worth saying: _N places left, and they go to whoever pays._
- none left: _full — every place is held by somebody who has paid._

That keeps #506's fix — it compared `paid` to `member_cap` for equality, so an over-subscribed burn
whose payments had not landed exactly on the cap told the person below the line nothing, and an admin
who recorded more payments than places silenced it altogether — without #506's split of the audience,
which said more than the data supports. The roster still draws the line, because for a **paid**
member it is a real fact and the page is where somebody looks to see it.

**Told once per burn, per sentence** — the query asks whether this account already has _this exact
message_ about _this burn_, so recording the next payment says nothing to somebody already out, while
the countdown repeats whenever the number in it has actually changed. That is one rule where there
were two, and it is what lets the line be recomputed as often as it likes without anybody hearing the
same thing twice. The link carries the burn (`/members?burn=…`, per #333), which is what makes "have
we said this already" a query rather than a column.

**The line is what triggers the telling, not the payment** (#564). It used to be called from the
payment route alone, which left out the one person most likely to care: somebody arriving at a burn
that is _already_ full changes nothing an admin will touch, so with every place paid for, nothing
would ever have fired for them — they were below the line on the roster and had heard nothing about
it. **Every way an unpaid row appears recomputes it**: joining, and an admin adding somebody. Those
are the two doors onto the same bug.

**Leaving does not**, and that is not an omission. `left` is the cap less what has been paid for, and
leaving only ever removes an **unpaid** row — so the line cannot move, and there is nothing new to
say to anybody. Handing a place over does not move it either: it marks the taker paid and deletes the
giver, who was.

**Editing `member_cap` does move it, and tells nobody.** Lowering a cap pushes people onto the
waiting list with nothing said. That one is open rather than decided.

## Handing a place over

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
keys do it: helping ticks, meal shifts, lead-role teams, dream helpers and pledges
to bring something cascade,
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

## Lodging, and helping out

The two things a member says about their stay used to be free text, so nobody
could count them and every burn re-invented the vocabulary. `event_option` holds
both lists as rows — **per event**, unlike the application questions and the
places, because what there is to sleep in depends on the site and what wants
doing depends on the year.

`/options` — **Lodging and helping**, for the burn the selector is pointing at.
Setting them up before that burn is the next one works because the selector offers
every burn still to come. Reached from **(edit lodging alternatives)** on the details page,
beside the question the list answers, and from ⚙️ as well, since that is where
somebody setting a burn up is already standing.

A lodging entry can carry a number of spaces — "Temple mattress: 9" — or leave it
blank for the ones that do not run out, like a tent of one's own. Helping entries
never do: nothing runs short of people willing to tend a sauna. Zero spaces is
refused rather than allowed; an option nobody fits in is a deleted option spelled
confusingly.

Free text became a reference, and the migration folds whatever was already typed
into `notes` rather than dropping it — "hammock in the barn" is not an id, so
there is nothing to map it onto, but an admin still reads notes. Truncated to
2000 there, which is what the schema allows.

A member picks one lodging option on **your burn**, and the select disables the
ones that are full, reading "— full". That is presentation: the API takes what it
is sent, so `PATCH /api/events/:eventId/attendance/me` counts the takers and answers
**409** for a full option.

The count is a plain read-and-compare, not race protection. Two people taking the
last mattress in the same millisecond can both succeed; at forty-odd people that
is an admin moving one of them, not something to build machinery against.

The option a member already holds is never disabled for them, even when it reads
as full — their own bed counts towards the total, so disabling it would make the
select fall back to "not decided" and quietly give the bed up on the next save.

The lists carry a `taken` count per option, derived every read. It is the only way
to tell a member the Temple is full without showing them who is sleeping in it.

A member ticks **as many helping-out options as they like**, and can write in one
the list does not have. The ticks are rows in `attendance_helping`, not a JSON
array: the whole reason the list exists is so an admin can count who is up for
the kitchen, and counting inside a JSON column is the thing that gets rewritten
later. The write-in sits beside them rather than instead of them — the point of
the list is counting, the point of the write-in is that a list is never complete.

The columns and the ticks arrive in one PATCH and are written in one transaction.
The ticks are validated before anything is written, but that check has a window:
an option deleted in the moment between it and the write rolls the column write
back too, rather than answering an error over a half-saved stay.

Both sides of that join cascade. Withdrawing from a burn takes the ticks with it,
and so does an admin removing an option — **unlike lodging**, where a bed
someone is in must not vanish underneath them. Nobody is displaced by "kitchen"
ceasing to be offered.

`kind` is not editable. The two lists number independently, so changing it would
leave an entry ordered against the list it came from — moving one is deleting and
adding.

The number of spaces is checked by `min` and the input's implicit whole-number
step, and by nothing in JavaScript. A browser will not submit a form containing an
invalid number, so a guard beside it is unreachable code — the same two-validator
trap as `required` versus `aria-required`, reaching the opposite conclusion: for a
name the page must be the authority because it has something to say, for a count
the browser already says it. There is a test asserting the form does not submit,
which is what proves the guard would have been dead.

## Getting there and back

`/rides` replaces the spreadsheet's Rideshares tab (#26): who is **looking for a
lift** and who has **room in a car**, for the burn the selector is pointing at.

One table with a `kind` rather than two. Everything else about a journey is the same
whichever way it is going — where from, roughly when, how much room, anything else
worth saying — and two tables would be one schema written twice with a word changed.
The two halves get headings of their own on the page, which is where the split
belongs.

**Where from and when are text**, not a place picker and a date. A lift is arranged
around a time of day and a willingness to wait, and a date field would ask for
precision nobody has three weeks out — the arrival date on somebody's stay is the
precise one. `seats` is a count somebody reads to decide whether it is worth asking,
not a capacity to book against: nothing on this page claims a seat, because the board
is two lists and the next step is a conversation.

**The contact is not on the row.** It lives on the account, where the details page
already asks for it and the roster already shows it to every approved member — so a
copy here would be a number to keep in step, wrong in exactly the moment somebody most
needs it. The board resolves the name and the contact at read time.

That is the whole privacy change from the spreadsheet, and it is a change of _audience_
rather than of content: the tab was a publicly linked document with phone numbers in
it, and this is behind `requireApproved`. Inside that gate the number is the point of
the page, and `contact` is the one field on an account that exists to be given out.

**Your own journey is yours.** Unlike the lanes, the lead-roles register or the
timetable — the burn's shared furniture, which any approved member may rearrange — a
row here is somebody's statement about their own travel and carries their contact. The
update and delete routes ask whose it is and answer **403** for somebody else's, not
404: every member can already read the row, so hiding that it exists would say nothing
and explain less.

No `If-Match`. That exists for the fields several people edit at once (#274), and one
of these has exactly one author. Writes need the burn to be open, like every other
per-burn write; reading a finished burn's board is reading the record of who travelled
with whom.

Reached from **(looking for a lift, or offering one?)** beside the arrival dates on the
details page — where somebody is standing when they think about getting there. Not from
the bar: that carries one entry per thing and is already full at six on a phone (#337).
