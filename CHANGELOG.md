What changed, newest first, written for the people using the app rather than the
people building it. The app serves this file at `/changelog`, which is where the "a new
version is out" notification leads — so the page supplies the title and the sections
below start at `#`, which `renderMarkdown` shifts down one level under it.

There are no version numbers: every merge to `develop` builds an image and the server
picks it up within a few minutes, so a date can hold several deploys. Add your line
under today's heading, and make a new heading when there is none.

# 2026-08-10

- **The pages that are a column no longer hug the left edge of a wide window.** Your details,
  Settings, the feed, somebody's page, notifications, signing in, redeeming an invite and
  applying are all centred now, at a comfortable reading width. The pages that are a table — the members list, the
  schedule, who is coming — still use the whole window, because that is what they are for.

- **The privacy page now explains why the Discord or Facebook screen asks for more than we keep.**
  Their screens name your username and banner, because a profile is the smallest thing either
  lets an app ask for — and what arrives beyond an identifier and a picture is dropped rather
  than stored. The settings page tells whoever set it up the same thing, so they can answer it.
- **The sign-in buttons for Facebook and Discord appear as soon as they are set up**, instead of
  after a reload.
- **When linking one fails, whoever runs the gathering can now find out why.** It still says only
  "that did not work" to you — there is nothing you could do about it — but the reason the provider
  gave is written to the server's log, so a wrong secret or a setting in the wrong place can be
  fixed rather than guessed at.

- **Signing in with Facebook or Discord works from the button again.** Clicking it landed on a
  "Nothing here" page instead of going to the provider — both on the login page and on Your
  details. Nothing was wrong with where the button pointed; the app was catching the click
  itself.

- **Linking Facebook can now fill in your profile page**, if whoever runs this gathering set
  their Facebook app up to ask for it — there is a tick box under ⚙️ → Settings for that, and it
  needs Facebook's approval first. Typing your Facebook name under How people can reach you is
  still the better of the two: Facebook only opens its own link for people already logged in and
  already friends with you. Taking the sign-in off takes the link with it.
- **There are terms now, at `/terms`, linked in the footer beside the privacy policy.** Mostly
  they say the thing that is easy to assume wrong: using this is an agreement with the people
  who invited you, not with a company, because there is not one.
- **The privacy policy now says how to get rid of what a Discord or Facebook sign-in gave us.**
  One button under Your details, what it does not undo, and what happens if that link is the
  only way you have left of signing in.
- **The calendar link has an address of its own, and every existing one has changed.** It used
  to be built from the burn's own identifier, which the front page hands to anybody who opens
  it — so for the gathering being planned, the schedule was readable by any stranger. If you
  had subscribed, subscribe again from the Schedule page. Organisers can also give the
  calendar a fresh address from there when a link has gone too far, which stops the old one.

- **Somebody organising a burn without coming to it can fill in Your details** — a name, a
  picture, an introduction — not only the parts about signing in. Their own page had been
  inviting them to write an introduction on a form that turned them away. The burns below are
  still for whoever is coming to one.

# 2026-08-09

- **The ✕ on each of your stored pictures says which picture it is**, rather than only the day
  it was added — which was the same words for everything from one sitting.

- **You can say who you are.** Your details now has _A little about you_ — a paragraph, and as
  many pictures as you like, pasted or dropped in or taken from your phone. It shows on your
  page, which every member reaches by clicking your name, above the ways of reaching you. Until
  now a name you had not met told you how to contact somebody and nothing about who they were.

- **"That is as many ways as one account may list" is said when it is true.** Adding a way of
  being reached to a list that filled up in another tab said "you have already listed that
  one", which is a different problem with a different fix.

- **Somebody organising a burn without coming to it can reach Your details.** Their picture,
  how people reach them, how they sign in, and — the one that mattered — the switch for
  notifications, which is where applications are announced. The page turned them away
  before, and the notification switch had already moved off the admin page. What is about a
  stay is still a member's: the name and allergies planning needs, and the burns themselves.

- **You can see and delete the pictures you have added**, under **Pictures you have added** on
  Your details. Every picture you paste or drop into something you write is kept, whether or
  not what you wrote still shows it, and until now there was no way to take one back off —
  so somebody who filled up their allowance could never add another. Taking one off frees a
  place, and leaves a gap wherever it was still being shown.

- **Pasting an SVG into a comment now says why it will not do**, instead of failing with
  "could not read that picture".

