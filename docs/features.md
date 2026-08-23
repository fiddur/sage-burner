# What sage-burner does

The feature map: one or two lines per feature, in the words of the person using
it. Two readers are meant: somebody curious about what the app can do, and an
agent trying a running copy out — [testing.md](./testing.md) is the protocol
built on this list. Each section links to the doc that carries the detail and
the _why_; nothing here repeats an argument those docs already make.

This list is kept current with the code — a change that adds, removes or renames
a feature updates it in the same PR ([AGENTS.md](../AGENTS.md) says so).

[← back to the README](../README.md)

## Getting in — [accounts.md](./accounts.md)

- Anyone can sign up and apply: `/apply` makes an account — email and password,
  or through Discord or Facebook — and then asks the application questions.
- An applicant waits with access to their own application, a private message
  thread with the admins, and their bell — and nothing else.
- Admins review applications with the answers as the applicant saw them, can ask
  a question back on the thread, and approve or reject; either way the applicant
  is told once, by bell and by one email carrying the whole of it — a question on
  the thread arrives with the question in it.
- Approval is one action: membership granted, the coming burn joined, the feed
  card opened, the bell rung.
- Direct invites: an admin mints a single-use, expiring link for somebody
  already known; redeeming it creates the account, offers the upcoming burn
  ticked, and signs them in. Lost links are re-issued, not worked around.
- A group link: one link for a closed group whose members are already vetted, good
  until the date the admin picks and optionally for a limited number of people. It
  lists who came in on it, and withdrawing it shuts the door without touching them.
  See [accounts.md](./accounts.md).
- Any invite can be taken up through Discord or Facebook in one click, which is how
  somebody who found the link in that group already signs in everywhere else. An
  applicant admitted that way has their application answered by the arrival, so the
  review queue holds only the people it can still decide about.
- The review card says which door an applicant signed up through — the provider, the
  name and username used there, with a link to their profile where the provider gives
  one — and links to their account.
- Signing up through Facebook takes the name from there; through Discord it does not, since
  a Discord name is rarely a real one. Every sign-up form asks for the real name.
- Forgotten your password? The login page posts a link to the address on the account,
  good once and for two hours; following it sets a new password and signs you in. Offered
  only where an admin has set a mail server up and told the app its own address, and it never
  says whether an address has an account here.
- Signing in: password, passkey, or a linked provider. Passkeys are usernameless
  and per device, several per account, alongside a password or instead of one —
  removing the last passkey off an account with no password is refused.
- Signing in sticks: a session lasts six months from the last visit and using the
  app renews it, so only staying away that long signs you out.
- The first admin comes from the CLI (`admin:create`); after that, admins grant
  roles from the accounts list, and each name there opens the account: its real name,
  login address, allergies, and a password to set. See [accounts.md](./accounts.md).
- Two roles, `admin` and `member`, independent — organising without attending is
  coherent.

## Who you are — [accounts.md](./accounts.md), [the-app.md](./the-app.md)

- Your details page holds everything that describes the person: name, the
  ordered list of ways you can be reached (one row per network, plus free
  links), allergies (ticked from a shared vocabulary, plus free text),
  an introduction, a picture, passkeys and linked providers, notification
  switches, and signing out.
- Every member has a page other members read — introduction, picture, contacts.
- The members roster per burn: names, arrival and departure, lodging, allergies
  and payment status are every member's to read; the email and the payment date
  stay admin's.
- Allergies follow the person, not the burn — corrected once, corrected
  everywhere.

## Burns — [burns.md](./burns.md)

- Burns recur — up to four a year, each with its own attendance and payments.
  Admins create and edit them: name, dates, daily hours, location, member cap,
  welcome text, payment and transfer instructions.
- The public homepage shows the active burn — name, dates, place, welcome
  markdown, pictures and all — with Apply and Log in for a visitor.
- Members join burn by burn from their own details page. A stay starts as the
  whole burn and carries arrival, departure, lodging, helping preferences and
  notes.
- Who has a place is derived, never stored: paid first, then unpaid, each in
  join order, with the line drawn where the cap runs out. Paying moves you up;
  waiting-list movements notify the people they happen to.
