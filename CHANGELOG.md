What changed, newest first, written for the people using the app rather than the
people building it. The app serves this file at `/changelog`, which is where the "a new
version is out" notification leads — so the page supplies the title and the sections
below start at `#`, which `renderMarkdown` shifts down one level under it.

There are no version numbers: every merge to `develop` builds an image and the server
picks it up within a few minutes, so a date can hold several deploys. Add your line
under today's heading, and make a new heading when there is none.

# 2026-08-19

- **Signing up through Discord no longer copies the Discord name into your name.** A Discord
  name is rarely anybody's real one, and it was landing in the field every member knows you by.
  The apply form now asks for your real name and starts empty; Facebook names, which mostly are
  real, are still filled in. Somebody coming in on a group link through Discord lands on Your
  details, where the name is asked for.

- **An organiser can correct an account.** The name in the accounts list opens it: the real
  name, the login address, the allergies — ticks and notes — and setting a password, which
  moved there from the table. So a mistyped address, or a Discord handle where a name should
  be, is one visit to fix rather than a message asking you to.

- **The review card names the Discord account.** "via Discord — ȐJaƔ (robby5859)": what
  Discord shows and the username behind it, which is what tells organisers who somebody is.
  Identities linked before this say so once you sign in through them again.

# 2026-08-20

- **A dream, a meal or the offer-a-dream form closes with a ✕ in its top right.** Opened from a
  notification, one of these fills a phone with no navigation anywhere, and the only marked way
  out was a _Close_ sitting between the pen and the bin. The ✕ stays put as you scroll, and that
  row is now just the pen and the bin.

- **Setting somebody's password stops a reset link they were already sent.** If they asked for
  one and an organiser set a new password instead, the link they hold no longer works.

- **Mail about your application says why it reached you.** It used to end with the installation's
  name and nothing else, and pointed at notification settings an applicant cannot open.

# 2026-08-18

- **A decision on your application is one email, and it is the one that explains itself.** Being
  approved or turned down sent two within a second of each other, and the organisers' reply on
  your application arrived as a line saying only that they had replied. Now each is a single
  message carrying the whole of what was said, to the address you gave on the form — the one the
  form says will reach you.

- **A forgotten password can be reset from the login page.** Give the address you sign in with
  and a link comes to your inbox; following it sets a new password and signs you in. The link
  works once and for two hours, and asking again replaces the one before it. It never says
  whether an address has an account here, and it is offered only where an organiser has set a
  mail server up and told the app its own address — without either, the page still points at
  the organisers, as it always did.

- **News about your application now reaches your inbox.** Somebody waiting to hear back has no
  reason to keep opening the app, and until now a reply from the organisers only rang a bell
  nobody was there to see. That one kind of message is emailed unless you say otherwise;
  everything else stays off until you ask for it, under Your details → Notifications.

# 2026-08-17

- **The page column reaches its own last entry.** On a short window it scrolled, but never far
  enough — the bottom of it sat below the window, so Meetings could not be got to without
  scrolling the page as well.

- **The composer's help line stops pointing at a button Preview has hidden.** While Preview was
  showing it still said to paste, drop or click the picture button, none of which was on screen.

- **`/apply` says what is true where a membership has been taken away.** It read "You are in — you
  are a member here now" from the decision alone, next to a navigation with nothing in it. It now
  says the application was accepted and the membership is not current, and who to ask.

- **An empty bring list says so once.** Two notes under two headings each said something true
  about its own half and together read as two problems where there is only nothing there yet.
- **The bell and the members page now count places the same way.** On a burn where every place was
  taken but not everybody had paid, the bell said there was a place left to go and win while the
  page showed you were already holding it. A place is taken by whoever is standing in it, paid or
  not — and if you have not paid, you are told you are in one for now rather than told to go and
  win it.

- **A card's 🔔 says whether it is on out loud.** 🔔 and 🔕 read as the same words to a screen
  reader; the button now ends with "on" or "off".

- **The offer to turn notifications on in this browser goes when you log out**, rather than
  standing over the signed-out homepage with a button that could not have worked.

- **The meal times of a burn that has ended can only be read.** The editor was still drawn, and
  pressing anything in it answered "Could not add that." It says the burn has ended instead.

- **A recorded payment and a place handed over link the burn they are about**, rather than
  whichever burn the selector happened to be on.

- **The digest says which burn each line is about.** Two lead roles with the same name on two
  different burns read as the same line twice, and following either one landed on whichever burn
  happened to be selected. Every line now ends with its burn — and a song with "Songbook".

- **A Posts line in the digest has somewhere to go.** Every other section's lines were links;
  a post's was plain text, so being told eight comments had landed on your announcement left you
  with nowhere to press. It opens the feed with the Posts chip lit.

- **The plain-text version of an email says where to press again.** It had been reduced to a bare
  web address where the formatted version reads "under Your details → Notifications".

# 2026-08-16

- **Saying something while Preview is showing comes back to Write.** The box emptied on the way
  out and then sat on "Nothing written yet." until you pressed Write yourself.

- **Email from the app fits a phone.** It was being laid out as though the screen were 980
  pixels wide and then shrunk to fit, so the card sat in the left half of the message with
  type too small to read comfortably.