- **A Facebook link the app cannot read a handle out of is kept as you pasted it**, rather
  than being quietly stored as something that led nowhere.

- **The links on somebody's page are named by what they say**, so a screen reader or voice
  control can address them; and a page for somebody with no name yet no longer offers to
  copy "them's Discord".

- **"Continue with Discord" only appears where it can actually work.** A provider saved with
  a client id and no secret used to draw a button that could only end in "that did not work".

- **"That is linked now" is said once**, rather than again on every reload of the page.

- **A refused save no longer empties the form** when you add a way of being reached, and a
  list that could not load says so instead of looking empty.

- **Your sign-in address fills in with one press** when you add it as a way of being reached.

- **The privacy page is linked from the footer of every page**, and from the application form
  above the Send button — which is where somebody hands over contact details before they have
  an account. It also now says what the calendar subscription gives away: the programme's
  titles and descriptions are readable by anybody holding that address, without signing in.

- **There is a privacy page now**, at /privacy, saying what this app keeps about you, who can
  see it, and how to get rid of it. Anybody can read it without signing in — which is what
  Facebook asks for before it will let people sign in with it, and a fair thing to be able to
  read before you apply.

- **You can sign in with Discord or Facebook**, if whoever runs this has set that up — as well
  as your password and any passkeys, never instead of them. Link one under Your details, and
  it works next time you sign in. You cannot take away the last way you have of getting in.

- **Linking one fills in your picture** if you have not chosen one — from Discord or Facebook,
  whichever you linked. It is yours to change or remove like any other picture, and one you
  have already chosen is left alone. If you want people to reach you on Facebook, add your
  Facebook name under How people can reach you: that is what puts Messenger in your list and
  your Facebook page on your profile.

- **Signing in with something nobody has linked tells you nothing about who is here.** It says
  the same thing whether or not there is an account — this app does not answer questions about
  who has one.

- **Every name is a link to the person now.** Click somebody — on the members list, on a
  dream, in a conversation, beside a lift they are offering — and you get their page: their
  face, and how to reach them in the order they chose, so the first one is where they would
  rather be tried. A handle nothing can link to, like a Discord username, comes with a copy button instead.

- **Your email address is now in your list of ways to be reached**, because you have one
  either way — and like everything else in that list, **other members can see it**. If you
  would rather they did not, take it off under Your details → How people can reach you; it is
  an ordinary entry, and you can also sort it or change it to a different address.

- **Notification settings are in one place.** The switch for notifications on this device
  was on both Your details and the admin Settings page, which made it look like two
  different settings. It is on Your details, where the rest of your own settings are.

- **Facebook is in the list, as Messenger.** Paste your Facebook name or the whole link to
  your profile and it becomes a "message me" link that works from anybody's phone.

- **You can say how people should reach you.** Your details now takes Discord, Instagram,
  TikTok, Mastodon, Signal, WhatsApp, a phone number, an email address or a link of your
  own — as many as you like, dragged into the order you want people to try. Nothing shows
  them to anybody else yet; that arrives with the page behind your name. The address you
  sign in with is shown to nobody either way: add it to the list if you want it to be.

- **You can put a picture in what you write.** Paste one into a comment, drag one onto a
  dream's description, or tap "Add a picture" and pick one from your phone — it appears
  where you were typing and everyone reading sees it. Photographs are shrunk in your own
  browser before they are sent, turned the right way up if your phone recorded that, and
  stripped of where they were taken. The burn's welcome text and the application form do
  not take them: those pages are public, and a picture there would only show as broken.

- **You can talk about a dream now.** Open one — from Dreams or from the grid — and under
  it there is a conversation: who offered it, who put a hand up, and whatever anybody has
  asked or answered. How many people is it for, do you want help, is that before or after
  dinner. That went to Discord before.

- **Going on is now the Feed, and a dream has one place on it.** A dream is a single card
  carrying its own history and everything said about it, so a morning of four comments is
  one card rather than four lines, and a card comes back to the top when somebody says
  something. Everything else — somebody joining, a lead role taken — still reads as it
  did.

- **A dream that has been renamed says its new name.** The feed used to go on offering the
  title it was given when it was first offered, however many times it had been changed
  since.

- **Withdrawing a dream keeps what was said about it.** The card stays, says it was
  withdrawn, and can still be replied to — the conversation was often worth more than the
  plan.

