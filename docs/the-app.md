# The app itself

Getting around it, what it calls itself, installing it, the faces in it, and how
anything anybody writes gets rendered.

[← back to the README](../README.md)

## Getting around

The bar carries **one entry per thing, not one per page** (#184). Everything else
is reached from the page it belongs to, which is where somebody is standing when
they want it.

The **burn selector** sits after ☰ and the logo, and everything to the right of it is
about the burn it names. **It lists every burn still to come, to every approved member**
(#503), joined ones first, and defaults to the first — the list arrives soonest-first and
the sort is stable, so within each half that order survives.

It used to list only the burns a member had said they were coming to, with `admin` as the
exception, and that left the person watching from the side on `NoBurn` everywhere while the
feed showed them everything being planned. **The API was always ahead of the UI here**:
`getMyBurns` already returns every coming burn with a null attendance, schedule reads and
writes are gated on the role rather than on attendance, and the burn-wide notification
audiences key on `attendance` rows — `namedBy` intersects mentions with attendance, so
`@everybody` on a burn thread still never reaches a non-attendee. Opening the pages leaks
nothing into the pings.

**The controls that put a person on something nudge rather than refuse.** 🙋 as helper, a
lead role, a meal crew place, hearting a dream — each needs an `attendance` server-side, and
each answered a bare 400. That surfaced as `Request failed (400).`, not even as the caller's
fallback, since `errorMessage` prefers an `ApiError`'s own message. They answer
`not_attending` now, which `joining.ts` turns into _You need to join this burn_ beside a link
to the details page.

**The 🙋 hand had to be offered for that to reach anybody.** `HelperStrip` gated it on the
viewer being among `candidates`, which every caller fills from `getEventAttendees` — so the
person the nudge is written for could not see the control that produces it, and the message
would only ever have appeared in a stale-tab race. The hand is now offered to any approved
viewer; the appoint list still is not, since filling somebody else's name needs an attendance
that exists. Arranging the shared furniture — moving dreams, lanes, the FAQ — stays
approved-wide and needs no attendance at all.

**A shut spot says so, rather than being inferred from an empty list** (#520). The first
version of that rule read `!viewerAttending && candidates.length > 0`, which conflated two
different empties: a spot the page deliberately closed — a chore's lead, which nobody may take
— and a burn nobody has joined yet, where `getEventAttendees` answers nothing. The second is
every burn on the day it opens, and it is the state #503 is most about, so the person the nudge
is for saw no hand at all on exactly the burn they were looking at. `shut` is now a prop the
chore sites pass, it suppresses the hand and the appoint control together, and an empty
`candidates` list means only
what it says: nobody to appoint. Joining is what opens the rest, which is what the nudge says.

**`viewerAttending` went with it.** Eight call sites passed the same
`attendees.some((who) => who.account_id === viewerId)` while also passing `everyone={attendees}`,
so the component now answers that question itself — eight copies of one expression replaced by
the one place that needs it.

**The nudge keeps its link inside a panel** (#521). The page-level `ErrorText` had
`link={joinLink(error)}` and `DreamPanel`'s did not, so pressing 🙋 inside an opened dream or a
meal dialog — where it is most likely pressed — produced "You need to join this burn" with
nowhere to go. One `ErrorText`, in the component both surfaces share.

It is hidden when there is nothing to choose between — one burn is the ordinary
case and a select with a single option is furniture.

**Every burn-scoped page says the same thing when it has no burn**, through `NoBurn`.
Now that both personas are offered every coming burn, an empty list means the same thing
to both — none is planned — so the two messages have converged on saying exactly that.
Only the fix differs, and the link to Events stays the admin's, being no use to anybody
else. Before #503 the member's copy said they had not joined one, which was true of the
list they were shown then and is a false claim about the world now.

It renders "Loading…" while the burns are still arriving, which is the state that
made this shared rather than copied: the burns are fetched once for the session, so a
page mounted before they land sees no selected burn and used to state that as fact,
then correct itself. A flash of a wrong claim is worse than a wait.

The choice is **not persisted**. A reload landing on the soonest burn is the right
default every time, and a remembered choice would leave somebody looking at last
month's grid with nothing on screen to say why.

**A `?burn=<id>` in the address chooses one** (#333), which is how a line in the feed
lands on the burn it is about. Read here rather than by each page, because every
burn-scoped page already reads this.

| Viewer                   | Bar                                                           |
| ------------------------ | ------------------------------------------------------------- |
| Signed out               | Apply, Log in                                                 |
| An account, neither role | 🔔 alone — an applicant, who is still told when it is decided |
| `member`                 | Feed, Members, Schedule, Leads, Meals, FAQ, and the circle    |
| `admin` without `member` | Feed, Members, Schedule, Leads, Meals, FAQ, ⚙️                |

- **Feed** is what everyone has been doing and saying (#303, #375) — see below. First of
  the entries, because it is the page that answers the question somebody has on opening
  the app between burns: is anything happening?
- **Members** is the roster a member may now read — see "What a member may change".
- **FAQ** is the burn's Q&A (#28) — a thing of its own rather than something reached
  from another page, because it is what somebody opens when they have a question and
  no idea which page would answer it. `docs/burns.md` has the shape.
- **Dreams** is reached from Schedule. Offering a dream and placing one are the
  same activity, and two entries for it is what the restructure undid.
- **Places** is reached from Schedule too: the lanes are what the grid draws.
- **Signing out** is on the details page, and nowhere else, under the line naming the
  account it ends — the line moved down to the button rather than the claim being dropped
  (#417), since it is the sentence the button is an answer to. Every entry in the bar is a _place_; this is an action, and it was the
  only one there. It was on ⚙️ → Settings as well (#195), for the admin that page refused —
  a second copy of one control, which is exactly what the push toggle was taken off that
  page for. #396 made the details page `approved` instead, so the copy could go.
- **The initials circle** is the details page: who you are, then a section per burn
  still to come — join it, or fill in your stay at it — then past burns behind
  _…show past burns_. It absorbed the page called "Your burn", singular, which was
  from when there was one burn worth showing and it was whichever came next.

  **`approved`, and only the burns are a member's** (#396, #412). The page was `member`
  outright, which left an admin who was not attending with nowhere to turn notifications
  on — and application notifications go precisely to admins. #396 opened the page and kept
  the name, contact and allergies behind `member`; #412 found that split was the same
  mistake one level down, since #390's introduction invites the person whose page it is to
  write one and that account could not. So everything that describes the **person** — name,
  contact, allergies, introduction, picture, ways of being reached, passkeys and providers,
  notifications, signing out — is any approved account's, and what is left behind `member`
  is the **stay**: `YourBurns`, because `joinEvent` is. `docs/accounts.md` has the argument.

- **🔔** is a link to `/notifications` that a wide viewport intercepts to open the
  panel instead (#336). `docs/accounts.md` has the why. It is the one entry offered to
  an account with no role at all, because an applicant is told things too.
- **The lodging and helping lists** are reached from that page, from
  _(edit lodging alternatives)_ beside the question they answer.
- **The rideshare board** is in ☰, and beside the arrival dates on the details page —
  which is where somebody is standing when they think about getting there (#26).
  `docs/burns.md` has the shape.
- **⚙️** is admin's alone. It used to be `Organise` and open to any approved member,
  because it was the only way to reach the two lists above; now those have their own
  way in, and what is left behind ⚙️ — the burn's shape, who gets in, payment, the
  installation — is admin's. It still links to both lists: they are the burn's shared
  furniture, and ⚙️ is where somebody organising is already standing.

**Width is three tiers, and only the first is a default.**

- **Unbounded**, which `.site-main` is and every page gets unless it says otherwise.
  The grids, rosters and registers are most of the app, and a reading column squeezed
  them into a sliver with the rest of the screen empty. The schedule used to escape
  that with a `:has()` override, which is the shape of a default that is wrong: one
  page opting out, and the next wide thing having to remember to.
- **`.prose`**, at `--measure`, for what is actually prose — the homepage's welcome
  text, the 404, and the served markdown pages.
- **`.column`**, at `--column`, for a page that is a stack of fields or cards rather
  than a table: Your details, Settings, notifications, the feed, somebody's page,
  signing in, redeeming an invite, applying. `GuardedPage` takes `width="column"`;
  signing in and redeeming an invite carry the class on their own `<section>`, and
  applying on its `<article>` (#421).

Both bounded tiers are **centred**, and neither is on `.page` — that class is on every
guarded page, so a width there would take the grids with it, which is the default this
arrangement exists to avoid.

Hiding a link is presentation. Every page behind these is guarded again server-side,
and `Layout.test.tsx` asserts each absence by name — a negated `arrayContaining`
passes when any _one_ of the named links is missing, which is not the question.

### ☰, at the leading edge of the bar

The bar carries one entry per thing and the bottom bar caps at six, so everything else
has been reached from the page it belongs to. That worked until a page belonged to no
other page: the rideshare board is linked from a form that only renders for a burn you
have already joined, so somebody who has not joined one could not get there at all.

**☰ is where those live** — 🎵 Songbook, 🛻 Rideshares and 🎁 Bring list. Beside the logo rather than on
it: the logo goes home, which is a convention worth more than the space a second target
costs. **Ahead of the logo**, at the edge its drawer slides in from — a control that
opens from the left, sitting to the right of something else, reads as belonging to that
something else.

**The drawer slides over the page, and the page does not move.** Pushing the site aside
would mean a `transform` on a wrapper, and a transform makes `position: fixed` resolve
against that wrapper instead of the viewport — which is `.bottom-bar` and `.bell-panel`,
and exactly the class of bug #344 and #348 were. The z-index scale gains two: bar 20,
popdown 30, the drawer's backdrop 34, the drawer 35, modal 40 — the backdrop one rung
under what it sits behind rather than a round number of its own.

It is **rendered only while open** rather than hidden with CSS, so its links are out of
the tab order the rest of the time with no `inert` to keep in step with an animation.

**The backdrop dismisses it**, not a document listener like the bell's. The backdrop
covers the viewport, so every press outside the drawer lands on it — and an "is this
inside?" check against a wrapper that contains the backdrop answers _yes_ to every press
on the page, leaving the drawer stuck open with only Escape as a way out. On a phone,
which is the viewport this is for, that is no way out at all. Escape still works and
hands focus back to ☰, and following a link closes it too, since a link to the page
already open changes no route to react to.

The drawer covers ☰ while it is open, so a **✕ inside it** is the pointer way out that
does not depend on hitting the strip of backdrop beside it. Focus moves to the first
entry on open and back to ☰ on every way out. While it is up the page behind it does not
scroll and Tab cannot reach into it — `useOverlay`, which the dream panel uses too:
an overlay that covers the page while the page scrolls under it, or hands focus to a
control behind an opaque backdrop, is telling two stories about what is interactive.

There is no ☰ at all when it would open onto nothing — a signed-out visitor may follow
none of it.

**The bar's nav is styled by class**, not as `.site-header nav`. The drawer is a `nav`
and it lands inside the header, where a descendant selector beats `.menu-drawer` on
specificity and lays a column of full-width entries out centred, wrapped and gapped.

**The bar pins its nav rather than spreading itself.** `justify-content: space-between`
put whatever was in the middle _in the middle_, and the bar's children come and go — ☰
only for a member, the burn selector only for a second burn — so ☰ landed halfway across
the bar for the ordinary one-burn viewer the day it was added. `margin-inline-start:
auto` on the nav holds for every combination; a second auto margin would split the free
space between the two and move the selector instead. Nothing in the suite lays anything
out, so `styles.test.ts` asserts it against the stylesheet as text.

### On a phone

Nine entries do not fit a phone's width. A member's bar was brand, burn selector, six
links, 🔔, 🙂 and ⚙️ with no responsive rule at all, so it wrapped to two or three rows
— which is also what put the bell's panel off-screen (#336).

Below `45rem` the six pages move to a **fixed bar along the bottom**, one icon each:

| 📜   | 🧑‍🤝‍🧑      | 🗓️       | 🕴️    | 🍽️    | ❓  |
| ---- | ------- | -------- | ----- | ----- | --- |
| Feed | Members | Schedule | Leads | Meals | FAQ |

The topbar keeps ☰, the brand, the burn selector and the three things that are about
the session rather than any page — the bell, ⚙️ and the face — and scrolls away with
the content as it always has. A signed-out visitor gets no bottom bar: Apply and Log in
are two entries and fit where they are, and a bar of six pages none of them may open
would be six refusals.

**And it does not wrap.** With the pages downstairs the only thing left to drop was the
corner, so on a narrow phone 🔔 ⚙️ and the face sat on a second row under the logo with
the whole right half of the first row empty — an admin's corner is a third icon wide, so
theirs went over first. Below `45rem` nothing in the bar wraps and the gaps tighten;
what gives way instead is the **installation's name**, which ellipsises, being the one
thing in the row that is a label rather than a control. Measured in Chromium with an
admin's three icons and "The Burning Sage": at 390px the name fits whole with 0.2rem to
spare, where the wide gaps leave it 1.8rem over; at 360px it is cut by 1.5rem and the
page still does not scroll sideways — which it does if the name is allowed to refuse.

Above `45rem` the bar wraps as it always did, because that is where the six words are:
too narrow for words and corner together, and the nav drops to a second row **whole**.
`.nav-session` is what makes that true — the bell, ⚙️ and the face are one group that
cannot be split, at any width.

**Six is the ceiling**, not a coincidence: six by ~3.5rem fits a 360px phone and
nothing wider does. The pages still to come — the map (#315), Leave No Trace (#29),
music (#316) — go behind ☰ rather than take a seventh seat, which is what ☰ was built
for and where rideshares (#26) and the bring list (#24) already are.

The entries are **one list in `Layout.tsx`**, drawn as words on a wide screen and as
icons here, so the two cannot come to offer different pages. Which layout is drawn is
decided in JavaScript by `usePhone`, not by `display: none`: a nav hidden with CSS
leaves a second copy of every link in the accessibility tree, and a bell that only hid
its panel would still have opened one off-screen. The stylesheet carries the same
`45rem`, and `viewport.ts` says so where somebody changing one would read it.

**The bar slides away as you read down a page** and comes back the moment you scroll
up (#340). The direction comes from a run of movement rather than one event, since a
flick arrives as a burst of small deltas that no per-event threshold would ever cross;
the top of the page always shows it, and nothing near the bottom may flip it, because
iOS reports movement in both directions at either end while the finger is still. The
slide takes `visibility` with it once it is over, so a bar that is off the screen holds
no focusable links.

**It does nothing on the schedule grid or the meal plan**, and that is a decision.
Both scroll internally against a `max-height` so their sticky headers have a box to
stick to, and `window` never scrolls on them. Letting the page scroll instead would
take those headers away on exactly the pages whose rows are unreadable without them,
which is a worse trade than a 3.5rem bar.

**A box that scrolls sideways is a containing block**, and that is load-bearing rather
than tidiness (#348). `.visually-hidden` is `position: absolute`, so without a
positioned ancestor its containing block is the _initial_ one: inside a table scrolled
sideways it sits at its static position, past the right edge of a phone, and a 1px box
there drags the whole document's scroll width out with it. The Leads page then scrolled
sideways beside its own table — and since a document wider than the viewport widens the
layout viewport on mobile, the fixed bottom bar went with it, too wide to fit and below
the visible area until the page was scrolled to its end. `styles.test.ts` asserts the
rule, because happy-dom applies no CSS and nothing else in the suite can see it.

**Three things float over a page**, and they share one stacking context — `.layout`
creates none — so source order decides ties. The scale is written down because it was
discovered rather than chosen: bar 20, the bell's popdown 30, a modal 40. At the same
`20` the nav painted over a dream's backdrop on a phone, with its links still tappable
through an overlay meant to be modal (#344).

### Wide things, and large text

Three rules the pages follow, all of them things a phone found first:

- **A table scrolls itself, not the page.** `Table.tsx` is the only thing that draws
  `.table`, and it draws the `overflow-x` box around it, so a roster wider than the
  screen cannot be added without one (#339). The schedule grid, the meal plan and the
  leads register each solved this separately first; this is the fourth copy turned
  into a component.
- **A heading that is a sentence is a `<caption>`, not a `<th>`.** `.table thead th`
  is `white-space: nowrap`, which is right for _Status_ and _Expires_ and wrong for
  _What happens to you_ — it cannot wrap, so it overflowed into the column beside it
  and the two words sat on top of each other at a larger text size (#341). A caption
  spans the table and has nothing to collide with. Column widths given in `rem` grow
  with the reader's text while the viewport does not, so the notification switches ask
  for `min(5.5rem, 22%)`: the percentage is of the table and cannot outrun it.
- **An editor opens as tall as what it holds.** Every text box opened at three lines
  whatever was in it, so editing a page of welcome text began by scrolling inside a
  sliver (#338). `rowsFor` in `textarea.ts` sizes them from the value and grows them as
  somebody types; `rows` on `MarkdownField` is a floor now rather than a size.
  `field-sizing: content` would measure it exactly and is not used — it makes the
  browser ignore `rows`, so the fields that ask for a taller empty box would open at
  the stylesheet's floor in Chrome and at their own everywhere else.

## The icons (#621)

**Colour names what a thing is; grey line art is what you can press.** The pages keep their
emoji — 🎵 Songbook, 🛻 Rideshares, 🍽️ Meals — and so do the marks on the feed's activity
lines and the before/during/after phases on Leads. Those say _what this is_, and a grey
outline pan is worse than 🍳. Every control went the other way: a pencil, a trashcan, a
bell, a heart, a hand, one weight and one colour. A row may hold both — a page's own mark
beside the arrow saying it opens elsewhere — but two _controls_ in one row are never one of
each.

The twenty-four the app uses are the twenty-four it ships. They are
[Lucide](https://lucide.dev)'s, pasted as path data into `Icon.tsx` exactly as #492 pasted
Simple Icons' brand marks into `MusicIcon.tsx`, with the ISC notice in
[THIRD-PARTY.md](../THIRD-PARTY.md). No dependency: a package would bring six hundred
icons and a tree-shaking argument to have with Rollup, and the reason `packages/shared`
sets `sideEffects: false` is that this app has already lost that argument once.

**`currentColor` and `em` are what kept it to one new rule.** `.icon` is `1.1em` square and
the drawing is `fill: none; stroke: currentColor`, so every rule that already set a control's
colour and its `:hover` reaches the icon untouched, in both themes, and each place decides
the size from its own `font-size`. The bell gained something in the move: it was greyed with
`filter: grayscale(1)`, which does nothing to a drawing that is one colour already, so
unseen notifications turn it `--ember` instead.

**The drawing is `aria-hidden` and the name stays on the button**, which was already true of
the emoji and is why six assertions in eighteen hundred had to change — a control is found by
what it does. Where a test does need to know which face is showing, the homepage's pencil
wearing an hourglass while a re-read is in flight, the `<svg>` carries `data-icon`.

**♭** and **♯** stayed as they were. They transpose a song; they are text, not icons, and
nothing in a line-icon set says what a flat says.

## Destroying something asks first (#594)

One component, `Destroy`, for anything that cannot be undone by pressing the same control again.
It replaces four hand-rolled copies of the same "Really …?" state — in the dream's withdrawal, the
lead role, the FAQ entry and the songbook — and covers the twenty-eight controls that had nothing
at all. Whether a thing asked was decided by which call site was written last, which is how a
scheduled meeting was lost with one press.

**Inline, not a modal.** The question replaces the control in place: no overlay, no portal, nothing
to trap focus in. That is what the four originals did and it is the cheaper thing to get right.

**The wording comes from two props.** `what` names the thing and `verb` says what is about to
happen to it, so the trigger reads _Remove Sauna_, the question _Remove Sauna? Everyone on it goes
too._ and the answer carries the accessible name _Really remove Sauna_ — which is what a test keys
on. `because` is the clause naming what else goes; it takes markup, for the one that italicises.

**A worded trigger keeps its own accessible name.** Where the control is part of a sentence — _I
cannot come after all_, _Back to the flame_ — the visible text is the name. `triggerLabel` overrides
that for the pages where several buttons read _Remove_ and the name has to say which.

**What must not use it:** anything the same press undoes. A heart, a hand put up, taking yourself
off a crew, a soft withdrawal that can be restored. A confirmation on everything is a confirmation
on nothing, and those controls are how somebody explores what a button does.

## Feed

A page of what everyone has been doing (#303) and what they are talking about (#375),
because between burns the app was quiet and quiet reads as nothing-to-do.

**Two things on one page, deliberately.** Anything you can talk about is one **card**
carrying its whole history and the talk under it — a dream, a person at a burn (#426), an
announcement (#438); the burn's own news that nobody talks to — a lead role added, a lead
taken — stays a **line**. Collapsing everything by thread was the first design and it does not work: the
lines that belong to no card would end up behind one card per burn, which is the page's
list disappearing into an accordion. So `activity` keeps what has no conversation to hang
on, and shrinks as each kind of thing gains one — saying you are coming was a line until
#426 and is a card now.

The server merges both halves by time and cuts them to fifty **against each other**, so a
burn full of talk cannot push its news off the page and a quiet one does not leave the
page half empty.

### Something taken back is off the page (#617)

The feed is what is going on, and a tombstone is not. A card whose thing has been taken back is
dropped from the read, wherever its date would have put it — an announcement or a bring item with a
`withdrawn_at`, a song with a `deleted_at`, a dream whose `session` row is gone, a stay somebody
left. A meeting and a talking point delete their thread outright (#608), so they never reach it.

**One definition of gone, and it is `factsFor`'s.** The route reads the cards and drops the ones
`readThreads` marks `gone`, rather than repeating each entity's rule as a `where` clause — a second
spelling of "withdrawn" is a second thing to keep in step, and the entity that gains a soft
withdrawal next would have to remember both. The cut to fifty happens after, so a run of tombstones
takes the page's slots but never a live card's place in the order.

#611 was the first answer to this, and the wrong one: it made a `withdrawn` entry not count as
liveliness, so the card stayed where it already was, marked "taken back", and a comment on it could
still lift it. There is no card left to order, so that rule is gone and `recentThreads` is back to
`max(created_at)` — a card whose newest entry is a withdrawal is never on the page for the ordering
to matter.

**Only the place on the page goes.** `GET /api/threads/:id` answers for a withdrawn card exactly as
it did, which is what the soft withdrawal is for and how the tests read one. The web still renders
`gone`, because a card can go stale under a page that is already open — that it can is its own bug
(#614) — but no load will bring one back.

**What it costs.** A withdrawn dream's conversation is now reachable from nowhere in the app: the
panel went with the dream, and the card was the last door. The rows are all there; a page for a
thread of its own is a separate thing to want.

### The chip row

Filling the songbook makes the page songs for a week; a scheduling run makes it dreams for
an evening. The floods are bursty and temporary, so the answer is a viewer-side lens rather
than collapsing (#472) — a rollup hides cards that are each individually worth having, and
needs an answer for a comment landing inside the pile. Coalescing already tempers the flood
one level down: ten edits to one song are one card. What it cannot help with is thirty
genuine happenings of one kind drowning the other kinds.

**The filter is the server's**, because the page reads the newest fifty: during exactly the
sprees above all fifty are one kind, so hiding them in the browser would show an empty
_Dreams_ while dream cards sat just past the window. `kinds` is a query parameter on the
feed read and the limit is applied after it, so fifty means fifty of the kinds asked for.

**One chip per kind of thing on the page**, derived from `threadEntityTypes` plus one for
the lines, so a future card kind gets its chip by construction rather than by somebody
remembering a list — `feedKindLabel` is exhaustive over the vocabulary and will not compile
without it.

**An empty lit-set means everything**, and that one rule is the whole interaction: the first
tap from there solos a chip, which is the scheduling-run case in one tap; taps after that
toggle one by one, which is the hide-the-flooding-kind case in one tap; and taking the last
one off lands back on everything rather than on an empty page. `Everything` is lit only when
nothing is filtered, so the row itself is the "you are filtered right now" signal. Every
chip lit is normalised back to the empty set, so two spellings cannot both mean everything.

**Carried in the URL, never in storage.** A filter somebody set during a scheduling run in
March must not still be eating the songbook news in June, so every visit starts at
everything; the address makes it shareable and lets back undo it. An unknown kind in a
stale link is dropped rather than refused — that shows more than was asked for, never an
error page.

**The songbook's category chips are the same row** (#316, #472), so the app teaches the
interaction once. The rule that serves both is _show what matches any lit chip_: a card has
exactly one kind so it degenerates to the obvious thing, while a song carries several
categories and stays visible while either is lit. The songbook keeps its lit-set in the page
rather than in the address, because there is nothing there to link somebody to.

### The lines

**The burn-wide notifications, shown to everybody.** Somebody saying they are coming, a
lead role added, a lead taken. Those categories are **off by default** — a burn where
every arrival pings forty-two people is a channel people learn to ignore (#259) — so
until this page the ordinary way to learn anything had happened was to go looking.

**An `activity` row, written where `notifyAttendees` fans out.** The alternative was
deriving the feed from the rows that already exist, and it does not work: those carry
_current_ state, so a helper who signed up and stood down again leaves nothing to show,
and several of the join tables have no `created_at` at all.

The wording is the notification's own, third person, and so is the link. Nothing about
payment, contact details or allergies can reach the feed, because nothing but a
burn-wide notification writes to it.

### The cards

**A dream is something you can talk about.** Under it is one column of what the app did
and what people said, in the order it happened: offered, facilitated, a hand up, a
question, an answer. The point of hanging it on a dream rather than on a change is that a
dream is still there next week, so the comment is still worth reading.

**The card is the conversation, not a preview of one** — a comment box included. The same
component draws it inside the dream's own panel (#342), so the two cannot come to show one
conversation differently. A withdrawn dream has neither: the panel goes with the dream and the
card is off the feed (#617), leaving `GET /api/threads/:id` as the only thing that answers for it.

**The title is never frozen into a sentence, and that is the bug this fixed.** An
`activity` line freezes it — "Ada offered a dream: Sauna at dawn" — and goes on saying it
after the dream has been renamed. A dream's card heads with `thread.title`, which the
rename keeps in step. A person's card cannot use the stored title at all: a name is the
account's, and renaming yourself must not leave the old one on the feed, so `readThreads`
resolves it from `account.name` and keeps `thread.title` only as the fallback for when the
account is gone — the same shape as a null title meaning "withdrawn" for a session. An
entry's body carries neither the title nor the actor's name: the author is a column, so a
name is resolved when the line is read.

**A thread outlives the dream.** Withdrawing one leaves a line saying so rather than
deleting what people said to each other, which is why `thread.entity_id` deliberately
carries no foreign key, and why `event_id` and `title` sit on the thread rather than
being joined out of a row that may be gone. Retention is still the burn: a thread
cascades with the event.

#### Naming somebody

**A mention is an id, not a handle** (#439). `account.name` is nullable and not unique — `NAMELESS`
exists because of it — and there is no username column anywhere, so `@name` as plain text has
nothing to resolve against. The data-model rule already says what to do: reference by id and
resolve the name at read time. The token is `@[Ada](mention:a-1)`, which is markdown-ish enough to
survive `markdown.ts` and tolerable to look at while editing, since the raw body is what the author
sees.

**Three things make it safe, and each one is the reason for the next.** The name inside the token is
author-controlled, so `mentionName` strips `[`, `]`, `(`, `)` and newlines — a name that could end
its own token could put the rest of itself outside. `mentionsAsLinks` then rebuilds the token as
`[@Ada](/members/a-1)`, so the renderer escapes the name like any other link text rather than
anything here escaping it. And it runs **inside `renderMarkdown`**, so no call site can forget it:
a token that somehow reached the page unconverted renders as its own text, because `mention:` is not
a scheme `isSafeUrl` allows.

**The name is refreshed when a thread is read**, not when it is written. `readThreads` collects the
ids out of every entry body and every post body it is returning, looks the names up once, and
rewrites the tokens — so renaming yourself changes what a comment written last year says about you.
What was typed survives only as the fallback for an id nobody can look up.

**Attendance is the audience, whatever the composer allowed.** `namedBy` intersects the ids in a
body with the burn's `attendance` rows and drops the rest silently; `@everybody` is that whole set.
Both minus the author, because nobody is told about their own click (#247).

**Being named is the most specific claim, so it wins.** Somebody named in a comment on their own
dream would otherwise get `dream_comment` as well; the mention is sent and the pile is not, which is
what keeps one comment to one notification per person. `mentioned` is `about: 'you'` and **on**,
which needs no argument: being named is the definition of what happens to you.

**It may only displace what it actually replaces.** Somebody who has switched `mentioned` off would
otherwise hear _nothing_ about a comment they had asked to hear about, because the mention that
displaced it was never written either — one notification becoming zero. So the named list is
filtered by whoever the mention reaches, on the bell or by email, before anybody is taken out of the
ordinary audience.

**An edit tells only whoever was added.** `tellNewlyNamed` diffs the mention sets before and after,
so fixing a typo in a comment that names somebody does not name them again. A comment's edit
notifies nothing else at all, which it did not before either.

**`@everybody` is any approved member's.** The alternative was gating it to admins, and the trust
model this app replaces is a spreadsheet everybody could edit; at forty-two people the cost of one
over-eager `@everybody` is small and social pressure is the real rate limiter. It is also the reason
`post_written` can honestly stay off by default — an author who needs the burn's attention says so
in the body rather than relying on a category nobody would leave on.

#### An announcement

**A post is the one card that mirrors nothing else** (#438). Everything else on the feed is a
view of a row that exists for its own reasons — a dream, a stay. A post exists to be
announced: "the planning call is Sunday the 14th". So it is an ordinary entity with an
ordinary thread, `entity_type: 'post'`, and commenting, bumping, notifying and the retention
rule all fall out of the thread design without a line of new machinery.

**The body is on the row, not on the first entry.** The alternative was tried on paper and is
worse: it forces `MAX_COMMENT` on an announcement and makes "edit the post" mean "edit entry
seq 0". `MAX_POST` is 8,000 — longer than a comment, shorter than a welcome page — and the
card reads it at query time, so a rewording cannot leave the feed quoting the old wording.
`posted` is the entry that opens the card and `edited` the one a rewording adds, which
coalesces — so six passes leave one line rather than six, and each of them still brings the card
back to the top, because coalescing rewrites the entry's `created_at`.

**Its card links nowhere, because the card is the post.** A dream's card links to its panel
and a person's to their page; an announcement has no elsewhere to be. The notification about a
comment on one therefore points at `/feed`, which is where the card is.

**Withdrawing keeps the conversation**, exactly as a dream's does: `withdrawn_at` is set, a
`withdrawn` entry is added, the title stays and the body goes. The author may withdraw their
own and an admin may withdraw any — the same split `deleteComment` already makes, and the
answer #426 deliberately left open for its own card. Withdrawing twice adds one entry. A save
that reworded nothing adds none: the page sends both fields whatever was typed, so `isEmptyPatch`
never fires from it and pressing Save on an unchanged form used to re-top the announcement on
everybody's feed (#455).

`post.author_account_id` is `set null` rather than a cascade, so the row outlives somebody
leaving — but **that is a claim about the row, not about the card** (#455).
`thread_entry.author_account_id` cascades, so deleting an account takes its entries with it, and
a post whose only entry was `posted` then draws no card at all: `recentThreads` is built from
`thread_entry`, and a thread with no entries is never returned. `set null` there is not the
answer either, because `thread_entry_comment_author_check` requires a comment to have an author,
so the cascade would fail the constraint instead. Nothing in the tree deletes an account (#35),
which is why this is written down rather than fixed.

**Announcing is any approved member's**, which is the repo's default for the burn's shared
furniture. Whether a lead's announcement should read differently from a member's is a
question about presentation, not a permission, and there is no bit here to change if the
answer turns out to be yes.

**`post_written` is off by default**, which sits oddly for content whose whole point is reach —
and is still right. #259's rule is that what happens _around_ you is off unless asked for, and
the reach is the card on the feed rather than the bell. An author who needs the burn's
attention has @-mentions (#439) to say so in the body, which is a better instrument than a
category everybody would have had to switch off.

#### Somebody's own card

**Every way in opens it** (#478). The join button was the only path that wrote the card, and
redeeming an invite called `joinBurn` straight past it — so the arrival that most deserved one, a
brand new member's, was the silent one. `announceJoined` is the card and the bell together, called
from both, and a migration mints the cards for the stays that arrived before it. Their entries are
dated from the stay rather than from the deploy, so the feed's order stays honest.

**One card per (person, burn), and joining opens it** (#426). Saying you are coming and
saying who you are are the same card: `entity_type: 'attendance'` with the attendance id,
which `thread.event_id` files under the right burn and gives the same retention.

**Found by the person, pointed at the stay** (#449). The attendance id alone was not enough,
and the sentence that used to stand here — "`thread_entity_idx` already means one conversation
per person per burn" — was one step ahead of the code: leaving **deletes** the attendance row,
so rejoining minted a fresh one, opened a second card, and left the first permanently saying
"no longer coming" about somebody who is. `subject_account_id` is what a card is looked up by,
so a rejoin re-points the surviving card at the new stay and keeps what people said under it.
`entity_id` still carries the current stay, which is what `gone` is read from — and the subject
resolving from the thread rather than through the stay is why a card for somebody who has left
still carries their name and their page.

An `account`-keyed `entity_id` was the other way out and cannot work: `thread_entity_idx` is
unique on `(entity_type, entity_id)`, so it would mean one thread per person across every burn.

**The database holds that invariant now, not one function** (#464). `thread_subject_idx` was a
plain index and `cardFor` reads with `limit(1)` and no order, so a second row would have left it
picking arbitrarily; it is unique on `(subject_account_id, event_id)`, and NULLs stay distinct in
a SQLite unique index so every thread that is nobody's is unaffected. Making it unique needed the
rows #449's own backfill could not reach: it read `attendance` by `entity_id`, so somebody who had
**already** left kept a NULL subject and the frozen title. The person is recoverable from whoever
wrote the card's first entry, which for a card is the arrival itself — and where somebody had left
and rejoined that produces two cards for one burn, so the migration merges the pair onto the one
whose stay still exists, renumbering the merged entries by time. Without the merge the unique index
cannot be created at all, which is asserted rather than assumed.

`aboutWhat` and `participantsOf` read the column too, so a comment on a card whose stay is gone
still has somebody to tell and somewhere to point.

**The introduction is resolved, not stored on the entry.** `readThreads` reads
`account.introduction` and the entry itself is a bump, so rewriting a paragraph cannot leave the
feed quoting the old one.

**And the card carries the whole of it** (#478). It was cut at 280 characters with an ellipsis,
which is the rule that keeps a post or a dream from swallowing the page — and the wrong rule for
the one card whose entire job is to be read. `MAX_INTRODUCTION` is 10,000, so fifty of those is
the worst a page can weigh; introductions are a paragraph in practice, and the excerpt was buying
a bound against a case nobody has hit at the cost of truncating every case they have. `excerptOf`
had no other caller and is gone with it, mention-token-safe truncation and all — git has it if a
future card needs one.

**Rewriting bumps once, and tells the burn once.** `introduced` coalesces, so six passes at a
paragraph move one card up the feed rather than leaving six lines — the argument `renamed`,
`scheduled` and `edited` already make for being kinds of their own rather than one `edited`.
The bell follows the card because `addEntry` **reports whether it inserted or coalesced** and
the notification only goes on an insert (#449). Before that the feed said one thing happened
and the bell said six, about the same six saves.

**Only burns that have not ended.** An introduction written today should not resurrect the
card from a burn two years ago, so `announceIntroduction` filters on `event.end_date >=`
today. Nothing is backfilled either: somebody whose introduction is already written gets no
card until they next change it.

**Clearing it says nothing.** A write that leaves the introduction empty, and a profile
save that never touched it, both announce nothing — the guard compares before and after
rather than trusting that a PATCH carrying the field means it changed.

**Nobody moderates it.** A conversation _about a person_ sits on their own card, and the
question of whether the subject may delete other people's comments was decided against on
purpose: the card is automatic and what it mostly shows is their own introduction, so their
lever is editing that or their contact list. Comments follow the dream rule — an author
deletes their own, and an admin may delete any.

**What leaves a quiet line, and what does not.** Offered, facilitated, handed over, a
hand up or down, renamed, moved, edited, withdrawn. A heart does not — the faces are on
the dream already, and twenty hearts is twenty lines nobody reads.

**A heart on every card** (#479), and it stays that quiet everywhere: no notification, no
`activity` row, no entry, no bump up the feed. A heart is for the next reader to see, not a bell
for the author.

**Two tables behind one button.** A dream's heart is `session_support`, unchanged — the heart on
its card and the heart on its schedule chip are one heart, and two like-buttons meaning different
things on one dream would be worse than none. Everything else is `thread_support (thread_id,
account_id)`, account-keyed rather than attendance-keyed because the songbook belongs to no burn
and so has no attendance to hang one on. The count is derived at read, never stored, and the
insert is `onConflictDoNothing`, so pressing twice cannot inflate it.

**One route pair over both**, `POST`/`DELETE /api/threads/:id/support/me`, dispatching on
`entity_type` — so the web has one call for every card, and a dream's rule travels with it:
hearting one asks for an attendance at that burn, as `asAttendee` does on the dream's own route.
Not for an **open** burn, though — the dream's own route goes through `onOpenBurn` and this does
not, which puts a heart with the comment box rather than with the writes: "that was lovely" is a
thing somebody presses on the way home.

**A withdrawn dream's card refuses the heart.** `thread.entity_id` deliberately carries no foreign
key so the conversation outlives the dream — but `session_support.session_id` does carry one, so
the insert would dangle and answer 500 rather than refusing. The route looks the dream up and
answers 404; the card hides the button, which is the nicer half but not the sufficient one, since
the route is reachable directly. The song page shows the faces as well as the count, through the same overlapped
row the dream panel uses — now `Faces`, since it has a second caller.

**Coalescing happens on the write.** Laying out the grid is a drag every few seconds, so
a second line of the same kind by the same person with nothing in between rewrites the
first rather than adding to it. On the write and not the read, so nothing accumulates and
the card and the whole thread cannot come to collapse it differently. Per aspect — a
rename followed by a move keeps both lines, and fifteen moves keep one — which is why
`renamed`, `scheduled` and `edited` are three kinds rather than one.

**A conversation is ordered by `seq`, not by the clock.** One save changing a dream's
name and its time writes two lines from one reading of `now()`, and two lines sharing a
millisecond would come back in whatever order the ids compared in. A conversation that
reorders itself reads as a different conversation.

**No formatted time is ever written into a line.** The server does not know the reader's
zone, so "moved it to Sat 14:00" stored here would be Saturday in UTC. The line says
something moved; the dream says when.

### Talking, and being told about it

`GET /api/threads/:id`, `POST /api/threads/:id/comments`, `PATCH|DELETE
/api/comments/:id`. Keyed by thread id rather than by the dream's, because a withdrawn
dream has no id left to ask by. A comment is the author's to rewrite and the author's or
an admin's to take down — an admin may take a comment off but not put words in somebody's
mouth, since a deletion says who did it and an edit would not. A line the app wrote is
nobody's to edit.

**A comment is allowed on a burn that has ended**, and it is the one member-facing write
that is not scoped to an open burn. Talking about a burn is not arranging one, and "that
was lovely" is a thing somebody posts on the way home. Every other dream write stays on
`openEvent`.

**The bell is a menu in the card's corner** (#480). It was a chip at the tail reading
"A song goes into the songbook 🔔", which is opaque unless you already know it is a setting —
it reads as a label. The menu is titled _Notification settings_ and holds the two switches that
exist for one card: this kind of thing, and this card. It is the app's first dropdown, so it sets
the pattern — a real button with `aria-expanded` and `aria-controls`, and closing on outside-press
and Escape. The activity **lines** keep their inline chip: a bell-menu per one-liner is more chrome
than line.

**It is not a menu, and it stopped saying it was** (#487). `role="menu"` puts a screen reader into
menu mode, where it expects `menuitem` children and arrow-key navigation; what is inside is a title
and two checkboxes, so the labels were announced unpredictably and nothing moved focus in. The panel
is a `role="group"` with the same accessible name and the button points at it with `aria-controls`,
which is what a disclosure is. `aria-haspopup` went with the role: it means "menu" whatever value it
is given.

**A pair of categories per kind of card, split the way every other pair here is** (#259).
A comment on a thread you are part of is `about: 'you'` and **on**; a comment on any card
of that kind at a burn you are coming to is `about: 'else'` and **off**. So
`dream_comment`/`dream_comment_any` for a dream and
`introduction_comment`/`introduction_comment_any` for a person, and `entryCategory` takes
the entity type as well as the kind — without that, the switch under a person's card would
offer to turn on comments about every dream. The audiences are disjoint so nobody is
told twice, and never the person who just wrote it (#247). Who is "part of it" is whoever
has spoken on the thread, plus — for a dream — the facilitator and the helpers, and for a
person, the person it is about. Appointing somebody writes a line authored by whoever
appointed, so a facilitator handed the dream has said nothing and would otherwise never
hear a question about it.

Neither writes an `activity` row: the entry is the record, and a line beside it would put
one comment on the page twice. That is what `tellAttendees` is for beside
`notifyAttendees`.

**And one card can be followed or muted** (#480). `thread_follow (thread_id, account_id,
enabled)` is the absence-means-default pattern `notification_setting` already uses: no row and
the participants rule above decides; `enabled` puts somebody in the reply audience without their
having spoken; disabled takes them out of it though they would otherwise be in — which is the
escape hatch for a commenter drowning in a lively thread, and falls out of the same column for
free. `tellAbout`'s audience becomes (participants ∪ followers) − muted − author, and the wider
`_any` audience is **muted − author** as well (#487). It was not, and a mute was then a downgrade
rather than a silence: subtracting muters from the participants made them newly eligible for the
`_any` bucket, so somebody who had turned on `dream_comment_any` and then muted one thread heard
about every reply to it under the other category, while the box read unchecked. A mute is the one
switch that names a single card, so it wins on that card whatever the category switches say.
Mentions stay untouched: naming somebody addresses them, and the category switches are what govern
everything else.

**The checkbox shows the effective state**, so what it says is always what will happen — which
means `readThreads` has to compute participant-or-follower for a page of fifty cards. Three
queries do it (spoken on, facilitating, helping) and the rest reads off columns the card query
already selects, rather than `participantsOf`'s several queries per card.

**The author is an `account`, not an `attendance`** — deliberately unlike
`session_helper`. Leaving a burn empties your spots and must not delete what you said; a
thread with the replies missing reads as though nobody answered. It cascades with the
account, which is where erasure belongs (#35).

**Members author it, so it is markdown and it is sanitized.** `markdown.ts` escapes raw
HTML rather than filtering it, and untrusted authors are already inside what it defends
against. A quiet line is drawn as text, so a dream titled with a tag is text too.

### The rest of it

**Each link carries the burn it is about** (#333). The links are burn-agnostic —
`/dreams`, `/members`, `/roles` — so following a line about the autumn burn while the
selector sat on the summer one opened the summer page. The line appends `?burn=<id>`, and
`burn.tsx` is what reads it. A card names the dream as well, `?dream=<id>`, which the
Dreams page reads to open the panel — the panel is local state, so before #375 no link
could reach one. Both parameters are spelled once, in `pages.ts` in the shared package,
because the backend writes them into notifications and the web builds and reads them.

**The chip is half of it.** A line carries its category's own settings-table label as a
toggle, so somebody meets the switch in the moment they have just found the thing
interesting rather than in a table of thirteen rows they went looking for. A card carries
the newest one of its lines that names a category anybody could be told through — a dream
being moved sends nothing, so a card whose latest news is a move offers no chip rather
than one that would change nothing.

**Reading it writes nothing.** The bell and its unseen count stay `notification`'s; a
feed that marked itself read would be a second thing to keep in step with them. And
`requireApproved`, like the roster: everything on it is already readable by an approved
member, gathered into one place.

**A card carries the newest few entries, not all of them.** `readThreads` ranks a thread's
entries with `row_number() over (partition by thread_id order by seq desc)` and takes the
`newest` it was asked for; the whole-thread read passes none and gets all of them. Reading every
entry of fifty threads to slice three off each was the one read here that grew with how talkative
a burn had been (#387). `thread_entry_seq_idx` is `(thread_id, seq)` because that is what all
three readers order by — it was `(thread_id, created_at)`, which served none of them.

**A heart does not unfold the card** (#487). Every write on a thread answers with the whole thread,
which is right for saying, rewording and deleting a comment — you have just written in it — and
surprising for the heart and for the bell's follow switch, where pressing one on a card with ten comments
unfolded all ten and made "show the whole thread" vanish. The fold is the client's, not the
server's, so the fix is there: those two paths keep the `entries` and `entry_count` the card was
already showing and take everything else from the answer. Keeping the fold rather than folding to
three is what makes it right in both directions — a card somebody had expanded stays expanded. The
song page's own conversation is unaffected, because it never folds.

**Retention is the burn, for everything that has one.** `activity` cascades with `event`
and so does a `thread` that names one, and the route reads the newest fifty. An audit log
grows without bound; this is bounded by something that already ends. The songbook is the
exception and says so below: `thread.event_id` is nullable for it, so a song's
conversation is kept as long as the song is.

**What the installed app keeps on disk.** The feed is at most two cache keys, each replaced
in place: the unfiltered read, and the newest filtered one — `trim` keeps only the newest
query string per path, so a chip row tapped all afternoon does not accumulate a key per
combination. Each is bounded by construction: fifty things, at most three lines a card, and
`MAX_COMMENT` is 2000. The whole thread is a read of its own and is **never cached** —
that would be a key per dream ever opened, kept until sign-out, which is the shape of the
problem #311 fixed for the banner. Offline you get the card's newest lines; the rest of
the conversation needs the network.

What is _not_ on it yet: an unread mark per thread, a digest instead of one notification
per comment, reactions on a line, and threads on a meal or a ride.
`entity_type` is what makes each of those a value in the vocabulary and a branch in three
places — the link, the participants, and the comment's categories. Those three are lookups
keyed by the type rather than chains of `if`, so the compiler names what a sixth is missing. Adding one is **not**
free of a migration, which #426 established by being the second: the column carries a
CHECK listing the vocabulary, so a value added to `enums.ts` alone passes Zod and the type
checker and then fails the write. `db.integration.test.ts` now checks each vocabulary in
the database against the one in the code, so the two cannot drift silently again.

## The songbook

The point is singing together: one shared book, so whoever picks up a guitar and whoever
holds a phone are looking at the same words. A song has a **title** and everything else is
optional — the words, chords, links, a capo, categories, and whose song it is.

**The artist is a field, not a line in the words** (#538). A book is browsed by who wrote it
about as often as by what it is called, and a name pasted into the body cannot be sorted on —
it is also a chord line's width away from being read as one. So `song.artist` is a nullable
column: most of what is already in the book has no artist recorded, and a blank is not an
artist called "". `nonEmptyText(…).nullable()` is what refuses the empty string, and there is
no CHECK saying the same — SQLite cannot add one through `ALTER TABLE`, and rebuilding `song`
would take `song_in_category` down with it.

**The row is the link, not the title** (#568). A bordered box the width of the screen with a
few words in it live is a target problem on a phone; the anchor is the row, and the title inside it
carries the colour and the underline so it still reads as one. The marks sit at the far end on their
own `margin-inline-start: auto` rather than on the artist beside them (#567) — a row nobody has named
an artist for has no such sibling, and its marks used to sit against the title. The taken-out rows
keep the old shape, since the restore button cannot live inside a link.

**Sorting is the client's, and by artist puts the nameless last.** The list is already loaded
whole and filtered by chips in the page, so a second order is `inSongOrder` over what is in
hand rather than a query parameter and a second index. Nulls last in either direction, because
a run of songs nobody has named at the top of the book is what "by artist" is least likely to
mean. The book's own read stays alphabetical by title, which is what the page opens on.

**It belongs to no burn** (#316), which makes it the second deliberately global thing here
after the feed. Songs outlive a date, so there is no `event_id` on `song` and none on its
thread. That is what made `thread.event_id` nullable, and the nullable column is the whole
of the change: `readThreads` left-joins `event` instead of inner-joining it, `Thread.burn`
is nullable, and the card says _Songbook_ where it would name a burn.

**Everybody may write it, and everybody may take from it.** `requireApproved` on every
route — adding a song, editing any song, taking one out, putting one back. This is
spreadsheet parity at its purest: a songbook is the least sensitive furniture the app will
ever hold, and ranking who may correct a chord would cost more than it saves. What stays
admin's is the **curated category list**, under `/api/admin/song-categories/` — the one
part of it that is a vocabulary rather than content.

**Shared furniture several people edit is what `if-match.ts` is for.** The song page reads
`GET /api/songs/:id` with an ETag and every write carries `If-Match`, so two people
polishing the same verse do not silently overwrite each other. **The version covers the
song alone**, not the response: the response carries the conversation as well, and a
comment arriving while somebody has the editor open must not read as a conflict. That is
`withCollectionVersion` with the payload and the versioned part passed separately.

### Chord lines are detected, not marked up

The body is stored as plain text and a line whose every token parses as a chord **is** a
chord line. That is the format ultimate-guitar renders, so pasting a song in from there
just works — which is how most of the book will actually get filled. There is no markdown
here: a songbook body is preformatted text, and letting the browser wrap it would slide
every chord off its syllable. `white-space: pre` and a monospace face in the editor as
well as the page, since the columns are typed in one and read in the other.

**So the app wraps it instead** (#491), because a line wider than a phone otherwise runs off
the side, and reaching the end of it means dragging the words sideways with a guitar in the
other hand. `songRows` pairs a chord line with the words under it — one row, not two lines —
and `wrappedRows` breaks that pair at a **single column, blank in both**, so no chord and no
word is ever split. The continuation then loses the whitespace the two halves share, which is
what puts the words back at the left edge with the chords still over them.

One rule beyond "blank in both" earns its complexity: a chord standing in a gap heads the words
that **follow** it, so a break may not fall between the two. Without it, `Em` over the space
before `while` is stranded at the end of the line above, pointing at nothing. It is why
`breakColumn` looks at where the chord tokens start rather than only at what is blank.

**A half that runs out is dropped, but only where something was split** (#494). A continuation
with no chords on it, or one whose words ended a break ago, renders as an empty line — and an
empty line in the middle of a verse reads as a verse break, which is a lie about the song. So
`piece` nulls an empty half. It takes `split` because a body's own blank lines are `words: ''`
and must survive: the rule is about halves the wrapping emptied, never about a line the author
left blank.

`split` alone was not enough to say that (#511). A blank line **padded with spaces** is wide
enough to wrap, so both of its halves were split, both came out blank, and the verse break
vanished — below a given width only, so the same song read right on a laptop and wrong on a
phone. `broken` now returns a row with nothing in it untouched, which is the real statement of
the rule: a row that was never anything cannot have been emptied.

How many columns fit is measured, not assumed: `.song-ruler` is an empty `1ch` box inside the
body, so the count is the content width over its width, watched with a `ResizeObserver`.
Unmeasured means `Infinity`, which is what the tests and any render before layout see — so
nothing wraps until something has measured, rather than wrapping wrongly.

**A link shows the platform's own mark** (#492), the paths taken from Simple Icons, which are
CC0. `musicHost` names the platform and the web decides how it looks — an emoji stood in for a
logo and read as decoration, and 🎧 for Spotify looked like a generic "audio" glyph rather than
a detection that had worked. Brand colour is what makes one recognisable at that size, so it is
set per mark in `styles.css`; TIDAL's black and Genius' pale yellow each disappear into one of
the two themes, and those two keep `currentColor`. Ultimate Guitar has no mark in the set and
keeps its emoji.

The detector lives in `songs.ts` in the shared package, outside `schemas/`, because the
web needs it at runtime and it needs no Zod — the same rule `enums.ts` follows. A line
needs at least one real chord to count, so a rule of dashes is not one, and the token
grammar is the test: `Bad`, `Cab` and `Fade` all start with a note letter and none of them
is a chord.

**Transposing holds the columns.** `transposeLine` rewrites each token and takes the
difference out of the following run of spaces, never closing a gap altogether — so `Bb`
becoming `B` does not walk the rest of the line out from under the words above it. The
result is spelled with flats when the chord was written with one. It is viewer state and
writes nothing: the stored song stays in the key it was written in.

**The capo is stored, because it is knowledge about the song.** "We play this capo 2" is
not about whoever is looking, so it is a nullable column, 0–11, and shown beside the
title — on the song's own page only, and only where there is one: a chip per row is noise at the
length a songbook grows to, and a stored **0** means "no capo", which is an absence rather than
something to label (#474). The editor offers `capoSuggestion` — the position that turns the most of the song's
chords into open shapes, ties going to the lower capo — but what is stored is what
somebody chose. Nothing derives it on the fly.

**The playing controls say what they do, and stay where they are needed** (#474). `♭ 0 ♯` reads as
decoration until somebody presses one, so the group is labelled _Transpose_ — the word explains and
the middle keeps showing the offset. Scroll and speed are reached for while scrolled down, mid-song
and one-handed, so they are `position: sticky` at the foot of the viewport rather than at the top
of the page: sticky and not fixed, so the bar keeps its place in the flow and the last lines of a
song end above it instead of under it. Transposing stays at the top, being a before-you-start
choice.

**Autoscroll is the phone-on-the-floor case**, a play button and a speed slider, entirely
in the front end. The speed is remembered in `localStorage` under one key rather than one
per song: a key per song is a row of cruft per song ever opened, and the last speed
somebody used is a better first guess than a constant. A storage that refuses — private
browsing does — falls back to the default rather than throwing.

**What it owes is counted in tenths of a pixel** (#490). The slider is 1–20 and a tick is 50ms,
so the slow end asks for a tenth of a pixel a tick — and a browser snaps a scroll offset to a
device pixel, so on a 1× display every one of those calls rounded to nothing and the fraction
was thrown away. Below about 7 of 20 the page stood completely still, while a 3× phone could
express a third of a pixel and moved at every setting. `scrollStep` carries the remainder and
scrolls whole pixels, in integers rather than fractions of one: ten sequential additions of
`0.1` come to `0.9999999999999999`, so the pixel that is owed after ten ticks would never be
paid.

### Taking a song out is soft

`deleted_at`, nullable. A book everybody can delete from wants an undo, so the list
excludes deleted rows and a _Recently taken out_ section at the foot of it puts one back. Taking
one out **asks first**, and the question says where the song goes (#474): the undo is only
reassuring to somebody who knows it is there, and one tap that makes a song vanish reads as data
loss to everybody else.
There is no purge: songs are text, and keeping them is what makes the regret recoverable
in both directions. `deleted_at` is worth adopting in more places than this — the songbook
is its first outing, not a special case, and generalising it is its own issue.

**Links are JSON on the row.** A link has no identity, nothing refers to one, and the only
operation is "replace the list" — so a table of its own would buy an id, an order column
and a reorder route for nothing. Only `https://` is allowed, which is `isProfileUrl`, the
same guard a member's own link field uses.

**They are icons and nothing else** (#474), stacked under the title: `musicHost` recognises the
sites people will actually paste and an unrecognised one gets 🎶, with the host's name in the
`title` and the `aria-label` since there is no visible text left to say it. The URL as text said
nothing anybody needed, and the name the form used to ask for — _What to call it_ — was unclear in
practice and read by nothing once the icons carried the meaning, so `label` came off the schema and
out of the stored JSON. The edit form still lists the URL in words, because that is what makes a
link identifiable enough to remove.

### On the feed, like everything else people make

A song's card is `entity_type: 'song'` and the thread machinery does the rest. Adding one
opens it, later substance lands as `edited` entries that coalesce per author, and a soft
delete and a restore are `withdrawn` and `restored` — because a book everybody edits
should say so where everybody looks. The card links to the song's page and carries the
title as it is _now_, never the whole lyrics.

**Its card offers no editing**, unlike an announcement's. A song is edited on its own page,
where the columns and the chord detection are, so the feed condition is `entity_type ===
'post'` explicitly rather than `own` — `own` still means authorship for a song, and the day
something else wants it, it is there.

**`song_added` is the first category whose audience is not an attendance.** The book is
global, so "everybody coming to this burn" is not a thing it could mean; `tellApproved`
fans out over every account holding `member` or `admin`. It is `about: 'else'` and **off**
unless asked for, per #259, and never the person who just added the song. The bell is on
the insert, not on the coalesce (#449). A comment follows the existing shape:
`song_comment` on for the song's author and whoever has spoken, `song_comment_any` off for
everybody else.

**A mention on a song thread resolves against every approved account**, which is what
`namedBy` does when the thread names no burn. The composer needs a list to offer, and the
burn's attendees are the wrong one for a global book, so `GET /api/accounts` answers ids,
names and avatars and nothing else — a route selecting three columns cannot leak a fourth,
the same argument the attendees route makes.

## The bring list

The spreadsheet had a "Bring" tab, and what it was for was one list everybody could read:
things the gathering wanted, and things somebody had said they were bringing. It replaces
that (#24), per burn, reached from ☰.

**Asks and offers are the same row.** An item is a name and an optional comment; hands on
it are what tell the two apart. An offer is an item added with the adder's hand already
up, an ask is one with no hands yet, and a kind column would be a second place the same
fact lived — one that could disagree with the hands the moment somebody put one up. The
page is two halves off `hands.length === 0`, asks first, because an ask nobody has answered
is the only thing on the page anybody has to do something about.

**An empty list is a third case, not an empty half** (#541). "Everything asked for has
somebody bringing it" is true of a list whose asks are all answered and the opposite of true
of a list with nothing on it — which is every burn on the day it opens. So the asks note is
picked off `items.length`, not off the half, and an empty list says what to do instead: add
the first thing.

**There is no wanted count.** "We could use three of these" is a sentence in the comment or
in the thread. A number would want display rules, a notion of fulfilment and a policy for
refusing the fourth hand, all bought to prevent two projectors — and at 42 people
visibility already prevents that, as it did in the spreadsheet.

**A hand is the dream-helper pattern**, down to the table: `bring_hand` keys on
`attendance` for the reason `session_helper` does, so leaving the burn withdraws every
pledge through the same cascade that empties a meal shift, and nobody is listed as bringing
something to a burn they are not coming to. Several hands to one item are normal — many
people can bring a drum — so `HelperStrip` gets no `max` and keeps one vacancy showing.
A non-attendee is still offered 🙋 and gets the join nudge (#503) rather than a hidden
control.

**The asker hears when somebody answers**, which is the moment the ask paid off:
`bring_answered` goes to whoever added the item, on the hand that turns it from an ask into
an offer, and not on the ones after — an item with hands is no longer an ask. Never for
your own click, per #247, and never twice: somebody put on their own ask gets `bring_role`
for being put on it and nothing else. `bring_role` is the pair to `meal_role` and
`dream_role` — being given or taken off a job, from either end of a handover.

**Adding one opens a card**, so `entity_type: 'bring'` is the fifth in the vocabulary and
the migration rebuilds four tables for it (a talking point is the sixth, and its migration
rebuilds five — `thread_entry` as well, for the two entry kinds it brings; see
[meetings.md](./meetings.md)). `added` and `edited` entries carry the item, the
soft withdrawal keeps the conversation the way an announcement's does, and the same
`DreamThread` draws the conversation on the list page as on the feed — one component, so
the two cannot come to disagree. The `added` mark stopped being 🎵 when it stopped meaning
only a song.

**The item is the author's to reword and the author's or an admin's to take off**, which is
the announcement rule (#438). The list itself is any approved member's: adding an ask needs
no attendance, because arranging the shared furniture never does — only pledging to bring
something does, since a pledge is a row keyed by one.

**Taking an item off tells nobody, and that is the decision** (#540). Withdrawing ends the
pledges of whoever had a hand up, so #247's rule — anything somebody else changes about your
roles tells you — looks like it should apply. It does not: the pledge did not change hands,
the thing it was a pledge for stopped existing, and the withdrawal is written into the item's
conversation where the hands are already listed. A dream's withdrawal is silent for the same
reason, and a notification saying "you are no longer bringing X" about an X that is gone would
send people looking for a page that no longer lists it. **Two simultaneous first hands would
each ring the asker**, since each reads the item as still an ask; at 42 people that window is
not worth machinery, per the same argument the roster's writes make.

## What this installation is called

`sage-burner` is the software. What the people running it call their gathering
is something else — "The Burning Sage", or whatever it is where you are — and it
is the heading on the homepage, the name in the header, and the browser tab
title.

Organise → **Settings**. `PATCH /api/admin/installation` takes `{ "title": … }`,
trimmed, 1–200 characters; `GET /api/installation` is public, because the header
renders for signed-out visitors too.

One row, in an `installation` table whose `id` a CHECK pins to `'installation'`.
The singleton is a constraint rather than a convention, so no read has to decide
which row is authoritative, and the migration seeds it — with `Sage Burner`, so
a fresh deployment looks exactly as it did before anyone renamed anything.

`index.html` ships `<title>Sage Burner</title>`, and the backend takes it out on
the way past: the shell it serves carries this installation's own title instead
(#306, below). Vite serves the file unchanged in development, so that is where
the software's name is still what the tab says for a moment. Until the fetch
lands the header renders no name at all, rather than the software's — showing it
and then replacing it is what would look like a bug.

### The map of the area

Whoever runs a gathering already keeps a map of the site somewhere, with the sauna and the
kitchen and the parking marked out. This links to it and nothing more (#315): no embed, no map
of our own.

**Link, not embed**, decided rather than defaulted. An `<iframe>` would need `frame-src` opened
to a map host in the CSP and would put every member's browser in touch with that host on page
load, which is exactly what "no external services are required to run it" rules out. A map of
our own would need a picture, pin coordinates and an editor for both, to reproduce something
that already exists and is already maintained where it is. A link costs one nullable column.

**Admin-set, global, and absent until it is set.** It is one column on `installation` rather
than one per `event` — one site, one map, and the burns are all at it — edited under Organise →
**Settings**. Where nobody has set one there is no menu entry at all, rather than an entry
leading nowhere.

**In the ☰ menu**, which is where the things that are not a burn's pages live, marked `↗`
because it is the only entry in the drawer that leaves the app. `rel="noreferrer noopener"`,
like every other outward link here.

**It is not on the public read.** `GET /api/installation` answers signed-out visitors — it is
what draws the header — and where the gathering physically is is not a visitor's to know. So
the link has a route of its own, `GET /api/map` behind `requireApproved`, and the public
projection selects its columns by name and therefore cannot leak this one by growing. Writing is
`PUT /api/admin/map`, admin by the prefix rather than by a check inside it. `null` is how the
wire says "there is none", both ways, so an empty box and a cleared setting are one thing rather
than two.

### The app icon

Organise → **Settings** also takes the icon an installed copy wears on a home
screen. `PUT /api/admin/installation/icon` takes raw bytes, `image/png` or
`image/svg+xml`, up to half a megabyte; `DELETE` puts it back to the app's own
flame. `GET /api/installation/icon` is **public** and always answers — the flame
when nothing is stored — so the manifest and the shell can both name one URL
unconditionally.

An SVG is stored exactly as authored. Rasterising a logo to 512 pixels throws
away the reason it was an SVG, so anything else is cut to a square and resized in
the browser instead, which is what lets this process store what it is given
without an image library. Nothing here decodes an image.

**Upload a PNG if iOS matters to you.** Safari does not accept an SVG for
`apple-touch-icon`, so an installation that has uploaded nothing gets a screenshot
tile on an iOS home screen rather than the flame — the default icon is the emoji
SVG. Every other platform, and any installation that has uploaded a PNG, is fine.

**That means an admin can upload a file carrying script, and that is the settled
trade** (#256): it is their own installation to break. Two things bound it. An
SVG cannot execute as a manifest icon or inside an `<img>` — only as a top-level
document — and that one remaining route is closed by serving the response
`Content-Security-Policy: default-src 'none'; sandbox`, which gives such a
document an opaque origin and no scripting. Uploading is admin-only.

**The tab wears it too** (#285), and `index.html` is where that starts: the link
points at the same route, so a signed-out visitor on the public homepage gets the
installation's mark rather than the browser's default. Adding the dot took a detour.

The unseen-notification dot (#248) was drawn as a `<circle>` inside an SVG data URL,
and a data URL cannot reference an external image to draw over — so for a while the
tab kept the flame while the home screen wore the upload. The tab now loads the icon
into an image and composes it with the dot on a canvas instead: the same trick the
upload path already uses, since a chosen file is cut square and resized in the
browser. Same-origin, so the canvas is not tainted, and still nothing decodes an
image server-side.

**The plain icon is the floor under it.** `favicon.ts` finds the link the shell
declared — by `id`, so there is only ever one `rel="icon"` — sets it back to the route
synchronously, and only replaces it if the drawing succeeds. A failed fetch, a browser
that will not draw an SVG with no intrinsic size, or a missing 2D context all leave
the tab wearing the right mark without a dot. Two links rather than one would leave it
to the browser which wins, which is how the first attempt at this came out doing
nothing at all.

The mark itself is `flameIcon` in `@sage-burner/shared`, which the backend serves
when nothing has been uploaded. The dot's numbers are `favicon.ts`'s own, because
that is the only thing that draws them.

### The card a shared link shows

Paste the homepage into Facebook, Slack, Signal or WhatsApp and it draws a card.
Until #306 that card said **Sage Burner** and showed no picture, because none of
those crawlers runs JavaScript: they fetch the HTML and read the `<head>` of it,
and everything this app knows about itself arrives afterwards over the API.

**So the backend injects it.** `shell.ts` reads `index.html` once at boot,
takes out the static `<title>` and description, and puts the installation's own
in — the name of the open burn, its dates and place, the welcome text stripped to
plain sentences, and a picture. `share.ts` builds the tags and is tested as a
string in, a string out.

**Both entry points, from one handler.** `@fastify/static` serves a route per
file, so `/` and `/index.html` _would_ come from there, while `/apply`, `/login`
and every other client-side route come from the not-found handler. Injecting into
one of the two makes sharing the bare domain work while sharing a deep link does
not, or the reverse — so `index.html` is kept out of the static glob and both paths
call `createShellHandler`. `app.test.ts` asserts the two answer identically.

What goes in:

| Tag                     | What it says                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| `<title>`, `og:title`   | `Autumn Burn · The Burning Sage`, or the installation alone        |
| `og:site_name`          | the installation                                                   |
| `og:description`        | the dates, the place, then the welcome text, ~200 characters       |
| `og:type`               | `event` with a burn open, `website` without                        |
| `og:url`, `og:image`    | absolute, and omitted entirely when the origin is unknown          |
| `og:image:width/height` | 1200 × 630 for a banner, 512 × 512 for a raster icon, none for SVG |
| `twitter:card`          | `summary_large_image` for the banner, `summary` for the icon       |
| `application/ld+json`   | schema.org `Event` — `startDate`, `endDate`, `location`            |

`og:type: event` is in the Open Graph spec, and **Facebook treats every type it
has not graduated as `other`**, so nothing there renders a typed date. That is
why the dates are also in the description, which is the line a human reads. The
JSON-LD is for Google, which reads it for rich results and which Facebook
ignores; it is a `<script type="application/ld+json">`, which CSP does not
restrict because it never executes, and every `<` inside it is escaped to
`<` so nothing somebody typed can close the element early.

**The origin comes from the request.** This app deliberately has no notion of its
own public address — `docker compose up` has to stay sufficient — so `Host` is
what it uses, and `PUBLIC_ORIGIN` wins where an operator set one. The scheme is
`request.protocol`, which follows `X-Forwarded-Proto` only as far as
`TRUST_PROXY` allows: behind Apache with that unset, the card names `http://` on
an https site. A `Host` that is not hostname-shaped gets no `og:url` and no
`og:image` at all, since both must be absolute and a card naming an origin nobody
can fetch is worth nothing.

### The banner

Organise → **Settings** takes the wide picture the card shows, which the public
homepage also wears above the burn. `PUT /api/admin/installation/banner` takes
raw bytes, **`image/jpeg` only**, up to a megabyte; `DELETE` removes it;
`GET /api/installation/banner` is public and 404s when there is none — unlike the
icon, nothing asks for it until `GET /api/installation` has said
`banner_updated_at`, which is also the `?v=` that makes a new banner a new URL.

JPEG and nothing else, which is a narrower list than the icon's two. The whole
job of this image is to be drawn by crawlers, none of them draws an SVG, and a
1200 × 630 PNG of a photograph is a megabyte the homepage would then load on
every visit. Whatever is chosen is cropped from the middle to 1200 × 630 and
encoded in the browser, so nothing here decodes an image — the same trade as
avatars and the icon, and what lets `og:image:width` be declared by a process
with no image library.

**1200 × 630 is the size to give it.** Facebook draws the large card above about
600 × 315 and a small thumbnail below it, so the format is what decides which of
the two a share looks like. With no banner the card falls back to the app icon,
which is square, and says `summary` rather than claiming a wide picture it does
not have.

**Where the burn is** is a field on the burn, edited under Organise → Events —
per burn rather than per installation, because the same people meet at a different
farm next time. It shows beside the dates on the homepage, in the card's
description, and as the `Place` in the structured data. Empty until somebody fills
it in.

**Cards are cached hard.** After a deploy, Facebook keeps showing the old one
until it re-scrapes; its Sharing Debugger has a button for that, and Signal and
WhatsApp cache too. A change that "did not work" is usually this.

### Where this installation posts from

Organise → **Settings** takes an SMTP server (#30), and there is nothing else to
set up: no hosted service, no account to sign up for, and no environment variable.
It is whatever mail the people running the gathering already have.

**All of it is optional.** With no server set up, approving an application posts
nothing, no notification is emailed, and the email column on the notification
settings is not drawn. `docker compose up` stays sufficient, exactly as it does for
push.

In the database rather than the environment, for the reason the VAPID pair gives —
and in a singleton table of its own rather than columns on `installation`, because
that row is read for a title on nearly every page load and an SMTP password should
not ride along on each of them. The password is stored **as given**: SMTP AUTH sends
the password itself, so a digest would be one this app could not use. It is the same
class of secret as `vapid_private_key`, kept safe by the volume rather than by the
column, and it never leaves the process — the read answers with `has_password`, and
a save that omits the field leaves the stored one alone.

| Field    | What it is                                                           |
| -------- | -------------------------------------------------------------------- |
| Server   | the SMTP host                                                        |
| Port     | 587 or 25 (STARTTLS), or 465                                         |
| TLS      | the socket is TLS from the first byte — 465 only, not "use TLS"      |
| Username | empty for a relay that authenticates by network                      |
| Password | stored as given; blank on a save keeps what is there, `""` clears it |
| From     | the address and the name every message appears to come from          |

**Test it before trusting it.** A wrong password fails silently otherwise: the next
approval posts nothing, the admin sees the invite link as usual, and the applicant
waits. The button posts to the **admin's own** address rather than one they type —
a send-to box on an admin page is an open relay with extra steps — and the answer
carries the server's own refusal, because "535 authentication failed" and "connect
ECONNREFUSED" want completely different fixes.

`nodemailer` does the talking, in `mail/smtp.ts` and nowhere else, so everything
else about email is testable with an injected spy — the same split `web-push.ts`
has. The protocol is a handful of lines; STARTTLS negotiation, AUTH mechanisms,
dot-stuffing and MIME encoding of anything that is not ASCII are not, and a
gathering called "Sagegården" would find that last one on the first message.

Every message is plain text. Nothing sent from here is worth a second rendering to
keep in step with the first, and it means no address or member-written line is ever
interpolated into markup on the way out. The `From:` display name is quoted per RFC
5322 and stripped of anything that could end a header, since an installation calls
itself whatever it likes.

**A notification's email leaves the request** (#356). `sendWithSmtp` opens a
connection per message and `notifyBurn` fans out over the whole attendance, so a full
burn dialled the relay once per attendee — and every one of those waits was inside the
request that caused it. Small relays cap concurrent connections and refuse the
overflow, which `post` turns into a quiet `sent: false`, so the failure mode was
_missing_ email rather than slow email.

The email leg goes on a queue instead: one message at a time, after the answer, drained
on shutdown. Nothing on screen depends on it — the row is written first and always —
so being slow now costs nobody anything, which is what makes serial the right shape
rather than a bounded pool. Nothing retries; a message that could not be posted is
logged and gone, the same promise the bell already makes.

**`DRAIN_DEADLINE_MS` is five seconds, and that is sized for a hung relay rather than for a
full queue** (#383). Serial at a few hundred milliseconds a message means a forty-two-person
fan-out does not fit inside it, so an ordinary redeploy in the middle of one abandons the tail.
Deliberate: raising it past a few seconds only trades a lost tail for a container that will not
stop — docker sends SIGKILL after ten — and nothing retries anyway, which is the promise above.
So the deadline is what stops shutdown waiting on a relay that will never answer, and the tail
it drops is the same thing a failed send already drops.

That reverses something the tests relied on: **a route answering no longer means the
posting has happened.** `createApp` takes `defer` for exactly that reason, so a test
holds the queue and drains it where it asserts. An invite is still posted inside its
request — one message to one person is not a burst, and the raw token is in that
response anyway.

**Links in email need `PUBLIC_ORIGIN`.** An invite is posted from a request and
takes the origin that request arrived on, so it always has one. A notification is
posted from wherever a role was handed out, with no request to read `Host` from — so
without `PUBLIC_ORIGIN` it says what happened and stops there.

## Offline and installing

The app is a PWA: installable, and readable with no connection.

`GET /manifest.webmanifest` is served rather than shipped as a file, because it
carries the installation's own name and icon — both rows an admin can change, and
a static file would need a redeploy to stop saying `Sage Burner`. The icon `src`
carries the stored `updated_at` as a version, so a new icon is a new URL rather
than one an installed copy holds on to.

Two caches, and the split is the whole of what stays on a device:

- **`sage-burner-shell-v1`** — the HTML shell, the hashed bundles, the manifest,
  the icon, the banner. None of it is anybody's data. Kept across a sign-out, because
  dropping it would mean the next person to open the app offline gets nothing at
  all. **Trimmed by two rules for two kinds of entry**: the hashed assets are capped
  at 40, oldest first, so old builds' chunks do not accumulate; and a picture carrying
  its version in the query keeps only its newest. The homepage quotes the banner as
  `?v=<updated_at>`, a fresh key on every upload and about a megabyte kept forever until
  #311 — and only a URL with a query can pile up that way, since one without is a single
  key that a store replaces in place. The query is what the rule turns on rather than
  the path, because `/api/installation/icon` is asked for **both ways**: bare by the
  header's mark and the favicon, versioned by everything that wants a particular one.
  Those are two live entries under one path, not two versions of one. Among the
  _versioned_ spellings only the newest survives, so they all have to agree — and the
  spelling drifted three times before they did: the manifest raw, the settings page a
  literal `?v=current`, the share card percent-encoded. `/api/installation` answers
  `icon_updated_at`, and `iconSrc` in `routes.ts` is the one builder every caller goes
  through, for the reason the per-segment encoding lives there too (#376, #378). A count
  over the lot would be the obvious single rule and is the one thing this must not do —
  it could evict the shell, which is what makes the app open offline at all (#268).
- **`sage-burner-api-v1`** — every API read: the roster, the schedule, who you
  are. **This is member data on disk, and signing out deletes the whole cache.**
  Not entries picked from it by URL, which would be a list to keep in step with
  the routes. The four `/api/` reads that are _not_ somebody's data — the icon, the
  banner, the changelog and the privacy policy — are named into the shell cache instead,
  on the argument that what a sign-out takes away should be what a sign-out was about.

Reads are network-first with the cache as a floor under being offline; hashed
assets are cache-first, since their names change with their bytes. `/api/version`
is never cached — a stale answer there is the one reply that makes the redeploy
check pointless. `/api/changelog` is, and is `no-cache` at the HTTP layer for the same
family of reasons: it answers what the _server_ is running, and the notification that
sends somebody to it fires precisely when that has changed. Nothing cross-origin is touched.

**A whole thread is never cached either, for the other reason** (#375). Every other read
here is one key for a page — the roster, the schedule, the feed — which `put` replaces in
place, so the cache does not grow with use. `GET /api/threads/:id` is one key per dream
ever opened, kept until sign-out, which is exactly the shape #311 fixed for the versioned
banner. The feed's card carries the newest few lines of each conversation, so offline
still shows what is being talked about. The prefix is taken off the route manifest rather
than written out, like every other path in `cache.ts`.

**A navigation is only stored if it answered with HTML.** Not every same-origin
navigation returns the app: the ICS feed is a plain `<a href>` in the page, so
clicking it is a `mode: 'navigate'` fetch answering `text/calendar`. Without the
check the worker would store the calendar as the shell, and every offline open of
the app would render an ICS file until some later online navigation overwrote it.
A content type rather than a list of paths to skip — a list is a thing to keep in
step with the routes, and the route it goes stale against is the one that breaks
the app offline.

### Offering to install it

A strip offers a one-tap **Install** where the browser allows one (#281), and **says how by
hand where it does not** (#452). Three states, one strip: an offer becomes the button; a browser
with no offer API becomes the instruction; the installed copy, a browser that could offer and has
not, or a dismissal, becomes nothing.

**"Has not offered" and "cannot offer" are different, and telling them apart is the whole of
#460.** Chromium fires `beforeinstallprompt` only after it has fetched and validated the manifest
icon and the worker is in place — reliably after first paint — so a strip showing the instruction
whenever there is no offer _yet_ flashed "open your browser's share or menu" at every Chromium
visitor for a few hundred milliseconds and then swapped it for the button. Worse, Chromium fires
it not at all for an app it has already installed, and a browser tab is not
`display-mode: standalone` — so somebody who installed it and later opened the site in a tab was
told to install what they had installed. `hasInstallOffer` is
`'onbeforeinstallprompt' in globalThis`, a direct feature test for "this browser has the API", and
it closes both: the instruction shows only where that is false. Presence, not truthiness —
Chromium leaves the property `null` until a handler is assigned. It sits beside `isStandalone` and
reaches the strip as `InstallWatch.offersItself`, injected the way `installed` is, so the suite
decides which browser it is; and it replaced a piece of state that tracked whether an offer had
ever arrived, since a browser that has made one demonstrably has the API.

**Chromium only for the button.** `beforeinstallprompt` is the only API that opens a
browser's own install flow; Firefox and Safari have no equivalent, and there is no way
to open Firefox's "Add to Home screen" or iOS Safari's Share sheet from a page.

**Saying nothing there was the bug, though.** No browser on iOS fires
`beforeinstallprompt` — they are all WebKit — so the strip was invisible on exactly the
platform where installing takes the most convincing, and where the Share sheet is the only
way in at all. The instruction is **generic on purpose**: an exact menu path moves between
releases and goes stale silently, so the strip names the shape of the thing ("your browser's
share or menu") and points at the **FAQ** for a walkthrough, which is admin-editable content
and fixable the day Chrome moves the button. The link is there **only for an approved
member**, who is the only one who can read the FAQ — an unconditional link would be a dead
end for the signed-out visitor who also sees this strip. **The notification settings gate the
identical link the same way** (#460): that page is `require="signed-in"`, so an account with no
role yet reaches it, and its own copy pointed at the FAQ unconditionally.

**iOS makes it more than convenience.** Web push works there only from an installed app: in
a browser tab the Notification API is simply absent. So the strip may honestly say installing
is what lets it notify you, and the notification settings say the same thing rather than
offering a switch that cannot deliver — `state === 'unsupported'` splits on whether this is
already the installed copy, because installed-and-still-unsupported means installing is not
the answer and pointing at it again sends somebody in a circle.

**`isStandalone` checks both spellings.** `matchMedia('(display-mode: standalone)')` is the
standard one and `navigator.standalone` is all that older iOS answers — and a home screen app
answering only the legacy one is exactly the reader the instruction strip would otherwise nag
for having already followed it. One function, used by the strip and by the notification
settings, so the two cannot disagree.

**One dismissal covers both forms.** `DISMISSED_KEY` is the same either way: whether to be
nudged about installing is one decision, not one per mechanism.

**Watched from before the first render**, in `main.tsx` rather than in an effect.
`beforeinstallprompt` fires once, when the browser decides the site qualifies, and
that can happen before any component has mounted — a listener attached on mount would
miss it and the button would never appear, which is the kind of race that reads as
"works on my machine". `watchInstalls()` builds an object rather than using a module's
variables, for the reason `createRemembered` does: two suites in one process would
otherwise share one.

`preventDefault()` on the event, or Chrome shows its own bar as well and the same
offer is made twice in two places. The offer is spent after one prompt, so the strip
goes on click; `appinstalled` clears it too, and an app already running standalone
never listens at all.

Dismissible, remembered in `localStorage`. The event fires on every visit until the
app is installed, so a nudge with no "not now" is a nudge for ever. Reading that
store is wrapped: it throws rather than answering when a browser blocks storage, and a
page that will not render is worse than a nudge dismissed twice.

### The tile a home screen draws

**iOS draws no SVG for `apple-touch-icon`**, and the icon route answers an SVG whenever
nobody has uploaded a raster one — so whoever fought through Add to Home Screen got a **gray
square** (#453). `/api/installation/icons/:size` answers a PNG whatever is stored: the upload
when it is already a PNG, and the app's flame otherwise. An SVG upload falling back to the
flame is honest rather than clever, and the settings page says so beside the upload.

**The flame became geometry.** It was `<text>🔥</text>`, which draws whatever emoji font the
reader has and cannot be rasterized without carrying one. `FLAME_SHAPES` in `media.ts` is now
the single description both renderings come from — `flameIcon` writes it as SVG paths, and
`pwa/flame.ts` fills the same curves into a PNG. Two renderers, one geometry, so they cannot
drift.

**Nothing here decodes an image.** The rule uploads live under is intact: the input is a
hard-coded list of bezier curves, and filling it is arithmetic. That is why there is no build
step, no committed binary and no native dependency — a scanline fill and a PNG encoder over
`node:zlib` are about a hundred and fifty lines, and the result is held per size in a closure
the route owns rather than in a module's variables.

Coverage is **exact along x and sampled along y**: sampling both axes costs sixteen times the
work for a worse edge, and the shape has no horizontal detail finer than a pixel to lose. The
tile keeps **a tenth clear at every edge**, because a maskable icon is cropped to the middle of
what it declares and a flame reaching the corners loses its tip to a circular mask.

**The manifest, completed.** `id: '/'` so a later `start_url` change does not read as a
different app; `description` matching the shell's; `lang` and `dir`; and `shortcuts` for a
long press — the schedule, the feed and the songbook. The drawn PNGs are declared at 180, 192
and 512 **only where nobody has uploaded an icon**: mixing the app's flame in beside somebody's
logo would show the wrong mark in the install sheet. The flame's own SVG entry stays
`purpose: 'any'`, because it has no background and a launcher fills a maskable icon's box; the
PNGs beside it are maskable, being opaque with that margin. An upload keeps the `any maskable`
it has had since #256, which is a claim about a picture an admin chose rather than one the app
draws. A raster upload is resized to 512
in the browser before it is sent, so the `512x512` the manifest has always claimed is true of
anything uploaded through the page.

The tile lands in the **shell** cache rather than the API one, on the same argument as the icon
and the banner: it is nobody's data, so a sign-out is not its to take away.

Not done on purpose: a **second upload slot** for the touch icon, for an admin whose logo is an
SVG and who would rather supply their own raster than fall back to the flame — the fallback
makes that optional rather than blocking. And **`screenshots`**, which would be pictures of
_this_ installation and so another upload pipeline for a richer install sheet.

### Saying how old it is

Every answer served from the cache is stamped `x-cached-at`, and the page reads
it. Past **five minutes**, a bar says how old what is on screen is.

The rule is deliberately literal — it is about the data, not about the network —
and it is paired with the other half: the pages several people change at once
(members, schedule, dreams, roles, meals) refetch every minute while the tab is
watched, and again whenever it comes back to the front. So online the bar is
nearly unreachable, and its appearing means a refresh genuinely could not land.
That is exactly when somebody should not act on the roster in front of them.

A background refetch that fails leaves what is on screen alone. Replacing a good
roster with "could not load" because a poll nobody asked for missed would be
worse than the page it started with — the staleness bar is what says so instead.
Pressing reload still reports the failure, because a button that appears to do
nothing is its own bug.

## Avatars

The circle in the corner, and on a schedule chip, may be a picture instead of initials
(#222).

**Wherever a name is listed, the face goes with it** (#301). The rounded chips that
say who has taken a spot — a dream's helpers, a meal's lead and crew, a lead role's
team — draw `PersonBadge`: the circle on the left, the name beside it, the chip's
height set by the circle rather than by the text. Somebody with no picture gets the
initials circle, which is what `Avatar` already draws, so a list lines up whether or
not anybody in it has uploaded anything.

The size modifiers — `.person-badge-face`, and the schedule chip's
`.dream-facilitator` — must sit **below** `.avatar` in `styles.css`. Each is a single
class, as `.avatar` is, so specificity ties and source order decides: above the base
rule they set nothing at all and every circle draws at the bar's 2rem. Both did, and
a screenshot showed it without anybody noticing — `getComputedStyle` is the check.
The one place the stack overrides a modifier is `.dream-supporter .dream-facilitator`,
which zeroes the chip's leading gap so the faces actually overlap.

`HelperStrip` takes the burn's attendees as `everyone` for this, separately from
`candidates`: candidates is filtered — a chore offers nobody, a dream's helpers
exclude its facilitator — so anybody already on the list is by definition absent from
it, and looking there would draw initials for exactly the people who have a picture.
It is required rather than optional so a call site cannot quietly forget it.

**A `<select>` keeps a bare name.** An `<option>` cannot hold an image, so the badge
stops at the list and the picker stays text.

**In the database**, in its own table. The container has no writable path but the data
volume and `docker compose up` has to stay sufficient, which is the same argument that
keeps the VAPID keys here — a bind mount for uploads would be a second thing to back
up and a second thing a restore could miss, leaving every avatar a broken image with
no error anywhere. Deleting an account cascades the picture away; with files that
would be a sweeper to write and orphans to accumulate silently.

Its own table rather than a column on `account`, because avatars are tens of kilobytes
and `select().from(account)` is on the path of nearly every request: a blob there would
be read by all of them to be used by almost none.

Serving goes through the app either way — an avatar is member data and needs
`requireApproved`, the same as the name beside it — so the one real advantage files
would have had is unavailable. **The threshold to revisit this** is roughly 100 KB per
blob or a few hundred megabytes in total; a 256-pixel avatar is nowhere near either,
and meal photos or a gallery would be.

**Nothing on the server decodes an image.** There is no image library in this process
and no appetite for one, so the browser cuts the picture to a square and sizes it down
to 256 px before sending. The consequences are worth stating rather than discovering:

- The content type is what the caller **claims**, and those bytes are served back with
  it. Only three types are storable — a CHECK as well as a route check — and
  `X-Content-Type-Options: nosniff` stops a browser deciding for itself that a PNG is
  really something to run.
- Half a megabyte is the cap, enforced by Fastify before the body is read. A resized
  avatar is tens of kilobytes, so the cap is generous for a client that skipped the
  resize and cheap against one that means harm.

**`avatar` is a version, not a flag** — when the picture last changed. It rides with
the viewer and with the attendee list, and it goes in the URL, so a new picture is a
new URL. That is what makes a week-long `private, max-age` safe on data everything
else here sends `no-store` for: no cache can show a stale one. Null means initials,
and spares every account without a picture a request that would only 404.

The crop is `squareCrop`, and it takes the **middle**: a portrait cut from the centre
keeps the face far more often than one squashed to fit. The resize itself is not
unit-tested and cannot usefully be — happy-dom has no canvas that draws, so a test
would assert against a stub of the thing under test.

## Pictures in what people write

Paste one into a comment, drag one onto a dream's description, or pick one from a phone
(#379). The markdown for it is written at the cursor and the picture is stored; nothing
about the renderer changed, because `renderMarkdown` already drew `![](…)` and `app.ts`
already allowed `img-src 'self'`.

**One table, `image`, unlike the three fixed slots.** `account_avatar`,
`installation_icon` and `installation_banner` each have one owner and nobody makes more
of them. A picture in prose has no owning entity at all — the reference is inside
somebody's markdown, which no foreign key can see — so the only thing it belongs to is
the person who uploaded it, and `uploaded_by` cascades with the account.

**Nothing sweeps orphans, deliberately.** Knowing when the last reference to a picture
went would mean scanning markdown on every save, or a sweep that has to know every
markdown column in the schema. Both are lists that go one column stale in silence, and
the rule here is to prefer deleting the thing that needs syncing over syncing it. At a
few hundred pictures a burn, capped, an orphan is cheaper than the machinery that would
find it. The one deletion that must work is the person's, and that is the cascade.

**`requireApproved` on both ends**, like the avatar and the name beside it: a photograph
in a comment thread is at least as personal as a face. The consequence is worth stating
rather than discovering — a picture hand-written into the burn's **welcome text**, which
is public, is broken for the public. That is why `MarkdownField` takes its uploader as an
optional prop and the public-facing fields do not pass one: the welcome text and the
application form's question text offer no picture button, and a paste into them is left
as an ordinary paste.

The id is a v4 UUID, so 122 CSPRNG bits stand between one URL and the next. That is
defence in depth rather than the guard.

**Nothing on the server decodes an image**, which is the rule the other three state and
the one that matters most here, because this is the upload that takes whatever a camera
produced. The browser scales the longest edge to 1600 px and encodes WebP before sending.
Two details the avatar and the banner do not have to care about:

- **Orientation.** A phone records the rotation in EXIF, and a canvas round-trip drops
  the tag and keeps the pixels. `createImageBitmap(file, { imageOrientation: 'from-image' })`
  is what stops a photograph going up sideways, and `image.test.ts` asserts it is asked
  for.
- **What re-encoding costs.** It strips EXIF, which is a privacy win worth having on
  purpose — a phone photograph carries where it was taken, and this one is going into a
  thread. It also flattens an animated GIF to one frame, which is why GIF is not in the
  accepted list.

**A placeholder holds the spot while the bytes go up**, GitHub's `![Uploading …]()`, and
the real markdown replaces it when the id comes back. It is matched by text rather than
by an offset, because the offset is wrong the moment somebody carries on typing — which
is the case the field must survive, since a refusal takes the placeholder back out and
must never take the comment with it.

**Saving waits for it.** Every submit beside one of these fields is disabled while a
placeholder is in the value, because a comment stored mid-upload keeps that placeholder
for good — it renders as escaped text, since an empty href fails `isSafeImageSource` —
and the picture that lands a moment later is written into a box that has already been
cleared, so it is a row nothing references. The condition is `stillUploading(value)`
rather than the hook's `busy` flag: the value is the one thing all six parents already
hold, and what must not be saved is the point rather than which component is busy.

**How much room a picture needs is the finished markdown, not the placeholder.**
`![](/api/images/<uuid>)` is 53 characters and `![Uploading a.jpg…]()` is 21, so a field
checked against the shorter one would take a picture it has no room for and overflow on
the swap — and `maxLength` does not truncate a value set from code, so nothing would
catch it until the save came back refused.

**A stored picture is not put in the offline cache.** It is one key per photograph
anybody has scrolled past, kept until sign-out, where every other entry there is a page's
JSON replaced in place — the shape `getThread` is excluded for, with a hundred times the
bytes. The route answers `private, max-age, immutable`, which is safe because an id never
answers with different bytes, so the browser's own cache still holds them between visits.

**How many one account may hold is a number**, not an absence: this is the first
unbounded write any member can make, and nothing rate-limits a signed-in member — the two
bounds #57 added are on the unauthenticated routes.
`MAX_IMAGES_PER_ACCOUNT` in `media.ts` says what it is and why.

**A ceiling has to be one you can get back under** (#392), and at first it was not. The
cap counts every row ever written, and deleting the comment that referenced a picture
deliberately leaves the row — so an account that reached 500 could never upload again by
any action the app offered. **Pictures you have added** on Your details is what closes
that: `GET /api/me/images` lists the ids and dates (never the bytes — five hundred of
those is not a JSON response anybody wants), the grid draws each one through
`storedImage`, and `DELETE /api/me/images/:id` takes one off with the account in the
`WHERE`, so somebody else's id is a 404 rather than a write.

**The grid draws the full stored bytes**, at 7rem apiece, and that is a deliberate no.
A `?w=` variant on `storedImage` would be the obvious fix and would make this the first
thing in the process to decode an image — the rule every image path here states, and the
one this feature was built to keep. What stands in for it: `loading="lazy"`, so nothing is
fetched until it is near, and `private, max-age, immutable`, so a second visit to the page
fetches none of them again. An account at the ceiling scrolling its own grid once is the
cost, and that account is the one about to delete something.

**A removal leaves a gap wherever the picture was still shown**, and the page says so
before anybody presses ✕. Refusing instead would mean knowing every markdown column in
the schema, which is exactly the list this design does not keep — so the honest version
is to tell the person what it costs and let them decide.

## The composer

Markdown is what is stored and what is rendered; what changed in #473 is only the surface. Most
members are not technical, and a field with a **Write / Preview** mode switch reads as a technical
tool. The alternative is not WYSIWYG: inline bold means `contenteditable`, which at production
quality means a Lexical/ProseMirror-class dependency larger than this whole bundle — and it changes
what is stored, reopening everything "Markdown is escaped, not filtered" below settles.

Discord's shape is the right one, so the surface got humbler and the format stayed put. Markdown
already degrades: somebody who never types a `*` writes plain text and gets plain text, which is
why the simple experience needs no setting to switch into. A setting would fork the editing
experience people help each other with at a gathering, and both halves would still have to exist
and be tested.

**A toolbar that writes the syntax**, four buttons wide: bold, italic, link, list. `syntax.ts`
holds the grammar as pure functions with the tests, in the spirit of `withMentionAt`: wrapping a
selection, unwrapping one already wrapped, opening an empty pair with the caret inside it when
nothing is selected, and refusing when the insert would pass the field's `maxLength` — `maxlength`
bounds typing and not a programmatic insert, which is #457's rule. `C-b` and `C-i` do the same for
whoever has a keyboard; on a phone, where most members are, the toolbar is the whole affordance.

**Italic is `_`, not `*`.** With asterisks, italic on a selection inside `**bold**` matches the
unwrap check and turns bold into italic. The two render identically, so the ambiguity buys nothing.

**The preview is not a tab.** It renders quietly below the field, and only once the text has any
markdown syntax in it — a preview of plain words beside the plain words is noise, and the mode
switch was the chrome that read as a tool. `hasMarkdown` is what decides, and it is a list of
patterns rather than a render-and-compare, because rendering plain text also changes it.

**A picture is appended at the end of the body**, wherever it was pasted, dropped or chosen. That
is the Facebook and Discord feel — words then pictures — and it costs no data-model change, since
storage stays a markdown token that anybody who wants one mid-text can still move.

**Every composer gets it**: `MarkdownField` for introductions, posts, dream descriptions and
welcome text, and the two comment boxes in `DreamThread`, which are plain textareas rather than
a `MarkdownField`. `useSyntax` + `SyntaxToolbar` is the same hook-and-component pair as
`useImageUpload` + `AddPicture` and `useMentioning` + `MentionMenu`, so a third composer wires it
the way it wires those.

## Markdown is escaped, not filtered

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