- **"and 3 more" at the foot of a summary is a link now.** It was the one line in the message
  with nowhere to go — everything else printed carried its own link, and the only other link
  was to your settings page rather than to the things waiting. It opens the feed, already
  filtered to the kind of thing that line is counting.

- **The privacy page says two things it had been quiet about.** That the summary email arrives
  unless you say otherwise, rather than only what you have asked for; and that when you were
  last here is kept, which is what decides whether that summary is sent at all.

- **A place freed by an organiser moves the waiting list.** Taking a paid member off a burn, or
  un-recording a payment, used to leave everybody waiting still being told the burn was full —
  which the roster on the same page disagreed with.

- **A burn that has ended says nothing about its waiting list.** Adding somebody to last year's
  gathering, or tidying up a payment on it, told them they were on its waiting list.

- **"You were added to …" now reads "You are on …".** The page was naming whatever burn you are
  on, which is not necessarily the one approving you put you on — you may have left that one and
  joined another yourself.

- **Sending an application twice shows you where it stands** instead of leaving the form up with
  a line saying the page would show it.

- **A group invite link cannot be over-used through Discord or Facebook.** Two people clicking a
  link on its last place at the same moment could both get in.

- **The burn's welcome text can carry a picture now.** It was the one box with no picture
  button, because a picture needed signing in to fetch and the homepage is read by people who
  have not — so the welcome text is where the button was missing and where a picture would
  have been most use. Pictures are readable without signing in from now on; the address of one
  is a long random string nobody can guess, but anybody holding it can open it.

- **A folded card names the right number of comments.** Giving a card a heart used to leave
  "Show the whole thread (6)" saying six while the answer had already said seven, so pressing
  it opened more than it promised.

- **"Sending pictures…" when more than one is.** The picture button takes several at once and
  the note under the box said "a picture" whatever it was carrying.

- **The help line under every box shows the button it means.** It said to click 🖼 while the
  toolbar draws a plain outlined picture icon, so there was nothing on screen matching what
  the sentence pointed at.

- **The ⋯ on a short bell fits on screen at last.** With one or two notifications in it there
  was nowhere for the little menu to go: it hung off the bottom where nothing could press it,
  or — after last week's fix — opened upward and had its first line cut off above the panel,
  where no amount of scrolling reached it. It now opens upward only where the whole of it fits,
  and otherwise stays where scrolling can bring it into view.

- **Escape closes the ⋯ and leaves the bell open.** One press used to shut both.

- **"Stop telling me about this" now says it did.** Nothing on screen changed before, so
  pressing it twice was the natural next move.

- **The diary reads as a list again.** "Thu 13 Aug 14:18🗑️" ran together, and asking to take a
  meeting out opened the question mid-timestamp — "14:18Take out of the diary …?". There is
  space between the time and the controls now, and two meetings with the same name no longer
  offer two identical ✏️ buttons.

- **Rewriting a comment keeps what you typed when the save is refused.** The box used to close
  and take the text with it.

- **Keyboard focus stops getting dropped.** Answering "Really remove …?" or pressing ‹ to put
  the page column away used to leave focus nowhere, so the next Tab started at the top of the
  page. And the column of pages scrolls now, so on a short screen its last entries are reachable.

- **"Nothing in the diary" points at the form it means**, which is further down the page rather
  than immediately below.

# 2026-08-15

- **You are told when somebody hearts what you wrote.** A heart used to reach nobody — it was
  news only if you went back and looked — so now whoever wrote the comment, the announcement,
  the song or the dream gets a line in the bell. Never for your own, and pressing the heart again
  changes nothing — though taking one back and giving it afresh does say so again, that being a
  second heart. It is on to begin with and switches off under **Somebody hearts something you
  wrote** on your details page.

- **The ⋯ on the last notification opens upward instead of off the edge.** On the bell panel it
  used to hang past the bottom, so **Remove this notification** was drawn where nothing could
  click it and mostly off screen entirely. It now opens above the row when there is no room
  below.

- **A comment's ♡ now sits on the line with the pen and the bin.** It had been drawn a few
  pixels high, which showed most on comments nobody had hearted yet.

- **Being handed a meal job says which sitting.** "You are leading Dinner" was the same
  sentence on a burn with three Dinners, and the notification links to the whole plan — so
  there was nothing to say which. It reads "You are leading Dinner · Sat 1" now, matching what
  the card and the digest already said.

- **A comment can be given a ❤️‍🔥 now, the way a card already could.** The heart itself only
  gives yours and takes it back — the count has moved out of it and sits beside it, behind a
  little stack of the faces of whoever gave one. Press that stack and the whole list unfolds
  under the comment, each name linking to their page. Cards work the same way now, so there is
  one heart to learn wherever you meet one. Nothing is notified and nothing moves up the feed:
  a heart is still for the next reader to see. The lines the app writes for itself — "offered
  this dream", "is cooking it" — carry no heart.

- **The bell offers to turn notifications on, for whoever it cannot reach.** If you are reading
  your notifications in a browser that has push switched off, there is now a quiet line at the
  foot of the list with a **Turn on** button. The ✕ puts it away for this sitting; it comes back
  next time you open the app, unless you have already said "Do not ask me here" somewhere else.
  It never appears where the button could not work.