- Admins record payment; a paid member who cannot come hands their place (and
  payment) to somebody unpaid.
- Lodging and helping-out are per-burn lists with optional capacities — a full
  lodging option refuses politely, helping never runs out.
- The rideshare board: who needs a lift, who has room, per burn, contact
  resolved from the account.
- The bring list: one shared list per burn of things the gathering wants and
  things people are bringing. An item with no hands up is an ask and is shown
  first; a hand makes it an offer, several hands to one thing are normal, and
  the person who asked is told the moment somebody answers. Each item carries a
  conversation and a card on the feed; leaving the burn withdraws your pledges.
- The FAQ: per burn, seedable from a previous one, any member asks and any
  member answers, in an order somebody arranged.
- The calendar feed: the programme as an `.ics` subscription per burn —
  `webcal://` link and an `https://` copy button — protected by a rotatable
  token, carrying titles, times and places and nothing personal.

## The programme — [schedule.md](./schedule.md)

- Dreams — the workshops, ceremonies and happenings members offer each other.
  Offered without a time is the normal state; scheduling comes later, and any
  approved member may arrange any dream on the grid.
- A dream carries a facilitator (assignable, must be coming), helpers with a
  hand-up control, and hearts from the people looking forward to it. A dream can
  repeat, and everything a dream needs is editable without leaving the grid.
- Withdrawing a dream is soft, like taking a song out: for thirty days the Dreams
  page offers to bring it back, comments, helpers and hearts intact.
- Two dreams that turn out to be one can be folded together — the conversations
  interleave on the one that stays, helpers and hearts move across, and the other
  is withdrawn pointing at it.
- The schedule grid: lanes are places (with emoji and colour), the hours come
  from the burn, blocks drag and resize, and the whole thing pinches on a
  phone. A timetable view reads it as a list.
- Places and the lead-roles register both seed from a previous burn.
- Meals: an admin sets slot templates (Lunch 13:00, Dinner 18:00, chores) and
  generates the sittings; regenerating adds what is missing and removes
  nothing. The plan is one table — food idea, lead, help, cleanup — and any
  member takes a role, moves a sitting or writes the food idea. The kitchen
  draws its own schedule lane from the meals. Each sitting has a card on the feed
  once somebody does something with it, headed by its slot and its day, so "is it
  vegan?" has somewhere to go for a particular Dinner rather than all three.
- Every notification about a sitting names its day too, so two jobs on two Dinners never
  read the same.
- The lead-roles register: the burn's jobs, any member takes one, hands one
  over or appoints somebody — and whoever it happens to is told. Each role has a
  card on the feed, so "who can take this?" has somewhere to be asked.
- Editing is scoped to burns that have not ended; a finished burn is a record.

## Talking — [the-app.md](./the-app.md)

- The feed: what everyone has been doing and saying, as one kind of thing — a
  card carrying its whole history and the talk under it, for a dream, a person at
  a burn, an announcement, a song, a bring item, a talking point, a meeting, a
  lead role or a meal.
- A chip row filters the feed by kind, carried in the URL, defaulting to
  everything.
- Comments on any card: markdown, edit your own, delete your own (an admin may
  delete any), open even after the burn has ended.
- One editor for every longer box: Write and Preview tabs, a toolbar, pictures
  by paste, drop or button, and a footer linking to a formatting help page at
  `/formatting` that anybody can read, signed in or not.
- Mentions — `@name` from a picker, `@everybody` — notify the people named.
  A card can be followed or muted.
- Announcements: any approved member posts one; withdrawing keeps the
  conversation.
- Anything taken back leaves the feed: a withdrawn announcement, dream, song or
  bring item, and a stay somebody left. The conversation is kept, its place on
  the page is not.
- A heart on every card and on every comment. One control throughout: the heart
  toggles your own, and the overlapping faces beside it unfold into who gave one.
  Whoever wrote the thing is told, once, and never for their own click; nothing
  else happens — no bump up the feed, no line in the thread.

## The songbook — [the-app.md](./the-app.md)

