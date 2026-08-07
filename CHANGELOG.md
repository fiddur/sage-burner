# What's new

What changed, newest first, written for the people using the app rather than the
people building it. The app is served at `/changelog`, which is where the "a new
version is out" notification leads.

There are no version numbers: every merge to `develop` builds an image and the server
picks it up within a few minutes, so a date can hold several deploys. Add your line
under today's heading, and make a new heading when there is none.

## 2026-08-07

- **A page saying what's new.** This one — reached from the "a new version is out"
  notification, which until now led nowhere at all, and from the bar that offers a
  reload when the app has been redeployed under you.
- **A Q&A per burn.** How to get there, what to bring, what taking part actually asks
  of you. Anyone can ask a question and anyone can answer one — including somebody
  else's — and a new burn can copy last time's answers. Readable before you have said
  you are coming to anything, since those are the questions you have first.
- **Email, if you have somewhere to send from.** An admin fills in an SMTP server
  under ⚙️ → Settings and the app posts invites to applicants and, for anybody who
  asks for it, notifications to their inbox. Nothing changes for an installation that
  never sets one up.
- **An application leaves a bell row**, not only a push. It stays there until somebody
  reviews it, which is the point.
- **Approving somebody says whether the invite was emailed**, and why not when it was
  not. It used to say "send this link" either way, so a link went out twice or not at
  all.
- **The lead-roles register is one table on a phone**, scrolling sideways with the
  role's name held still, and the effort icons have a legend under it.
- **A shared link draws a card** with the burn's name, its dates and a picture.
- **The app offers to install itself** where the browser allows it.
- **Names carry faces** wherever people are listed.
- **Pinch the schedule** to see more hours or more lanes.
- **Two people editing the same list no longer overwrite each other silently** — the
  second one is told the list moved under them and shown what it says now.

## 2026-08-06

- **Notifications.** A bell in the corner with what happened while you were away, and
  browser push if you turn it on, per browser. What happens _to you_ is on unless you
  refuse it; what is going on _around you_ — a dream offered, somebody joining, a lead
  role taken — is off until you ask.
- **A waiting list.** Once the paid places are gone the rest of the list is a queue in
  the order people said they were coming, and a paid place can be handed to somebody
  else.
- **Allergies as a list to tick**, beside the free text, so whoever cooks can read
  them at a glance.
- **Readable offline, and installable.** The app keeps what you have already looked
  at, says when what you are reading is old, and forgets every bit of it when you sign
  out.
- **How to pay, per burn**, shown to whoever has not.
- **A dream's hearts say who**, not just how many.
- **A bar when the page has been redeployed under you**, offering a reload rather than
  taking one.

## 2026-08-05

- **Passkeys**, alongside the password rather than instead of it.
- **The meal plan.** Sittings per burn, who cooks and who cleans, and what is cooking
  — the spreadsheet's tab as a page, cross-checked against nobody's allergies yet.
- **A picture for your circle**, cropped and sized in the browser.
- **Dreams open from the grid.** Edit one, offer one, withdraw one, put a hand up to
  facilitate, pull its bottom edge to make it longer, or plan the same dream into
  several mornings.
- **Say you are coming to the next burn while signing up.**

## 2026-08-04

- **A selector in the bar**, because there is more than one burn at a time, and every
  page is about the one it names.
- **The lead-roles register** — who is looking after what — open to any member, with
  the roles copyable from a previous burn.
- **One places grid per burn**, seeded from a previous one.
- **Members read the roster**, without the payment dates or anybody's login address.
- **A lost invite link can be re-issued**, which kills the old one in the same breath.

## 2026-08-03

- **An application tells the admins**, on whichever browsers they asked on.
- **The burn's shared furniture is every member's** — the lodging and helping lists,
  the places, the welcome text. This replaces a spreadsheet everyone could edit.

## 2026-08-02

- **Lodging and helping lists per burn.** Pick where to sleep from what is actually
  there, with the full options refused, and tick what you will help with — or write in
  what the list is missing.

## 2026-08-01

- **The programme.** Offer a dream, edit it, and drag it into a timetable of lanes and
  hours.
- **The programme as a calendar subscription**, so it lives in a phone rather than in
  a page somebody reloads.
- **A burn starts and ends at a time**, not just on a day.
- **The installation has a name of its own.**

## 2026-07-31

- **The public application form**, rendered from questions an admin edits, with the
  answers stored beside the wording each applicant was actually shown.
- **Review, approve or reject**, minting a single-use invite link on approval.
- **Direct invites** for people already known, listed and revocable.
- **Redeeming a link makes the account**, with the details filled in as you go.
- **Members maintain their own record**, and say which burns they are coming to.

## 2026-07-30

- **Accounts and roles**, with the first admin bootstrapped from the command line.
- **Burns as records** rather than one hardcoded event, with an admin editor.
- **The application form's questions are rows**, so changing them needs no redeploy.
- **The welcome text on the public homepage**, written in markdown per burn.

## 2026-07-28

- **The first container.** One Node process serving the API, the web app and a single
  SQLite file, with password login and a Docker image Watchtower can pick up.
