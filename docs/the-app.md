# The app itself

Getting around it, what it calls itself, installing it, the faces in it, and how
anything anybody writes gets rendered.

[← back to the README](../README.md)

## Getting around

The bar carries **one entry per thing, not one per page** (#184). Everything else
is reached from the page it belongs to, which is where somebody is standing when
they want it.

Leftmost is the **burn selector**, because everything to the right of it is about
the burn it names. It lists the burns a member has said they are coming to, and
defaults to the soonest — the list arrives soonest-first, so that is the first
entry rather than a rule applied twice. **An account holding `admin` sees every
burn still to come**: one without `member` has no attendance anywhere and would
otherwise face an empty selector on the burn they are setting up. Somebody coming
to none gets no selector and no burn-scoped content; their details page is where
they join one.

It is hidden when there is nothing to choose between — one burn is the ordinary
case and a select with a single option is furniture.

**Every burn-scoped page says the same thing when it has no burn**, through `NoBurn`,
and it says a different thing to each persona because that is what decided the list
is empty. An admin is offered every coming burn, so empty means none is planned
and the fix is theirs — a link to Events. A member is offered the ones they have
joined, so empty usually means they have not joined one, and the fix is on their own
page. The old copy said "there is no burn open at the moment" to both, which is a
claim about the world where only one of them needed a claim about themselves.

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
  account it ends. Every entry in the bar is a _place_; this is an action, and it was the
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

**☰ is where those live**, starting with 🛻 Rideshares. Beside the logo rather than on
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
nothing wider does. The pages still to come — the map (#315), the bring list (#24),
Leave No Trace (#29), music (#316) — go behind ☰ rather than take a seventh seat, which
is what ☰ was built for and where rideshares (#26) already are.

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

**The card is the conversation, not a preview of one** — a comment box included. It is
also the only place a withdrawn dream's thread can be read, since there is no panel left
to open. The same component draws it inside the dream's own panel (#342), so the two
cannot come to show one conversation differently.

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
answer #426 deliberately left open for its own card. Withdrawing twice adds one entry.
`author_account_id` is `set null` rather than a cascade, so a burn's announcements outlive
somebody leaving — the post, its title and its body all stay, and only the `posted` entry's
author goes.

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

**One card per (person, burn), and joining opens it** (#426). Saying you are coming and
saying who you are are the same card: `entity_type: 'attendance'` with the attendance id,
so `thread_entity_idx` already means one conversation per person per burn and
`thread.event_id` files it under the right burn and carries the same retention. An
`account`-keyed thread cannot do it — one thread per person, pinned to one burn by a
`NOT NULL` `event_id`.

**The introduction is resolved and clamped, not stored on the entry.** `readThreads` reads
`account.introduction` and `excerptOf` cuts it at `INTRODUCTION_EXCERPT` on a word
boundary; the entry itself is a bump. Two reasons: rewriting a paragraph must not leave
the feed quoting the old one, and `MAX_INTRODUCTION` is 10,000 against a card's budget of
fifty-in-one-cache-key. The whole of it is on the person's page, which the card's title
links to.

**Rewriting bumps once.** `introduced` coalesces, so six passes at a paragraph move one
card up the feed rather than leaving six lines — the argument `renamed`, `scheduled` and
`edited` already make for being kinds of their own rather than one `edited`.

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
hand up or down, renamed, moved, edited, withdrawn. A ❤️‍🔥 does not — the faces are on
the dream already, and twenty hearts is twenty lines nobody reads.

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

**A pair of categories per kind of card, split the way every other pair here is** (#259).
A comment on a thread you are part of is `about: 'you'` and **on**; a comment on any card
of that kind at a burn you are coming to is `about: 'else'` and **off**. So
`dream_comment`/`dream_comment_any` for a dream and
`introduction_comment`/`introduction_comment_any` for a person, and `entryCategory` takes
the entity type as well as the kind — without that, the chip under a person's card would
offer to switch on comments about every dream. The audiences are disjoint so nobody is
told twice, and never the person who just wrote it (#247). Who is "part of it" is whoever
has spoken on the thread, plus — for a dream — the facilitator and the helpers, and for a
person, the person it is about. Appointing somebody writes a line authored by whoever
appointed, so a facilitator handed the dream has said nothing and would otherwise never
hear a question about it.

Neither writes an `activity` row: the entry is the record, and a line beside it would put
one comment on the page twice. That is what `tellAttendees` is for beside
`notifyAttendees`.

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

**Retention is the burn.** `activity` and `thread` both cascade with `event`, and the
route reads the newest fifty. An audit log grows without bound; this is bounded by
something that already ends.

**What the installed app keeps on disk.** The feed is one cache key, replaced in place,
and it is bounded by construction: fifty things, at most three lines a card, and
`MAX_COMMENT` is 2000. The whole thread is a read of its own and is **never cached** —
that would be a key per dream ever opened, kept until sign-out, which is the shape of the
problem #311 fixed for the banner. Offline you get the card's newest lines; the rest of
the conversation needs the network.

What is _not_ on it yet: an unread mark per thread, a digest instead of one notification
per comment, reactions on a line, and threads on a meal, a ride or a plan item.
`entity_type` is what makes each of those a value in the vocabulary and a branch in three
places — the link, the participants, and the comment's categories. Adding one is **not**
free of a migration, which #426 established by being the second: the column carries a
CHECK listing the vocabulary, so a value added to `enums.ts` alone passes Zod and the type
checker and then fails the write. `db.integration.test.ts` now checks each vocabulary in
the database against the one in the code, so the two cannot drift silently again.

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

A strip offers a one-tap **Install** where the browser allows one (#281), and says
nothing where it does not.

**Chromium only, deliberately.** `beforeinstallprompt` is the only API that opens a
browser's own install flow; Firefox and Safari have no equivalent, and there is no way
to open Firefox's "Add to Home screen" or iOS Safari's Share sheet from a page. The
alternative was written instructions, which means naming a menu item that moves
between releases and goes stale silently — so those browsers get nothing rather than
directions that may be wrong.

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
unbounded write any member can make, and rate limiting (#57) is still unbuilt.
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