- **Meal cards say which day they are for.** A burn with three Dinners had three cards on the
  feed all headed "Dinner", and each digest line said the same word — with nothing to tell one
  sitting from another until somebody wrote a food idea. They now read "Dinner · Sat 1", and so
  does the notification when somebody comments on one.

- **On a laptop, everything is in one menu down the left.** Half the pages were words along
  the top and the other half were behind ☰, and which half a page was in came down to what
  fitted. Every page is in the column now — Feed, Members, Schedule, Leads, Meals, FAQ,
  Songbook, Rideshares, Bring list, Meetings and the map — with the one you are on marked. The
  ‹ at the top of it puts it away if you would rather have the room, ☰ brings it back, and it
  stays however you left it. On a phone nothing changes.

- **Every longer box is now the same editor, and it tells you what it can do.** Write and Preview
  tabs over it, the toolbar under them, and a line beneath saying markdown is supported and that a
  picture can be pasted, dropped or picked. The comment boxes, the meeting notes, the bring list's
  "anything else" and the applicant's box had all been simpler boxes with less on them — the
  meeting notes were rendered as markdown while offering nothing to write it with.

- **A new page explains the formatting**, at `/formatting`, linked from under every box. It shows
  what you type beside what it turns into, and it is readable without signing in — an applicant
  writing to the organisers has the same box as everybody else.

- **Taking back a comment somebody else already took back no longer claims the whole thing is
  gone.** The banner said "Somebody took that out of the diary" while the meeting sat on the screen
  right below it. It says the comment is no longer there, and the card stays.

- **The notification settings are four switches, not a row per kind.** Your details →
  Notifications was one long list of every kind of thing the app can tell you about, which is a
  page nobody could answer. It is four sections now — what happens to you, what others are
  doing, a new version of the app, and what you look after — each with a switch for Here and one
  for Email. A switch shows half-filled where the kinds under it disagree, and opening a section
  still gives you every row it always had.

- **You can switch a kind off from the notification itself.** Every line on the bell and on the
  notifications page has a ⋯ with "Stop telling me about this", which says which kind it means
  and switches it off for both the bell and email, and "Remove this notification", which takes
  that one line off your list. That is where switching things off is meant to happen — you know
  whether you wanted to hear it while you are looking at it.

- **Meals are on the feed now.** Taking a sitting's cooking on, handing it over, putting a hand up
  for the crew or writing what it will be all show as one card per sitting, with the food idea on
  it and a box to ask "is it vegan?". Generating the plan itself puts nothing on the feed — a card
  appears the first time somebody does something with that sitting. It was the last shared list
  the feed said nothing about, so it was also missing from the email summary.

- **Naming everybody in one message is one line in the log again, not one per person.** ⚙️ →
  Notifications sent filled up with identical rows whenever somebody wrote `@everybody`, pushing
  everything else off the page.

- **The log's Emails column counts emails a mail server actually took.** It counted the ticked
  box instead, so an installation with no mail server at all reported emails going out.

- **"1 place left, and they go to whoever pays" now says "it goes".**

- **Every meeting in the diary can be edited, not only the next one.** Mistype the time or the
  joining link on a meeting further out and the only way back was to take it out and put it in
  again — which told everybody a second time and dropped it out of every subscribed calendar in
  between. There is a ✏️ on every line now.

- **A card whose thing has been taken away says so and goes.** Reply to a meeting somebody took
  out of the diary a moment ago and the answer used to be a bare "Not found." over a card that
  stayed there, composer and all. Now it says "Somebody took that out of the diary" and the card
  leaves the page.

- **A reply that fails for any other reason stays in the box.** It used to be cleared the moment
  you pressed Say it, whatever came back — so a hiccup at our end lost what you had written.

- **The bell tells you whether it is on again.** In a card's corner it had become a grey outline
  in both states — the same empty bell whether you were being told about that card or not. It is
  🔔 when either of its switches is on and 🔕 when neither is, the way the heart is ♡ until you
  give one. The bell in the top bar is a bell you can see too, dim until something is waiting.

- **The "notify me on this device" offer can be pressed where it appears.** Ticking a category on
  a card near the bottom of a phone screen raised the offer _behind_ the little menu you ticked it
  in, so the button did nothing however many times you pressed it. The strip now sits above the
  menu.

- **A lead role is something you can talk about now.** The feed had two shapes on it: cards you
  could reply to, and one-line news you could not — which by the end was only the lead roles.
  Adding a role, taking the lead, handing it over and joining or leaving a team all show as one
  card per role now, with the 🔔 in its corner, a heart, and a box to say "what does this
  actually involve?" or "I can take it from July". The card shows the role's purpose and links to
  the register at that burn. Roles that were there before this get a card too, dated from when
  they were added.

- **The chip row over the feed has a Leads chip**, and no longer has Burns — there is no
  separate stream of burn news left to filter, since every bit of it is on the card of the thing
  it happened to.

# 2026-08-14

- **The email summary is the feed now, not your notifications.** It used to carry only the kinds
  you had switched on, and most of what happens around a burn — a dream offered, somebody saying
  they are coming, a talking point raised, a song going into the book — is off until you ask for
  it. So the summary reached the people who had stopped opening the app and told them almost
  nothing. It now carries what the feed carries, under the same headings you see there, whatever
  your switches say. A conversation somebody has added to says how many comments are new rather
  than quoting them. Your switches still decide what reaches the bell and your inbox as it happens.

