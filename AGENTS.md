# sage-burner

Membership, application, and scheduling platform for small "burner"-style
mini-events (up to ~42 members, up to 4x/year). Replaces a spreadsheet +
Discord workflow with a single self-hosted app.

Conventions here deliberately track the sibling project `aurboda` so both repos
feel the same to work in. Where this repo diverges, it says so and why.

Two deliberate divergences from aurboda:

- **Node 24 LTS, not 25.** Odd-numbered Node lines never become LTS and stop
  receiving security patches roughly six months in; 25's window closed in
  June 2026. This app holds contact details and allergies, so it runs on a
  supported runtime. Type stripping is on by default in 24, so the
  no-build-step decision is unaffected.
- **No nginx in the container.** One Node process serves the API, the SPA and
  the ICS feed. The app is small enough that a second process buys nothing but
  moving parts.

## Repository structure

- `apps/backend` — Fastify API. Also serves the built web app and the ICS feed.
- `apps/web` — Preact + Vite single-page app.
- `packages/shared` — Zod schemas and inferred types, shared by both.
- `docs/` — longer-form documentation.

One Node process serves everything in production.

## Shared schemas and types (`packages/shared`)

`@sage-burner/shared` is the single source of truth for validation schemas and
type definitions. All layers import from it — never duplicate a schema.

