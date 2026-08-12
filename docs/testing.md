# The tryout protocol

A walk through a running copy, for a human or an agent, with the expected
outcome beside each step. It exists for what the automated suite cannot see:
real browser layout at phone widths, a real calendar client, and the wiring
between features end to end. The fine-grained invariants live in the tests —
`pnpm check` and `pnpm test` are the gate, and a claim that can be a test
belongs there, not here.

The feature list this protocol exercises is [features.md](./features.md); when a
feature's observable behaviour changes, the check that exercises it changes in
the same PR.

**Run it against a disposable copy, never a live installation** — the protocol
creates accounts, burns and content.

[← back to the README](../README.md)

## Setting up

1. `pnpm install`, then `pnpm dev:backend` and `pnpm dev:web` in two terminals;
   open `http://localhost:5173`. (Sessions over plain HTTP work on `localhost`
   only — any other origin silently drops the cookie.)
2. Create the first admin:
   `ADMIN_EMAIL=admin@example.org ADMIN_PASSWORD=... pnpm --filter sage-burner-backend admin:create`
   — it grants `admin` and `member` both.
3. Hold four personas across browser profiles or private windows: a signed-out
   visitor, an applicant, an approved member, and the admin. The applicant and
   member come out of the protocol's own first steps.

**Four checks need the built web app instead, served by the backend on port 3000.**
The dev pair above cannot pass them — not because anything is broken, but because
that setup does not serve the pieces they exercise. `docs/configuration.md` has the
recipe:

```sh
pnpm --filter sage-burner-web build
SESSION_SECRET=$(openssl rand -base64 48) WEB_ROOT=$PWD/apps/web/dist pnpm dev:backend
```

A fresh `SESSION_SECRET` invalidates the sessions from the `dev:web` phase — cookies
are not port-scoped — so all four personas sign in again on `:3000`.

- **The share card** (_First contact_): the shell handler that injects the `<meta>`
  tags registers only when `web_root` is set, so the dev backend answers `/` with a
  404 and Vite serves `index.html` uninjected.
- **Subscribing to push** (_Being told_) and **offline from cache** (_Installing,
  offline_): `/sw.js` exists only after `vite build --config vite.sw.config.ts`,
  which `pnpm dev:web` never runs — there is no service worker there at all.
- **Offers to install / the home-screen tile** (_Installing, offline_):
  `/manifest.webmanifest` is a backend route at a path outside `/api`, and the Vite
  proxy forwards `/api` only, so it is never reached from port 5173.

Where a step says "phone width", use a viewport under 45rem (~720px); "narrow
phone" means 360px.

## First contact, signed out

- [ ] The homepage names the installation in the bar and shows the active burn —
      name, dates, place, rendered welcome text — or, with no coming burn, no
      stale past one.
- [ ] The only nav is Apply and Log in; no bottom bar appears at phone width.
- [ ] Burn-scoped API reads refuse a signed-out caller; the SPA's guarded pages
      are not reachable.
- [ ] `curl -s http://localhost:3000/ | grep og:` — the shell carries the
      installation's own title and description, not the software's.

## Applying, and being let in

- [ ] `/apply` as the visitor: creating an account (email + password) leads into
      the questions; the form renders whatever questions the admin has set, in
      order, and refuses submission with a required question blank or an
      agreement unticked.
- [ ] The confirmation says whether anything will be emailed, matching whether
      SMTP is configured.
- [ ] The new applicant, signed in, reaches their own application and their bell
      and nothing else — no Feed, no Members.
- [ ] Mint a group link under ⚙️ → Invites with a closing date and a cap of 2.
      Redeem it twice with different addresses: both get in, where a direct invite
      refuses the second. The list shows both names against the link and 2 of 2, and
      a third try is refused. Revoke it: the link stops working, both accounts stay.
- [ ] With Discord or Facebook configured, open a group link and take it up with the
      provider button: one round trip makes a member, and the invites list counts the
      arrival. The page does not tell a group link's arrival it is good for one person.
- [ ] As somebody who signed up through that provider and has no role yet — the pending
      applicant above — open a second group link and press the provider button: they come
      out a member, and the list counts the arrival against that link. Pressing it again
      leaves the link unspent, membership already being theirs.
- [ ] An application from a provider signup shows which door on the review card, with
      a profile link only where the provider gave one.