- **Joining a burn that is already full now tells you so.** You would land on the waiting list, see
  it on the Members page if you went and looked, and hear nothing — and with every place already paid
  for, nothing that happened afterwards would have told you either. The message arrives on joining
  now, the same one everybody else on the list has.

- **The emails look like the app now.** Invites, decisions, notifications and the new summary all
  arrive in the app's own colours and typeface, with the link as a button rather than a bare URL in
  a wall of plain text. They still carry a plain-text version underneath, so a mail reader that
  shows no formatting shows the same words.

- **A summary by email when you have been away.** If something happens and you have not been on the
  site for a day, you get one message listing what you have not seen, grouped and linked. It
  arrives only when there is something new and only when you have actually been away, so a day you
  have read everything is a day it stays quiet. Your first one covers everything since you were
  last on the site — so somebody who signed up and never came back hears about the dreams and the
  meeting points they have missed, not just the last day of them — and each one after it covers
  what is new since the last. It is on unless you say otherwise — Your details → Notifications has
  _Every day_, _Every week_ and _Never_ — and it needs a mail server, so an installation without
  one is unchanged.

- **The buttons are drawings now, not emoji.** The pencil, the trashcan, the bell, the raised
  hand, the menu — every control the app offers is one set of grey line icons, drawn the same
  weight and the same size wherever it appears, instead of whatever your phone or laptop happened to
  make of an emoji. The pages keep their emoji: the bar at the bottom, the drawer, the marks on the
  feed. The heart keeps its ❤️‍🔥. Colour is what a thing is; grey is what you can press.
- **Adding a picture is a button in the toolbar now.** It was the words _Add a picture_ below the
  box, louder than anything else in the composer; it is the picture icon at the end of the row the
  bold and italic buttons are in, where every other app puts it. Pasting and dropping still work
  exactly as before.
- **The bell says more.** It used to grey out with nothing unseen; now it goes the app's own orange
  when something is waiting for you.

# 2026-08-13

- **A meeting put in the diary before meetings had cards has one now.** Anything scheduled on the
  morning of the 13th was a one-line notice on the feed, and the tidy-up that took removed meetings
  off the page took those notices with them — so a meeting still very much happening was on the feed
  nowhere. It is a card like everything else now, headed with the meeting's name, saying when it was
  planned, and open to "I can't make that time". Meetings from that morning say "Somebody put it in
  the diary": nothing recorded who at the time.

- **Anything taken back leaves the feed.** Withdrawing an announcement, a dream, a song or a bring
  item, or leaving a burn, used to leave the card on the page marked as taken back — first at the
  top, and since this morning where it already was. Neither is what the feed is for: it is what is
  going on, and something removed is not. What was said is not deleted, it just has no place on the
  page any more. Putting a song back puts its card back.

- **Taking an announcement back is the same trashcan every other card uses**, rather than a worded
  link.

- **A meeting taken out of the diary leaves the feed too.** Its card stayed behind, and so did the
  lines meetings had for the half-day before they were cards — so a meeting nobody had any more was
  on the feed twice. Both are gone, including the ones already stranded there, and the same for a
  talking point.

- **A meeting on the feed is a card you can reply to**, like a dream, a song or an announcement —
  headed with its name, with hearts, its own bell and a thread. It was a bare line with an old-style
  switch beside it and nowhere to say anything, which was backwards for the thing most likely to
  need "I can't make that time". Moving a meeting brings its card back to the top.

- **Nothing is destroyed on one press any more.** Removing a meeting, a talking point, a bring item,
  a ride, a comment, an announcement, an invite, a passkey, a linked provider, your picture, the app
  icon, the mail settings — anything with no undo — now asks first, names what is going, and says
  what goes with it. Hearts, raised hands and anything else a second press would undo are unchanged.

- **Signing in takes you to the feed** instead of leaving you on the login page with a link to the
  homepage. Somebody still waiting on an application lands on their own application instead.

- **Putting a meeting in the diary has its own place on the page**, rather than sitting inside the
  box describing the meeting that is already there.

- **A meeting put in the diary shows on the feed, and rings by default.** It was saved and shown on
  the Meetings page but said nothing anywhere else — the bell only rang for the few who had switched
  that kind on, and there was no line at all. Everybody coming to the burn sees it now, and sees it
  again if the time moves. It is also the one kind of burn news that is switched on to begin with:
  a dream or a song can be read whenever you next look, and a meeting at 19:00 on Sunday cannot.
  (If you have saved your notification settings at some point, your own choice stands — turn it on
  under Your details → Notifications.)

- **Switching notifications on from the feed offers to turn them on in this browser too.** Ticking
  "Notify me on similar" in a card's 🔔 used to save the setting and say nothing, so what you asked
  for arrived in the bell and nowhere else. The offer now follows the tick wherever it happens, as a
  strip at the bottom of the window — and "Do not ask me here" answers for every later one, not just
  the tick it was pressed on.