- **You are told when somebody answers you.** A comment on a dream you offered,
  facilitate, help with or have spoken on reaches your bell, and by email if you have
  asked for that. Comments on everybody else's dreams are off unless you switch them on,
  under Your details → what else is going on.

# 2026-08-08

- **The bar across the top fits on one row on a phone.** 🔔, ⚙️ and your face sat on a
  second row under the logo — most often for admins, who have one icon more — and ☰ has
  moved to the far left, where the menu it opens comes from. An installation whose name
  is too long for the row now gets an ellipsis rather than pushing the icons off.

- **Recording a payment, or anything else that emails a burn, answers straight away.**
  The send used to happen inside the request, so a mail server that was slow or busy
  made whoever pressed the button wait for it — and a burn-wide message opened one
  connection per person at once, which some mail servers refuse. They go out one at a
  time now, after the page has answered.

- **Changing the banner no longer leaves the old one on your phone forever.** Every
  upload was kept, about a megabyte each, with nothing to clear them.
- **The page no longer jumps sideways when a menu or a dream opens** on a desktop, and
  a menu whose pages disappear under it no longer leaves the page stuck unscrollable.
- **The icon preview under ⚙️ shows what is actually installed**, rather than whatever
  that browser had seen under a URL that never changed.
- **The menu and a dream's panel now hold the page behind them still.** It used to
  scroll under them, and tabbing from inside walked out to buttons hidden behind the
  backdrop.
- **A page that is not yours now offers the application form beside the log-in link.**
  Somebody sent a link to the burn by a friend, before they have applied, was told only
  to log in — which is not a door they have.
- **A change on an admin page cannot be undone by the next click.** The buttons stay
  put until the list has been read back, so a second change made in the moment between
  the two is no longer computed from what was on screen before the first — which could
  quietly write it away. A click refused while something else is saving no longer marks
  the row it landed on as busy either.
- **Somebody organising a burn can put people down to help with a dream without
  coming to it themselves.** 👉 on a dream's Helping-out strip used to fail for
  them, which is what the lead-roles register has always allowed. Whoever is named
  still has to be coming.
- **A menu beside the name at the top left.** ☰ slides out the pages the bar has no
  room for — 🛻 Rideshares to begin with, and more as they arrive. The logo still takes
  you to the start page.
- **The rideshare board is reachable without having joined a burn.** It was linked only
  from your arrival dates, which is a form you do not have until you have said you are
  coming.
- **A rideshare board.** Who is looking for a lift and who has room in a car, per burn,
  with everyone's contact details right there — the Rideshares tab from the spreadsheet,
  without being a publicly linked document. Your own posting is yours to change or take
  down. Find it beside the arrival dates on your details page.
- **A line on Going on opens the burn it is about.** Following one about the autumn burn
  while the bar was showing the summer one took you to the summer page — the right page,
  the wrong burn.
- **A mail server that is not answering no longer holds a page up.** With email
  configured to a host that had stopped responding, anything told to everybody at a
  burn — a dream offered, a lead role taken — waited on it once per person, which at a
  full burn was minutes. Now it posts to everybody at once.
- **"Send a new link" says which of the two things went wrong.** It told you the person
  was already in whatever the reason; an application that had not been approved now says
  so instead.
- **Somebody organising a burn without coming to it can now see its timetable.** They
  could pick the burn from the selector at the top and were then told the Schedule and
  the Dreams pages were "for members" — while the places, the lead roles and the
  lodging lists beside them were already theirs to set up.
- **What is new on your notifications stays marked new while you read it**, instead of
  quietly going plain a minute in.
- **The Leads page no longer drags sideways, and its bottom bar is back.** The page
  slid left and right beside its table, which pushed the row of icons at the bottom off
  the edge of the screen — on that page it was missing entirely until you scrolled to
  the very end.
- **Tapping a dream opens it.** On the Dreams page a dream was a title and a time, and
  what it actually _was_ — the description, who is running it, who is helping, who
  wants it — could only be found by going to the Schedule. The row opens the same panel
  the grid opens now, and editing and withdrawing live inside it, so the pen and the
  bin no longer wrap onto a line of their own on a phone.
- **The bottom bar gets out of the way.** It slides away as you read down a page and
  comes back the moment you scroll up. It stays put on the Schedule and the meal plan,
  which scroll inside themselves.