- [ ] The admin's bell rings for the application. From the applications list,
      send the applicant a message; the applicant is notified and can reply.
      The exchange stays private to the two of them.
- [ ] Approve. The applicant gains membership, is joined to the coming burn, a
      card appears on the feed, and their bell says they are in. This account is
      the protocol's **member** persona from here on.

## Setting a burn up (admin)

- [ ] Create an event: name, slug, dates, daily hours, location, member cap,
      welcome markdown. The editor's preview matches what the homepage then
      renders.
- [ ] A second event with the same slug answers a slug conflict, not a generic
      error.
- [ ] Add lodging options (one with a small capacity) and helping options; add
      places (lanes) with emoji and colour; add meal slots and generate the
      sittings — generating again adds nothing and removes nothing.
- [ ] Seed the FAQ and the lead roles from a previous burn where one exists;
      seeding into a non-empty list is refused.

## Joining, and the stay

- [ ] The member's details page offers every coming burn; joining defaults the
      stay to the whole burn.
- [ ] Pick lodging; fill the small option with other accounts until it reads
      "— full" and refuses another taker — while never disabling it for
      somebody already in it.
- [ ] Tick helping options and add a write-in; save; reload; everything held.
- [ ] Leave the burn (unpaid): the stay and every signup at that burn are gone.

## The roster, payment, and places

- [ ] The member reads the roster: names, dates, lodging, allergies, payment
      status — no email column, no payment date.
- [ ] The member's own page shows payment status with no control to change it,
      and a member cannot record payment through the API either.
- [ ] The admin records a payment: the list reorders paid-first and the
      have-a-place line moves. With more joiners than the cap, whoever is below
      the line is told they are waiting.
- [ ] A paid member transfers their place to an unpaid one: the payment moves,
      the giver's stay is deleted, the taker is notified.

## The programme

- [ ] The member offers a dream with no time — it lists as offered, not as an
      error. Another member drags it onto the grid; any member may move it.
- [ ] Hand the facilitator role to somebody coming; their initials show on the
      block and they are notified. A hand up as helper notifies nobody for
      their own click.
- [ ] The meal plan draws its own kitchen lane — cooking, eating, cleanup —
      and dragging a block moves the sitting. A dream cannot be dropped into
      the kitchen lane.
- [ ] At phone width the grid and the meal plan scroll internally under sticky
      headers; the page itself does not scroll sideways.
- [ ] On a burn that has ended, dreams, lanes, meals and FAQ refuse writes;
      commenting still works.

## The feed, and talking

- [ ] The feed holds the protocol's history so far: joins as cards, lead news
      as lines, newest first.
- [ ] The chip row: first tap solos a kind, the URL carries the filter, back
      undoes it, clearing the last chip lands on everything.
- [ ] Comment on a dream's card; the same conversation shows in the dream's
      panel. Edit your own comment; delete it; an admin can delete anyone's.
- [ ] Mention the member by name from the picker — they are notified once, not
      also for the comment pile. Follow and mute a card and confirm the
      checkbox states what will actually happen.
- [ ] Post an announcement; reword it (one card, bumped); withdraw it — the
      title and conversation stay, the body goes.
- [ ] Heart a card: the count moves, nothing is notified, nothing bumps.

## The songbook

- [ ] Paste a chords-over-lyrics song from ultimate-guitar as plain text: chord
      lines are recognised and the columns hold, monospace, in editor and page
      alike.
- [ ] At narrow-phone width the song wraps: lines break only where chords and
      words are both blank, no chord and no word is split, and every chord
      still sits over its syllable. The page does not scroll sideways.
- [ ] Transpose up and down: chords respell, the columns hold, and the stored
      song is untouched on reload.
- [ ] The editor suggests a capo; what is stored is what was chosen, shown
      beside the title.
- [ ] Name an artist on one song and leave another without one: the name shows
      beside the title in the book and under it on the song's page, "By artist"
      groups the named ones and puts the nameless last, and clearing the field
      takes the name off again.
- [ ] Autoscroll moves at the slowest speed setting, and the controls stay
      reachable at the foot of the viewport mid-song.
- [ ] Take a song out: it asks first, saying where the song goes; restore it
      from "Recently taken out".
- [ ] The song's card is on the feed; song news notifies only those who turned
      `song_added` on.

## The bring list