- **Meetings.** A page per burn for what we need to talk about: raise a talking point, discuss it in
  its own thread on the feed, and record what was decided on the point itself — the spreadsheet's
  meeting tab, except the discussion happens where the point is instead of somewhere else. The page
  says when the next meeting is and how to join it, and meetings turn up in the burn's calendar feed
  beside the dreams. Clearing a decision reopens the point.

- **You are offered notifications when you join.** Taking up an invite used to end on "You are in"
  with no mention of them, so the one moment you have just decided to come was the moment the app
  said nothing. Ticking a category on your own page now also says when this browser would hear
  nothing about it — with the switch right there, and a "do not ask me here" that sticks.

- **Organisers can see what actually went out.** ⚙️ → Notifications sent is one line per
  notification: when, what it was about, how many people were told, how many had that category
  switched off, and how many devices took it. It says taken rather than delivered, because a push
  service accepting a message is not a phone showing it.

- **Taking up a group link answers the application it belonged to.** Somebody who had applied and
  then pressed the link posted in the group was let in, but stayed in the organisers' queue looking
  like they were still waiting — and pressing Reject on them changed nothing except the "this one has
  not been accepted" they then read on a page carrying the full member navigation. Being admitted is
  now the decision: their application reads approved, dated the moment they arrived, and the queue
  shows only the people it can still decide about.

- **A link admits you even if an earlier one already did.** If your roles had been taken off and you
  had come in on a group link before, pressing a live one signed you in with nothing and said nothing.

# 2026-08-12

- **"What's new" now lands on the new version.** Following the redeploy bar — or the notification that
  points at the same page — used to keep the tab on the old build, so the bar was still there when you
  arrived. While the bar is up, any link you follow loads the new version, and the bar is gone once you
  are on it.

- **The whole songbook row opens the song**, not just the title, and the 🎧 and the category sit at the
  right edge whether or not the song names an artist.

- **The waiting-list messages say the one thing that decides it: whether a place is left.** Everybody
  who has not paid now hears the same thing — either "N places left, and they go to whoever pays" or
  "full, every place is held by somebody who has paid". You used to be told only when the paid members
  exactly filled the burn, so whoever was over the line often heard nothing at all, and the message
  otherwise implied a queue position that paying overturns. The link opens that burn's roster.

- **A burn that is over cannot be re-planned.** Meal times could still be added, changed and generated
  on a burn from last year, and single sittings added to or deleted from it — Generate quietly wrote a
  whole meal plan into a burn that had already happened. Everything about a finished burn is a record
  now; reading it still works.

- **A group link that closes in the past says so.** Picking a date already gone answered
  "Request failed (400)." with no clue which field was wrong. The date picker now offers nothing
  before today, the form says what is wrong with it before sending, and a refusal from the server
  names the closing date.

- **A group link cannot be filled past its cap.** A rush of people redeeming the same link at once
  could all slip past the count and take it a few over. It is checked again as each account is
  written, which is the check that decides.

- **Applying no longer asks for an email twice.** The address you signed up with is the one we write
  to, so the field is optional: fill it in only if something else would reach you better. It used to
  refuse to send without one, blank, while the account already had it.

- **"You are in" stops claiming a burn you are not on.** Being approved between burns joined you to
  nothing, and the page still said you had been added to "the burn that is coming" and offered to let
  you leave it. It now says what is true either way, and names the burn only when there is one.

- **A second submit of the same application says so** instead of "you are already a member here", and
  somebody who is already a member is told there is nothing to apply for rather than being shown the
  whole form to fill in first.

- **The first person onto a new burn can put their hand up.** On a burn nobody had joined yet — every
  burn on the day it is planned — 🙋 was missing everywhere: no lead role, no meal crew, no bring
  list, no helping out, and so not even the nudge telling you to join first. The hand is there now, and pressing it
  says what to do. Where a job is closed to everybody, as a chore's cook is, nothing is offered, which
  is unchanged.

- **"You need to join this burn" says where.** Inside an opened dream or a meal dialog the message
  arrived without its link to Your details — which is exactly where the button that produces it is.

- **A song can say whose it is.** There is a field for the artist now, beside the words rather than
  buried in them: it shows next to the title in the songbook and under it on the song's own page,
  and the book can be listed by artist instead of by title — which puts one songwriter's songs
  together. Songs nobody has named come last.

- **The bell stops badging what you have already looked at.** A notification only counted as read
  if you opened the bell or the notifications page, so following "What's new" on the redeploy bar,
  or a link out of a push message, left it sitting there unread. Arriving at what a notification
  points at now marks that one — and only that one — as long as the page is showing something at
  least as new as the notification itself. A page left open clears it the moment it refreshes and
  shows the change.

- **No more being told to install an app you have installed.** On Chrome and Edge the strip flashed
  "open your browser's share or menu" for a moment before offering the Install button, and it kept
  saying that to anybody who opened the installed app in an ordinary tab. Those browsers now show the
  button or nothing at all; the by-hand instruction is for the browsers that have no button — Safari
  and Firefox — which is who it was written for.

- **Muting a card is silence, not a change of subject.** If you had turned on notifications for every
  dream's comments and then muted one dream, replies to it still reached you under the other switch.
  Muting one card now means that card is quiet, whatever else you have on.

- **A heart no longer unfolds the whole conversation.** Pressing ♡ on a card with more comments than
  it shows opened all of them and took away "show the whole thread". The card stays as it was.

