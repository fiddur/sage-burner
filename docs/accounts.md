# Accounts and sessions

Signing up, applying, being invited, redeeming an invite, signing in, passkeys, roles, and
what a session is.

[← back to the README](../README.md)

**The account comes first, the application second, and approval grants membership** (#476).
Sign-up is open: `/apply` makes an account — through Discord or Facebook, or with an address and
a password — and then asks the questions. There was no open sign-up until this: accounts came only
from redeeming an invite ([#17]), the applicant held nothing between submitting and maybe
receiving that mail, and a rejection sent nothing at all.

**A new account holds no roles**, and that state already means "not a member": `requireApproved`
gates the rest of the app, so somebody signed up and waiting reaches their own application, their
own bell, and nothing else. No account-status column was added for a fact the roles already carry.
`requireSignedIn` is the guard for that state — being signed in at all — and it is what the
application routes and `/api/push/*` sit behind.

**Approval is one action**: grant `member`, join the burn that is coming, open the feed card and
ring the bell every other arrival gets, and tell the applicant. No token is minted, because there
is nothing left to claim. A rejection tells them too, and the page names the organisers to ask —
**only where the answer was no**, since sign-up is open and that route is reachable by anybody who
can make an account, while the admins' contact details are a members-only read everywhere else.
Somebody still waiting has the thread below for a question; somebody accepted has the Members page.

**The invite machinery stays** for the case it was always shaped for — an admin minting a link for
somebody specific. Applications submitted before this have no account, so approving one of those
still mints a token: the link is all such an application can offer. Re-issuing for an
account-first application is refused, since it would be a second account for somebody who has one.

### A group link, where the group is the vetting (#512)

The people in a closed Facebook group or Discord server are already vetted, and since Meta
removed the Groups API no OAuth scope can ask "is this person in group X". What is still true
is the possession proof: **a link posted inside the group is readable only by its members**, so
the link carries the membership.

That kind is `kind: 'group'`, and it is the opposite of every invite before it — redeemable
until it closes rather than once. Its expiry is **chosen, never defaulted**: an open door is the
one invite that must be given a closing date. A cap is optional.

**Where the single-use invariant splits.** One account per token is enforced by
`account_invite_token_idx`, a partial unique index on `account.invite_token_id` — which is
exactly the invariant a group link must not have. So a group redemption **leaves that column
null** and records itself in `invite_redemption` instead: one link, many accounts, and the list
an admin audits. `invite_redemption.account_id` is unique across the table, so nobody arrives on
two links whichever kind they used. The index is untouched, still guarding the kinds it was
written for, rather than loosened to accommodate one it was not.

**The cap is checked twice: once before the scrypt, and once inside the write** (#524). The first
read decides the status and refuses cheaply, before a deliberately slow hash and a gate queue. That
read is the one that used to be the only one, and the window it leaves is wider than "two arrivals
in the same instant" — everybody who arrives _during_ somebody else's hash passes it, so a burst of
K on a link one below its cap all pass and all insert. The overshoot was bounded by concurrency
rather than by one.

Closing it needs three lines, not machinery: `db.transaction`'s callback is synchronous and SQLite
serializes writers, so a `SELECT count(*)` on `invite_redemption` immediately before the insert is
authoritative. The refusal answers the same 409 the pre-read does.

**That branch is reachable from a test**, which is why it is worth having: `hash` is injected, so a
test that inserts a redemption _while the password is being hashed_ is exactly the burst, and the
in-transaction count is the only thing that refuses it. Deleting the check fails that test and
nothing else.

**Revoking closes rather than deletes.** A direct invite is a row nobody has used, so
`DELETE /api/admin/invites/:id` removes it. A group link has accounts behind it and rows pointing
at it, so the same route stamps `revoked_at` instead — the door shuts, and the record of who came
in through it stays. `inviteStatusOf` grew `revoked` and `full` for the two ways a group link ends
that a single-use one has no notion of.

### Coming in through a provider on an invite (#512)

A group link is posted **inside** the group it vets — a Facebook group, a Discord server — so
whoever opens it already has that provider, and asking them for an address and a password is the
long way round to an account they could make in one click.

`GET /api/auth/oauth/:provider?invite=<token>` is that click. The round trip has to remember which
invite it set off from, and `oauth_state` is where it remembers: the row gains
`invite_token_hash`, **the digest and never the token**, because a live credential sitting in a
row is a credential at rest for no reason. It is the same hash `invite_token.token_hash` already
holds, so the callback matches on it directly.

**The link is checked twice.** Once before the account is made — an expired, revoked, full or
unknown link never becomes one — and again in the write for the single-use kind, whose claim
_is_ the stamp. Nothing else about `signUpThrough` changes: the same address rules, the same
`address-taken` answer, the same avatar and contact handling.

**What the invite adds is `member`**, in the same transaction as the account, so there is no
window where somebody exists without the role their link granted. Without an invite the handler
is exactly what it was — an account with no roles, landing on `/apply`. With one, the account
lands on the start page, already in.

A link that has gone stale answers `refused` on the login page rather than naming what was wrong
with it, because only the digest survives the round trip: the page cannot be linked back to, and
saying more would describe a token the reader cannot see anyway. The page's copy names both halves
of what `refused` can mean — a round trip that came back wrong, and a link that has run out — since
whoever pressed a button in a group has no reason to read "sign in with your password" as advice.
The write's own failure says the same thing: the pre-read above it is what answers `address-taken`,
and inside the transaction only a single-use link claimed twice can collide, so anything that is not
`account.email` is the link having run out rather than the address being held.

**An identity the app already knows takes the link up too** (#534). `signIn` forwarded the invite
only where no `account_identity` matched, so somebody who had once signed up through Discord and
never got a role — a pending or rejected applicant — could press the button on the link posted in
that very server, be signed in, and be told nothing. Possession of the link is the vetting, and
their identity already matching is not a reason to refuse: a rejected applicant getting in on a
group link is the group vouching for them, which is the model. So the same check the sign-up path
runs decides it, and the same write grants `member` and records the redemption.

**Only for an account with no role at all.** A member's membership is not the link's to spend
again, and an admin who opens the link to see whether it works must not be handed a role by
looking — so any role already held leaves the link alone for whoever can use it. A link that has
run out signs them in regardless, since they have an account either way, and the status page is
where somebody with no role reads where they stand.

**Being admitted settles the application, because being in is a decision** (#548). The applicant
who presses the link holds `member` from that moment, so a queue still offering Approve and Reject
on them is offering a decision that no longer decides anything: Reject would answer 200 and change
nothing but the copy the person reads, which then contradicts the member navigation on the same
page. So `claimInvite` writes `approved` and the moment it happened onto their own application, in
the transaction that grants the role — after which Reject answers 409 the way it does for any
application already settled. A rejection already recorded is overwritten rather than left standing
beside the role, since a group link admitting a rejected applicant is deliberate and the record has
to say which of the two is true. A decision already `approved` keeps its own date; nothing else
here reads somebody else's row, so an applicant is the only one their arrival settles.

**Somebody already counted against a group link is admitted by another** (#546).
`invite_redemption.account_id` being unique across the table means a second link cannot write a
second row, and until this the write simply failed — rolling back the role with it, so an account
whose roles had been taken off could press a live link and be signed in with nothing, silently,
where the same person on a single-use link would be let in. The insert is `onConflictDoNothing`:
they are counted once, forever, against whichever link counted them first, and every later link
still admits them. The cap it does not consume is the price of the invariant above it.

**No table-level CHECK enforces the two shapes.** SQLite cannot add one through `ALTER TABLE`, and
rebuilding `invite_token` would mean dropping a table two others hold foreign keys into. The rules
— a single-use token carries no cap and no revocation, a group one no application and no `used_at`
— live where the rows are written, and the route tests are what hold them.

### Which door an applicant came in through (#513)

`GET /api/admin/applications` joins the account's `account_identity` rows, so the review card says
"via Facebook" or "via Discord" beside the account's own name. An admin vetting somebody against a
community they already know is cross-checking exactly that by eye, and it was the one thing the
review page did not show.

**The name is `account.name`, not the provider's**, because `account_identity` carries no name
column — only the provider, the subject and a profile URL. It arrives from the provider at
sign-up, so for most people it is the same string, but it is editable afterwards and two linked
providers on one account render it twice. Storing the provider's own name on the identity row is
what would make the card say what it appears to say; until then this is the account's name shown
beside the door it came in through.

The link is offered **only where `profile_url` holds one**. Discord has no profile URL to give;
Facebook's `public_profile` answers an app-scoped id that identifies nobody outside this
installation's Meta app, so a real link exists only where the app has been approved for
`user_link`. The account's name shows beside the form's `applicant_name` where the two differ — the form name
is what the person typed into the application, the account name is what they signed up as.

The admin's row is its own schema, `adminApplicationSchema`, rather than a field that is sometimes
present: the applicant's own view of their application has no use for the doors, and a shape that
carries them optionally is one that goes one reader stale.

- `POST /api/auth/login` — `{ email, password }`. 200 with `{ viewer }` and a
  session cookie, or 401 `invalid_credentials`.
- `POST /api/auth/logout` — clears the cookie.
- `GET /api/auth/me` — `{ viewer }` or `{ viewer: null }`. Always 200: an
  anonymous visitor on the public homepage is the expected case, not an error.
- `POST /api/auth/passkey/challenge` and `POST /api/auth/passkey/login` — the two
  halves of signing in with a passkey. Same 200 and same cookie as the password
  route, same 401 for everything else.

**Passwords** are hashed with scrypt from `node:crypto` (N=2^16, r=8, p=2 — one
of OWASP's listed configurations). #8 asked for argon2 or bcrypt; both are
native modules, which means a build toolchain in an image whose whole point is
that there is no build step, and the thing most likely to break a Node upgrade.
The parameters are stored in each hash, so raising them later re-hashes on next
login instead of invalidating every account.

Login deliberately spends the same work on an unknown address as on a wrong
password — measured at 220ms versus 0ms before that was fixed. Differing is an
account-enumeration oracle, and on a membership app the membership _is_ the
private part. For the same reason a malformed request body answers 401 rather
than 400.

That equal-work property is conditional, and nothing enforces the condition: it
holds while every stored hash uses the current parameters. Raising them would
make an account still on the old ones verify _faster_ than the decoy, reopening
the oracle in the other direction — and since the opportunistic upgrade runs
only after a successful login, an account whose owner never signs in keeps the
old parameters indefinitely. Raising the cost wants a plan for stale rows, not
just next-login.

**Sessions** are a signed value in an `HttpOnly`, `SameSite=Lax` cookie — not a
database row.

`Secure` is decided once in `config.ts` as `secure_cookies`, on exactly the same
predicate as the `SESSION_SECRET` requirement: `production`, a non-loopback
`HOST`, or a set `WEB_ROOT`. The image is all three, so **every containerised
deployment gets it** — and so does a hand-rolled `pnpm start` behind a proxy,
which is neither production nor non-loopback but does serve the built
frontend. Plain HTTP therefore works on `localhost` only, where browsers treat the origin as trustworthy — and that is
now true by construction rather than by coincidence of the Dockerfile. On any other
plain-HTTP origin — a LAN address, an internal hostname — the browser discards
the cookie silently: login answers 200, the page says you are signed in, and the
next load says you are not. Put TLS in front, as the Apache vhost in
[deploying.md](./deploying.md) does.

One deliberate hardening, with a cost worth knowing. If a request arrives with
more than one session cookie, both are refused — a legitimate client only ever
sends one, so a second is planted, and refusing beats signing the member into
someone else's account. But logging in again does _not_ clear a planted cookie
set at a different path, so the member stays locked out until it expires or they
clear cookies by hand. Still the right trade against the alternative, and [#58]
is what actually ends it.

The consequence, stated plainly: **logout clears the cookie but does not
invalidate the token**, which stays valid until it expires. That follows from
sessions being signed rather than stored — there is no row to delete — and not
from anything above. A compromised session can only be revoked by rotating
`SESSION_SECRET`, which logs everyone out at once.

**Login is bounded twice, and they are different properties** (#57). A reverse proxy in
front of this is still worth having, but the app no longer depends on one.

**Per address, ten in fifteen minutes**, which is the guessing bound. It is keyed on the
address **as sent** rather than on whether it names an account — keying or answering
differently for a known address would hand back the enumeration oracle the constant-time
verify exists to close. A right answer **forgives** the address, so somebody who mistypes
nine times and then gets in is not one attempt from a lockout.

**Per address of origin, thirty in five minutes**, which is the availability bound, and it
is claimed **ahead of** the concurrency gate below. Per-address alone does not close that
hole: an attacker cycling addresses never fills one bucket, so two sustained requests would
hold the gate's whole capacity and answer 429 to every member for as long as they held them.
Thirty is deliberately generous, because everybody at a gathering shares one public address
— a bound tight enough to stop a determined guesser from one machine would lock out a camp.
What it does bound is the CPU one client can ask for, which is the actual exposure.

**The per-address bound is a lockout, and it can be aimed.** Ten wrong guesses at a known
member's address refuses **them** for a quarter of an hour, correct password included — and
because the refusal is free, one origin can hold a handful of known addresses locked out
indefinitely without ever filling its own bucket. Keying on `(origin, address)` instead would
weaken exactly the guessing bound this exists for, so it is not done; a passkey and a linked
provider both stay open as ways in, and an admin can reset a password. It is the conventional
trade and it is stated here rather than left to be discovered.

**`GET /api/invites/:token` is deliberately not bounded**, though the POST beside it is. It
answers whether a token is outstanding and the applicant's name, so it is a cheaper oracle than
the redemption — against 32 random bytes, cheap enough not to matter. What a bound there would
reach first is a camp arriving on one public address, where every redemption is a read and then
a write.

Both bounds are one `Map` of counters with an injected clock, bounded at four thousand keys: the
expired ones are reclaimed first, and if every bucket is live the one closest to expiry is
forgotten to make room. Forgetting rather than refusing, because a limiter that runs out of
memory to be a limiter with is an outage.

Neither is `@fastify/rate-limit`. Forty lines with the clock passed in is less than the
configuration surface of the plugin, and it is testable without waiting for a real window.

There is also a bound on concurrent _work_, which is a third thing. At most two
**scrypt hashes** run at once, and up to eight further callers wait in a FIFO
queue; the eleventh concurrent caller, or one still waiting after five seconds,
gets a `429` with `Retry-After`.

That bound is **shared with invite redemption**, not login's own. One gate covers
both, because what is being protected is libuv's threadpool rather than either
route — two gates of two slots would spend all four threads between them. So the
eleven are eleven of _either_: a flood of redemptions can shed a login and the
other way round, which is the point.

Queued rather than refused, deliberately. A hard cap would mean two sustained
anonymous requests denied every member's login for as long as they held them,
with nothing to wait out. Taking turns means a member arriving mid-flood is
served, and a client holding connections open competes for places rather than
owning them.

Why any of this is needed: every attempt costs ~230ms of CPU and 64 MiB —
including one for an address with no account, since the decoy derivation
deliberately spends the same work, and including a redemption that is going to be
refused — and `scrypt` runs on libuv's threadpool, four slots by default, shared
with the reads that serve static files. Without a bound, sustained traffic to
either route would degrade the whole app rather than just that route.

What the app does **not** do is bound the number of _attempts_. There is no
lockout and no backoff, and the gate does not provide one — it bounds concurrent
work, which is a different thing. Two slots at ~230ms is roughly 8–9 tries a
second, about 750,000 a day, sustained indefinitely against one address.

**So configure the proxy**, and for **both** paths that spend a hash:
`POST /api/auth/login` and `POST /api/invites/:token/redeem`. Something that counts
requests per client IP — `mod_evasive`, `mod_qos`, or fail2ban watching the access
log — sized well below that figure. A rule scoped to login alone leaves half the
gate's callers unthrottled, and redemption is the worse half: its `409` for an
address that already has an account never spends the invite, so one held link
drives it indefinitely. A few attempts a minute is generous for a membership of 42
and leaves an attacker nowhere to go. This matters from the moment the first
account exists, which is the setup step below.

`SESSION_SECRET` is required in production and the app refuses to start without
it. Generating one at boot instead would look like it works and log every member
out on each deploy — with watchtower redeploying on a tag move, every few
minutes after a merge.

[#17]: https://github.com/fiddur/sage-burner/issues/17
[#58]: https://github.com/fiddur/sage-burner/issues/58

### Signing up through a provider

Sign-up and sign-in converge on one handler, because asking somebody to say which one they are
doing is asking them to know. An identity nobody has yet makes an account rather than being
refused, which is why nothing answers `unlinked` any more (#489): every path that used to reach
it now falls through to `signUpThrough`, so the outcome was a branch nothing could take.

**That needs an address**, since an account is keyed by one — so both providers are now asked for
`email`, which neither was before: nothing here matched on an address, so collecting one bought
nothing. Discord's counts only where Discord says it is **verified**; an unverified one is a string
somebody typed into the provider, and taking it as a login identity would let a stranger claim an
address they do not hold. Facebook offers no such signal and often no address at all, so its is
taken as given or not at all.

**The address goes through `emailSchema`**, like every other way one enters the app — trimmed,
lowercased, bounded and checked that it is one at all. `account.email` carries a lowercase CHECK,
so a provider answering `Wren@Example.org` taken as given would miss the row it collides with and
then fail the write, reporting an address conflict to somebody who has no account.

**No address, no account**: the sign-up page says so and asks for one, and an address that is not
one is the same answer.

**The name comes with it where the provider gives one** — Discord's display name or username,
Facebook's `name` — because `account` carries the person, and without one `displayName` answers
"Somebody" on the feed card, in the `member_joined` push to every attendee, and in the Members
list. Where a provider gives none, submitting the application fills it in from the name the form
asked for: `updateMyProfile` is behind `requireApproved`, so an applicant cannot do it themselves
while they wait. **An address somebody
already holds** is refused too, and pointedly — matching accounts by address is account takeover
the moment a provider hands over one it has not verified. The path is signing in the other way and
linking under Your details, and that is the sentence the login page shows.

### Talking to an applicant

An application that raises a question had two buttons, and one of them was a silent no. There is
a third thing now (#477): **a private thread on the application**, so "who are you coming with?"
can replace a rejection.

**Not the feed's thread machinery**, deliberately. A feed thread is member-visible by design, and
this is the one conversation that must not be — it runs before there is a membership at all.
`application_message` is the whole model: the application, the author, the body, the time.

**Two parties and no more.** An admin reads and writes any, through
`/api/admin/applications/:id/messages` and therefore the admin prefix. The applicant writes to
`/api/me/application/messages`, which takes **no id** — an id in the path would be a way to ask
about somebody else's — and reads theirs as part of `GET /api/me/application`. Both are behind
`requireSignedIn`, because the applicant has no role by design.

**Both directions ring a bell.** The applicant hears `application_news`, which is the same
category the decision uses: one switch for news about your application, whether that news is an
answer or a question. Admins hear `application`, the category a new application already used, so
a reply lands where a submission does.

**A thread does not change the status.** Pending stays pending while the conversation runs;
approve and reject remain the same explicit actions, and a thread on a rejected application stays
readable — which is what the status page's "ask the organisers" posture is for.

**A password has a floor of ten characters** (#489). There was none, deliberately — "what makes a
good password is the member's business, and a floor here mostly pushes people to the one they
reuse" — and that held while the only way to choose one was redeeming an invite somebody had been
vetted for. Sign-up is open now, so the same schema is the floor for every account made from the
internet. `MIN_PASSWORD` is one constant the form and the schema share, so the page can say the
rule rather than let the server refuse after the fact.

**Somebody who already holds `member` cannot file an application** (#489). `/apply` renders for any
signed-in viewer with no application row, and the route asked only for a session — so a member who
came in by invite could add noise to the queue. It answers 409 now, and the page says what to do
instead: the second account is the trap, not the form.

**The applicant's end of the thread is bounded** (#489), because each message rings every admin's
bell through `notifyAdmins`. Ten in ten minutes per account, the same shape as the other routes a
role-less account can reach.

**Allergies are ticked on the way in.** The redemption form had a free-text box while every other
surface offers the shared vocabulary with checkboxes; `AllergiesField` is now one component both
use, so the two cannot drift. The list is a public read, which is what lets a form nobody has
signed into yet render it. Both ends write through `writeAllergyTicks` (#532), whose leading
`DELETE` is a no-op on an account three lines old — one place to change rather than two that can
drift, and a foreign key still refuses an item id nobody minted.

## Applying

`POST /api/applications` is behind `requireSignedIn` since #476 — it was the only public write in
the app, and the account it now needs is one anybody can make in the step before. Everything in
the body is still attacker-controlled, so two things are true by construction:

- **The submitter names their answers and which questions they were shown, and
  nothing else.** `id`, `status` and the timestamps are the server's. The schema
  is `.strict()`, so an attempt at any of them is a 400 rather than a quietly
  dropped key — a request that tried to approve itself must not look like it
  succeeded. What `asked` is allowed to decide — and what it is not — is set out
  below.
- **The questions are re-read from the database on every submission**, never
  taken from the request.

**Answers store the question, not a reference to it.** Each entry is
`{ question_id, label, type, value }`: the id so a reviewer can line the same
question up across applications, and the wording exactly as that applicant saw
it. A bare reference does not survive the form changing, and the form is meant to
change — questions are rows precisely so admins can retune them between
burns. Without the snapshot, editing a question would silently re-file every past
answer under wording nobody was shown, and deleting one would leave answers that
cannot be labelled at all. Neither is recoverable afterwards, which is why the
cost is paid on write.

One entry is stored per question **asked**, answered or not, so a reviewer can
tell "said no" from "was never asked". An absent tick box stores `false`; an
absent optional text answer stores `""`.

**The form asks for an email address, not "how can we reach you".** It was the
latter — one free-text box holding phone numbers and Discord handles as often as
addresses — until approving somebody started posting them their invite (#30). Once
the app has to write to it, the address is the one thing it must have. The form
marks a typo before submitting, because a bad address is an application that
silently goes nowhere; the column keeps whatever the old box held for everybody who
applied before, with no CHECK on the shape, and `looksLikeEmail` is what decides
whether one of those is worth posting to.

**Blank means the address the account already has** (#510). Since #476 applying starts with an
account, so the app knows an address before the form is drawn — but the _client_ does not, and
deliberately: the viewer carries a name and nothing else personal, and `getMyProfile` is behind
`requireApproved`, which an applicant does not hold. Rather than putting the address on the viewer
for every page, or adding a route for one field, `applicant_email` became **optional** and the
route falls back to `account.email`. That keeps the two columns independent — applying with a
different address than you sign in with stays possible, which is the reason the field exists — and
asks nothing new of the client. The form says what blank means and no longer refuses one.

**The two 409s say which they are** (#531). `already_member` is somebody with nothing left to apply
for; `already_applied` is the unique index on `application.account_id` catching a second tab. They
read identically before, so a double submit was told it was already a member. The page also swaps
the form for a sentence when the viewer holds `member`, rather than letting them fill it in and
learn on submit.

**"Asked" means the form said so, not that the question exists now.** The
submission carries `asked` — the ids the page actually rendered — and only those
get an entry. Without it, a question an admin added while someone was filling
the form in was stored against them as `""` or `false`, which reads as "asked and
declined" about a question they never saw.

`asked` narrows what is **stored**, never what is **checked**. Validation runs
against the server's own list, or "I wasn't shown that" would be the way to skip a
required question or an agreement — so a required question added in that window
still answers 400, and the form still says to reload rather than to try again.

An answer naming a question outside `asked` is a **400** rather than a dropped
key: the body disagrees with itself, and silently discarding it would lose what
somebody typed.

An id in `asked` that the server no longer has is a question deleted while the
form was open, and what happens then depends on whether it was answered:

- **with no answer key in the body, it is a 201** with no entry. There is nothing
  to store — the wording comes from the question row, and the row is gone.
- **with a key, it is a 400**, and not by the `asked` rule at all: `answerProblems`
  sees an answer naming no question it holds and says `unknown`, before the
  filtering is reached. The form's advice for a 400 — reload and send again — is
  right for it.

The distinction is the key, not what the field looked like. `Apply.tsx` writes
`answers[id]` on every keystroke, so a text question typed into and then cleared
sends `''` — a key, and therefore the 400 — while one never touched sends
nothing.

**The wording is still read at submission, not sent.** All of the above is about
which questions get an entry; the label on each one comes from the question row
as it is when the application lands. So an admin who _edits_ a question's text
while someone is filling the form in has that answer stored under the new
wording, against a question they were shown the old one for. That is the trade
`asked` does not touch and deliberately: taking the wording from the body would
let a submission record a question in words nobody wrote, which is the worse of
the two. #85's fix narrows what is stored, not where the words come from.

What this does _not_ claim: a crafted body can omit an optional question it was
shown and left blank, so it records as never-asked rather than as `false` or
`""`. Understating your own application is not an attack worth defending against,
and the direction that matters is closed — nothing can be recorded as answered
that the body does not claim was asked.

**What makes a submission valid** lives in `answerProblems`, in
`packages/shared`, and both sides use it: the server refuses on it, and the form
marks its fields with it. Written twice they drift, and the drift is a form that
says everything is fine against an API that answers 400. The rules:

- a `required` question must have a non-blank answer — trimmed, so `required`
  means "said something" rather than "sent the key";
- an `agreement` must be ticked, which is the entire reason the type exists.
  Absent counts as unticked, because that is what a browser sends for a box
  nobody touched;
- a tick box takes a boolean and a text question a string — `'false'` is truthy,
  so accepting a string for a tick box would tick an agreement nobody ticked;
- an answer to a question that was not asked is refused rather than stored.

The module is deliberately free of Zod so the browser can import it — see the
`sideEffects` note under [Shared schemas and types](AGENTS.md#shared-schemas-and-types-packagesshared).

The form itself hardcodes nothing about the questions: it renders whatever
`GET /api/questions` returns, in `order`. Adding a question in the admin UI makes
it appear on the public form with no deploy, which is the acceptance criterion
`form_question` exists for.

**Nothing is sent on submission**, ever. Whether anything is sent on approval
depends on the installation, so the confirmation screen reads
`installation.sends_email` and says which — a promise the installation may not be
able to keep is worse than no promise, and an applicant left waiting for a message
that will never arrive is what the copy exists to prevent.

## Reviewing applications

`GET /api/admin/applications` lists everything sent in, newest first, with the
answers as stored — the question wording included, so an admin reads what the
applicant was actually asked rather than what the form says today.

Approving and rejecting are the same shape, and the shape is the point:

```sql
UPDATE application SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
```

Zero affected rows means someone already decided it, which is answered `409`
rather than silently re-deciding. The decision and the guard against
re-deciding are **one statement**, so there is no window between them — a
double-clicked Approve mints one invite, not two. `invite_token_application_idx`
is the backstop underneath that, and the page tells the admin to reload
rather than to try again, since retrying cannot help.

**Approval mints an invite only for an application from before #476** — one with no `account_id`,
where a link is the only thing there is to offer. For everything since, approval grants the role
outright and mints nothing. What follows describes that older path, which the two outstanding
invites still ride.

**What the approved person is told is written in the past tense, and only where it happened**
(#517, #522). Approval calls `joinTheNextBurn`, which joins nothing where no burn is planned — so
the page's old fallback, "you have been added to the burn that is coming", asserted a membership of
a burn for somebody on none, and offered to let them leave it. It also read the _current_ burn list
rather than a record of what approval did, so a member who joined and then left was still told they
were on it. The sentence now names the burn only when one is joined, and otherwise says what is
true: every burn being planned is open to them, and joining is theirs to do.

32 CSPRNG bytes, base64url, valid 30 days. Only
the SHA-256 digest is stored, so the raw token exists in that one response and
nowhere else — a leaked backup or a stray copy of the volume hands out no
invites.

**It is posted to the applicant where the installation has a mail server** (#30),
and the admin still gets the link in the response either way — pasting it into
Discord is how this worked before there was one to configure, and is still the
answer for an installation with no SMTP. The message goes out _after_ the
transaction: the invite is committed by the time it runs, so a mail server that is
down costs a message rather than an approval, and a refusal is logged rather than
turned into a failed decision. A re-issue posts the replacement the same way, which
is the case that route exists for.

**The admin is told which of those happened** (#327). The response carries
`delivery` — the same `{ sent, to, reason }` a test message answers with — and the
paragraph beside the link words itself from it. It said "Send this link" whichever way
it had gone, and that was wrong in both directions: an applicant got the link twice
from two people, or every send failed with a TLS record error and nobody learned. The
link stays visible in all three cases, because a bounce is invisible to this app.

`null` there means nothing was attempted, which needs different words from a refusal:
a direct invite has nobody to post to, and an application from before #30 may hold a
Discord handle rather than an address — `looksLikeEmail` is what decides. The third
silent path was a `Host` that is not hostname-shaped, since a link in an inbox has to
be absolute; it now answers with a reason naming `PUBLIC_ORIGIN` instead of returning
quietly.

**A lost link is re-issued, not worked around.**
`POST /api/admin/applications/:id/invite` mints a replacement and shows it once,
the same way approving does. The link is shown in a paragraph that vanishes on
reload and the admin has to paste it into Discord before navigating away, so
losing it is a realistic accident rather than carelessness.

**The two ways it is refused carry different slugs** (#178) — `not_approved` and
`invite_used`. The `errorCodes` doc block in `packages/shared/src/schemas/error.ts` has
the why.

**The row is updated, not replaced**, which is what makes this safe. One invite per
application stays the invariant `invite_token_application_idx` already enforces, and
rewriting `token_hash` kills the lost link in the same statement that mints its
replacement — the old token no longer hashes to anything stored.

That matters because of what the previous workaround cost. Until this route,
recovery meant minting a _direct_ invite with `POST /api/admin/invites`, and:

- **the original link stayed live.** It is the token that is lost, not the row, and
  `DELETE /api/admin/invites/:id` refuses an application's invite precisely because
  it belongs to one. A lost link turning up later could still be redeemed — with a
  _different_ email, since the same address answers `409` against the account they
  now have. An invite is forwardable and whoever holds it is a stranger, so that was
  the likelier shape anyway: a second, unrelated account off an approval meant for
  one person (#137).
- **the answers were orphaned.** A direct invite carries no `application_id`, so
  what they wrote was not tied to the account they ended up with.

Re-issuing closes both by construction. Direct invites remain, for the person who
never applied through the form.

**Refused once the invite has been used.** By then they are already in, and a fresh
link would be a second account by another name — the same hole from the other end.
An application that is pending or rejected is refused too: pending is approved
instead, and rejected is not reopened by a side door.

The copy button is deliberately silent on failure rather than claiming a copy
that did not happen.

The link is assembled in the browser from `window.location.origin`, so the API
needs no notion of its own public URL.

**An invite carries no `event_id`.** It admits you to the community, not to a
burn — the application has no event either — and which burns you then come to is
a separate decision each time.

## Direct invites

For people already known — returning members, partners — who should skip the form
entirely. `POST /api/admin/invites` mints the **same** token an approval does, so
both kinds redeem through one path: CSPRNG bytes, digest stored, raw value
returned once. The default is 30 days; an admin can set `expires_at`, and one
already in the past is refused rather than stored, since it would be a link
nobody could use.

`GET /api/admin/invites` lists them with a **derived** status — `outstanding`,
`used`, `expired`. Derived rather than stored, because an invite becomes expired
by time passing, not by anyone writing to it, and a stored status would be a
value in the database that quietly stops being true. `used` beats `expired`: a
redeemed invite that later lapses is spent, and calling it expired would suggest
re-issuing a link to someone who is already in.

The list never carries the digest, let alone the token.

**Only an unredeemed direct invite can be revoked.** The other two cases are
refused with `409`, for different reasons:

- a **redeemed** invite is the record of how someone got in, and `account`
  references it — deleting it would rewrite how the group formed;
- an **application's** invite is the only one that application will ever have, so
  revoking it would leave that applicant with nothing to redeem. A direct invite
  gets them in; what cannot be recovered is the tie back to what they wrote, and
  #91 owns re-issuing against the application itself.

The admin UI offers Revoke on exactly those — every unredeemed direct invite,
**expired ones included**, since an expired link is still a row worth clearing
out and the route deletes it happily.

## Redeeming an invite

`/invite/:token` is where both membership paths converge. Unauthenticated, and the
token is the only credential — an invite is unguessable but **forwardable**, so
whoever holds it is a stranger until they redeem.

`GET /api/invites/:token` answers `200` with one of four statuses —
`outstanding`, `expired`, `used`, `unknown` — never a 404 for an unknown token,
which would turn a leaked link into a way of probing for live ones. The page needs
the distinction because the three dead ends want three different things done about
them: an expired link can be re-sent, a used one usually means you already have an
account, an unknown one is usually a truncated paste.

**While the invite is outstanding it also carries what that applicant typed** —
their name, and since #30 the address the invite was posted to. Both are theirs;
both are dropped once the link is spent or expired, where there is no form to fill
and naming them would be disclosure bought for nothing. The trade is that a
forwarded live link tells its holder whose it was, weighed against a token that is
256 bits of CSPRNG, single-use, expiring, and sent only to the person it names.
Being asked for the address the message you are reading arrived at is worse than a
system that was not listening.

This is **not** the enumeration channel the redemption section describes: nothing
here takes an address and says whether it has an application. It takes a token
nobody can guess and repeats what the person who applied wrote.

`POST /api/invites/:token/redeem` creates the account, fills in the person-level
fields, grants the `member` role and signs them in. **One transaction**, because
half a redemption is the worst outcome: a spent token with no account behind it
leaves the person unable to finish with the link they were sent, and that link
cannot be re-sent — somebody with admin has to notice and mint a direct invite
(#91).

Two races are closed, and each has a test that fails without it:

- **Two people, one link.** Both requests read the invite as outstanding, then
  both spend ~230ms in `scrypt` before writing, so they genuinely interleave. The
  stamp is `UPDATE … WHERE id = ? AND used_at IS NULL` requiring one affected
  row, so the loser's transaction rolls back whole.
- **Two links, one email.** Both pass the email pre-check before either writes, so
  the loser's insert meets the `UNIQUE` and its stamp rolls back with it — leaving
  that invite still usable.

The password is hashed _outside_ the transaction. Holding a write transaction open
across 230ms of scrypt would block every other writer for that long.

It is also hashed **before** the check for an address that already has an
account, so the refusal costs what a success costs. `POST /api/auth/login` is
shaped the same way.

**This throttles an enumeration channel; it does not close one, and the
difference is worth stating plainly.** A `409` does not spend the token, so
whoever holds one unspent invite can ask "does this address have an account?"
about address after address — and the _status code_ answers that regardless of
timing: `409` for a member, `201` for anyone else. Latency was a redundant second
copy of an answer the status line already gives. What the ordering buys is cost:
each probe now spends a gated scrypt. With `SCRYPT_GATE`'s two slots and scrypt at
~230ms that is a ceiling of **about nine probes a second**, shared with every
login — against thousands a second when the refusal was free. The per-origin bound on
redemption (twenty in ten minutes) is what caps it properly now, and there is a test that
pins the residual so this paragraph cannot quietly go stale.

Spending the token on the taken-address refusal would cap a held invite at one
probe. It is deliberately not done: someone who typos an address that happens to
belong to a member would lose their invite over it, and a new one needs an admin.

That hash goes through the **same gate as login**, not one of its own — the gate
bounds concurrent scrypt against libuv's four threads, so two gates of two slots
would spend the whole pool between them. There is a test holding the only slot
from the redemption side and asserting login is shed, which fails if they ever
drift apart. Over the bound both answer `429` with `Retry-After`.

The `POST` gives **one answer** — `409` — for unknown, expired and spent alike.
Not to hide which it is: the `GET` above says so plainly to anyone who asks, and
could not usefully do otherwise. It is that the client has nothing to do with the
difference at this point — the page has already read the status, and by the time
it POSTs all three mean the same thing, that this link cannot be spent.

**The form offers the upcoming burn, ticked** (#224). Almost everybody spending an
invite is coming to the burn that is next, so the form says so by name and asks for
the stay — arrival, lodging, helping — in the same breath, rather than leaving a new
member to find a second page. Offered rather than assumed: being on the list is a
commitment, and an admin setting a burn up need not be attending it, so the box
unticks and the stay questions go with it. No burn coming, no checkbox.

It needs no new disclosure to do this. `/api/events/active` and
`/api/events/:eventId/options` are **already public** — the second for the reason the
places are, that nothing in it is about a person — so an unauthenticated form can name
the burn and draw its lodging list without the invite route learning to hand out
anything new. Both reads fail soft: somebody who cannot be offered a burn can still
become a member and pick one afterwards.

**Joining happens after the transaction, never inside it.** That transaction spends a
token which cannot be spent again, so nothing optional may be given the power to roll
it back. A burn that ended while the form was open leaves the account made and the
response's `attendance` null, and the page says which happened. The stay details are a
second write for the same reason — their failure reads "you are in, but…" rather than
as a signup that failed. Redeeming with the box unticked still creates no `attendance`
at all: being a member and coming to a particular burn stay separate acts.

A signed-in visitor is not offered the form — redeeming would create a second
account for the same human, and the page cannot tell whether that was meant.

## Creating the first admin

`admin:create` makes the first admin, or grants the roles to an account
that already exists. Against a running container:

```sh
read -rs -p 'Password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD

docker compose exec \
  -e ADMIN_EMAIL=you@example.org \
  -e ADMIN_PASSWORD \
  sage-burner node apps/backend/src/cli/create-admin.ts
```

`node` rather than `pnpm` inside the container on purpose: the image purges
corepack's cache to keep ~24 MB out of a layer watchtower re-pulls on every
deploy, so `pnpm` there re-downloads itself from the network first. The script
is the same one `pnpm --filter sage-burner-backend admin:create` runs locally.

Or locally, against `./data/sage-burner.sqlite`:

```sh
read -rs -p 'Password: ' ADMIN_PASSWORD; echo
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  pnpm --filter sage-burner-backend admin:create
```

Then log in at `/login`; the nav gains the **⚙️** link and the initials circle in
the corner — `admin:create` grants `member` alongside `admin`, because an admin
is almost always also coming. The circle shows a 👤 until a name is filled in, which
is the state that account starts in.

**It never changes an existing password**, and says so when it finds one. Setting a
password for somebody is the accounts list's job.

## Setting somebody's password

Every row of ⚙️'s accounts list has a field for it (#211). It is the **only** way a
password changes once it is set: redemption is where one is chosen, `admin:create`
refuses to touch an existing one, and nothing else writes the column except a silent
rehash on login when scrypt's parameters have moved on. Before this, an account whose
owner had lost the password — or one an admin made and did not write down — had
no way back at all.

No old password is asked for, because an admin does not have it. That is the
point, and it also makes this the most powerful route in the app: admin taking over
any account, another admin's included. At 42 people who all know each other that
is the trust the role already carries, and it is written here so nobody has to infer
it.

The field is deliberately **not** `type="password"`: an admin is choosing a
password to read out or paste to somebody, and hiding it from the person choosing it
helps nobody. Nothing is echoed back by the API — 204 and an empty body, because a
password in a response is a password in somebody's network log — so it has to be
passed on before the page is left.

**It does not end that account's existing sessions.** Sessions are stateless signed
cookies with a TTL and there is nothing to revoke them against, so a reset locks
nobody out of a browser already signed in. Fine for the case this exists for; not
fine for a compromised account, which would want a session version to bump.

Both values come from the environment, never from arguments. `read -rs` keeps
the password out of the shell history, and `-e ADMIN_PASSWORD` with no `=`
forwards the value from the caller's environment rather than restating it — so
it never reaches the host's process arguments, where any local user can read it
off `ps`. Verified: the container receives it and it appears nowhere in docker's
argv. This is the one password on the system at the moment it is created.

The **local** invocation runs migrations first, so it works against an empty
volume: an admin can exist before the server has ever started. That is not what
makes the container recipe above work — `docker compose exec` needs a container
already running, which has already migrated on boot. There the migration has
happened regardless.

Two things it deliberately does not do:

- **It never changes an existing password.** Given an address that is already
  here, it grants the roles and stops. Otherwise the bootstrap command would
  double as an offline password reset for any account, and anyone who could run
  it could take over the admin's login rather than merely create one. Run it
  twice and the second run says so.
- **It does not lowercase-and-hope.** The email goes through the same schema the
  API validates against, so `You@Example.org` finds the existing
  `you@example.org` rather than creating a second account beside it — the
  table's `UNIQUE` is byte-exact.

The password needs `MIN_PASSWORD` characters and nothing else — no composition
rule, since those are the app deciding what a good password is on somebody else's
behalf, and they push people towards the one they already reuse everywhere. There
was no length rule either while redemption was the only way to choose one and
whoever held the link had been vetted; sign-up being open changed what the same
schema is a floor for (#489).

**The floor applies where a password is _set_ and never at login**, which is why
`loginPasswordSchema` stays at `min(1)`: adding a rule later must not lock out a
member whose existing password is shorter than it. `ensureAdmin` is the one place
a short one now stops something — a first bootstrap, which is a fresh choice
rather than an old one.

## Passkeys

Anybody signed in can register one from the details page behind the initials
circle, and any of them signs in from `/login`. They **sit alongside the password
rather than replacing it** (#9): an account may hold both, either, or several
passkeys and no password at all.

- Per **device**, like notifications. A passkey lives in the phone or laptop that
  made it, so somebody with both registers twice — and names each, which is what
  makes the list act-on-able three months later.
- **Signing in asks for no address.** Registration requires a discoverable
  credential (`residentKey: 'required'`), so the browser offers whatever it holds
  for this domain and the server resolves the account from the credential itself.
  Naming credentials would mean sending an address first, and answering "which
  passkeys does this address have" is the enumeration oracle the password login
  goes to some length to avoid.
- **User verification is required** at both ends — a fingerprint, a face or a PIN,
  not merely a tap. Asking for it in the options rather than only at verification
  is what keeps a device that cannot do it from failing at the last step, after
  the browser has already said yes.
- **Removing the last passkey is refused when there is no password** — 409, and
  the page says why. There is no reset flow at all: #30 gave the app a mail server
  and nothing that sends a reset through it, so the only way back is an admin, from
  the accounts page. That combination is a lockout with nothing in the app to undo
  it, which is why the refusal is folded into the `DELETE`'s own `WHERE` (#239)
  rather than checked before it — two removals from two tabs could otherwise each
  see two passkeys, both pass, and together strip the account bare. It is the one
  place here that engineers for a race, and the consequence is why.
- The **challenge is a row**, not a signed cookie, and it is deleted by the
  statement that reads it. Single-use is the whole point of a challenge, and a
  signed one is replayable for as long as it is valid. Expired rows are swept
  whenever a new challenge is minted; nothing else makes them, so nothing else
  needs to clean them up.
- Which domain a credential belongs to comes from `PUBLIC_ORIGIN` when it is set
  and from the browser's `Origin` otherwise. See the configuration section for
  what the fallback costs.

Both ends use `@simplewebauthn`. The backend's tests carry a small authenticator —
a P-256 key, `authenticatorData`, a CBOR attestation object and a real ECDSA
signature — rather than stubbing the verifier, because the verifier is the part
worth testing.

[#30]: https://github.com/fiddur/sage-burner/issues/30

## Notifications

Any approved member can be told when something happens to them, per **browser**
rather than per person: a subscription belongs to the browser it was made in, so
somebody with a laptop and a phone turns it on in both. The toggle is on the details
page behind the initials circle, and **only** there.

It was on ⚙️ → Settings as well, because an account holding `admin` without `member`
was refused from the details page and application notifications go precisely to
admins. Two switches for one subscription turned out to be the worse problem —
which of them is on is a question neither page can answer, and it reads as two
different settings — so it lives where a person's own settings live, and #396 made
that page `approved` so the account the second switch existed for can reach it.

A notification is a **record**, and a push is a copy of it (#248). The bell in the
header carries what happened while you were away and whether you have looked; a push
message is gone the moment it is dismissed, which is why the row is the notification
rather than the other way round. A member with no browser subscribed still gets the
bell, which is the ordinary case.

**The bell is a link to `/notifications` that a wide viewport intercepts** (#336). It
used to be a button dropping a panel hung off its own right edge, which worked only
while it was near the right margin — wrapped onto the header's second row on a phone
it opened past the edge of the screen and could not be reached at all. One control
rather than two: on a phone there is no panel to misplace, a tapped push lands on a
page that can be scrolled and shared, and a middle-click or an open-in-new-tab does
what the `href` promises. On a wide screen the click is intercepted and the panel
opens as before — hung off the header now rather than the button, so no future layout
change can put it off-screen again.

The page is open to **anybody signed in**, not to approved members: an applicant is
told when their application is decided, and refusing them the page announcing it would
be the app hiding a message it sent them. Reading it marks everything seen, exactly as
opening the panel does, and the list it was read with keeps its emphasis — the marking
is for the next visit. The panel and the page draw the same component, so the peek and
the page cannot come to say different things about one row.

### Seeing the thing itself also marks it (#527)

Those two were the only ways a notification became seen, so arriving at what one points
at any other way left it unread: the new-version banner's "What's new" leads to
`/changelog` and the row written with that link stayed on the bell, and so did a push
notification's deep link or a shared URL. A badge about something already read is what
teaches people to stop looking at the badge.

**The client reports the address; the server does the matching.** `POST
/api/me/notifications/shown` takes `{ link, as_of }` and marks `link = ? AND created_at
<= ? AND seen_at IS NULL` for that account alone. By address rather than by ids the
client holds, because of a real race: the banner comes from version polling, quite
independent of the notification row, so somebody can be on `/changelog` before the
bell's sixty-second ask has ever fetched the notification. A client marking by id would
miss that one; a server matching by link cannot.

**The address includes the query**, because that is what distinguishes one bring item's
notification from another's — `/bring?burn=…&item=…`. So the report is
`location.pathname + location.search`, and a link is built once in `pages.ts` and read
back by the browser unchanged. `changelogPage()` exists for exactly that reason: three
places spelled `/changelog` by hand, and the marking is a string comparison between two
of them.

**Freshness is what bounds it.** Being on the page is not enough — the shown data must
be at least as new as the notification, or somebody parked on an open introduction page
would have a second edit marked seen without ever seeing it. So the claim carries when
the shown data was read, and the timestamp is the server's own: `Date` on the response
of the read, which the API client keeps per `AbortSignal` and hands back as `readAt`.
Whole seconds and the **oldest** read of the load, both of which err towards marking
less; a device clock is not asked, and could not be trusted if it were. `useLoad`
reports after each successful fetch, so `live: true` gives the "clears while the page
is open" case for free — the second notification is marked the moment the refetch
renders the newer content, and not before.

**Nothing here is a permission.** A forged `as_of` would mark that account's own
notifications, which `POST /api/me/notifications/seen` already does wholesale, so the
timestamp is about correctness rather than trust. The report is best-effort — a failure
is swallowed and retried by the next load — and it is not sent at all for a signed-out
visit, where there is nobody to mark anything for. What the answer carries is the bell's
own payload, handed to whoever subscribed, so the badge clears without waiting for the
next ask.

One row per category under **Your details → Notifications**, in three sections that
default differently — a count here would go stale on the next feature, and
`notificationCategoryInfo` is the list:

- **What happens to you** — on unless you refuse them: being put on a meal is not
  noise, and somebody who never opens the settings should still hear it.
- **What else is going on** — the section #259 added. **Off unless you ask.** A burn
  where every dream and every arrival pings forty-two people is a channel people learn
  to ignore, which costs the notifications that are actually about them.

  **One exception, and what makes it one: a meeting has a time you have to be at.**
  Everything else in this section can be read whenever you next look — a dream offered, a
  song added, somebody saying they are coming — so nothing is lost by finding out late. A
  planning call at 19:00 on Sunday is either heard before Sunday or missed, and the whole
  point of putting it in the diary is that people come. So `meeting_scheduled` is on by
  default while sitting here rather than under _what happens to you_, which is about your
  own record changing. The section still says where a category belongs; `on` says whether
  it can wait.

- **What you look after** — an application arriving, and **only an admin is shown it**
  (#326). Nobody else is ever told, and a switch that cannot do anything reads as a
  promise. On, like the first section: an application stays open until somebody reviews
  it. The wire still carries it for everybody, because the settings are per account and
  know nothing about roles — so a member unticking a row does not switch it off for
  whoever does hold `admin`.

That split is what decides the storage. `notification_mute` held only the categories
somebody had switched _off_, and absence meant on — sound while every category was on
by default, and unable to say anything once five are off by default. So a row in
`notification_setting` now carries `enabled` and means "this person said"; absence
means they have not, and the default lives in `notificationCategoryInfo`. Nothing is
seeded, so an account made tomorrow still picks up today's defaults. The wire carries
`{ on: [...] }` — the complete list of what is on — rather than a list of exceptions
whose meaning would depend on which category it named.

Switching one off silences the bell and the push together — those are one switch, and
a bell filling with things somebody asked not to hear about is the same noise in a
quieter place. The same holds in the other direction: nothing is recorded at all for a
category somebody never turned on.

### Asked for at the moment somebody joins (#574)

The permission prompt used to live in one place, the toggle, and the toggle was rendered in two:
the details page and the _Application sent_ panel. **The invite flow asked nowhere.** Somebody who
followed a link, filled the form and read "You are in, signed in, and on the list" got the install
strip and no offer of notifications at all — at the one moment they have just decided to join. So
the invite welcome offers it, the way Apply's waiting panel does.

**One implementation, not a second copy of a control.** `usePushHere` is the state machine and
`PushAsk` is the button and the copy for the states it cannot offer one in; the toggle on the
details page is that pair plus the category table, the invite welcome is the pair alone. That is
the distinction `docs/the-app.md` draws when it says signing out and the toggle live in one place:
what must not be duplicated is a _control_ whose two copies can disagree about what is on. Two
places asking one browser for one permission cannot.

**Ticking a category is the other moment worth asking at.** "Tell me about X" on a browser with no
subscription reaches the bell and nothing else, which is precisely the silence this closes — so
switching one on raises a nudge offering the same button. It carries **"Do not ask me here"**, which
is `localStorage`, per browser like the subscription itself: a "never ask" that synced across devices
would silence a phone because somebody said no on a laptop. A key of its own rather than the install
strip's, since having the app installed says nothing about wanting to be notified.

**Both places a category is switched on raise it, and one refusal covers them all** (#584). There
are two such controls — the table on the details page and the 🔔 on every feed card — and the feed
is where people actually tick things while reading. So neither renders a nudge of its own: they say
_a category was switched on_ to `PushNudgeProvider`, mounted above both, and one strip answers.
Held there rather than inside either control because a dismissal pressed on the feed has to silence
the one under the settings table too, and state inside a component cannot say that — and because
somebody switching four kinds on in a sitting must be asked at most once, which is what the shared
flag makes true.

**The strip is fixed to the bottom of the window.** It answers a tick that can happen anywhere, and
the settings table is three screens long while the feed is longer, so a notice in the flow at the
top of the page would appear off-screen exactly when it was raised. `usePushHere` lives inside the
strip rather than beside it, so a page nobody has ticked anything on registers no service worker and
re-posts no subscription.

**On iOS it leads with installing**, because push does not exist in Safari until the app is on the
home screen: `PushAsk` renders the install line rather than a button that cannot deliver, splitting
on whether this is already the installed copy exactly as the toggle did.

### What went out, and how far it got (#575)

`notification` rows say who was told; nothing said whether it arrived. `notifyRows` computed
`{ sent, failed, gone }` per account and threw them away — the callback in `app.ts` logged the
counts only when something went wrong, with no account and no category — and somebody with the
category switched off left no trace at all, which for an audit is the interesting half.

**One row per notification, not per recipient.** `notification_batch` is what ⚙️ → Notifications
sent lists: when, the category, the first line of the body, how many were told, how many had it
switched off, how many devices took it, how many emails were queued. A fan-out to thirty attendees
is one line here and thirty in `notification`.

**`oneBatch` is what makes that true, and every shared-audience loop calls it** — not only the
fan-out helpers. A comment on a card tells the people in it and, separately, everybody who asked
about that kind; the waiting list tells everybody who has not paid. Those are loops in
`threads.ts` and `waiting-list.ts` calling the notifier directly, and without an id minted once
above them each recipient opened a row of their own: a comment in a forty-person burn wrote forty
lines, nearly all `told: 0, suppressed: 1`, pushing everything real out of the two hundred the
page holds. One category per row, so a comment is two rows — the participants' and the listeners'
— because those are two categories and the log is read by what it was about.

Mentions stay one row per person, deliberately: they are separate notifications with separate
bodies, naming different people.

**`accepted` is not `delivered`, and the column is named so it cannot be read as one.** It counts
the subscriptions the push service took; `gone` is a 404 or 410, meaning the subscription is dead
and `push.ts` has just deleted it. What a device actually showed is unknowable without the service
worker acknowledging a `push` — and only while online — which is not what this is.

**It prunes itself.** These are member records in aggregate, and the issue an audit log always has
is unbounded growth, so a row older than `RETENTION_DAYS` goes when the next notification opens a
batch. The `notification` rows are the record; this is the delivery note.

**No CHECK on its category**, unlike `notification`, `notification_setting` and `activity`. Those
three are rebuilt by every migration that widens the vocabulary and a fourth would tax that change
again — for a table nothing but this process writes into, and where a write failing because the
vocabulary moved on would mean losing the record of a notification that did go out.

### The email column

Where an admin has set an SMTP server up, each row grows a second switch (#30). The
two tables are `table-layout: fixed` with a stated width for the switch columns, so
the split by heading does not put the same control in two different places.

**Email is a channel of its own, not a copy of the bell.** They are independent: take
the burn-wide ones in your inbox and off your phone if that is what suits. It is **off
for every category until somebody asks**, so it needs no defaults at all — absence and
`false` say the same thing, which is why `notification_setting.email` has a SQL
`DEFAULT 0` and the migration adding it decided nothing for the rows already there. An
upgrade must never be what starts posting to somebody's inbox.

**The digest is the one exception, and it is deliberately one** (#620). The rule above is
about the per-category channel — an instant copy of each notification, which is somebody
choosing to be reached that way. The digest is a different thing: **only what you have not
seen, and only when you have not been here.** It is on by default, daily, because the
people it is for are precisely the people who have stopped opening the app and will
therefore never open the settings page to switch it on. An upgrade does start it, and what
it can produce for somebody who never comes back is one message a day that would each have
been a reason to come back.

`account.digest` is `daily | weekly | off`, nullable, and **absence means "has not said"** —
the same shape `notification_setting` uses, with `DEFAULT_DIGEST` in the shared package
holding what that means. The wire carries it whole alongside the two lists, for the reason
the lists are carried whole.

A digest goes out only when **all** of these hold: a mail server is configured; the choice
is not `off`; something is unseen; something unseen is newer than the last digest; and the
account has not been on the site inside the window — 24 hours or 7 days. It then carries
**everything** still unseen, not only what arrived since the last one: a digest is the whole
of what is waiting, and the newer thing is only what makes it worth sending. Sending the new
one alone would leave the rest unmentioned for ever.

**`account.last_active_at` is what "has been here" means**, and nothing recorded it before:
a session is a signed cookie with no row behind it. An `onRequest` hook stamps it for
`/api/` requests carrying a session, and the staleness test is the `UPDATE`'s own `WHERE`,
so it is one write, no read, and a no-op on all but the first request of an hour. That also
sets the resolution: an hour is the finest question this data can answer.

**`account.digest_sent_at` is set only on a send that succeeded.** A mail server that is
down therefore costs a delay rather than a digest — the next sweep tries the same person
again — which is the one place the "a failed send costs a message" rule is worth bending,
since nothing else will carry that backlog.

**The sweep is in `server.ts`, not `createApp`** — exactly where `announceDeploy` is, and for
the same reason: the suite builds an app per test, and a timer wired into that would tick in
every one of them. It is an hourly unref'd interval that does nothing outside 02:00–05:00 by
the container's clock. Nothing depends on the hour being right; the window guard is what
stops a second digest, whenever the sweep happens to wake.

The wire carries both lists in full — `{ on: [...], email: [...] }` — for the same
reason it carries `on` in full: two lists meaning two different things is exactly what
the `muted` rewrite got rid of.

With no mail server there is **no column**, rather than one that cannot do anything: a
switch that does nothing reads as a promise. Setting one up puts it there without a
reload, because `GET /api/installation` carries `sends_email` and the settings page
sets it locally when it saves.

A message is the same sentence the bell shows, which is the whole of it — a second
wording per category would be one more thing per category to keep in step. It links to the page
the notification belongs to **only when `PUBLIC_ORIGIN` is set**: an email is read
outside the app, so a relative path is no use, and unlike the share card this runs from
wherever a role was handed out, with no request to read `Host` from. Without one the
message says what happened and stops there.

Posting never fails a write, and never delays one. The send goes on a queue rather than
being awaited beside the bell's row (#356), so a mail server that is down costs a
message rather than somebody's record — the rule push already follows here — and costs
nobody the wait either. The queue reports a failed message rather than rethrowing it,
which is what keeps a rejection nobody is holding from taking the process down with it;
Node's default for one of those is to exit.

**The email leg leaves the request** (#356), and it was a burn-wide notification that
made that necessary. Sent one after another it was fifteen seconds _per attendee_ on a
host that drops packets — something like ten minutes at the forty-two cap, with no
request timeout above it. #313 made them go side by side, which is one wait however
many people are coming, and traded that for forty-two connections opened at once: small
relays cap those per user or per IP and refuse the overflow, which is answered as a
failed send and logged. So the queue is **serial** — one message at a time, after the
answer — because the relay is what has the limit and slowness costs nothing once nobody
is waiting.

**A route answering therefore says nothing about what has reached a mail server.** It
means the rows are written and the pushes attempted. A test asserting on a posted
message drains the queue first, which is what `createApp`'s `defer` is for.

Anything somebody else can put you on or take you off notifies you — a dream's
helpers, a meal's crew, a meal's lead, a lead role and its team, a dream's
facilitator. Never for your own click.

Two of the first six are different in kind: **the waiting-list ones are not caused by
an action taken against the person told.** Somebody else pays, the burn gets fuller,
and an unpaid member's standing changes without anybody touching their row — which is
exactly why they are worth sending, and why they run outside the payment's
transaction. Recording that somebody paid must not fail because a bell could not be
rung.

The burn-wide ones fan out over the attendance list, and **attendance is the whole
audience**: somebody who has not said they are coming hears nothing about that burn,
however their switches are set, and a member who leaves stops hearing about it the
moment their row goes. `notifyAttendees` is the fan-out that also writes an `activity`
line; `tellAttendees` is the same fan-out without one, which is what anything carrying a
thread uses — a comment, and since #426 saying you are coming and saying who you are.
A line beside a card would put one thing on the feed twice. They name people — "Ada offered a dream: Sauna at dawn" —
unlike the applications notification, which hides an applicant. The difference is who
is reading: these go only to people attending the same burn, who already read each
other's names on the Members page, and "somebody is coming" is not worth switching on.

**A redeploy is the one notification nobody caused.** Watchtower replaces the
container on every merge, so a boot is the event: `announceDeploy` compares the build
sha this process was given against the one the last boot recorded in `installation`.
The first boot on a fresh database records and says nothing — there is no previous
version for it to be new against. It is called from `server.ts` rather than
`createApp`, deliberately: the suite builds an app per test, and an announcement wired
into that would fire in every one of them.

**While the bar is up, every in-app link is a full load** (#566). The bar says this tab is running
code the server no longer serves, and `preact-iso` claims same-origin clicks and pushes state — so
following it to `/changelog`, or following the notification that leads there, landed on the new page
still running the old build, with the bar still up saying so. `hardenNavigation` listens for clicks
at **capture**, ahead of the router's own listener, and hands an in-app link to `location.assign`
instead. The service worker answers navigations fresh-first, so that is the new shell, and the bar is
gone on arrival because the build now matches.

One rule rather than a list of destinations, because the bar is not about the changelog: any
navigation is the natural moment to pick the new build up, and the next one after that is a
router push again like every other day. It leaves alone exactly what the browser is already
handling itself — another origin, a modifier click, `target`, `download`, a `#` on this page — and
anything outside `ROUTER_SCOPE`, which the router would not have claimed either.

What notifies today:

- **Being handed a lead role, or taken off one** — the lead column and the team
  both, and only the person it happened _to_. Not when they did it themselves:
  taking a role you want is the common case, and a notification for your own click
  is noise that teaches people to ignore the channel.
- **Being put on or taken off a meal or a dream**, on the same rule.
- **Your payment being recorded**, and the two waiting-list movements above.
- **Someone applying**, which goes to every admin, since only an admin can act on
  one — and which names nobody, because an applicant is not a member yet. A bell row
  like everything else since #326: it pushed and recorded nothing, so an admin told on
  a lock screen found an empty bell, and an application is the strongest case for
  history there is — it stays open until somebody reviews it.
- **A dream offered, somebody saying they are coming, a lead role added, a lead
  taken** — to everyone attending that burn who asked for them, never to whoever did
  it (#259).
- **A new version being deployed**, to everyone who asked, once per build. It links to
  `/changelog` since #325 — until there was a changelog, nothing in the app could say
  what a release contained, so it named no page at all.

The lead-role routes take `notify` as a dependency rather than importing the push
module. Handing somebody a role is the point and the notification is a courtesy, so
delivery failing must not fail the write — there is a test that hands the role over
with the push service rejecting every call. The team removal is idempotent, so it
notifies only when a row actually went: telling somebody they have been taken off
something they were never on is worse than silence.

These routes **moved out from under `/api/admin/`** rather than being exempted
inside it (#184), which is the rule — the prefix hook's whole value is having no
exception to forget. They are `requireApproved`, so an account with neither role is
still refused: nothing would notify them.

Browser push is the one thing in this app that reaches outward at runtime. The
notification travels via whichever push service the browser chose — Google's for
Chrome, Mozilla's for Firefox — and the container therefore needs outbound HTTPS.
Nothing has to be signed up for or configured: the VAPID pair is minted into the
`installation` row the first time an admin asks for the key, so an installation
that never turns notifications on never acquires one. That keeps `docker compose
up` sufficient, which is the same argument #59 makes for `SESSION_SECRET`.

The endpoint is **https-only**. It is the one field whose stored value the server
itself then requests, so a `http://10.0.0.5/…` there would point the container at
something on its own network. Only an approved member can write it and a real push
service is always https, so requiring the scheme costs nothing. Narrowing
past that would mean an allowlist of every browser vendor's endpoint, which goes
stale the moment a new one appears.

**The payload says only that someone applied.** No name, no contact, nothing from
the application. Push payloads are encrypted to the browser's own key, so the push
service cannot read them — but a notification is read on a lock screen, and the
applicant's details are theirs until an admin opens the page.

Sending is **fire-and-forget**. `POST /api/applications` is public and
unauthenticated, so awaiting a push service there would let a stranger make the
server wait, and a push outage would turn a successful application into an error
for the person applying. Failures go to the log and nowhere else.

A subscription the push service answers `404` or `410` for is **deleted**: the
browser has thrown it away, and keeping the row would retry a dead endpoint
forever. Any other failure keeps it — a 500 from Google is not a
reason to forget someone's phone. Subscriptions also cascade with the account, so
a deleted account leaves none behind.

The service worker is built from `apps/web/src/sw/` to `dist/sw.js` — the site
root, which is where a worker has to live to claim `/` as its scope.
`@fastify/static` serves everything outside `assets/` as `no-cache`, which is what
lets a redeploy replace it. It handles `push` and `notificationclick` here, and
caching for [offline](./the-app.md#offline-and-installing); `main.ts` is wiring to browser
events, and every decision worth asserting is in `cache.ts` and `notification.ts`
beside their tests.

**What a push says and where it lands are the server's** (#279). The payload carries
the wording, the link and the category — built by one function, `pushPayload`, and
there is one sender now that an application is a bell row too (#326), so a push cannot
carry less than the row it copies. It could before: the applications callback built its
own payload and sent a body alone. The worker routes by what it was told rather than by
a page written into it — which is what it did while a new application was the only
thing that pushed, sending a member told they were on a meal to the admin applications
page. The category is also what a notification collapses on:
three applications on a locked phone should be one line to act on, and that was the
whole point of a tag, but one tag for everything made a meal role replace a dream
offer instead.

Tapping one lands wherever costs least: the window already showing that page, else any
window of this app asked to route in place, else a new one. A new window is the worst
of the three and used to be the common one — the match was a suffix of the whole URL,
so an app open on `/meals` did not count as open for anything else, including a
notification naming no page at all. On a phone, where the worker belongs to the browser
rather than to the installed copy, that meant a browser tab beside the app that was
already on screen.

**A notification naming no page focuses a window without moving it.** `link` is null
for a category with nowhere to send anybody, and that is a different instruction from
"go to `/`": any window of this app is already the right one, and routing it would take
somebody off what they were reading. Every category names a page today — the redeploy
notice took `/changelog` in #325 — so what reaches that branch is a row written before
that, and the branch stays because those rows are still in the bell.

The move is a `postMessage` the app routes on, never `client.navigate()`, which is a
full page load and would discard whatever had been typed into a markdown editor — the
thing the dream panel was rewritten to stop doing. A window loaded before that shipped
has no listener and simply stays where it is, which is still inside the app rather
than beside it.

It was hand-written plain JavaScript in `public/` while push was all it did,
precisely because that put it outside the type-check and the suite — the argument
being that offline behaviour must not live where nothing verifies it. #256 moved
it rather than growing it there.

**Delivery itself has no test**, and cannot have one here: it needs a real browser
to produce a subscription and a real push service to accept it. What is tested is
everything around it — who may subscribe, that the payload carries no personal
detail, that an application still answers 201 when the push service is down, and
that a gone subscription is deleted while a failed one is kept. `deliver` is
injected for exactly that reason, and `web-push` sits behind it as the one place
that does RFC 8291 encryption.

## Roles

Two roles, `admin` and `member`, in `account_role`. No finer-grained
permissions — at this size they would be more to get wrong than to gain.

They are separate concepts and neither implies the other. `admin` opens the
organising pages; `member` opens a person's own details and saying they are
coming to a burn. Somebody organising but not attending is coherent, so `admin`
deliberately does not confer `member` — but the ordinary case is both, which is
why `admin:create` grants both.

## The ways somebody can be reached

`account.contact` is one free-text box, and #88 said what is wrong with it: "how can we
reach you?" as a single field produces "fredrik on discord i think" and an organiser
guessing. `account_connection` is the answer for a member, as `applicant_email` was for an
applicant (#30) — **rows, ordered, one per way of being reached**.

**Rows rather than a column per network**, and the order is why as much as the count is.
The first one is the answer to the question somebody actually has — where do I reach this
person — rather than the start of a list of everything they have ever signed up to.

**Adding a network is not free**, and it is worth being exact about, because the trap is
quiet. It is a line in `enums.ts` **and** a migration: `kind` carries a CHECK listing the
vocabulary, SQLite cannot alter a CHECK in place, so the table is rebuilt — which is what
`20260806180000_general_notifications` did when the notification categories grew. Nothing
checks that `schema.ts` and the migrations agree, so a kind added to the vocabulary alone
passes Zod and the type checker and then fails the CHECK against a database that ran the
old migration. A column per network would be that migration _and_ a wider `account` row on
the path of every read.

**The vocabulary is fixed because rendering needs it.** A handle has to become a URL, and
only the kind says how: `@wren` on Instagram and `@wren@chaos.social` on Mastodon build
different addresses, and a Discord username builds none at all. `connectionKindInfo` holds
each kind's label, icon, hint and `href`, and the `href` is allowed to answer nothing —
Discord and Signal do, because a username you paste into a search is not a link. That every
kind has one at all is the type's doing — `satisfies Record<ConnectionKind, ConnectionKindInfo>`
makes omitting it a compile error — so what `enums.test.ts` is for is the part the type cannot
say: that every href any kind builds, from anything anybody types, carries a scheme worth
sending a browser to.

**A handle is a handle with or without its scheme** (#433). A stored Mastodon address is
`@user@authority` with no separator in either half, and `connectionValue` keeps whole anything it
could not read a handle out of — so a pasted post URL reaches `mastodonHref` with an `@` in it too,
and matching on the `@` alone built a link to host `wren`. Forbidding `/` and `\` inside either
half is what tells the two apart, and dropping the scheme first would not have: `chaos.social/@wren`
is no more a handle than the URL it came from. Where it cannot tell, there is no link at all —
visibly wrong beats confidently wrong.

`link` is the escape hatch: a label and a URL somebody types. A labelled URL rather than a
free-text _kind_, because a kind nothing knows about could produce neither an icon nor an
address. It is also the only kind whose value is checked rather than merely bounded —
`isProfileUrl` allows `https` alone, since the field exists to become an `href` and
`javascript:` is what that has to refuse. Deliberately stricter than `markdown.ts`'s link
check, which governs prose where a relative path and a `mailto:` are ordinary.

**The editor offers only the kinds not already listed**, and opens on the first of them
(#418). All ten every time, with a fixed default, meant the option the form opened on was —
for anybody who had already added that one — the one guaranteed to be refused.
`kindsToOffer` is what the `<select>` draws from, and the exemption is keyed on `labelled`
rather than on `link` itself, so a second labelled kind gets it without anybody remembering
to. That exemption is also what keeps `MAX_CONNECTIONS` meaningful: nine fixed kinds and as
many links as fit, rather than a ceiling of ten that makes the constant dead. Editing a row
keeps that row's own kind in the list, or it could not be saved again. **The route still
takes a second of a kind** — this is a rule about what the form offers, `unique(account_id,
kind, value)` is unchanged, and an account already holding two Discords renders both and can
still take one off.

**A load that failed says so rather than drawing an empty list** (#395). "You have not added
any yet" for a request that never answered invites an Add that then collides with a row
nobody can see, so the editor tells the two facts apart. What it offers is read from the list
itself and never from an empty stand-in (#445): before the fix, both while loading and after a
failed load, `kindsToOffer([])` offered all ten kinds and the form opened on Email — so somebody
who already had an email row could press _Use my sign-in address_ and collide with it. The sign-in address the `email` row
can be filled from comes from the page around the editor, since `/api/auth/me` deliberately
does not carry it (#388).

**What was typed is what is stored**, and the URL is built at render. A handle is what
somebody knows about themselves; a network changing its domain is then one line in
`enums.ts` rather than a data migration. A row a linked provider brought in (#442) is stored
the same way, through the same `connectionValue`, so nothing downstream can tell the two apart.

**Every row is meant to be read by approved members**, and the editor says so. That is what
separates the list from `account.email`: the address somebody signs in with is the login
identity and stays out of what other members read (#159), while these are what the person
chose to put up — **including an `email` row**, which is an address they typed and may not
be the one they sign in with at all.

Somebody's page (#389) is what reads it: `connectionsFor` is called with whoever's page is
being looked at, and every name in the app links there. The editor's own note says what the
list is _for_ rather than reciting who can see it, which is the same sentence either way.

**The login address is in the list from the start.** Everybody has one, and a list that
starts empty is a list nobody fills in — so `loginAddressConnection` seeds an `email` row in
the same transaction as the account, on both paths that create one, and a migration
backfilled every account that already existed. It is an ordinary row from there: sortable,
editable, and removable by the person whose it is, because present by default is not the same
as imposed. The backfill puts it **last** for an account that already had rows, since
somebody who put Discord at the top chose that, and it skips an account that already has an
`email` row whatever address that holds.

**That publishes the login address, and for some accounts it is the first time.** The easy
version of this sentence is wrong, so it is worth being exact: `redemption.ts` writes
`contact: body.contact ?? body.email`, so the address usually _is_ already on the roster
through `contact` — but `contact` is editable afterwards, and anybody who replaced it with a
Discord handle or a phone number had never had their login address shown to members. #159's
decision stands for the `account.email` column, which no member-facing read selects; what
changed is that a row holding the same string is now in a list that is read.

Why it was not scoped to the accounts where the address was already public — a one-line
`WHERE account.contact IS NULL OR lower(account.contact) = account.email` would have done it —
is that a list present for most people and mysteriously absent for the rest is worse than
either, and the absence would land on exactly the people who care most about the difference
with nothing telling them why. What is owed instead is that the row is removable and that the
changelog says plainly it is visible. Both hold.

**Facebook is Messenger here.** The `messenger` kind takes a Facebook name or the number out
of a `profile.php?id=` link, and builds `m.me`. Looking at somebody's Facebook page is a
different act and not a way of reaching them, so it is not a row in this list — the page
draws that from a linked Facebook sign-in, which is the only place the app knows about one.

**Written only by the person themselves.** `/api/me/connections` takes the account id from
the session, and the `id` a caller supplies reaches only their own row because the account
is in the `WHERE` — somebody else's is a 404 rather than a write. No `If-Match`:
preconditions are for the burn's shared furniture (#274), where two people edit one thing,
and this is one record with one writer.

`MAX_CONNECTIONS` is a ceiling rather than an absence, since this is a row per click, and
`unique(account_id, kind, value)` refuses the same handle twice with a 409 — the list is
what somebody reads to know how to reach this person, so a silent duplicate is worse than a
refusal. The server assigns `order` through `nextOrder`, and a reorder names every row
exactly once or is refused, which is `ordered.ts` for the sixth list.

**`contact` is untouched.** It is required by the details page, drawn on the roster and on
the rideshare board, and `rides.ts` calls it "the one field on the account that exists to be
given out". Once there is a list of kinds, `contact` is the sentence that fits no kind, and
merging it in means touching all three — its own change, with its own migration.

## Signing in from Discord or Facebook

A third way in beside a password and a passkey (#393), and the same rule governs it: **a way
in is an extra way in, never the only one imposed** (#9). The routes sit outside both
`/api/admin/` and `requireApproved`, because the guard is being signed in at all — an account
with no role yet still has to be able to add a way in and get back in with it.

**Nothing about it is in the environment.** A client id and secret are a row an admin fills in
under ⚙️ → Settings, keyed by provider — `mail_setting`'s argument, and the VAPID pair's:
`docker compose up` has to stay sufficient, and an installation that never wants this never
has a row. Zero rows is the ordinary state. The secret is stored trimmed and never read back — the read
answers `has_secret`.

**A provider that is not configured has no button anywhere.** `GET /api/installation` carries
`social_logins` — provider names, nothing else — for the reason `sends_email` is public: the
login page draws its buttons before anybody is signed in, so it cannot ask an admin route.
Absent rather than present and disabled, which is #30's rule about the email column.

**"Configured" means both halves filled in**, not a row existing (#401). The secret is
optional on the update, so a first save that leaves it blank — or one clearing it — keeps a row
with `client_secret = ''`; selected on existence, that drew "Continue with Discord" for a trip
that could only fail. `configuredProviders` selects on both columns
being non-empty and `usableOauthSetting` is the same rule for the routes that start and finish
a trip, so the button and the journey cannot disagree.

### What it will not do

**It never creates an account.** Accounts come from the CLI bootstrap, an approved
application's invite, or a direct admin invite, and the login page says so out loud. So a link
is made from Your details by somebody already signed in; signing in matches a stored identity
or refuses. An OAuth button that created accounts would be a hole straight through the
membership gate the application form exists to be.

**It never matches on an email address.** Both providers are asked for one now, because an
account is keyed by one and sign-up goes through here — but the address makes an account, it
never finds one. Matching a provider's address to an existing account is an account-takeover
path the moment any provider hands over one it did not verify, and it would make the button an
oracle for which addresses have accounts here, which the usernameless passkey login went out of
its way not to be. An address that already has an account answers `address-taken` and says to
sign in and link the provider, rather than signing anybody in.

**It never leaves an account with no way in.** Removing an identity is refused with a 409 when
no password, passkey or other identity remains — `removePasskey`'s refusal generalised.
Somebody who set no password and linked one provider has exactly one, and losing it locks them
out of a burn they have paid for.

The check is **inside the DELETE's own `WHERE`**, as `removePasskey`'s is (#239). Read in a
statement of its own, two removals from two tabs — a Discord identity and a Facebook one, on
an account with no password — could each see the other as the survivor, both pass, and
together leave the account with nothing. These two are the only places in the app that
engineer for a race; not because either window is realistic, but because the consequence is
permanent and the password reset that would undo it is an admin's.

### The round trip

`oauth_state` is a row, and the statement that reads it deletes it — `webauthn_challenge`'s
shape, for the reason stated there: single-use is what a state is for, and a signed cookie
cannot be spent. It carries the **intent**, because signing in and linking end differently and
the caller must not be the one saying which, and the **account** that started a link, so a
callback cannot attach an identity to somebody else by arriving with a different cookie. A
CHECK enforces that a link has an account.

The redirect URI is built by the backend from `originOf` with `PUBLIC_ORIGIN` winning, and has
to match what is registered with the provider exactly — which is why the admin page prints it
rather than asking for it.

`oauth/providers.ts` is pure and `oauth/client.ts` is the only module that opens a socket,
which is what `mail/smtp.ts` and `push/web-push.ts` are for theirs. Nothing in it throws: a
provider that is down or answering nonsense costs a sign-in attempt rather than a stack trace.

**The reference is bounded before it reaches a sentence.** It lands on the _unauthenticated_
login page beside advice about the visitor's password, and a query string is anybody's to write —
so the risk is not markup, which Preact escapes, but a crafted link making the real page give
attacker-authored instructions. `quotable` lets through only the shape the backend produces,
`String(request.id)`, which is `req-N`.

**It must not cost the reason as well** (#430). `Identify` answers `{ profile }` or `{ failed }`,
where the failure names which leg gave up — the token exchange, the profile read, or a request that
never arrived — with the status and the provider's own words. A bare `undefined` had made a secret
with a stray space, a redirect URI registered slightly differently, a scope the app was never
approved for and a container with no outbound HTTPS into one indistinguishable refusal recorded
nowhere; the person who configured the provider is the person running the installation, so that was
the difference between a five-minute fix and an unfixable mystery. The route logs it, and since #440
the page says which of two kinds it was, split by **whether the person reading can do anything about
it**: `unreachable` means try again in a moment, `misconfigured` means tell an organiser and quotes
`request.id`, the `reqId` on that log line. Which status falls where is `outcomeFor`, with a test per
branch — enumerating it here as well produced a sentence that called a 429
`misconfigured` for two PRs after the code stopped agreeing. The detail itself still does not
travel; what the module _sends_ never appears in it, which `client.test.ts` pins as a whole shape
rather than field by field, because spreading the decoded body straight in is the mistake that was
made while writing it.

**A secret already stored with a stray line break does not heal itself** (#440). The trim is on
the way in, and a save that omits the field keeps what is stored — so an installation that was
already refusing every sign-in goes on refusing until an admin re-saves the secret under ⚙️ →
Settings. Deliberately not a migration: rewriting a stored credential in place is not something to
do quietly, and re-pasting it is one action for the one person who has it.

**The URLs Meta's console asks for are routes, not promises.** App review will not take an app
without a privacy policy at a URL, and Basic Settings asks for terms of service and data deletion
instructions beside it — so `PRIVACY.md` and `TERMS.md` ship with the image and `/privacy` and
`/terms` render them, public because a reviewer opens both as a stranger and a policy behind a
login is not one. They follow `CHANGELOG.md` in every respect, which is why there is now one
`routes/documents.ts` serving the three and one `MarkdownPage` rendering them rather than the
same forty lines written out three times. The admin's Facebook field prints each URL to paste
beside the redirect URI. Deliberately not admin-editable: a textarea for legal text is a promise
the app cannot keep, nothing would validate it, and an installation that emptied it would fail
app review with no explanation.

What the terms say that nothing else does: the agreement is with the people who invited you, not
with the software or anybody who wrote it, because a self-hosted gathering has no company behind
it. Everything else in them follows from the privacy policy or the licence.

**Data deletion is instructions rather than a callback**, and that requirement is already ours
rather than something a further permission would add — `public_profile` hands over an app-scoped
id and a copy of a picture, which is user data. Meta accepts either. The callback is an
unauthenticated POST defended only by an HMAC over the app secret, it needs a stored deletion
record so its status URL can answer with a confirmation code, and it would have to delete an
identity `anotherWayInSurvives` refuses to release: somebody who linked Facebook, set no password
and then revoked the app from Facebook's side is either locked out of a burn they have paid for or
answered with a refusal to justify on a status page. Signed in on their own Your details page none
of that arises, so the policy names the button and `messageForRemoval`'s 409 explains itself.

**The profile link is a setting, not a constant** (#405). `link` is not in `public_profile` —
that grants eight fields and `link` is not among them — so it takes `user_link`, which is the
admin's own trip to app review. Whether Graph omits a field the token lacks permission for or
refuses the whole read is not answerable without an unapproved app to try, and a sign-in is the
wrong place to find out: the scope is named in the authorize redirect, which leaves the browser
before this process sees anything, so an app not approved for it cannot be recovered from
server-side. Hence `oauth_setting.ask_profile_link`, off by default — an installation whose admin
never went to the console keeps exactly the sign-in it has, and `asksFor` reads the one row both
legs read so the scope and the field list cannot disagree.

`account_identity.profile_url` rather than a column on `account`, and that placement is the whole
of how deletion works: taking the way in off deletes the row, and the row is the only place the
link is. It is refreshed on sign-in as well as written at link time, which is what makes the
feature reach somebody who linked before the installation asked for the scope — otherwise their
only route to one would be to unlink and link again.

On a member's page the **typed Messenger handle wins** over it. That is not arbitrary: a handle
builds `facebook.com/wren`, which resolves for anybody, while Facebook's own `link` resolves only
for a viewer who is logged in _and_ already a friend. So the linked URL is a fallback for
somebody who never typed a handle, not an upgrade over one. `facebookProfileLink` checks the host
before it is stored, because it becomes an `href` on a page other members read.

Messenger is still not among what linking gives, and cannot be: `m.me` needs the same vanity
username the profile link would carry, and nothing in `public_profile` or `user_link` answers one
for an account that has not set it.

The client secret is **trimmed** on the way in, like the client id (#440). A provider's secret is
an issued token and its surrounding whitespace never means anything, so a newline picked up from a
copy out of the developer portal is dropped rather than stored — untrimmed it survived into the
token exchange and only that leg, since authorize uses the id alone, which produced a consent screen
followed by `401 invalid_client`. Deliberately unlike `mail_setting.password`, which is stored
exactly as given because SMTP AUTH sends the password itself and a space may be part of it; the two
should not be made consistent.

`FACEBOOK_GRAPH_VERSION` is the one value here that goes stale on somebody else's schedule.
Meta pins each app to a version and retires them, so it has to match the developer console —
check it there rather than trusting the constant.

### What linking gives you

**Your picture, if the account has none**, and — where the installation asked for it — a link to
your page there. A provider's picture is a better start than initials and never better than one
somebody chose, so an existing avatar is not even asked about. A silhouette is skipped: replacing
initials with a grey placeholder says less, not more.
Nothing in this process decodes it — the provider is asked for a 256-pixel picture, the type
must be one of the three `account_avatar`'s CHECK allows, and the length is capped at
`MAX_AVATAR_BYTES`. A failure costs the picture and never the link.

**A way to be reached, where the provider has one to give** (#442). Discord answers `username`
on the `identify` scope already asked for, so linking it writes a `discord` row — and this is
the general rule rather than a Discord case: `ProviderProfile.reach` is where a provider says
what it can be reached on, and a provider that has no such thing produces none. The alternative
was a button offering it, which is what every other rule about contact details would suggest,
since a row is published to every member and a sign-in is not a request to be. It was decided
the other way: at this size the extra press mostly costs somebody being reachable, and what
stands in for the asking is that Your details **says** it happened on the way back, with one
press to take it off.

Two properties bound it, and both come off `account_connection.from_provider`, which is null
for everything typed. **A row of that kind already there is left alone**, whatever it holds —
so nothing anybody wrote is overwritten, and nothing is added twice. **Unlinking deletes only
what the link wrote**, and a row somebody has since edited is no longer that: `updateMyConnection`
clears `from_provider`, so touching a row makes it yours and unlinking leaves it. The column
carries no CHECK on the vocabulary, deliberately — adding one to an existing table means the
rebuild described under "Adding a network is not free", and only `OAuthProvider` writes it.

**A failed contact delete is swallowed and logged, and answers 204 anyway** — the rule the linking
side already follows, so an unlink cannot leave the identity in place because a second statement
failed. It does slightly outrun what `PRIVACY.md` promises about the name going back out with the
link: only with a misbehaving database, and the member can take the row off themselves. Making the
two deletes one transaction is what would close it, and is the reason to (#471).

**Facebook writes none**, and the reason is the id it hands over: `public_profile` answers with
an **app-scoped** id, which identifies nobody outside this installation's Meta app, so
`m.me/<that>` and `facebook.com/profile.php?id=<that>` both point at nobody — and there is no
Facebook username to reach anybody by at all. So Facebook's comes from the handle somebody
**types** under How people can reach you: the `messenger` kind builds the `m.me` link in their
list, and the profile page builds `facebook.com/…` from the same value. Your details says where
to type it, next to the linking.

**The page on the profile is never taken from that id either**, for the same reason. Where an
installation has been approved for `user_link` it comes from Facebook's own `link` field (#405),
and where it has not, from nothing.

**The sign-in address is in the list without any of this**, from the moment an account exists —
`loginAddressConnection` seeds it on both paths that create one, and a migration backfilled the
rest. That is why nothing here asks a provider for an email address.

## Somebody's page

`/members/:accountId` is one person as the rest of the community sees them (#389), and it
exists because every name in the app used to be a dead end. `GET /api/accounts/:accountId/profile`
serves it, beside `accountAvatar`'s `/api/accounts/:accountId/avatar` and behind the same
`requireApproved` — a page answering "how do I get hold of this person" is exactly as
private as the attendee list it is reached from, and no more.

**The projection is an object literal**, in the manner of `asMemberEntry`. That is the
safety property rather than tidiness: this is the route every member reads about every other
member, so a column added to `account` reaches it only when somebody names it in
`personProfileSchema`. It carries `account_id`, `name`, `avatar`, the introduction, the
connections in their order, and `contact`. What is absent is absent because something else
already decided it —
`email` is the login identity (#159), allergies belong to the roster where whoever cooks
reads them as a list, `payment_status` says something about the burn rather than the person,
and `roles` change nothing on the page.

### The introduction

**A profile that lists ways to reach somebody answers "how do I contact this person". It does
not answer the question anybody actually has about a name they have not met: who is this**
(#390). That is a paragraph and a couple of pictures — the thing people post in a Discord
introductions channel and nowhere else, so it scrolls away and the next person to join never
sees it.

`account.introduction` is a **column**, not a table: one field with one owner, unlike `image`
and unlike `account_connection`. Markdown of a few thousand characters, so the argument that
keeps an avatar's bytes off this row does not reach it. `MAX_INTRODUCTION` is its own number
with its own reason — `MAX_NOTES`' 2000 is less than what is being asked for and
`MAX_DESCRIPTION`'s 20 000 is a dream's whole plan.

**Null rather than empty** for an account that has written none, which is what lets the page
tell "has not written one" from "wrote one and cleared it". `optionalText` turning `''` into
null is load-bearing here rather than tidy.

This paragraph is the home for all of that: the migration, `schema.ts`, `membership.ts` and
`person.ts` point here rather than arguing it again. Six copies is what the first version of
this feature shipped, and the migration header is the copy nobody should have to go back to —
drizzle keys on the folder timestamp rather than the SQL, so editing one is safe, but a
migration is a record of what ran and re-arguing a decision inside one invites exactly that.
`limits.ts` keeps its own reasoning, because the number is what that file is for and its rule
is that each one is named and argued where it is declared.

**The first field on an account that is neither identity, contact nor a health fact.**
Everything else there exists so somebody can be reached or fed; this exists so a name means
something.

It is edited with `MarkdownField` and rendered with `renderMarkdown`, which is the whole of
why it takes pictures: #379 taught that field to accept a paste, a drop and a photograph from
a phone, and this is the first field that exists _because_ of that rather than one that
gained it. So the Save button is disabled while a placeholder is still in the value, like
every other markdown field's.

**`requireApproved`, the same guard as the page it sits on and as the pictures inside it.**
That last part is not a coincidence: #379 chose `requireApproved` for `/api/images/:id`, so an
introduction full of photographs renders for members and would show broken images to anybody
else. This is the field where that decision pays off rather than pinches.

**Nothing renders it anywhere else** — not the roster, not a hover card, not the feed's card.
It is a page you go to, and it is long; a truncated introduction in a table cell is the shape
of thing nobody reads and everybody has to keep formatting.

**The empty state is worth more than the field.** This only works if people fill it in, so a
page with none says so — an invitation on your own, the plain fact on somebody else's.

That invitation is why `getMyProfile` and `updateMyProfile` are `requireApproved` rather than
`requireMember` (#412). An account holding `admin` and not `member` has a page of its own like
anybody else, and was being asked there to go and write an introduction on a form it could not
reach. `requireMember` on the account's own name, picture and prose was also the root of what
#396 had to work around. What stays a member's is the stay itself: `updateMyStay`,
`joinEvent`, `leaveEvent` and `transferMyPlace`.

**Nothing extra for erasure.** The column goes with the account, and the pictures written into
it cascade from `image.uploaded_by`. Both were already true; `profile.test.ts` writes a real
`image` row into an introduction and asserts both go, since "needs no cascade" is still a
claim — and a test that stored no picture would have proved only that deleting a row deletes
it.

`renderMarkdown` puts `loading="lazy"` on every image it draws, which is here rather than per
surface: an introduction is a page of prose and half a dozen photographs, and a thread is as
many as anybody has posted.

**An introduction is a feed entry, on the card of every burn somebody is coming to** (#426).
It went the other way from the guess recorded here: not a line on the burn's own thread but a
second `entity_type`, `attendance`, so joining and introducing yourself are one card. The
worry that "an edit is not an event, so it fires once and never again" is answered by
coalescing — a rewrite bumps the same card rather than adding to it — and `introduction_written`
is `about: 'else'` and off, exactly as #259 says. "Somebody's own card" in `docs/the-app.md`
has the rest.

**Every picture in a row renders as a wall of full-width images.** A row of thumbnails is the
obvious next thing, and it is a rendering decision — so it belongs to `markdown.ts`, and
everything else that draws pictures gets it too.

**Every name links to it, and mostly through one component.** `PersonBadge` already drew a
face and a name together (#301), so making it an anchor linked a dream's helpers, a meal's
crew and a lead role's team at once — and anything built with it later is linked without
anybody remembering to. The rest were done by hand: the two roster tables, a comment's
author, a name on the rideshare board, and the faces on an open dream.

Two deliberate exceptions:

- **The circle in the corner of the bar** goes to `/profile`, not here. It is reliably you,
  and what somebody wants from their own face is the page where they change it.
- **The facilitator on a schedule chip** is not a link. That face sits inside a grid cell
  whose whole job is to open the dream, and an anchor there would take the click that does
  it. The name is a link in the panel the chip opens, which is where somebody can follow it
  without losing the dream.

A deleted author stays plain text — "Somebody", with no page left to point at — because a
link to nowhere is worse than none.

**The page is in the offline cache**, unlike a thread (#375) or a stored picture (#379). The
growth argument that excludes those does not reach it: there are as many of these as there
are accounts, a few dozen, each a few hundred bytes — so the cache does not grow with use
the way a key per dream ever opened does. Looking up how to reach somebody with no signal is
most of what the page is for.

## What a member may change

This replaces a shared spreadsheet where everyone could edit everything except
paid status, so the default for the burn's **shared furniture** is any approved
member — not admin:

| Open to any approved member                        | Still admin                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Schedule places, per burn                          | The burn's shape: name, slug, dates, gate times, `member_cap`, and creating one |
| The lodging and helping lists                      | Payment                                                                         |
| A burn's welcome text                              | Applications, invites, role grants, installation settings                       |
| The lead-roles register                            |                                                                                 |
| Who is coming, by name                             |                                                                                 |
| Reading the roster, bar the payment date and email |                                                                                 |

"Approved" means **`member` or `admin`**, and the second half is load-bearing.
The roles are independent — the accounts table grants either on its own, and
somebody organising but not attending is coherent — so an account can hold `admin` and
not `member`. A `member`-only guard would lock that person out of setting the burn
up. That is `requireApproved` in `auth/guards.ts`.

(`admin:create` grants both, as [Roles](#roles) below says, so the account an
installation starts with is not the example. The example is anyone given `admin`
afterwards without `member`.)

Personal details stay the person's own: nobody edits somebody else's name, contact
or allergies.

**A member reads the roster, minus the payment date and the email** (#159). Whoever cooks needs
the allergies, and that is why allergies live on the account rather than per burn.
The write does not open with it: somebody else's stay stays theirs, through the
`PATCH /api/events/:eventId/attendance/me` they already have, and adding or removing
someone else is still admin's.

`GET /api/events/:eventId/members` serves it, **outside the admin prefix rather than
exempted inside it** — the hook's whole value is having no exception to forget. There
is no `active` variant: the burn selector names the burn, so the route never has to
guess which one.

**`payment_status` is shown to everyone.** Having paid is the definite mark of
somebody actually joining, and it was a column everyone could read in the spreadsheet
this replaces. What stays admin's is _recording_ it, which is the `PATCH` and not this
read. The page prints a word rather than a tick, since a checkbox reads as something
to click and this is the one column here nobody may change.

Two columns come off the admin's row:

- **`payment_date`**, because when a transfer landed is bookkeeping. The status
  answers "are they in"; the date answers a question only whoever reconciles the
  account is asking.
- **`email`**, which is the login identity rather than a way of reaching somebody.
  `profileUpdateSchema` refuses to change it for that reason, and `contact` is the
  field a person fills in to be contacted. The member page has no fallback to it,
  where the admin's shows it when a name is missing.

`waiting` stays, because a waiting list is only any use to the people on it.

The projection is `asMemberEntry` in `roster.ts`, written out field by field. That
is the safety property, not tidiness: it is an object literal against
`MemberRosterEntry`, so a column added to the admin's row reaches members only
when somebody names it there, and one removed from the member schema stops compiling
rather than quietly still being sent. Both views run the same `rosterFor`, so the
order — which decides who has a place — cannot come out differently on the two pages.

**`avatar` was added to it deliberately** (#305), which is what naming every field is for: it
is a projection change rather than a permissions one, since an approved member can already read
any attendee's avatar through `GET /api/events/:eventId/attendees`. Both roster tables draw a
face beside the name now, through one `PersonCell` — so the two cannot come to disagree about
what a person looks like in a table row.

The admin's roster keeps its own route, its payment control and its CSV. The CSV's columns are
typed `keyof RosterEntry` (#148), so renaming a field stops compiling instead of exporting a
column of empty cells.

What a member reads elsewhere, more narrowly, is **who is coming, by name**:
`GET /api/events/:eventId/attendees` returns account ids and display names and
nothing else. The lead-roles register has to offer somebody to hand a role to, and
that is the whole of what it needs. It is a separate route rather than a relaxed
roster on purpose — a route that selects two columns cannot leak a third by
someone later returning whole rows, and `attendance.test.ts` asserts the body
carries no contact, allergies or payment state.

Two consequences worth knowing rather than discovering.

**The burn's shared furniture is written under a precondition** (#274). Each of the
reads a shared page makes — the grid, the dream pool, the lead-roles register, the
meal plan, the lodging and helping lists, the active burn — answers with an `ETag`
over the representation itself, and each of the writes that _replaces_ a value the
author was shown quotes it back as `If-Match`. Nothing is stored for it: the tag is
a hash of the body the `GET` would send, so there is no column to migrate, nothing
for a write to remember to bump, and reordering a whole collection is covered by the
same tag as renaming one row in it. The `GET` and the guard go through one function
per family, which is the only way the two can be kept saying the same thing.

Sending no `If-Match` is refused as well, with 428. That is deliberate rather than
strict: a write with nothing to assert is a write made against nothing, and treating
the header as optional would mean forgetting it on one route silently restores
last-write-wins there.

Both refusals carry the resource **as it now stands**, and its new tag. So a page can
say what the other person wrote rather than only that somebody did, and a retry costs
no extra read.

**A successful write carries the next tag too** (#277). A single-row write answers
with the row while the precondition is over the whole collection, so the tag it hands
back is the collection's — `withCollectionVersion`, which re-reads what the guard
already read once. Without it these routes answered 200 with no `ETag` at all, and a
second edit before the page reloaded refused _itself_ with "Somebody else changed
this". The longer fields — the welcome text, the words above the meal table —
keep what was being typed and show the other version beside it; a refused click just
warns and catches up, because there is nothing there worth reconciling.

This deliberately reverses the rule that this app does not engineer for races. #256
made staleness a _designed_ property — what is on screen may be five minutes old, and
offline arbitrarily older — so a lost update stopped being a same-millisecond
coincidence. Creating, deleting, and taking or leaving a job are untouched: they add
or remove rather than replace, and nobody's words disappear into them. So are
somebody's own record and the admin-only writes, where the only person who could
collide with you is you on a second device.

And deleting a helping option takes every member's ticks for it with it — `attendance_helping` cascades — so a
member can now remove something other people signed up for. That follows from the
spreadsheet default rather than being an oversight, and it is the same trust the
lead-roles register assumes in #27.

The welcome text is edited **on the homepage**, where it is read — whoever spots a
typo is the one likely to fix it — through `PATCH /api/events/:id/welcome`. The way in
is a ✏️ rather than a sentence: a text button under a paragraph, in the paragraph's own
face, read as the last line of it. The meal plan's intro carries the same pen for the
same reason. An admin
can also edit it under Organise → Events, alongside the dates and the cap, which
goes through the admin `PATCH` with everything else. That is
a route of its own rather than a carve-out in the admin `PATCH`, and the reason is
the paragraph below: opening one field of the admin route would move the burn's
shape out from under the prefix hook and turn its protection back into a branch. A
`.strict()` body means a `member_cap` sent there is a `400`, not a dropped key.

**Every route under `/api/admin/` requires `admin`, whether or not the route
asked.** One `onRequest` hook on the prefix, rather than a `preHandler` per
route: opt-in protection is a line a new route has to remember, and forgetting
it ships that route world-readable — nothing type-checks it, nothing fails, and
the tests written beside it pass. There is a test that registers a route and
never guards it, and it is refused.

The hook keys on the matched route's own pattern, so an encoded path cannot step
around it. It covers the bare `/api/admin` as well as everything beneath it — an
admin index page is the obvious route to add next, and matching only
`/api/admin/` would have let exactly that one in unauthenticated. For an
unmatched path the hook still runs, since the not-found handler inherits the same
`onRequest` chain; there is simply no route pattern there to match. A Fastify
plugin scope would be the more idiomatic seam and is weaker here — it covers
what is registered on it, so a future route declared on the root instance with
an `/api/admin` path would slip past. The prefix is what the paths already agree
on.

One consequence worth knowing: `onRequest` runs _before_ body parsing, where a
`preHandler` ran after it. A caller with no session gets 401 rather than a parse
error describing their own JSON, and the body of an unauthorized request is
never read at all.

Organise → the **Accounts** table sets them, a checkbox per role per account.
`PUT /api/admin/accounts/:id/roles` takes the whole set the account should end
up with, not a delta: the editor sends what the row now says, so it cannot
express "add admin, forget to remove member".

Removing the last `admin` is refused with **409**. The count is taken inside the
transaction, after the write, so the rule is decided against the state the write
actually produced; a `throw` rolls it back. Two admins stepping down at the
same moment leave one, and a test asserts it.

Nothing stops an admin removing their _own_ `admin` while another exists —
that is stepping down, not a lockout.

**The viewer is resolved once per request.** A guard answers 401/403 from it and
then has no way to hand it on, so the handler behind it used to ask again — two
identical session+roles joins on every authenticated request, and the admin prefix
hook made it two before the handler even ran. `viewerFor` now answers a repeat ask
from a `WeakMap` keyed on the request object (#139), so the guard and its handler
share one query and the entry goes when the request does. Told apart with `has`
rather than a truthy `get`: a token that is valid but stale — signature good, account
deleted — resolves to `undefined`, and on `get` alone that would pay for the join
every time it was asked.

It lives in `auth/viewer.ts` rather than `routes/auth.ts`, where it began. The guards
need exactly this, so a guard was importing from a route file — `auth/` depending on
the thing it exists to protect.

Authorization is a `preHandler` on the route, not a hidden link:
`/api/admin/*` answers **401** with `{ "error": "unauthenticated" }` when nobody
is signed in and **403** with `{ "error": "forbidden" }` for a signed-in account
without the role. The two are different on purpose: 401 is a client's cue to
send the visitor to login, and 403 must never be — that would bounce a member
around a loop logging in again cannot fix. That is the contract, not yet a
description; the web app currently renders both as a message rather than
redirecting.

The web app hides what a viewer cannot use, but that is presentation. Every
admin route refuses server-side regardless of what the nav rendered.