- [ ] ☰ → Bring list. Add something without ticking "I am bringing this
      myself": it lands under "Nobody is bringing these yet".
- [ ] Put your hand up on it from a second member's account: it moves to the
      half below, and the member who asked is told somebody is bringing it. A
      second hand on the same item tells them nothing more.
- [ ] Two hands to one item both show; ✕ takes one off and tells that person,
      never yourself.
- [ ] Reword your own item — the pen is offered on yours and not on somebody
      else's; an admin has the bin on any and the pen on none.
- [ ] Take an item off: it leaves the list, and its card on the feed says so
      with the conversation kept.
- [ ] 💬 opens the item's conversation on the list page; the same comments show
      on its card on the feed.
- [ ] From an account that has not joined the burn, 🙋 says to join the burn and
      links to the details page rather than refusing.
- [ ] Leave the burn with a pledge outstanding: the hand is gone from the item
      and the item is not.

## Being told

- [ ] The bell: a panel on a wide screen, a page (`/notifications`) on a phone;
      opening either marks things seen.
- [ ] Without opening the bell, follow a notification's own link — a dream card from
      the bell's list, or "What's new" on the redeploy bar. The badge drops by one on
      arrival, and only that notification loses its emphasis.
- [ ] Leave that page open and cause a second notification for the same thing from
      another browser: the badge appears while the page is up, and clears itself
      within a minute — when the page has refetched and is showing the change.
- [ ] Switch a category off; cause that event; neither bell nor push arrives.
- [ ] Turn on "any dream" comments, then mute one card from its bell: a reply there
      rings nothing, while a reply on another dream still does.
- [ ] Heart a card with more comments than it shows: the count fills and the card
      stays folded, "show the whole thread" still offered.
- [ ] Subscribe to push in one browser; a notification tapped lands on the
      right page in the open app rather than a new window.
- [ ] With SMTP configured (⚙️ → Settings), the test message goes to the
      admin's own address, and the email column appears on the notification
      settings — off everywhere until asked.

## The calendar

- [ ] The Schedule page carries the feed link — `webcal://` to follow, `https`
      to copy — for the burn in the bar.
- [ ] Subscribe in a real calendar client: the scheduled dreams and meals
      appear with title, time and place; nothing personal — no contacts, no
      allergies, no payment.
- [ ] Rotate the token: the old URL stops answering, the new one works.

## On a phone

- [ ] Below 45rem a member gets the six-icon bottom bar; the top bar keeps ☰,
      the brand and the session corner, and nothing wraps. The burn selector
      appears once there are two burns — `Layout.tsx` renders it only above one,
      and the admin steps above leave exactly one, the second create being a
      slug-conflict check.
- [ ] The top bar slides away scrolling down a page and returns on the first
      scroll up.
- [ ] ☰ opens the drawer over the page (Songbook, Rideshares, Bring list, the
      map when one is set); backdrop, ✕ and Escape all close it and focus
      returns to ☰.
- [ ] At 360px nothing anywhere scrolls the page sideways.

## Installing, offline, and the installation's face

- [ ] The app offers to install; the home-screen tile wears the uploaded icon
      (upload one under ⚙️ → Settings), and the browser tab wears it too, with
      a dot while the bell holds something unseen.
- [ ] In Chromium, the by-hand instruction never appears: on first paint there is
      either nothing or the Install button, and once the app is installed, opening
      the site in an ordinary tab offers neither. In Safari or Firefox the
      instruction is what shows.
- [ ] As the applicant persona, the notification settings' "not available on this
      page" note carries no FAQ link — the FAQ is a guarded page.
- [ ] Offline, visited pages render from cache; signing out deletes the cached
      data (an offline reload after sign-out shows no roster).
- [ ] `/changelog` lists what changed, newest first, and the deploy
      notification links to it.

## Guard spot-checks

- [ ] Admin routes (`/api/admin/...`) refuse the member persona.
- [ ] The member cannot write anybody else's name, contact or allergies.
- [ ] The applicant persona (pre-approval) is refused everywhere but their own
      application, the private message thread on it, passkeys and bell.
- [ ] A raw `<script>` typed into a comment, a dream title or the welcome text
      renders as text, never as markup.

## What to do with a failure

A failed check is an issue, filed with the step, the persona, the viewport and
what happened instead. A check that can be made an automated test should be —
and then leave the protocol, per the rule at the top.