- **An invite works for somebody the app has met before.** Pressing "Continue with Discord" on a
  group link did nothing for anyone who had already signed up that way and was still waiting on an
  application: they were signed in and told nothing. The link now makes them a member, the same as
  it does for a stranger — possession of it is the vetting. Somebody already in keeps their link
  unspent, and a link that has run out says so rather than blaming the address.

- **An empty bring list says it is empty.** It used to claim "Everything asked for has somebody
  bringing it" on a burn where nothing had been asked for at all, which is the opposite of true.
  Now it says there is nothing on the list yet, and what to do about that.

- **A bring list per burn, behind ☰.** One shared list of things the gathering wants and things
  people are bringing, replacing the spreadsheet's Bring tab. Add a thing — tick "I am bringing this
  myself" and it is an offer, leave it and it is an ask, waiting for a hand at the top of the page.
  Several people can bring the same thing, and whoever asked is told the moment somebody says they
  will. Every item has a conversation and a card on the feed, and leaving a burn quietly takes your
  pledges with it.

- **An invite link takes Discord and Facebook.** A link posted in a group is opened by somebody who
  already has that provider, so the invite page now offers the same one-click buttons the login page
  does — one round trip and you are a member, with no address and password to invent. Setting up an
  email and a password still works for anyone who would rather.

- **A group link no longer says it is good for one person**, which was never true of that kind.

- **Allergies are ticked on the way in, not typed.** Redeeming an invite offered a free-text box
  where the rest of the app offers the shared list with checkboxes. It is the same list now, with
  the box kept for anything the list does not cover.

- **A password needs ten characters.** Sign-up is open to anyone with the address of this app now,
  so there is a floor where there was none — and every form that chooses one says so before the
  server refuses: signing up, redeeming an invite, and an admin setting somebody's.

- **Somebody who is already a member cannot file an application.** It only ever added noise to the
  organisers' queue, and the apply page now says what to do instead — log in the usual way and link
  the provider under Your details.

- **The application page no longer flashes a blank form** while it is still finding out whether you
  have already applied, and a message you send the organisers stays in the box if the send fails
  rather than vanishing.

- **The wait no longer promises 24 hours**, which nothing in the app enforces. It says what actually
  happens: applications are read together before each burn.

- **A link the whole group can use.** Under ⚙️ → Invites there is now a link for a closed group —
  posted inside a Facebook group or a Discord server only its members can read, so the link itself
  is the proof of belonging. It works until the date you set, optionally for a limited number of
  people, and the list shows who came in on it. Withdrawing it closes the door without touching
  anybody who already walked through.

- **The applications page says how somebody signed up.** An application from a Facebook or Discord
  signup used to look exactly like any other. It now says which one, with the name they use there —
  and a link to their profile where the provider gives one.

- **A verse break made of spaces no longer vanishes on a phone.** If the blank line between two
  verses had spaces on it, it disappeared on a narrow screen and welded the two verses together —
  while reading correctly on a laptop.

- **Every burn being planned is open to every member.** You used to see only the burns you had
  said you were coming to, so if you had joined none, Schedule, Members, Leads and Meals all told
  you there was nothing — while the feed showed you the planning going on. Now every coming burn
  is there, the ones you have joined first, so you can watch and help plan a burn before you know
  whether you can come.

- **Reaching for a job you cannot take yet says why.** Putting your hand up as helper, taking a
  lead role, joining a meal crew or hearting a dream all need you to have joined that burn.
  They used to fail with an unreadable "Request failed (400)"; they now say you need to join
  the burn first, with a link to where you do it. Putting your hand up is also offered now
  where it was simply absent before.

- **Being let in says what happened.** Approval adds you to the burn that is coming, and the page
  now names it and points at where to set your arrival and departure — or to leave the burn, if
  you know you cannot come. Staying to watch the planning is fine either way.

- **Applying no longer asks twice for your name.** The account you just made already had it, and
  the form now starts from it instead of an empty box.

- **A song fits the phone you are holding.** A line too wide for the screen used to run off the
  right edge, and reaching the end of it meant dragging the words sideways one-handed. It now
  breaks onto the next line together with its chord line, so every chord stays over the syllable
  it belongs to — and a chord standing in a gap goes down with the words it heads rather than
  being left behind on the line above. A wrapped line no longer leaves a blank gap behind it
  where the words or the chords ran out, which read as a verse break in the middle of a verse.

- **The slow half of the scroll slider works.** On a laptop the words stood completely still until
  the slider was about a third of the way along. Every setting now moves, and the same setting
  moves at the same pace on a phone as on a laptop.

- **A link to a song shows where it goes.** Spotify, YouTube, YouTube Music, Apple Music,
  SoundCloud, Bandcamp, Deezer, TIDAL and Genius each show their own mark instead of a stand-in
  emoji, and links to TIDAL, Deezer and YouTube Music are now recognised at all.

- **Applying starts with an account now.** You sign up first — with Discord or Facebook, or with
  an address and a password — and then answer the questions. Your application has a page of its
  own that says where it stands, and you can turn notifications on there while you wait.

- **The organisers can ask you something before deciding.** There is a private note thread on your
  application — only you and they can read it — so a question can take the place of a no. It is on
  your application page, and both of you are told when the other writes.