- **A dream opened on a phone is no longer half behind the nav bar.**
- **The app fits a phone.** The six pages — Going on, Members, Schedule, Leads, Meals,
  FAQ — are a row of icons along the bottom of the screen now, instead of a bar that
  wrapped onto three lines and pushed the page down. The name, the burn you are looking
  at, 🔔, ⚙️ and your face stay at the top. Nothing changes on a laptop.
- **🔔 has a page of its own.** Tapping the bell on a phone opens Notifications rather
  than a list that, on some screens, opened off the side and could not be reached at
  all. Reading it counts as having seen them, exactly as opening the list did.
- **A wide list scrolls by itself.** Dragging the Members list sideways used to take
  the whole page with it, nav and all. Now the list moves and the page stays put.
- **The notification settings hold up at a large text size.** "What happens to you" ran
  into the column beside it and the words sat on top of each other. It is a heading
  above the table now.
- **An edit box opens as tall as the text in it.** Editing the welcome text, a FAQ
  answer or the meal plan's intro started with a three-line box you had to scroll
  inside. It opens at the size of what is already written, and grows as you type.
- **The way into a text block is a pen.** "Edit these words" under the meal plan's
  intro, and the same under the homepage's welcome text, read as the last line of the
  paragraph they sat under. Both are ✏️ now.

# 2026-08-07

- **Going on — a page of what everyone has been doing.** A dream offered, somebody
  saying they are coming, a lead role taken. Across burns, so it has something to say
  in the quiet between them, and each line carries what kind of thing it is: tap that
  to be told about the next one without going looking for the setting.
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
  role's name held still, and the effort icons have a legend above it.
- **A shared link draws a card** with the burn's name, its dates and a picture.
- **The app offers to install itself** where the browser allows it.
- **Names carry faces** wherever people are listed.
- **Pinch the schedule** to see more hours or more lanes.
- **Two people editing the same list no longer overwrite each other silently** — the
  second one is told the list moved under them and shown what it says now.

# 2026-08-06

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

# 2026-08-05

- **Passkeys**, alongside the password rather than instead of it.
- **The meal plan.** Sittings per burn, who cooks and who cleans, and what is cooking
  — the spreadsheet's tab as a page, cross-checked against nobody's allergies yet.
- **A picture for your circle**, cropped and sized in the browser.
- **Dreams open from the grid.** Edit one, offer one, withdraw one, put a hand up to
  facilitate, pull its bottom edge to make it longer, or plan the same dream into
  several mornings.
- **Say you are coming to the next burn while signing up.**

# 2026-08-04

- **A selector in the bar**, because there is more than one burn at a time, and every
  page is about the one it names.
- **The lead-roles register** — who is looking after what — open to any member, with
  the roles copyable from a previous burn.
- **One places grid per burn**, seeded from a previous one.
- **Members read the roster**, without the payment dates or anybody's login address.
- **A lost invite link can be re-issued**, which kills the old one in the same breath.

# 2026-08-03

- **An application tells the admins**, on whichever browsers they asked on.
- **The burn's shared furniture is every member's** — the lodging and helping lists,
  the places, the welcome text. This replaces a spreadsheet everyone could edit.

# 2026-08-02

- **Lodging and helping lists per burn.** Pick where to sleep from what is actually
  there, with the full options refused, and tick what you will help with — or write in
  what the list is missing.

# 2026-08-01

- **The programme.** Offer a dream, edit it, and drag it into a timetable of lanes and
  hours.
- **The programme as a calendar subscription**, so it lives in a phone rather than in
  a page somebody reloads.
- **A burn starts and ends at a time**, not just on a day.
- **The installation has a name of its own.**

# 2026-07-31

- **The public application form**, rendered from questions an admin edits, with the
  answers stored beside the wording each applicant was actually shown.
- **Review, approve or reject**, minting a single-use invite link on approval.
- **Direct invites** for people already known, listed and revocable.
- **Redeeming a link makes the account**, with the details filled in as you go.
- **Members maintain their own record**, and say which burns they are coming to.

# 2026-07-30

- **Accounts and roles**, with the first admin bootstrapped from the command line.
- **Burns as records** rather than one hardcoded event, with an admin editor.
- **The application form's questions are rows**, so changing them needs no redeploy.
- **The welcome text on the public homepage**, written in markdown per burn.

# 2026-07-28

- **The first container.** One Node process serving the API, the web app and a single
  SQLite file, with password login and a Docker image Watchtower can pick up.