- Backend imports the **schemas** (runtime validation at the HTTP boundary).
- Web imports **no Zod**. Types always; runtime values only from modules that do
  not pull Zod in — today `enums.ts` (the vocabularies and `tickBoxRequired`),
  `answers.ts` (`answerProblems`, `isTickBox`, the application form's `MAX_*`
  limits), `limits.ts` (bounds the schemas and the forms share), `media.ts`
  (what an uploaded icon may be, and `flameIcon` — the app's own mark, which the
  backend serves when nobody has uploaded one), `routes.ts` (`apiRoutes`, every
  endpoint's path and verb), `pages.ts` (the client-side paths a link is built from),
  `mentions.ts` (the `@[Name](mention:id)` token, which `markdown.ts` renders),
  `dates.ts` (`dayName`, which names a plain calendar day for the backend's meal cards
  and the web's day headings alike), `meetings.ts` (`meetingEnds` and `nextMeeting`,
  which decide what the banner shows), `songs.ts` (`isChordLine` and `transposeLine`,
  which the songbook renders with), `roster.ts` (`withPlaces`, which draws the line between a
  place and the waiting list) and `cards.ts` (`whereItBelongs`, which names the burn a feed
  card is about for the page and the digest alike). Nothing under `schemas/`.
- **Every endpoint lives in `routes.ts` and nowhere else.** The client builds its
  path from it and the route file registers `fastify` from it, so the two spellings
  of one endpoint cannot drift; `routes.test.ts` checks that each built path routes
  to its own registration. The `/api` prefix and the per-segment encoding belong
  there too — encoding was a per-call-site chore in 61 places, which is 61 chances
  to leave one off. Adding a route means adding it there first.
- Field names are `snake_case` everywhere: schemas, REST API, DB columns, JSON
  keys, frontend types.

This is aurboda's `api-spec` idea without the OpenAPI/Kotlin generation — we
have no third client and no public API contract to publish.

The package sets `"sideEffects": false`, and that is load-bearing rather than
tidiness. `index.ts` is `export *` over twelve modules, so importing any runtime
value goes through a barrel whose schema modules evaluate `z.object(…)` at module
scope; without the flag Rollup must assume those are side effects and keeps them,
pulling Zod into the main chunk — which is not code-split, so it reaches the
public homepage. Measured on the `apps/web` bundle: 150,493 bytes with Zod
against 79,826 without. Both halves are needed — moving a value out of a schema
module without the flag, or the flag while the value stays put, each still ships
Zod. Verify with `pnpm --filter sage-burner-web build` and grep the bundle, not
by reading Rollup's docs.

## Data model rules

- **Never hardcode a single event.** `event` exists from day one; the whole
  point is that this recurs up to 4x/year.
- **Every burn-scoped route takes an event id** (#184). `activeEvent` decides only
  what the public homepage and the ICS feed are about; the selector in the bar
  supplies the id for everything a signed-in member looks at. Routes keyed by a bare
  id resolve the burn from the row and refuse one that has **ended** — `openEvent`,
  not `activeEvent`, because a grid is laid out and a dream offered months ahead.
- **Payment is per `attendance`** — one row per `(event, account)` — not a
  global "has this person paid" flag. The same human may attend several burns and
  pays separately for each.
- **The `account` carries the person**, `attendance` carries one stay. Name,
  contact and allergies describe a human and live on the account; arrival,
  lodging, shifts and payment describe a visit and live on the attendance. Held
  per burn, allergies meant a copy per event and correcting one left the others
  wrong.
- **The application form is data, not code.** `form_question` rows are
  admin-editable — adding or reordering a question must never require a
  redeploy.
- Store data normalized: reference entities by id rather than duplicating
  mutable fields, and resolve names at query time.

## Code style

- Prefer functional style. No classes.
- Prefer code that is testable without heavy mocking — pass dependencies
  (db handle, clock, config) in as arguments rather than importing singletons.
- Avoid global variables, module-level mutable state, and singletons.
- Avoid casting. Use proper typing and type guards.
- **Write no comments.** Not "few", not "only the good ones" — the default is
  none, and the bar for an exception is that **a future coding agent could not
  work out what is going on without it**. Nothing softer qualifies: not helpful,
  not clarifying, not "worth recording". They are not typed and not tested, so
  they rot while the code moves, and every one is a claim nothing verifies. The
  reader here is an agent that reads the code, the types and the tests faster
  than prose about them.

  A comment you are tempted to write is nearly always a name, a type, a test or a
  `docs/` paragraph that has not been written yet:

  - **a name**, if it would say what a block does;
  - **a type**, if it would say what a value may be;
  - **a test**, if it would say what must hold — a test name is a sentence that
    fails when it stops being true, which is the one kind of prose this repo can
    trust;
  - **`docs/`**, if it is a paragraph of reasoning. That is where the _why_ of a
    feature belongs, and pointing at it beats copying it. **A `docs/` paragraph
    replaces the comment; it does not license one beside it.**

  Delete on sight, without weighing whether it is nice to have: anything
  restating the code or a well-named symbol; history ("used to be", "before #N",
  which PR moved what, what a thing was called before); how a bug was found; an
  alternative the compiler already rejects; a rationale that belongs in `docs/`;
  an issue number as decoration; the second and third paragraph of anything;
  **every comment in a test whose name already says what it asserts.**

  The one thing that survives is a line where the code's **absence** is
  deliberate and an agent would otherwise "fix" it — a cascade not added, an
  `await` not awaited, a guard whose omission is intended, a constant that looks
  wrong and is not. Nothing in the code or the tests can say "this is on
  purpose", so one line may. One line, and only where a test cannot say it
  instead.

  **`styles.css` is the one exception, and it is a decided one** (#436). CSS has no
  types and no tests, and a selector cannot say why a rule is the way it is — why
  `border-collapse: separate` is load-bearing under a sticky cell, why a size
  modifier must sit _below_ `.avatar`, why `touch-action: none` is there. There is
  nowhere to move those claims to, so they stay. What still goes are the labels that
  only name the block the selector already names.

  Most of the tree predates this and is far heavier than it should be. Thin it
  wherever you are editing anyway, and never match the surrounding density.

- `pnpm fix` formats and auto-fixes lint. `pnpm check` verifies formatting,
  type-checks, and lints — it is the same gate CI runs, so a green `check`
  locally means a green CI.
- Per-package `check` runs `oxlint --type-aware`, which needs `oxlint-tsgolint`.
  Type-aware rules — `no-floating-promises` in particular — are silently skipped
  without that flag, so keep it on any new package's `check` script.

## Testing

- Write the unit test first where reasonable — it pressures the design toward
  clear dependency injection.
- The backend should be well covered.
- Always run tests non-watch (`pnpm test`, `pnpm check`) so no process hangs.

### Claims must be executed, not reasoned about

Roughly seventy review threads across #73 and #74 were one failure repeating:
**behaviour changes, and its description somewhere else goes one step stale.**
These are the habits that would have caught nearly all of them.

- **Never write a claim you have not run.** Any "this catches X", "without this,
  Y", or "the failure mode is Z" gets the mutation applied and the suite run
  _before_ the sentence is written. This caught a test that passed against the
  very implementation it existed to reject, and stopped an overstated claim about
  what a boundary test covers. A failure mode described from memory has been
  wrong more often than right here — including twice in the same direction.
- **A rejecting test needs a passing sibling.** Two real defects hid behind this:
  the event's date-ordering guard had a test proving it refused a one-sided move
  and none proving it allowed an ordinary one, in either direction. Refusal cases
  are easier to think of, so the success path is where the gap lands.
- **After changing behaviour, grep for the old vocabulary _and_ for the claim.**
  The names are the easy half: function names, status codes, the terms the old
  design used. The harder half is prose that describes what the removed thing
  _did_ without naming it — "it does so inside the UPDATE", "this is what stops a
  concurrent write". Those survive a rename and go on asserting a guarantee the
  code no longer gives. Prose at a distance does not fail to compile, and a
  comment naming the wrong thing is worse than none because the next reader
  trusts it.
- **Prefer deleting the thing that needs syncing over syncing it.** Every durable
  fix in those PRs was this shape: one `tickBoxRequired` replacing the same rule
  written out in four places; `.returning()` removing the `changes` coupling and
  the three comments describing it; scoping a pre-read removing a stub duplicated
  across three tests. If a comment has to keep being corrected, the code is
  telling you something.
- **Comments must not reference branch state.** "this branch", "two commits ago",
  or a symbol the PR deletes all dangle after the squash merge. Write what is true
  of the merged tree.
- **Gate the push on `pnpm check`, not on an `echo` beside it.** Two commits went
  out red from exactly that shell mistake:
  `if pnpm check >/dev/null 2>&1; then git push …; else echo "refusing"; fi`.
- **A mutation that does not apply looks exactly like one that was caught.**
  Every "0 failed" is a result to check, not to celebrate: the anchor may have
  gone stale after `pnpm fix` reflowed the line, the mutation may be rejected by
  a schema before it can take effect, or deleting a whole `export const` line may
  break the import so the suite never runs. Assert the anchor was found, and be
  suspicious of a mutation that kills nothing in code you believe is load-bearing.
- **Mutate the migration, not `schema.ts`.** The test database is built by
  `runMigrations` from the generated SQL and never reads the Drizzle schema at
  runtime, so deleting a `check(...)` there fails nothing — not because the
  constraint is covered but because the mutation had no effect. A CHECK is only
  exercised by a write that skips the API; pair each one with a direct
  `client().prepare(...)` test.
- **A timezone-dependent test in a UTC runner is not a weak test, it is no test.**
  `apps/web` pins `TZ=Europe/Stockholm` in `vite.config.ts` for exactly this: in
  UTC every wrong implementation of a local-time conversion looks right.
- **Adding a function above an existing one steals its doc comment.** The
  orphaned block then reads as though it describes the new function, which is
  worse than no comment because it is plausible.

## Security expectations

These are member records, so treat them as such:

- Authorization is enforced **server-side** on every route. Hiding a button is
  not access control.
- **A member may write their own record, and the burn's shared furniture.** This
  app replaces a spreadsheet everyone could edit, so the default for something the
  community shares — the schedule lanes, the lodging and helping lists, a burn's
  welcome text, the lead-roles register — is any approved member, not admin. What
  stays admin is the burn's shape (dates, times, cap, creating one), payment,
  applications, invites, role grants and installation settings. Personal details
  stay the person's own: nobody edits somebody else's name, contact or allergies.
- `requireApproved` is the guard for that default, and counts `admin` as well as
  `member`. The roles are independent — the accounts table grants either on its
  own, and somebody organising but not attending is coherent — so an account can hold
  `admin` and not `member`, and a `member`-only guard would lock them out of
  setting the burn up. Neither role implies the other anywhere else.
- Everything under `/api/admin/` requires `admin` through one `onRequest` hook,
  with no per-route opt-out. **Opening a route means moving it out from under that
  prefix**, never exempting it there — the hook's whole value is having no
  exception to forget.
- Invite tokens are CSPRNG-random and unguessable, single-use, and expiring.
- **A forgotten password is reset by email, and the route says nothing about who exists**
  (#738). One token with the invite token's properties — CSPRNG, stored hashed, single-use,
  expiring — and 204 whatever the address turns out to be. Every read of the account happens
  on the email queue after the route has answered, so the time taken cannot answer the
  question the body refuses to; minting drops the account's earlier link, spending it is a
  `DELETE … RETURNING` in the transaction that writes the password. Offered only where an
  admin has configured SMTP, which is #30's rule about a control that cannot do anything.
- **A passkey is an extra way in, never the only one imposed.** Passwords and
  passkeys coexist per account (#9), so the routes live outside both `/api/admin/`
  and `requireApproved` — the guard is being signed in at all, because an account
  with no role yet still has to be able to add one and get back in with it. Login
  is usernameless, so nothing there can be asked "does this address have an
  account". Challenges are rows and the statement that reads one deletes it;
  single-use is what a challenge is for, and a signed cookie cannot give it.
  Removing the last passkey off an account with no password is refused.
- **A notification is a row; a push is a copy of it** (#248). The bell needs history
  and a push does not have any. Written before the push, so an unreachable push
  service cannot cost somebody the record. A category somebody does not want is not
  written at all.
- **A stored setting is an explicit choice, not a mute** (#259). What happens _to you_
  is on unless refused; what happens _around you_ is off unless asked for, bar
  `meeting_scheduled`, which is on because a meeting nobody heard about is a meeting
  nobody comes to. One list of
  exceptions cannot mean both, so `notification_setting` carries `enabled` and absence
  means "has not said" — the default lives in `notificationCategoryInfo`, and the wire
  carries the complete `{ on: [...] }` rather than a delta. **Attendance is the whole
  audience** for the burn-wide ones: somebody who has not said they are coming hears
  nothing about that burn, whatever their switches say.
- **Any role somebody else can change tells the person it happened to** (#247). One
  control everywhere several people sign up — 🙋 takes the spot, 👉 appoints somebody
  else, ✕ takes them off — and every route behind it notifies, on being _given_ a job
  and on being taken off one. A filled one-person spot offers only ✕, so a handover is
  two steps and both ends hear about it. Never for your own click: taking a job you
  want is the common case, and a notification for that teaches people to ignore the
  channel. The write must not fail because a push service did.
- **Push is any approved member's**, not admin's (#184). The routes are
  `/api/push/…`, moved out from under the admin prefix rather than exempted inside
  it. `notifyAdmins` fans out over the notifier and `notifyAccount` is the delivery
  loop it lands in; the lead-roles routes take `notify` as a dependency so the write
  cannot fail because a push service did, and never notify somebody about their own
  click.
- **The viewer carries `name`, and nothing else personal.** `/api/auth/me` returns
  `{ account_id, name, roles }` — the name for the initials in the corner, which
  every page renders, and which every other member already sees on the Members
  page. The email stays out: it is the login identity, and a member's own record is
  a separate authorised read.
- **A member may read who else is coming, by name.**
  `GET /api/events/:eventId/attendees` returns account ids and display names and
  nothing else — the register has to offer somebody to hand a role to. It is a
  separate route rather than a relaxed roster because a route selecting two columns
  cannot leak a third.
- **A member may read the roster itself, minus the payment date and the email**
  (#159). `GET /api/events/:eventId/members`, outside the admin prefix rather than
  exempted inside it. Whoever cooks needs the allergies, which is why those live on
  the account. **`payment_status` is shown to everyone** — having paid is the
  definite mark of actually joining, and it was a column everyone could read in the
  spreadsheet this replaces; what stays admin's is _recording_ it. `payment_date` is
  bookkeeping, and `email` is the login identity rather than a way of reaching
  somebody — `contact` is that. The projection is `asMemberEntry` in `roster.ts`,
  an object literal against
  `MemberRosterEntry`, so a column added to the admin's row reaches members only
  when somebody names it there; spreading the row and deleting keys would not have
  that property. The two views share one query, so the order — which decides who has
  a place — cannot come out differently on the two pages.
- **What the offline cache holds is a sign-out question** (#256). The service
  worker keeps two caches, and the split is the whole of what stays on a device: the
  shell, bundles, manifest, icon and banner survive a sign-out because none of it is
  anybody's data, and the cache holding every API read — the roster, the schedule,
  who you are — is deleted whole on the way out. Whole rather than by URL: entries
  picked out by path would be a list to keep in step with the routes, which is the
  kind of list that goes one route stale. Deleted _before_ the logout request, since
  that is the half that has to happen.
- **The app icon is the admin's to break** (#256). An uploaded SVG is stored as
  authored — rasterising a logo defeats uploading one — so it can carry script.
  Bounded rather than sanitized: an SVG cannot execute as a manifest icon or in an
  `<img>`, only as a top-level document, and that route is closed by serving the
  icon `Content-Security-Policy: default-src 'none'; sandbox`. Uploading is
  admin-only; reading is public, because a browser fetching an icon for a home
  screen carries no cookies. Nothing in this process decodes an image, exactly as
  with avatars.
- **A crawler reads the shell, so the shell has to say who this is** (#306). The
  card a shared link draws is `<meta>` tags injected by the backend, because nothing
  the SPA applies after load ever reaches one. Injected from **one** handler that
  both the registered `/` and the not-found handler call — into one of the two makes
  sharing the bare domain work while a deep link does not. The origin comes from
  `Host`, with `PUBLIC_ORIGIN` winning, since this app has no notion of its own
  address and `og:url` and `og:image` must be absolute; a `Host` that is not
  hostname-shaped gets neither tag rather than a URL nobody can fetch. The banner is
  the icon's pipeline with a narrower type — JPEG, because no crawler draws an SVG,
  and a banner that leaves the card blank is the bug this fixed.
- **Email is optional, admin-configured, and never fails a write** (#30). The SMTP
  settings are a singleton row an admin fills in, not an environment variable — so
  `docker compose up` stays sufficient and an installation that never wants email
  never has one. The password is stored as given, because SMTP AUTH sends the
  password itself, and it never leaves the process: the read answers `has_password`,
  and a save that omits the field keeps what is stored. The test button posts to the
  **admin's own** address rather than one they type, since a send-to box on an admin
  page is an open relay with extra steps. A mail server that is down costs a message
  rather than a record — the rule push already follows — and since #356 a
  notification's send does not happen inside the request at all: it goes on a queue,
  one message at a time, so a burn's fan-out cannot dial the relay once per attendee.
  A route answering therefore no longer means the posting has happened, which is why
  `createApp` takes `defer`. `mail/smtp.ts` is the only module that opens a socket,
  exactly as `web-push.ts` is.
- **The email column on the notification settings is a channel of its own** (#30),
  independent of the bell, and **off for every category but one until somebody asks** —
  so an upgrade is never what starts posting to somebody's inbox. Absent where the
  installation has no mail server, rather than present and inert: a switch that cannot
  do anything reads as a promise. The one exception is `application_news` (#739), because
  an applicant has no browser registered for push and no habit of opening the app, so a
  reply on their application reached nobody at all; the default sits in
  `notificationCategoryInfo` beside `on`, so the next category has to decide both.
- **The digest is the one thing that is on by default** (#620), and the exception is
  deliberate: it is **only what you have not seen, and only when you have not been
  here**, so the people it reaches are exactly the people who have stopped opening the
  app and will therefore never open the settings to switch it on. An upgrade does start
  this one. Everything above still holds for the per-category column, which is an instant
  copy of each notification. `account.digest` is nullable — absence is "has not said" and
  `DEFAULT_DIGEST` decides what that means — and `docs/accounts.md` carries the rest.
- **An invite is posted to the address the applicant gave** (#30), and the raw token
  is still in the approval's response either way. `applicant_contact` became
  `applicant_email` because once the app writes to it, an address is the one thing
  it must have; rows written before that hold phone numbers and Discord handles, so
  `looksLikeEmail` decides whether one is worth posting to. The invite form starts
  from that address as well as the name — the reversal of an earlier decision, and
  not an enumeration oracle: nothing takes an address and says whether it has an
  application, it takes a token nobody can guess.
- Markdown is sanitized before rendering, and members author it too — any longer
  field shown to other people is markdown. `markdown.ts` escapes raw HTML rather
  than filtering it and allowlists link schemes, so untrusted authors are inside
  what it defends against; that is why it was chosen over `marked` + DOMPurify.
- The public ICS feed exposes session title, description, time and location —
  never member names beyond the host's display name, contact details,
  allergies, or payment state.

## Git workflow

- Base branch is `develop`. `main` holds released state.
- **Never push directly to `develop`.** Always a PR.
- **Never alter already-pushed commits.** No amend after push, no force push.
- **Never rebase. Always merge.**
- Merge the latest `origin/develop` into the branch before pushing a PR update.
- Branch naming: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<slug>`.
- Commit and PR titles use conventional-commit style: `feat(members): ...`.

## Working an issue: merge on approval

This project works **merge on approval**: once an issue is ironed out and assigned,
take it end to end, up to the merge. A webhook service reviews every ready PR
automatically, so getting one reviewed, approved and ready needs nobody's attention.

**The merge itself needs the go-ahead, and "merge on approval" is it.** Said once it
stands for the whole run — the PR in hand and every later one in the same session,
including a queue worked off the Ready column. Do not ask again per PR; that is the
confirmation step those words remove. Without them, take the PR to `✅Approved` with
every thread resolved and CI green, then stop and say it is ready. The rule lives in
`~/.claude/CLAUDE.md` and holds for every project; it is spelled out here because
this repo's flow is built around it.

1. Sync: `git checkout develop && git fetch origin develop && git reset --hard
origin/develop`. Reset rather than pull — squash merges make local `develop`
   diverge.
2. Branch off `develop`.
3. Implement, tests first where reasonable.
4. `pnpm fix && pnpm check && pnpm test` all green locally.
5. Open a **Draft** PR against `develop`, body containing `Closes #<issue>`.
6. Watch CI — all of it, not one named check. Red → fix and push. Green →
   `gh pr ready <n>`.
7. Wait for the review by tailing `/home/fiddur/src/codereview/events.log` for
   the line `<pr url> updated` — do not poll GitHub on a timer. (`review
started` means it has only begun; keep waiting for `updated`.)
8. Read the review body **and every inline comment**. Fix genuine
   correctness/security findings; for trivial or subjective nits, resolve the
   thread with a brief rationale. Resolve every inline thread via the GraphQL
   `resolveReviewThread` mutation.
9. Any push starts a fresh review round. Repeat from step 7.
10. **Merge, without asking again**, once "merge on approval" is standing and all
    four gates hold:
    - the latest review body starts with `✅Approved`, **and** it is on the
      current head commit (a `✅Approved` left on an older commit is stale),
    - every inline review thread is resolved,
    - **every** check is green — not a named one. `CI Gate` runs the tests,
      but `build` is what proves the image starts, and naming only the first
      would let a red `build` through. Check the whole rollup:
      `gh pr view <n> --json statusCheckRollup`.
    - `mergeStateStatus` is `CLEAN`.
      Then `gh pr merge <n> --merge`. Never `--admin`. Avoid `--auto` — a push
      clears it and the PR sits `BLOCKED`. Never the `merge` skill either: it is
      `disable-model-invocation: true`, so only Fredrik can run it, and waiting on
      him to type `/merge` is the stall this step exists to prevent.
11. If `BEHIND`: `git fetch origin develop && git merge origin/develop
--no-edit`, re-run `pnpm check`, push, and re-confirm the gate from step 7.
12. After merge: `git checkout develop && git fetch origin develop && git reset
--hard origin/develop`, delete the merged branch, and pick up the next
    assigned issue.

The gate is not optional. "Merge on approval" removes the human confirmation
step, not the review — never merge an unapproved PR, and never merge with open
threads or red CI. It removes that step for the run rather than for one PR: having
been told once, asking again on the next PR is the same failure as never asking.

**Most of it is enforced now.** The `CI and PR` ruleset targets the repository's
default branch — which is `develop` — and enforces, with no bypass actors:

- a pull request, merge-commit only (so step 10's `--merge` is the only method
  the platform will accept),
- both checks, `CI Gate` and `build`, strictly — so the branch must also be up
  to date with `develop`,
- resolution of every review thread,
- no force-push, no branch deletion.

That covers three of step 10's four gates. Two things remain unenforced:

- **No approval is required** (`required_approving_review_count: 0`). GitHub will
  not let an author approve their own pull request, and every commit and review
  here is authored by the same account, so an approval requirement would deadlock
  rather than protect. The `✅Approved` gate is therefore discipline, and this
  document is the only thing enforcing it. The review agent's verdicts are
  `COMMENTED`, not `APPROVED`, so they would not satisfy the setting even if it
  could be turned on.
- **`main` is unprotected**, deliberately for now — deployment runs from the
  `:develop` tag, so `main` is unused. `GET /repos/fiddur/sage-burner/rules/branches/main`
  returns nothing: no required check, force-push and deletion both allowed. Set
  it up before the first promotion to `:latest`.

So a green rollup means the tests passed, the image starts, and the threads are
closed. It does not mean anything reviewed the change.

This paragraph caches an answer that actually lives in repository settings, and
it has already gone stale several times while being written. Check rather than
trust it:

```sh
gh api repos/:owner/:repo/rules/branches/develop --jq '.[] | "\(.type): \(.parameters // {} | tojson)"'
```

(Beware `// empty` as a jq fallback: `empty` produces _no_ outputs, so any
expression needing a value from it yields nothing and the whole surrounding
output disappears — silently, and still exiting 0. Substituting
`.parameters.required_status_checks // empty` into the interpolation above drops
every rule that lacks the field, which reads as a ruleset that does not have
them.)

## Deployment

- Merge to `develop` builds and pushes `fiddur/sage-burner:develop` to Docker
  Hub. Watchtower on the server polls every 5 minutes and redeploys.
- Merge to `main` promotes the image to `:latest`.
- The app is served at a **domain root** — there is no sub-path/`BASE_PATH`
  handling, deliberately.
- No external services are required to run it: no payment gateway, no external
  database — and nothing to sign up for. **Three** features reach outward at runtime
  and all three are optional and configured from inside the app, never from the
  environment. Browser push (#96) goes to the push service the _browser_ chose, so the
  container needs outbound HTTPS; the VAPID pair is minted into the database the first
  time an admin turns notifications on, and an installation that never does never
  acquires one. Email (#30) goes to whatever SMTP the people running the gathering
  already have, set under ⚙️ → Settings and stored in `mail_setting`; with no row
  there, no invite is posted, no notification is, and nothing else changes. Signing in
  from Discord or Facebook (#393) goes to that provider, with the client id and secret
  a row per provider in `oauth_setting`; with no row there the button does not appear
  and nothing is ever asked of the provider. `mail/smtp.ts`, `push/web-push.ts` and
  `oauth/client.ts` are the only three modules that open a socket, and each is injected
  at `createApp` so the suite never leaves the machine.
- `docker compose up` must be sufficient — with one current exception: the app
  refuses to start without `SESSION_SECRET`, so a bare clone needs it generated
  first (the README's Deploying section is one `sed` line). Failing loudly beats
  minting an in-memory secret that logs every member out on each redeploy;
  minting one into the data volume would restore the invariant, and #59 tracks
  that decision. Do not read this as licence for a second exception.

## Documentation

Keep `README.md` and `docs/` current when behavior changes. If a change makes
the README's setup instructions wrong, it is not finished.

**`docs/features.md` is the feature map** — one or two lines per feature, in
user terms, linking into the area docs. A change that adds, removes or renames
a feature updates it in the same PR; the detail and the why stay in the area
docs, never copied here. **`docs/testing.md` is the tryout protocol** built on
that map: when a feature's observable behaviour changes, the check that
exercises it changes too. A check that can be an automated test belongs in the
suite, not in the protocol.

**`CHANGELOG.md` is part of that** (#325). Anything a member would notice gets a line
under today's date, newest first, written for the people using the app rather than the
people building it — a refactor gets none. The app serves it at `/changelog`, and it is
where the "a new version is out" notification and the redeploy bar both lead, so an
entry that is missing is a release that says nothing about itself. There are no version
numbers to keep in step: every merge to `develop` deploys, so a date holds however many
deploys it holds.