- One shared book, belonging to no burn. Any approved member adds a song, edits
  any song, or takes one out (softly — restore is offered, nothing is purged).
- A song is plain preformatted text; chord lines are detected, not marked up,
  so pasting from ultimate-guitar just works.
- On a narrow screen the app wraps the song itself, breaking chord-and-lyric
  pairs only at columns blank in both — no chord and no word is ever split, and
  every chord stays over its syllable.
- Transposing is viewer-side and holds the columns; the capo is stored, with a
  suggestion offered; autoscroll with a speed slider for the phone on the
  floor.
- Links to recordings show the platform's own mark; categories are a curated
  (admin-edited) vocabulary, filtered by the same chip row the feed uses.
- Whose song it is, as a field of its own: shown beside the title in the book and
  under it on the page, and the list sorts by it as well as by title.

## Meetings — [meetings.md](./meetings.md)

- Talking points: one rolling list per burn, split into open and addressed. Raise one,
  discuss it in its own thread on the feed, and record what was decided on the point
  itself — clearing the decision reopens it.
- Meetings in the diary: the page says when the next one is and how to join it, every
  meeting appears in the burn's calendar feed beside the dreams, and each one is a feed
  card you can reply to — for the _I can't make that time_ nobody had anywhere to say.

- Anything that cannot be undone asks first — one question in place of the control, naming
  the thing and what else goes with it. What a second press would undo does not ask.

## Being told — [accounts.md](./accounts.md)

- A notification is a record: the bell holds what happened while you were away,
  as a panel on a wide screen and a page on a phone. Opening the bell marks
  everything seen, and so does arriving at what one points at — once the page is
  showing data as new as the notification.
- Browser push per device, opt-in, with nothing to sign up for. It is offered where
  somebody has just joined on an invite, and again wherever a switch is turned on in a
  browser that would hear nothing — the settings table or a card's own bell — until you
  say not to ask there, which answers for all of them at once.
- The bell itself carries a quieter offer at the foot of the list, for whoever is
  reading their notifications on a device push cannot reach. Its ✕ lasts the sitting
  rather than for good, and the heavier refusal above silences it too.
- Email as a channel of its own, per category, off until asked for — the column
  appears only once an admin has configured SMTP. News about your own application is
  the exception, emailed unless you say otherwise, an applicant having nowhere else
  to hear it.
- A digest of the feed, by email, **on by default** — daily, weekly or never. It carries
  what has happened since you were last here whatever the switches above say, and goes
  only to people who have stayed away, so it reaches whoever has stopped opening the app
  without adding a message for anybody who has not.
- Categories default by kind: what happens _to you_ is on unless refused, what
  happens _around you_ is off unless asked for — except a meeting being scheduled,
  which is on, because it is the only one with a time you have to be at. Attendance
  is the audience for burn-wide news, and nobody is told about their own click.
- The settings are four collapsed sections with a switch each for Here and Email;
  open one for the categories under it. A section's switch writes every category in
  it and reads as mixed where they differ.
- Every notification carries a ⋯: stop being told this kind of thing at all, on both
  channels at once, or take that one line off your list.
- Admins are told when somebody applies; everybody who asked is told when a new
  version deploys, with a link to the changelog.

## The installation — [the-app.md](./the-app.md), [configuration.md](./configuration.md), [deploying.md](./deploying.md)

- Self-hosted: one container, one Node process, one SQLite file. No external
  services required; push, email and provider sign-in are optional and
  configured from inside the app.
- Admins name the installation, upload its icon, link the site map, and set up
  SMTP (with a test message, and a digest of any stretch, to their own address) and OAuth providers.
- A shared link draws a proper card — the backend injects the installation's
  name, the burn's dates and a banner into the shell for crawlers.
- Getting around: on a wide screen every page is a column down the left, marked with
  the page you are on — ‹ hides it, ☰ brings it back, and the browser remembers which.
  On a phone the six member pages are a bar along the bottom and the rest are behind ☰.
- The app installs to a home screen and works offline from its cache; signing
  out deletes the cached data.
- `/changelog` says what each deploy changed, in the members' words, and the
  deploy notification points at it.
