# Burns

Events, who is coming to one, where they sleep, what they help with, and the calendar feed.

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
dates, hours, member cap and the welcome text are all on the same form. The hours
in particular need to be editable: a burn created before anyone thought about them
takes the whole-day default, and the schedule grid is drawn from them.

The public homepage renders it: name, dates and the welcome markdown, with
"Apply to join" and "Log in" for a signed-out visitor. The editor's preview uses
the same renderer, so what it shows is what a visitor gets.

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

**Help text is markdown**, edited in a textarea with Write and Preview tabs. It
carries the things that need more than a line — the 10+1 principles an
`agreement` asks someone to accept, for instance — so it needs lists and
paragraphs. It was a 2000-character single-line `<input>`, which made writing
them impossible.

The label stays plain single-line text: it is the field's accessible name, and a
list inside a `<label>` is not markup a screen reader can make sense of. Long
text belongs in the help text below it.

Rendering is the same `renderMarkdown` the welcome text uses — raw HTML escaped
rather than filtered, link and image URLs checked against an allowlist. See
[Markdown is escaped, not filtered](./schedule.md#markdown-is-escaped-not-filtered).

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

## The calendar feed

`GET /events/:eventId/schedule.ics` is the programme as a calendar subscription,
so people can put it in their phone rather than reloading a page.

The **Schedule page carries the link**, for the burn selected in the bar, with a
copy button beside it (#258). The button is the part that works: following the link
downloads a snapshot in most browsers, where the point is a subscription that keeps
up. Until then nothing in `apps/web` referenced the feed at all, so it existed and
was reachable only by typing a URL with a UUID in it.

**Unauthenticated**, because a calendar client cannot hold a session — subscribing
is a URL a phone re-fetches on its own. The event id is a UUID, so the URL is
unguessable, but it is not a secret beyond that: **do not post it anywhere outside
the gathering.** That is the trade that lets descriptions go out in full.

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

## Lodging, and helping out

The two things a member says about their stay used to be free text, so nobody
could count them and every burn re-invented the vocabulary. `event_option` holds
both lists as rows — **per event**, unlike the application questions and the
places, because what there is to sleep in depends on the site and what wants
doing depends on the year.

`/options` — **Lodging and helping**, for the burn the selector is pointing at.
Setting them up before that burn is the next one works because the selector offers
every burn still to come. Reached from **(edit lodging alternatives)** on the details page,
beside the question the list answers, and from ⚙️ as well — an account holding
`admin` without `member` has no details page to reach it from.

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