- **You hear the answer.** Being accepted makes you a member and puts you on the list for the burn
  that is coming, and tells you so — no invite link to wait for and no email to lose. A no is
  answered too, with the organisers' names and how to reach them, which used to be silence.

# 2026-08-11

- **A heart on every card in the feed.** ♡ fills to ❤️‍🔥, the way it already did on a dream — and
  a dream's heart is the same heart wherever you press it. A song's page shows who gave one.
  Hearts stay quiet: nobody is notified, and nothing moves up the feed because of one.

- **The bell moved into the card's corner, and opens a small menu.** It was a chip at the tail
  that read like a label rather than a switch. The menu holds two things: whether you hear about
  this kind of thing, and — new — whether you hear about replies to _this_ card. Following one you
  have not spoken on works, and so does muting one you have.

- **New members show up in the feed.** Somebody joining by an invite link opened no card, so the
  feed said nothing about the one arrival most worth saying something about. The cards missing for
  people who already arrived that way have been made, dated from when they actually joined. And a
  person's card now shows their whole introduction rather than the first few lines.

- **A link to the map of the area, in the ☰ menu.** Whoever organises pastes the address of the
  map they already keep under ⚙️ → Settings, and everybody signed in finds _Map of area_ in the
  menu; it opens where the map lives. With nothing pasted there is no entry at all.

- **Writing anything now has a small toolbar: bold, italic, a link, a list.** It writes the
  markdown for you, so nobody has to know what `**` means — and if you never press any of it, plain
  words are still plain words. `Ctrl`+`B` and `Ctrl`+`I` do the same on a keyboard. The Write and
  Preview tabs are gone: what you write shows below the box as it will read, and only once there is
  anything to show. A picture you paste, drop or choose is added at the end of what you have
  written, the way it works elsewhere.

- **The song page's tidy-up.** The words box can now be dragged wider as well as taller, for chord
  sheets that are wide. Links to hear a song are icons under the title rather than a line of raw
  address, and adding one is a box and a button — no name to invent. _Edit it_ and _Take it out_
  are the pencil and the trashcan the rest of the app uses, and taking a song out asks first, and
  says where it goes. The transposing controls say _Transpose_, and Scroll it and Speed stay at the
  bottom of the screen where you can reach them mid-song. The songbook list no longer marks every
  song with its capo.

- **The feed has a row of chips for choosing what to show.** Filling the songbook or laying out
  the schedule used to make the whole page one kind of thing for a while. Tap _Dreams_ and you get
  dreams only; tap another chip and you get both; _Everything_ puts it back. The choice is in the
  address, so you can share the link and Back undoes it — and it never sticks: every visit starts
  at everything. The songbook's categories are the same row, so it works the same way in both
  places.

- **A card for somebody who left before the app knew how to keep it no longer sits there frozen.**
  Those cards showed a name that never updated and linked nowhere, and rejoining opened a second
  one beside them. They now know whose they are, a pair left by a leave-and-rejoin is merged into
  one with everything said under it kept, and commenting on one tells the person and links to
  their page.

- **Clearing where a dream would be now says so.** The feed said "said where it would be" when
  somebody took the place off a dream that has no time yet.

# 2026-08-10

- **A pasted Mastodon post link no longer offers a link that goes nowhere.** If what you put in
  your contact list was a whole URL rather than an `@you@instance` handle, the page built a link to
  a host that does not exist. It shows the value as you typed it and offers no link now.

- **Faces on the two lists of who is coming.** The Members page and the organiser's roster show
  everybody's picture beside their name, the way the rest of the app already did — initials where
  somebody has not set one.

- **The list of ways to reach you no longer offers an Add before it has loaded.** For a moment
  after opening your details it offered every kind including one you already had, so pressing
  _Use my sign-in address_ could collide with the row it was still fetching. And _Signed in as …_
  now sits beside the Sign out button, which is the sentence that button answers.

- **Guessing at somebody's password now runs out of tries.** Ten attempts per address per quarter
  of an hour, and getting it right clears the count — so mistyping your own a few times costs you
  nothing. If you do hit it, the page says how long to wait rather than inviting you to try again
  straight away. Redeeming an invite is bounded the same way. None of it can be used to find out
  whether an address has an account here: a wrong guess at an address nobody uses is answered
  exactly like a wrong guess at one somebody does.

- **Leaving a burn and changing your mind no longer leaves two of you on the feed.** Rejoining
  used to open a second card and leave the first one saying you were no longer coming — the one
  card comes back instead, with everything anybody had said under it. A card for somebody who has
  actually left still carries their name and links to their page.

- **Writing your introduction tells the burn once, not once per save.** The card already moved to
  the top of the feed once however many passes you made at it; the notification now agrees with
  it. And an announcement you open and save without changing anything stays where it was rather
  than going back to the top of everybody's feed.

- **The home-screen icon works on an iPhone now.** Adding the app to your home screen used to
  leave a gray square there, because iPhones cannot draw the kind of picture we were handing
  them. They get a proper one now — the app's flame, or the picture an organiser uploaded if
  they uploaded a PNG. The flame is drawn rather than borrowed from your phone's emoji, so it
  looks the same everywhere. Long-pressing the installed app offers the schedule, the feed and
  the songbook.

