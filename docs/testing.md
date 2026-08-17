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

**A glyph for a control in these docs stands for the drawn icon of that meaning**, not for an
emoji on screen: since #621 every control is Lucide line art, so ✏️ means the pen, 🗑️ the bin, ☰
the menu, ✕ the close, ⚙️ the cog, ↻ the reload, 🖼 the picture button and 🙋 the raised hand.
What the pages, a card's entry marks and the Leads phases wear really is emoji, and so are the
two states — 🔔 / 🔕 and ♡ / ❤️‍🔥 — for the reason `docs/the-app.md` gives under **The icons**.

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
- [ ] Leave the email field blank: the application still sends, and the admin's
      review card shows the address the account signed up with.
- [ ] Signed in as a member, `/apply` says there is nothing to apply for and shows
      no form.
- [ ] The confirmation says whether anything will be emailed, matching whether
      SMTP is configured.
- [ ] The new applicant, signed in, reaches their own application and their bell
      and nothing else — no Feed, no Members.
- [ ] Send the same application a second time (two tabs, or the back button): the page turns
      into "Application sent" rather than leaving the form up.
- [ ] Once approved, `/apply` reads "You are on _burn_" and never flickers the between-burns
      sentence on the way. Leave that burn and join another by hand: it names the one you are
      on, and claims nobody added you to it.
- [ ] The group-link form offers no closing date before today, and says so rather than
      answering "Request failed" if one is typed anyway.
- [ ] Mint a group link under ⚙️ → Invites with a closing date and a cap of 2.
      Redeem it twice with different addresses: both get in, where a direct invite
      refuses the second. The list shows both names against the link and 2 of 2, and
      a third try is refused. Revoke it: the link stops working, both accounts stay.
- [ ] With Discord or Facebook configured, open a group link and take it up with the
      provider button: one round trip makes a member, and the invites list counts the
      arrival. The page does not tell a group link's arrival it is good for one person.
- [ ] Fill a group link's last place through the provider button: the next person through it
      is turned back to the login page saying the link has run out, and the list still counts
      what the cap allows and no more.
- [ ] As somebody who signed up through that provider and has no role yet — the pending
      applicant above — open a second group link and press the provider button: they come
      out a member, and the list counts the arrival against that link. Pressing it again
      leaves the link unspent, membership already being theirs.
- [ ] Their application now reads approved in ⚙️ → Applications, dated today, with no
      Approve or Reject left to press — where before it sat among the people still waiting.
- [ ] An application from a provider signup shows which door on the review card, with
      a profile link only where the provider gave one.
- [ ] The admin's bell rings for the application. From the applications list,
      send the applicant a message; the applicant is notified and can reply.
      The exchange stays private to the two of them.
- [ ] Approve. The applicant gains membership, is joined to the coming burn, a
      card appears on the feed, and their bell says they are in. With no burn planned,
      the same page says every coming burn is open to them and claims no join. This account is
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
      have-a-place line moves. Every unpaid member with a place is told the same
      thing, and everybody past the cap the same as each other — how many places
      stand empty while any do, and once none do, whether this member is holding
      one or on the waiting list. The notification opens that burn's roster, and a
      second payment does not say "full" again.