- **The nudge to install the app now says how, where your browser cannot do it for you.** On an
  iPhone — every browser there — and in Firefox and Safari, the strip used to show nothing at
  all; it now says to open your browser's share or menu and choose Add to Home Screen, with a
  pointer at the FAQ. _Not now_ still makes it go away for good, and it says nothing at all if
  you have already installed it. Notifications on an iPhone only work from the installed app,
  so the notification settings now say that instead of showing a switch that could not deliver.

- **There is a songbook.** ☰ → 🎵 Songbook: one shared book of what we sing, so whoever has the
  guitar and whoever has a phone are looking at the same words. A song needs nothing but a title.
  On its page you can paste the words in — chords on their own lines above them, the way
  ultimate-guitar writes them, and they are recognised as chords without your marking them up —
  add links to hear it, say which fret the capo goes on, and file it under Chant, Song or anything
  an organiser adds to the list. **♭ and ♯ transpose it** while you look, without changing what is
  stored, and **▶️ scrolls the page for you** at a speed you can set and that is remembered for
  next time. The book belongs to no one burn: it is the same book every time, and anybody here can
  add a song and anybody can polish one. Taking a song out is undone from _Recently taken out_ at
  the foot of the list, so nothing is lost by a slip. A new song gets a card on the feed you can
  say something under, and there are switches for being told about a new song and about comments —
  off unless you ask, except comments on a song you put in.

- **You can name somebody in a comment or an announcement.** Type `@` and pick them — everyone
  coming to the burn is offered, and so is **@everybody**, which reaches all of them. Whoever you
  name is told, and told that rather than the general "somebody commented" — one notification per
  person, so being named never doubles up. Fixing a typo afterwards only tells anybody you have just
  added. Names are looked up fresh every time the feed is read, so if somebody changes their name, a
  comment from months ago says the new one. Being named is on unless you turn it off, under
  notification settings.

- **You can announce something on the feed.** _Announce something_, above the feed — a line saying
  what it is and as much or as little as you want to add, pictures included. Everyone coming to the
  burn you have chosen sees it, and can say something under it, the same as on a dream. Rewording
  it brings the card back to the top, and leaves one line saying you reworded it however many
  passes you make at it. Taking it back leaves
  the title and what people said, and takes the words away; your own to take back, or an
  organiser's. There is a new switch for being told when somebody announces something, and one for
  comments on yours — off unless you ask, except comments on your own, which are on.

- **A sign-in button for a provider that is not set up now says so.** Pressing one where the
  client id or secret has gone missing used to answer "that did not work", which is the same
  sentence as a provider refusing you — it now says it is not set up here, offers your password,
  and gives an organiser a reference to look up. The settings page also warns that a secret stored
  before today's trimming fix is still stored with its line break, and has to be pasted again.
- **Your introduction now shows on the feed of every burn you are coming to.** Saying you are
  coming and saying who you are are one card there: joining opens it, and writing or changing
  your introduction brings it back to the top with the first part of what you wrote in it. The
  whole of it is still on your page, which the card's title links to. Rewriting a paragraph six
  times bumps the card once rather than filling the feed. Other people can say something under
  it, and there are three new switches on your notification settings — being told when somebody
  says who they are, when somebody comments on your own card, and when somebody comments on
  anybody's. Nothing is filled in for you: if your introduction is already written, the card
  appears the next time you change it.
- **Saying you are coming is a card rather than a line**, for the same reason — it is now
  something people can welcome you under. Lines written before today stay as they are, so the
  feed shows both for a while.

- **Linking Discord now puts your Discord name in how people can reach you.** That was the one
  thing linking did not do, so people were linking a sign-in and then typing the same name in by
  hand. The page says when it has happened, and it is an ordinary row from then on — change it or
  take it off as you would any other. If you had already put a Discord name there yourself,
  linking leaves what you wrote alone; and taking the sign-in off takes the name back out, unless
  you have since edited it, in which case it is yours and it stays. Your sign-in address has been
  in that list from the start, and Facebook still adds nothing — it gives us a display name and no
  handle anybody could reach you on.

- **Adding a way to reach you no longer offers one you have already listed.** The **Where** menu
  on Your details used to list all ten every time and start on Discord, so with Discord already
  there the one it opened on was the one guaranteed to be wrong. It now opens on the first kind
  you have not used, and leaves the used ones out — except **Somewhere else**, which is the one
  meant to be repeated, so you can still list your band and your photos separately.

- **When signing in with Discord or Facebook goes wrong, the page now says what kind of wrong.**
  Either it is not set up correctly here — tell an organiser, and the page gives you a short
  reference to mention, which they can find in the log — or the provider could not be reached, in
  which case trying again in a moment is the whole of the advice. It used to say "that did not
  work" for both.
- **Setting up Discord or Facebook sign-in no longer fails on an invisible character.** A client
  secret copied out of the developer portal often brings a line break with it, and that was being
  stored and sent along with it — so the provider refused every sign-in with nothing on screen to
  say why. It is trimmed now.

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
- **When linking one fails, whoever runs the gathering can now find out why.** The reason the
  provider gave is written to the server's log, so a wrong secret or a setting in the wrong place
  can be fixed rather than guessed at.

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