- [ ] On a burn with a cap of one and a single unpaid member, read that member's bell against the
      roster: the page says "1 of 1 places taken" with them in it, and the bell says they are in
      one for now — not that there is a place left to go and win (#726).
- [ ] A paid member transfers their place to an unpaid one: the payment moves,
      the giver's stay is deleted, the taker is notified.
- [ ] With every place paid for and somebody waiting, un-record one of those payments: the
      waiting member is told the line has moved. Removing a paid member from ⚙️ → Roster does
      the same.
- [ ] Do either of those on a burn whose dates have passed: nothing is posted to anybody's
      bell about its waiting list.
- [ ] ⚙️ → Events, on a burn whose dates have passed: **Meal times** lists the times with no
      clock, no bin, no add row and no **Fill the days in**, and says the burn has ended. On an
      open burn the whole editor is there.

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
- [ ] On a burn that has ended, the admin's meal times refuse adding, editing and
      deleting, Generate lays no new sittings, and a single sitting can be neither
      added to it nor taken out.
- [ ] On a burn that has ended, dreams, lanes, meals and FAQ refuse writes;
      commenting still works.

## The feed, and talking

- [ ] The feed holds the protocol's history so far, every item a card with a 🔔 in
      its corner and a comment box under it, newest first. Nothing on the page is a
      one-liner with a chip at its tail.
- [ ] The chip row: first tap solos a kind, the URL carries the filter, back
      undoes it, clearing the last chip lands on everything. **Leads** is one of the
      chips and shows the roles.
- [ ] A lead role has a card: adding one opens it, taking the lead and handing it
      over add a line each, and saying something on it reaches whoever is on it.
- [ ] A generated meal plan puts **nothing** on the feed. Take a sitting's cooking on and
      its card appears, headed by the sitting's slot **and its day** — "Dinner · Sat 1" —
      and carrying the food idea; the **Meals** chip shows it. Do the same for the next
      day's Dinner: two cards, headed differently. A comment on it reaches whoever is
      cooking, and names the sitting the same way — and so does the bell line for being put
      on a crew or handed the lead.
- [ ] Comment on a dream's card; the same conversation shows in the dream's
      panel. Edit your own comment; delete it; an admin can delete anyone's.
- [ ] Mention the member by name from the picker — they are notified once, not
      also for the comment pile. Follow and mute a card and confirm the
      checkbox states what will actually happen.
- [ ] Post an announcement; reword it (one card, bumped); withdraw it — the card
      leaves the feed, and a reload does not bring it back.
- [ ] With the feed open in a second browser, take a meeting out of the diary in the
      first, then reply to its card in the second: the reply is refused with "Somebody
      took that out of the diary" and the card leaves the page, composer and all.
- [ ] With the same two browsers, take a comment back in the first and then, in the second,
      press ✏️ on that same comment and save: the message is "That comment is no longer
      there.", the card stays with everything else on it, and the comment goes from it.
      🗑️ **Take back** on an already-taken-back comment says the same.
- [ ] Stop the backend, type a reply on any card and press **Say it**: the message says
      something went wrong, the card stays, and what was typed is still in the box to
      send again.
- [ ] Heart a card somebody else announced: the count moves, nothing bumps, and **they**
      get a bell line saying you hearted it. Take it back — still one line. Heart your own:
      nothing at all.
- [ ] Heart somebody's dream from the **panel** on Dreams or Schedule, not from its feed card:
      the same line reaches them. The two buttons are one heart and say the same thing.
- [ ] The ♡ on a comment sits on the same line as the pen and the bin beside it, hearted or not.
- [ ] Heart a comment under any card: the ♡ fills, the count appears beside it rather
      than inside it, and whoever wrote it is told. From a second account, heart the same
      comment: the count is 2 and both faces are stacked.
- [ ] Press the faces-and-count: the list of who gave one unfolds under the comment,
      each row linking to that person's page. Press again and it folds away.
- [ ] The lines the app wrote — "offered this dream", "is cooking it" — carry no heart.

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
      links to the details page rather than refusing — from an opened dream panel and
      a meal dialog as well as from a page, since that is where it is pressed.
- [ ] On a burn nobody has joined yet, the lead-role, meal-crew, bring-list and helping 🙋 are
      all offered (and the appoint control is not, there being nobody to appoint). A chore's cook
      offers neither.
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
- [ ] Switch **Somebody hearts something you wrote** off, have somebody heart your comment:
      nothing arrives, and the heart is still saved.
- [ ] Turn on "any dream" comments, then mute one card from its bell: a reply there
      rings nothing, while a reply on another dream still does.
- [ ] Heart a card with more comments than it shows: the count fills and the card
      stays folded, "show the whole thread" still offered. The same for a heart on one
      of the comments it does show.
- [ ] Subscribe to push in one browser; a notification tapped lands on the
      right page in the open app rather than a new window.
- [ ] Any of the emails — the test message, an invite, a notification — arrives wearing
      the installation's name, the app's colours and its serif body, with the action as a
      filled button. Read it in a client with images off: nothing is missing, because there
      are none. Read it as plain text: the same words, and every link on a line of its own.
- [ ] Read one on a phone, or at a 360px window: the card fills the width rather than
      sitting in the left half of a wider page with the type shrunk to fit.
- [ ] With SMTP configured, ⚙️ → Settings offers **Send me a digest of the last [24] hours**.
      Press it: a digest of the last day's feed arrives — the same headings as the chips on
      the feed, a card as one line saying who did what, and a card somebody only commented on
      as "+N comments" rather than the comment itself. Change 24 to 1 and press again: less,
      or a note that nothing has happened in that stretch. Neither press changes when your
      real digest next goes out.
- [ ] Give one section more than five things to say — six songs into the songbook, say — and
      press it again: the section lists five and ends with "and N more", which opens the feed
      already filtered to that section's chip.
- [ ] Put a lead role of the same name on two burns and press it again: the two lines read the
      same but end with different burns, and each opens its own. A song's line says "Songbook".
- [ ] Announce something and press it again: the Posts line is a link, and it opens the feed
      with the Posts chip lit. It lists posts from every burn — the feed has no burn filter, and
      the `burn` in the address only moves the selector.
- [ ] Read the same digest as plain text (most clients offer it, or look at the raw message):
      the footer carries "Your details → Notifications" on its own line above the address,
      rather than the address alone.
- [ ] Raise a talking point from a second account with **every** notification category
      switched off on your own. The digest preview still carries it: it is the feed, not
      your notifications.
- [ ] With SMTP configured (⚙️ → Settings), the test message goes to the
      admin's own address, and the Email column appears on the notification
      settings — unticked for every kind until asked. The digest below the tables
      is the one thing there that starts on.
- [ ] Your details → Notifications shows four collapsed sections rather than a row per
      category. **A new version of the app is out** has no expander — with one category in
      it, its header row is the row.
- [ ] On an account that has never saved: **What happens to you** is plainly ticked, every
      one of its kinds being on by default, and **What others are doing** is **mixed**,
      `meeting_scheduled` being the one of its kinds that is on. Press the mixed one: every
      row under it comes back ticked, and one save went out. Press it again: all off.
- [ ] Open a section and untick one row: the switch above it goes mixed without a reload.
- [ ] Open the ⋯ on the **last** row of a **full** bell panel: the menu opens upward and both
      entries are inside the panel and clickable. On a row near the top it still opens downward.
- [ ] With only one or two notifications in the bell, open the last row's ⋯: nothing is drawn
      above the panel's top edge, and scrolling the panel brings the whole menu into view.
- [ ] Escape with a row's ⋯ open shuts the menu and leaves the bell panel open, with focus back
      on the ⋯. A second Escape shuts the panel.
- [ ] On the bell panel and on `/notifications`, a row's ⋯ offers two things. **Stop telling
      me about this** names the kind; press it, and a line under the panel says which kind was
      switched off, and that kind is off in both columns on the details page. **Remove this
      notification** takes the row off, and a reload does not bring it back — with an unseen row,
      the count above drops with it.
- [ ] In a browser with push off, tick a category on the details page: a strip appears at the
      bottom of the window offering to turn notifications on here.
- [ ] Without dismissing it, go to the feed and tick "Notify me on similar" in a card's 🔔:
      the same strip is raised — and switching one _off_ raises nothing.
- [ ] Press "Do not ask me here". Tick another category, on either the feed or the details
      page: no strip, this time or after a reload. In a different browser, ticking one raises
      it again.
- [ ] Raise the strip and then log out without answering it: it goes with the session rather than
      standing over the signed-out homepage, where its button would ask the browser for permission
      and then meet a 401 (#588).
- [ ] In a browser with push off, open `/notifications`: a slim strip at the foot of the
      list offers **Turn on**, and pressing it subscribes from there. With push already on
      here, or with the browser blocking notifications, there is no strip.
- [ ] Press the strip's ✕: it goes. Reload — still gone. Close the browser, open it
      again and return: the strip is back. After "Do not ask me here" on the other strip,
      it stays away.
- [ ] Take up an invite in a browser with push off: the welcome offers "Notify me here",
      and accepting it subscribes without a trip to another page.
- [ ] With SMTP configured, Your details → Notifications carries **A summary by email when
      you have stayed away**, set to _Every day_; without SMTP the whole control is absent.
- [ ] Set it to _Never_ and reload: it is still _Never_. The digest itself needs a clock —
      an approved account, something on the feed, no visit for a day, and the sweep run in
      the small hours — so `digest.test.ts` is what covers when one goes out.
- [ ] ⚙️ → Notifications sent lists what has gone out, newest first, with the number told,
      the number who had the category off, and the devices that took it. Cause a burn-wide
      notification: it is **one** line whose "Told" is the number attending, not one line
      per person.
- [ ] Write `@everybody` in an announcement, a bring item's comment and a talking point: each
      is **one** line under "Somebody names you", not one per person named.
- [ ] With no mail server set up, tick an Email box and cause that notification: the line's
      **Emails** column stays at 0, nothing having been posted.

## Meetings

- [ ] ☰ → Meetings, on a burn you are attending: raise a point. It appears under **Open
      points** with your name, and on the feed as a card whose first line is "raised this".
- [ ] Comment on that card from the feed: the comment shows on the point's thread on the
      Meetings page too — it is one thread, not two.
- [ ] Record a decision on it, with a "where was it decided". The point moves to
      **Addressed**, the decision shows on the card, and the feed card gains a `⚖️` entry
      carrying the decision itself.
- [ ] Press **Reopen**: it goes back to Open points and the decision is gone from both.
- [ ] Put a meeting in the diary with a start and a joining link. The banner names it, the
      link opens it, and leaving the end blank means it runs an hour.
- [ ] Press ✏️ on it: the form opens filled in with what it already says, and saving moves it.
      A link that is not `https://` is refused.
- [ ] Put a second and a third meeting in, further out. Each line in **Also in the diary** has
      its own ✏️, editing one leaves the others closed, and pressing the same ✏️ again shuts
      the form. Editing one that has already been works the same way.
- [ ] The feed carries a **card** for it, headed with the meeting's name and carrying
      "put it in the diary". Comment on it, heart it, and use its 🔔 — a meeting is not a
      second-class thing on the feed. There is no separate line beside the card.
- [ ] Take the meeting out of the diary: its card goes off the feed with it, and so does what
      was said on it. The same for a talking point.
- [ ] Move the meeting: the card says "moved it" and comes back to the top. Moving it again
      does not stack up a second line. Rewording its note rewrites the paragraph under the card head
      without bumping the card or adding a line.
- [ ] Subscribe to the burn's calendar feed: the meeting is in it beside the dreams, with the
      joining link as its description — and the note you typed is nowhere in the file.
- [ ] A meeting whose time has passed moves under **Meetings that have been**, and one that is
      running right now stays in the banner with its Join link.
- [ ] On a burn that has ended, raising a point and recording a decision are both refused.

## Taking something back

- [ ] Announce something, then take it back with 🗑️ — the same bin every other card offers.
      The card goes off the feed as it is pressed, and is not there after a reload either:
      not at the top, and not where it was.
- [ ] The same for a dream withdrawn, a bring item taken off the list, and somebody leaving
      the burn — each card leaves the feed with the thing it is about.
- [ ] Take a song out of the book: its card goes too. Put it back and the card returns,
      carrying what was said on it while it was out.

## Nothing goes without asking

- [ ] Press 🗑️ on the meeting in the diary: it asks, naming the meeting, and nothing happens
      until **Take out of the diary** is pressed. **Keep it** leaves it alone, and the bin is
      offered again.
- [ ] The same on a talking point, a bring item, a ride, a place, an allergy item, a song
      category, a lodging option, a meal slot, an application question, a comment, an
      announcement, an invite (Revoke), a passkey, a linked provider, a way of being reached,
      your picture, the app icon, the banner, the mail server and a provider's settings.
- [ ] A heart, a raised hand, and taking yourself off a crew do **not** ask — pressing again
      undoes them.

## The calendar

- [ ] The Schedule page carries the feed link — `webcal://` to follow, `https`
      to copy — for the burn in the bar.
- [ ] Subscribe in a real calendar client: the scheduled dreams and meals
      appear with title, time and place; nothing personal — no contacts, no
      allergies, no payment.
- [ ] Rotate the token: the old URL stops answering, the new one works.

## The icons

- [ ] Every control is a line drawing in the colour of the text beside it — the pencil,
      the trashcan, the hand, the menu, the toolbar's link, list and picture. Nothing
      coloured is a button except the heart and the bell.
- [ ] The pages keep their emoji: the phone's bottom bar, the drawer's entries, the
      marks on a feed card's entries and the before/during/after phases on Leads.
- [ ] The top bell is 🔔, dim with nothing unseen and full-strength with a count on it when
      something is.
- [ ] A card's bell says its position out loud as well as showing it: with a screen reader, or by
      reading the `aria-label`, the button is "Notification settings for <what>, on" or "…, off"
      (#675). 🔔 and 🔕 differ by one diagonal stroke, so the mark alone is no use to anybody who
      cannot see it.
- [ ] A card's bell is 🔔 where either of its switches is on and 🔕 where neither is — tick one
      and it lights without a reload.
- [ ] Ticking a category on a card near the bottom of a phone screen raises the push strip
      **over** the still-open menu, and its offer can be pressed without dismissing anything.
- [ ] Hearting something fills ♡ to ❤️‍🔥 — the heart is the one control that is not a line
      drawing — and taking the heart back empties it.
- [ ] In dark mode every icon is still legible, and hovering a control still lightens it.

## The composer

- [ ] A comment box's toolbar is five wide: **B**, _I_, link, list, picture. There is no
      _Add a picture_ under the box.
- [ ] The picture button opens a file picker and the chosen picture lands at the end of
      the body; pasting one and dropping one on the box still do the same.
- [ ] Tab to the picture button: the ring is drawn around the button, not around the toolbar.
- [ ] While it is going up, the note below the box says a picture is on its way and the
      picture button is dimmed. Choosing an SVG says so below the box, not in the toolbar.
- [ ] Choosing two at once puts two placeholders in the box and the note reads _Sending
      pictures…_ rather than naming one.
- [ ] Every longer box wears the same editor — a card's comment box, the rewrite box under
      ✏️, a meeting's notes, a bring item's "anything else", the welcome text, and the
      applicant's box on `/apply` — each with **Write | Preview** over it and a footer under
      it. The song sheet and the application answers are plain boxes, and say nothing about
      markdown.
- [ ] **Preview** renders what **Write** holds, and an empty box previews as _Nothing
      written yet._ rather than blank. Switching back keeps what was typed.
- [ ] Say something on a card with **Preview** showing: the box empties and comes back to
      **Write**, rather than sitting on _Nothing written yet._
- [ ] The toolbar's controls name the box the way it is labelled — _Bold in what you said_
      under a comment's ✏️, not _Bold in Rewrite what you said_.
- [ ] The footer's _Markdown is supported_ opens `/formatting`, which reads the same signed
      out. Every example's right-hand column is what its left-hand column renders to.
- [ ] The picture half of that footer is there only where pictures are — present on a
      comment, on **How to pay** and on the **welcome text**, absent on the applicant's box.
      It draws the same outlined icon the toolbar's button does, not a coloured emoji.
- [ ] A picture put in the **welcome text** is drawn on the homepage while signed out, in a
      private window that has never signed in.
- [ ] Press a 🗑️ anywhere: focus is on the confirming button, and pressing **Keep it** puts it
      back on the 🗑️.

## The nav on a wide screen

- [ ] A member sees a column of pages down the left on load, with every page in it —
      Feed, Members, Schedule, Leads, Meals, FAQ, Songbook, Rideshares, Bring list,
      Meetings, and the map where one is set, which still opens away. The top bar carries
      the brand, the burn selector and the corner, and no page links at all.
- [ ] The page you are on is marked in that column.
- [ ] Press ‹ at the top of it: the column goes, ☰ appears at the leading edge of the bar and
      focus lands on it. Reload: still gone. Press ☰: it is back, and a reload keeps it back.
- [ ] With the browser window made short — under about 500px tall — the column scrolls, so
      Meetings at the bottom of it can be reached.
- [ ] Signed out, there is no column and no ☰.

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
- [ ] With the redeploy bar showing, follow "What's new" (or the notification that
      leads there): the page loads afresh and the bar is gone on arrival.

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
