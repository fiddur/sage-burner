# Tryout recipes

Everything a tryout of this app has had to learn the hard way: selectors, API shapes, fixtures,
oracles and traps, grouped by area. Read the section for the area the PR touches before writing
a script. Each entry keeps the `(#PR)` it came from, so the tryout that learned it can be found.

These were learned against a Docker image and a compose stack; the rig is now the checkout
itself. [`AGENTS.md`](./AGENTS.md) has the mapping table. Where a translation has not been
exercised since, the entry says `(untested from source)`.

[← back to the tryout brief](./AGENTS.md)

## Finding the truth in the source

- **Route names are not paths.** `packages/shared/src/routes.ts` is the single register of every
  endpoint — grep it before guessing. Traps that have caught runs: a burn is created at
  `POST /api/admin/events` (not `/api/events`), the viewer is `GET /api/auth/me` answering
  `{viewer}` (not `/api/me`), the login route is `/api/auth/login` (there is no
  `/api/auth/sign-in`), and there is **no `DELETE /api/admin/events/:id`** at all — seeded burns
  stay (#780, #730, #828).
- **Page paths come from `packages/shared/src/pages.ts`, and the nav lies.** The sidebar entry
  "Leads" is `/roles?burn=`. A wrong path renders a friendly "Nothing here", so a selector sweep
  comes back with zero matches that read exactly like "the feature is missing". Check the path
  before filing (#729).
- **Read the web sources from the repository** — `apps/web/src/…` is right there. The dist
  sourcemap is still the way to check what the **built** bundle contains:
  `apps/web/dist/assets/index-*.js.map`, `JSON.parse(...).sourcesContent[i]` for `sources[i]`.
  That is how `RECENTLY_GONE_DAYS = 30` in `Songs.tsx` was found, and how "which pages call
  `getSessions`" was swept to prove none was left unfiltered (#780, #791).
- **The live z-index scale needs no browser**: `curl` the `/assets/index-*.css` named in
  `GET /`, strip comments, regex the rules, read the rungs (#729).
- **Proving a PR is comments-only takes one grep, not a parser**:
  `git diff A B -- '*.ts' '*.tsx' ':!*.test.ts' | grep -E '^(diff|[-+])' | grep -vE '^[-+]\s*(//|\*|/\*)'`
  — if only `diff --git` lines survive, every changed line was a comment. Do **not** reach for a
  TypeScript scanner: `createScanner` is context-free, a template literal puts it in a bad state,
  and it emits whole file sections as one "token" (#729).

## Driving the browser

### Mechanics that silently do nothing

- **CSP blocks an injected `<style>` tag.** Use the CSSOM (`sheet.insertRule`) instead.
- **`page.evaluateOnNewDocument` observing `document.documentElement` does nothing at all** — it
  runs before the HTML is parsed, so `documentElement` is still null and `observe` throws inside
  the init script. Observe `document`, and put a `requestAnimationFrame` sampler beside it so a
  flip that comes and goes inside one batch is still caught. That pair is _the_ oracle for "was
  it drawn and then taken away on load?": an empty flip list on a load that ends with the element
  absent is the state-initialiser-not-an-effect claim, proved (#694).
- **Puppeteer pages share one cookie jar**, so a "signed out" page in the same browser is still
  signed in. `browser.createBrowserContext()` per persona (a signed-out check once passed
  silently with a full member sidebar) (#694).
- **A `page.click` on a panel underneath another panel is eaten in silence.** Before concluding
  "the ✕ does nothing", hit-test it: `document.elementFromPoint(centre of the button)` returned
  `H2.` from the dream panel stacked over the meal's ✕, and `button.click()` through `evaluate`
  then behaved correctly (#760).
- **Bottom-nav click theft.** At a 430px viewport a `boundingBox().y` of ~968 in a 1000px window
  is _under_ the bottom bar, so `elementHandle.click()` lands on `/schedule` and the page
  navigates; the error surfaces several steps later pointing at the wrong line.
  `el.evaluate((e) => e.scrollIntoView({ block: 'center' }))` before every click, or run the
  whole flow at 1280px where there is no bottom bar. Re-`evaluateHandle` a button immediately
  before clicking, too — `MarkdownField` re-renders on input and detaches handles taken before
  typing (#791, #569).
- **A trusted `page.click` and a synthetic `el.click()` give different answers** (0→645 vs 0→0
  on one scroll check), so run a behavioural matrix with real taps (#770).
- **A viewport meta means nothing in headless Chromium unless mobile emulation is on.**
  `setViewport({ width: 360, isMobile: true, hasTouch: true })`, and then
  `document.documentElement.clientWidth` is the oracle — 360 with the meta, **980** without. The
  physical type size is `fontSize × (360 / clientWidth)`, so 16px renders as 5.9px. For the
  old-vs-new pair, strip the meta out of the captured HTML with a string replace and render both
  files (#718).
- **`innerWidth` reading 377 at a 360 viewport** means something overflowed and the mobile visual
  viewport zoomed out. Walk `getBoundingClientRect().right > 361` to find it (that found #803, an
  admin-only `.copy-from` select with a long option label — unrelated to the PR under test) (#802).
- **A grid block can be in the DOM and off every screenshot.** `.schedule-grid` is ~6000px tall
  with internal scroll, so `fullPage` shows only midnight. Select the element
  (`button.dream-open` inside `span.dream-chip > div.dream-stack > td.schedule-cell`),
  `scrollIntoView({ block: 'center' })`, _then_ shoot (#780).
- **The app renders dark under both `prefers-color-scheme` emulations** — do not read that as a
  dark-mode bug (#627).

### Measuring what is actually drawn

- **For a CSS claim about ink, measure ink, not boxes.** `page.screenshot({ clip, encoding:
'base64' })`, then in-page `new Image()` → `canvas.drawImage` → `getImageData`; take the corner
  pixel as background and scan each element's own columns for the first and last non-background
  row. Constrain the scan to a **y-band around that element's own rect** (±3px) — otherwise an
  unfolded list sharing the ♡'s columns is read as part of the glyph and the centre comes out
  ~20px low (#705).
- **Screenshot before mutating**, or the picture shows the comparison state rather than the
  shipped one (#705).
- **Cross-check ink against boxes where you can.** `heartTopFromFoot` per `align-items` (baseline
  5px, flex-start 0px, center 4.8px) is width-independent, so once it is measured a phone run adds
  nothing (#705).
- **Reachability is `document.elementFromPoint`** at the element's own centre, plus
  `panel.scrollTop = ±9999` to see which way the overflow can be scrolled: past a scroller's
  **bottom** is reachable, past its **top** is not (#705).
- **A `position: sticky` element in a grid area is bounded by that area, not the viewport.** The
  sidebar is un-pinnable at the document end, so its overflowing entries come back there — check
  top, middle **and bottom** (#694).
- **Narrow-main clipping is usually a non-finding**: tables sit in `div.table-wrap`
  (`overflow-x: auto`). Walk the ancestors for `scrollWidth > clientWidth && overflowX in (auto,
scroll)` before filing (#694).
- **For any absolutely-positioned popover**, loop every instance at 390px and compare
  `getBoundingClientRect().right` with `documentElement.clientWidth`, plus `scrollWidth` before
  and after. That found #822 (#820).
- **"The reader's font size set large"** is CDP `Page.setFontSizes({ fontSizes: { standard: 24,
fixed: 24 } })` and a reload. It moves the root `rem`, which is what proves a `rem` token keeps
  up with a measured box (header 65px → 97px against a `calc(4rem + 1px)` token) (#733).
- **Pin the `<pre>` height** to prove which `ResizeObserver` fired.
- **The first ~700 characters of `document.body.innerText` on any page are the burn `<select>`'s
  option list.** Slice further, or read the element you actually mean (#787).

### Intercepting and faking

- **The service worker defeats request interception.** `page.setBypassServiceWorker(true)`
  **before** `page.setRequestInterception(true)` (#530, #674).
- **A `fetch` wrapper installed by `evaluateOnNewDocument` runs before the service worker**, so it
  needs no interception dance at all. `await sleep(ms)` when `url.includes('/api/images') &&
method === 'POST'` makes an upload's busy states observable — "Sending a picture…" vs "Sending
  pictures…", the disabled picker, the `stillUploading()`-held Save. Returning a synthetic
  `new Response(…, { status: 500 })` from the same wrapper drives the refusal path (#625, #716).
- **Timing beats flicker-hunting.** To prove "the page waits for X", delay that one request by 3 s
  in the wrapper and record `applicationResolved` / `burnsResolved` / `statusFirstSeen`:
  `statusFirstSeen >= burnsResolved` with the other data in hand at 154 ms is the whole proof, and
  a mid-hold screenshot shows the deliberately blank `<article class="column" />` (#720).
- **Repair a POST body in flight** with request interception to pin a double-JSON-encoding
  api-client bug (#659).
- **A form's own guard can hide the branch you mean to test.** `AdminInvites` refuses a past date
  client-side ("That date has gone…"), so the server's `expired` branch needs a _valid_ future
  date plus interception answering `{"error":"expired"}` vs `{"error":"bad_request"}`. The live
  server check (stale date → `expired`, blank label or cap 0 → `bad_request`) is a separate leg
  (#720).
- **Three-state `/api/installation` rig** for "pending" vs "unreachable": one page normal, one
  whose interception handler does `setTimeout(() => req.continue(), 6000)` (still "One moment…"
  at 2.5 s), one that `req.abort('failed')` (flips to the ask-an-organiser copy and stays there at
  7 s). The handler also catches `/api/installation/icon` (#756).
- **Faking the new-version bar**: intercept `/api/version` and answer a different sha from the
  second ask, then in-page `Date.now = () => real() + 61_000` and
  `window.dispatchEvent(new Event('focus'))` beats the 60 s throttle.
  `window.__docMarker` plus a count of main-frame navigation requests separates a router push
  from a full load (#824, #569).
- **Speed up a 60 s poll without touching its `Date.now` throttle**: wrap `setInterval` in
  `evaluateOnNewDocument` so `ms === 60000` runs at 6000. Ticks every 6 s prove the interval is
  un-throttled, while a dispatched `focus` 2 s after an ask stays silent — the floor is the
  listeners' alone (#828).
- **Clock skew** for anything date-dependent: a `Date` Proxy installed before the document (#550).
- `page.on('request')` needs no interception at all and is often enough — it showed the account
  page posting `{name, email, allergies_notes, allergy_item_ids}` on **every** Save, which is what
  made "a name edit must leave the seeded address alone" checkable (#769).
- **Watching non-GET `/api/*` responses** is the cheap oracle for _which_ thread a comment landed
  on (#791).

### Files, clipboard and the keyboard

- **`waitForFileChooser`** for the label-wrapped hidden file input (#625). The picker is labelled
  (`input[aria-label="Add a picture to <subject>"]`) and `elementHandle.uploadFile(a, b)` drives it
  straight through `class="visually-hidden"`; two paths exercise the `multiple` picker in one go
  (#716).
- **Overlapping upload batches** — the case a boolean `busy` cannot tell apart — need `paste`,
  because the picker is disabled while any upload is in flight: build files in-page with
  `canvas.toBlob` and dispatch `new ClipboardEvent('paste', { clipboardData: transfer, bubbles:
true, cancelable: true })` at the textarea (#716).
- **Unmounting a focused input DOES fire `change`/`blur`/`focusout` in Chromium** — listen on the
  node itself and read the value back from the API. A save-on-blur field survives Escape, the
  backdrop, Back and walking off (this contradicted a review claim in #778) (#770).
- **Browser scroll restoration is a measurable suspect**: set `history.scrollRestoration =
'manual'` before the trip and re-run — if an odd landing disappears it is Chrome's restore, not
  the app. `overflow-anchor: none !important` through the CSSOM rules out scroll anchoring the
  same way (#770).

## Auth, sessions and accounts

- **Mint your own session cookie.** The token is
  `base64url(JSON{sub, exp, jti}) + '.' + base64url(HMAC-SHA256(secret, thatPayload))` — the whole
  format. The rig's secret is `sessionSecret` in `$TRYOUT_DIR/state.json`, so any
  age-of-cookie or expiry question becomes an exact experiment: choose `exp` and the server's view
  of the cookie's age follows (`slid` derives the issue time as `exp - SESSION_TTL_SECONDS`).
  **Mint and send inside the same process** — minting in one shell call and curling in the next
  drifts by seconds, which is enough to cross an 86400 s boundary and fake a result. A token for
  an account that does not exist still exercises everything above the database (`viewer: null`,
  and the renewal hook still fires), so a fresh empty rig needs no seeding (#787, #729).
- **Roleless accounts are the free 403 fixture.** `POST /api/auth/sign-up` (`{email, password,
name}` — without `name` it is a bare `400 bad_request`) answers 201 and sets the session cookie,
  with roles `[]`. That account renders **no** `.menu-wrap` and no `.bottom-tab` at all, which is
  the "the drawer disappears for the unapproved" claim (#802, #702).
- **Never pass an explicit `undefined` for a no-cookie test.** `const post = (id, body, cookie =
TOKEN)` takes the **default** on an explicit `undefined`, so the "unauthenticated" case silently
  ran as admin and looked like a 200 auth hole. Do the no-cookie and garbage-cookie cases in
  `curl`, where nothing can default (#783).
- **A days-old `token.txt` is a free aged-cookie fixture.** Decode it (`echo "${T%%.*}" | base64
-d`) before assuming it is fresh. To prove a renewal really outlives the original, mint a token
  expiring in ~120 s, renew it, wait past the original `exp`, and show the old one answering
  `{"viewer":null}` while the renewed one still names the account (#787).
- **Browser-side cookie oracles**: `page.setCookie({ httpOnly: true, url })` before navigating;
  `page.cookies(BASE)` afterwards returns `expires` (epoch) plus `httpOnly`/`secure`/`sameSite`,
  so the jar itself proves the lifetime slid. `page.on('response')` plus
  `res.request().headers().cookie` shows **which token each request carried** — that is what showed
  one renewal on the first `/api` call of a stale visit and every later call already carrying the
  new `jti`, rather than a `Set-Cookie` per parallel request. `res.fromServiceWorker()`
  distinguishes the SW-served `/api/installation/icon` (no cookie) from a real network hit (#787).
- **Log masking is a countable claim.** Ask on `/forgotten`, pull the link out of the SMTP sink,
  `page.goto` it the way a recipient would, then `grep -cF "$TOK" "$TRYOUT_DIR/server.log"` → **0**,
  with `GET /reset/[redacted]` in the line. The control that it is not blanket redaction is
  `/apply/<token>`, which stays in the clear. The **empty-`$TOK` trap**: an empty `$TOK` matches
  every line, so assert the token is non-empty first. `GET /api/events/:id/calendar` answers
  `{token}`, and `/calendar/:token/schedule.ics` is a fifth token-carrying path nobody has masked
  (#774) (#769, #751, #824).
- **Passkeys end to end** are CDP: `WebAuthn.enable` plus `addVirtualAuthenticator { ctap2,
internal, hasResidentKey, hasUserVerification, isUserVerified }`, then
  `input[name="passkey_label"]` and "Add a passkey" on `/profile`, delete the cookie, "Use a
  passkey" on `/login` → lands `/feed`. A 48-byte pkcs8 private key out of
  `WebAuthn.getCredentials` means Ed25519 (alg −8 was picked). `POST /api/me/passkeys/challenge`
  by curl needs an `Origin:` header or it is a 400 (#828).
- **An OAuth round trip** is drivable in a probe that builds the app with a faked
  `oauth.identify`: `createApp({ db, config: createConfig(), oauth: fakeIdentify })` against the
  live database, then `app.inject`. `app.inject` plus `Promise.all` is enough concurrency to open
  the `await openInvite` window that an over-redeeming invite race needs (#720).

### Applications, invites and the roster

- **A fresh approved member, the app's own way** — what the brief asks for whenever a journey must
  not start as the demo admin: `POST /api/auth/sign-up` (returns the session cookie in
  `set-cookie`) → `POST /api/applications` with `{applicant_name, applicant_email, answers: {},
asked: []}` (an empty answer set is valid whenever `GET /api/questions` is empty, which it is on
  a fresh rig) → demo admin `GET /api/admin/applications`, match on `account_id`, then
  `POST /api/admin/applications/:id/approve`. **The approve needs a body** — a bare POST with
  `content-type: application/json` is a 400, so send `-d '{}'` (#707, #780, #769).
- **Approval grants `member` and runs `joinTheNextBurn`**, and that join is what creates the
  account's **`attendance` feed card** — on whatever burn the app picks, not on yours.
  `POST /api/admin/events/:id/attendance {account_id}` adds somebody to a burn but writes **no
  thread**, so an attendance-card test has to hunt `entity_type === 'attendance' && link ===
'/members/<id>'` across the whole feed rather than filter by `event_id` (#707, #783).
- **The `/apply` state machine, end to end by API**: sign-up → application → approve (grants
  `member`) → `PUT /api/admin/accounts/:id/roles {"roles":[]}` gives the "let go" state, and
  putting `member` back flips the _same_ row to "You are in". That round trip is the proof the
  page reads roles rather than the decision. A PATCH on the account 400s — it is a PUT.
  `GET /api/me/application` sends `organisers` **only** when the row is `rejected` (#737), so the
  let-go page names nobody (#733, #783).
- **Group invites**: `POST /api/admin/invites/group` wants `{label, max_uses, expires_at}` (not
  `uses`/`expires_on`) and answers `{invite: {token}}`. `POST /api/invites/:token/redeem`
  **creates the account itself** (`email`, `password`, `name`, `allergies_notes`, optional
  `join_event_id`) — no sign-up first — and answers `{viewer: {account_id, …}}`, not `{account}`.
  It 400s unless `allergies_notes` is sent explicitly (nullable but not optional). Redeeming one
  group link N times is N real `member`-role accounts with cookies, no admin grants needed
  (#730, #702, #679).
- **Fixture budget**: `REDEEM_BY_IP` is 20 per 10 minutes per IP, so minting members through group
  links runs out mid-run. Plain sign-up accounts are enough for waiting-list notification
  fixtures, but `/members` is member-gated, so a roster read needs a really-redeemed member
  (#720).
- **Seed an account with `password_hash NULL`** straight into SQLite to model somebody who arrived
  by provider or passkey: login 401 → reset → `$scrypt$…` → login 200 is the "gives a password to
  an account that has none" proof (#740).
- **An applicant who arrived on an invite link and is still pending** is its own fixture — the
  state between redeeming and being decided on, which neither a plain sign-up nor an approved
  member reaches (#576).
- **The roster read is `GET /api/accounts`**; `GET /api/accounts/:id/profile` answers
  `person.card_thread_ids`; `GET /api/events/mine` rows are `{event, attendance}`, not bare events
  (#824).
- **Waiting-list singular/plural in one burn**: `PATCH` (not PUT)
  `/api/admin/events/:id/attendance/:accountId/payment` fires `tellAboutTheWaitingList` on every
  status flip, so with `member_cap: 3` and three attendees, paying the first yields "has 2 places
  left, and **they go** to whoever pays" and paying the second "has 1 place left, and **it goes**"
  (#729).
- `tellAboutTheWaitingList` counts `member_cap - paid` while `withPlaces`
  (`packages/shared/src/roster.ts`) ranks paid-first by `joined_at` and marks `waiting = index >=
cap` — that contradiction is #726, and the shape of it is worth re-checking whenever either
  moves (#720).
- **Force a `joined_at` tie** with a direct SQLite write when the ordering is what is under test
  (#562).

### Password resets

- **Seed the reset row instead of running the mail rig** when the token itself is all you need.
  The database keeps only `digestOf(token)` (sha256 hex), so an insert into `password_reset`
  (`token_hash, account_id, expires_at, created_at`) makes any string a genuine outstanding link —
  `GET /api/auth/resets/<token>`, the `/reset/<token>` page and the POST all honour it. A negative
  hours offset gives `expired`; POSTing the password gives a genuinely **spent** link, which is the
  only honest way to reach the `unknown` copy (#769).
- **The throttle budget is the binding constraint**: `RESET_BY_IP` is 10 per 15 minutes and
  `RESET_BY_ADDRESS` 5 per hour, so a script of a dozen asks silently starts 429ing mid-run and
  mail stops arriving. Restarting the server (`tryouts/up.sh`) clears the in-memory counters
  without touching the database. **Always assert on the ask's own status**, or "no mail arrived"
  looks like a broken feature (#740).
- **The privacy/timing oracle**: interleave N known-account and N stranger asks and compare the
  _sets_ of `{status, body, header-names}` plus mean ms — 204, empty, identical headers, and 2.54
  against 2.91 ms is the "never says whether an address has an account" claim done properly (#740).
- **Reset lifecycle from the rows** (a read-only `node:sqlite` probe): two asks → 1 row and the
  first token 409s; `PUT /api/admin/accounts/:id/password` → 0 rows and the outstanding link 409s;
  a successful claim → 0 rows on its own (#756).
- `offerAReset` reads `config.public_origin` directly, deliberately **not** `originOf`, so the
  reset mail needs the rig restarted with `PUBLIC_ORIGIN` set (#756).

## Mail and the digest

- **The SMTP sink is the whole rig.** A `node:net` server in the test process, bound on
  `127.0.0.1:2525`, with a mutable `mode` flipping 250-queued to 550-refused between steps.
  Point the app at it with `PUT /api/admin/installation/mail {host: '127.0.0.1', port: 2525,
secure: false, username: '', from_email, from_name}` — `username: ''` skips nodemailer auth
  entirely, and the field is **`from_email`, not `from_address`** (a 400 otherwise). `DELETE` the
  same path restores `{"mail":null}` afterwards (#676, #740).
- **Leave the box as you found it**: `DELETE FROM mail_setting` (or the DELETE route) when you are
  done, or the next run inherits a mail server pointing at your dead sink (#769).
- **The email leg is deferred onto an in-process queue**, so wait ~3 s after the trigger before
  reading the notification log (#676).
- **Links in mail need `PUBLIC_ORIGIN`.** With it unset every absolute link is silently omitted,
  which makes a mail-link claim unfalsifiable. Restart the rig with
  `PUBLIC_ORIGIN=http://127.0.0.1:8082 tryouts/up.sh` — the database survives, so the session does
  too. The no-origin run is worth keeping as its own evidence: it _is_ the "takes no href without
  an origin" branch. `knows_own_address` on `GET /api/installation` is the flag to watch flip
  (#718, #740).
- **Tokens in mail are split by a quoted-printable soft break** (`=\n`). Un-QP before regexing, or
  you extract a truncated token and every later assertion lies — a truncated token reads
  `unknown`, which looks exactly like the feature working. The decode is byte-wise (#746, #633).
- **`POST /api/admin/installation/mail/digest {"hours": N}` is a far cheaper digest than a sweep**
  — no seeding, no `dueForDigest` window to satisfy — and `hours` picks the section sizes: 24
  gives `> MOST_PER_SECTION` sections (remainder lines), 1 gives one-line sections (#718).
- **`feedSince(db, { after: null, origin })`** from `mail/digest.ts` prints the digest lines
  without sending anything, and `sweepDigests` from the same module runs the real nightly pass from
  a probe. `createDb({ url })` returns a **handle**: `const db = createDb({ … }).db` (#702, #730,
  #633).
- **Digest-window fixtures**: four accounts with `digest_sent_at` NULL / 2 days / all-old / weekly,
  and a two-night sweep driven by a future `at`. `laterOf(last_active_at, digest_sent_at)` is what
  the window is measured from, so both columns need placing. Backdate rows to put the cut exactly
  where the claim is (#651, #659, #668).
- **Section headings** come from `feedKindLabel`: Dreams, People, Posts, Songs, Bring, Points,
  Meetings, Leads, Meals — no "Burns" (#729).
- **`post` cards alone carry `link: null`** (`threads.ts`), so every printed Posts line in a digest
  is a bare `<li>` with nowhere to go — that is #724 (#718).
- **The one-mail oracle is a pair**: the sink's captured message count across the trigger _and_ the
  `emailed` column on the matching `GET /api/admin/notification-log` row. The whole point of #741
  is that those two numbers now agree (#746).
- **A fixture that discriminates every address claim at once**: sign up a fresh account and apply
  with `applicant_email` **different** from the sign-in address (`x.form@example.org` vs
  `x.signin@example.org`), so "writes to the address the form gave" is visible in the envelope
  (#746).
- **`PUT /api/me/notification-settings` is a full replacement** of `{on, email, digest}` — a
  `{category, enabled, email}` body is a 400. Drop `application_news` from `email` and an approval
  sends **zero** mail with the bell row still landing (#746).
- **`GET /api/me/notification-settings` on an account with zero `notification_setting` rows answers
  `email: ["application_news"]`** — that is the whole email-by-default proof, and the pre-merge
  control is one seeded row (`enabled 1, email 0`), which drops an approval from two mails to one
  (#740).
- **The `/profile` → Notifications Email column and the "A summary by email…" select only exist
  when SMTP is configured** — check them with mail settings in place, then remove them again
  (#718).
- **The legacy no-account path** (an application with no account behind it, for the invite mail) is
  one insert with `account_id NULL` (#746, #633).
- **To force `originOf` to answer `undefined`** — the "mail goes without its action link" branch —
  send `Host: not a host!`. `originOf` (`shell.ts`) falls back to `request.headers.host`, and the
  host pattern is `/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i`. **Node's `fetch` silently drops a
  custom `Host`** (it is a forbidden header) and the linked branch comes back instead, reading
  exactly like the feature not working — so it has to be `curl -H`. Use
  `execFileSync('curl', …)` with `-w '<<%{http_code}>>'` and **no** `-o /dev/stdout` (that pair
  exits 23 after the request has already succeeded) (#756, #746).
- **Letter footers, proved within one account**: reply to the applicant while pending → "Nothing
  else is sent to you"; approve (grants `member`); reply again → "You can turn these emails off
  under Your details → Notifications". Same route, same code path (#769).
- **The rejection letter reads `are on your page.`** (full stop, no button in the HTML) against
  `are on your page:` plus a link from the same route with an origin — that pair is the whole
  link/no-link claim (#756).
- **A decision posts `decisionMessage` _and_ the notification mail**, same link, seconds apart. A
  link followed a second time hits the `unknown` branch, whose copy tells you to check you copied
  all of it; the accurate "used already" sentence hangs off the POST's 409, reachable only by
  racing a spend against an open form (#740, #745).
- **The mail viewport**: see the mobile-emulation note under _Driving the browser_ — a captured
  message rendered without emulation reports a 980px `clientWidth` and the type size is wrong by
  the ratio (#718).

## Push and notifications

- **Chrome has no Push API in incognito**, and every `browser.createBrowserContext()` page is
  incognito, so `pushManager.subscribe` there dies with `AbortError: Registration failed -
permission denied` (the console says so outright). Drive the real round trip in
  `browser.defaultBrowserContext()` with `overridePermissions(BASE, ['notifications'])` — then
  `POST /api/push/subscriptions` really fires. Fresh contexts remain right for everything else:
  one per "sitting" resets `sessionStorage` (`sage-burner:push-nudge-later`), and
  `overridePermissions(BASE, [])` **denies** notifications, since CDP grants the listed ones and
  rejects all others (#702, #579).
- **A real subscribe leaves the environment.** The endpoint is the browser's own push service
  (`fcm.googleapis.com` for Chrome), and the accepted/gone/failed endpoints the older runs used are
  on `httpbun.com` (httpbin 503s). Both are outside a Trusted allowlist — say "not drivable here"
  rather than skipping quietly (#579).
- **`offline.ts` registers `/sw.js` on every page load**, so "did _this component_ register a
  service worker?" needs a counting wrapper installed by `evaluateOnNewDocument` around
  `navigator.serviceWorker.register`: 1 call means only `offline.ts` ran, 2 means the component did
  too. One wrapper around **both** `navigator.serviceWorker.register` and
  `Notification.requestPermission` answers "does anything ask the browser?" — `main.tsx` registers
  unconditionally (1 call, active registration) while a member with nothing ticked drives 0
  permission asks (#702, #729).
- **The bell cadence** is drivable by hand: define `document.visibilityState` through
  `evaluateOnNewDocument` and dispatch `visibilitychange` (it **does not bubble** — listen on the
  right target) plus `focus`, then log `/api/me/notifications` request times. It is a long
  (~5 minute) single-browser run, so start it and do non-browser work while it goes. Real-Chromium
  `visibilitychange` does reach window listeners (#824, #639, #649).
- **Notification defaults decide the fixture.** `meeting_scheduled` is the only `about: 'else'`
  category that is `on: true` in `notificationCategoryInfo` — it reaches attendees holding **zero**
  `notification_setting` rows, which is the cheapest live proof of a default-audience claim.
  `meal_taken` and `post_written` are **off**, so a burn-wide meal notification or a post bell line
  needs the watcher opted in first; `post_comment` is on by default and about-you, so a second
  account's comment reaches an announcement's author (#729, #705, #730).
- **`followed_by_me` is not the 🔔 glyph** (which is `on || following`) — click
  `button[aria-label^="Notification settings"]` and read the "Notify on replies" checkbox (#679).
- **The notification log's `told`/`suppressed` counters per batch expose the waiting-list dedupe**:
  bell-off members are `suppressed` on _every_ recompute, bell-on ones once. To prove the bell half
  and the email half share one log row, give one account bell-off + email-on and another both on:
  one row, `told 1, suppressed 1, emailed 2`. Sample the log by timestamp (`created_at > mark`)
  with ≥1 s between steps — the API has no cursor (#679, #676).
- **Four mail states worth driving** for the `emailed` column: no mail server (emailed 0, zero SMTP
  connections), taken (1), refused (0, and the server log shows `"reason":"Message failed: 550 …"`),
  and nobody ticked the box (0, zero connections) (#676).
- **`@everybody` fan-out**: `@[everybody](mention:everybody)` (`everybodyToken()`) expands to the
  burn's **attendance minus the author**, so plain sign-up accounts added with
  `POST /api/admin/events/:id/attendance` are enough — no roles needed to be notified (#676).
- **The send-that-refuses-everybody-else trick** sweeps one account out of dozens of due ones, and
  `last_active_at` is an oracle a page-fetch wrapper cannot fake (#639).
- **Trim a bell to exactly N rows** to drive panel geometry: one `PUT /api/meals/:id/lead`
  there-and-back writes two `meal_role` lines, and `DELETE /api/me/notifications/:id` removes the
  surplus (#705).
- **Bell panel**: `a.bell` opens `.bell-panel`, desktop only — under 45rem the bell is a link to
  `/notifications`. **Escape closes the whole panel**, so close a row menu by clicking its own
  `button.notification-menu-button` again. The push nudge is `aside.push-nudge`; a pathname-only
  re-ask isolates the subscriber push (#705, #579, #550).
- **Seed notifications straight into SQLite** when the point is the panel, not the path that filled
  it (#550).
- **Faking a redeploy banner** and the version bar: see _Intercepting and faking_ (#550, #824).

## The feed and threads

- **`GET /api/feed` answers `{threads: […]}`** — not `feed`, not `cards` — each carrying `id` (the
  thread id), `entity_type`, `entity_id`, `entries[]`, `support_count`, `supporters[]`, `last_at`.
  **It takes no `?burn=` filter**: passing one silently yields nothing, which reads exactly like
  "the card was never made". Match on `thread.burn === burn.name` client-side instead.
  `?kinds=<kind>` **is** honoured, and returns more rows than the unfiltered first page — so
  comparing filtered card titles against the unfiltered feed invents "strays"; assert on
  `[.threads[].entity_type] | unique` (#702, #718).
- **The feed is the only source of thread ids** (#668).
- **Match feed cards by `entity_id`, never by title** — copied roles share titles (#679).
- **`GET /api/feed` returns `cards.filter((card) => !card.gone)`**, so a gone card is on no feed
  page and `mail/digest.ts` skips them too. The **only** surface for a tombstone is
  `GET /api/threads/:id` — and for a `meeting` or a `point` even that 404s, because `deleteMeeting`
  runs `forgetThread` in the same transaction (#608). To see a meeting tombstone at all you must
  delete the `meeting` row in SQLite and leave the thread orphaned; that is what made #731. For
  attendance, `gone: row.stay === null` means the person left the burn (#729, #791).
- **A `meal` thread does not exist until somebody acts on the sitting** — `PUT
/api/meals/:id/crew/helper` writes the first entry through `noteOnMeal`. That is also the setup
  that makes "a meal is nobody's card" falsifiable: let A take the sitting on, have B heart it, and
  A must still hear nothing. Same shape for a `role` through `POST /api/roles/:id/team` (#707).
- **One subject thread per person per burn**: the database carries
  `UNIQUE (thread.subject_account_id, thread.event_id)`. Seeding a _second_ subject thread for a
  live-fired mutation check must pick a burn where that person has **no** subject row —
  `select id from event where id not in (select event_id from thread where subject_account_id = ?)
order by start_date desc limit 1`. Picking the freshest such burn is what makes it a real
  discriminator; an unfiltered query would put the probe row at the head of `card_thread_ids`.
  Delete it afterwards (#791).
- **Card DOM**: `li.feed-card` (a card) against `li.feed-line` (a line) is the card-not-a-line
  oracle; the title is in `p.feed-card-head a` and the burn in `p.feed-when`; there are **no ids**
  anywhere. `.thread-more button` is "Show the whole thread (N)", entries are
  `ol.thread-entries > li`, and the heart is `button.dream-heart` with
  `[aria-label="Give a heart to <title>"]` flipping to `Take back your heart for <title>`, beside
  `button.heart-who-toggle` and `ul.heart-who`. The busy-disabled Heart eats a click, and
  `button.dream-heart` is drawn on **four** different surfaces — name the one you mean (#702, #603,
  #627, #716).
- **Per-comment DOM map** (the same on the feed and on a member page): `li.thread-said` /
  `li.thread-did`; `button.dream-heart[aria-label^="Give a heart to what …"]` (flips to
  `aria-pressed="true"`); `button[aria-label="Rewrite what you said"]` → `.thread-editing textarea`
  with a Save/Cancel pair; `button[aria-label="Take back this comment"]` → an in-place
  `Take back` / `Keep it` confirm (Destroy.tsx-shaped, no browser dialog) (#791).
- **The stale-card recipe for fold counts**: the listing hands each card `entry_count` plus only
  the newest `CARD_ENTRIES = 3` entries, and `Feed`'s `useLoad` is **not** `live` — no interval, no
  refetch on focus — so comments POSTed out of band leave the open page showing the old count
  indefinitely, and pressing the heart is what lands the answer's count.
  `GET|POST|DELETE /api/threads/:id[/support/me]` all answer with the **whole** thread (every entry
  and the true `entry_count`), which is why keeping the fold has to be the client's doing (#716).
- **A feed card renders only its most recent entries**, so seed the comment you mean to measure
  **last** (#705).
- **To drive the comment-404 branch**, `DELETE /api/comments/<id>` with the session cookie _behind
  the open page's back_, then press ✏️ or 🗑️ on that line in the browser. Assert on
  `document.querySelectorAll('li.feed-card').length` before and after — an unchanged count is what
  separates "only the comment went" from "the whole card left the page" (#688, #683).
- **Natural interleave oracle for a thread merge**: alternate comments A1, B1, A2, B2 across the two
  threads with ~1.1 s between posts. Real `created_at`s then contradict a naive concatenation
  (which would read A-offered, A1, A2, B-offered, B1, B2), so the survivor's order alone proves the
  re-sequence. For the **tie-break** half, insert four `thread_entry` rows at one identical
  `created_at` with seqs 9, 7 on the survivor and 2, 4 on the copy: correct output is 2, 4, 7, 9
  regardless of thread. `openWith` appends the fold note at `max(seq) + 1` _after_ the re-sequence,
  so with faked future timestamps the note still lands last — not a bug (#783).
- **`PUT /api/threads/:id/follow/me` takes `{following: true}`** (not `{enabled}`) (#783).
- **Public-read pictures**: upload with `curl -X POST /api/images -H 'content-type: image/png'
--data-binary @x.png` — a raw body, not multipart — and the id comes back in a 201. A
  **cookieless** GET of `/api/images/<id>` is the whole test; `naturalWidth > 0` on the visitor's
  `.welcome img` plus a `response` listener logging the status is the browser-side oracle. A
  roleless account still gets 403 on upload, so read-open/write-shut is checkable in one script
  (#716, #692).
- **The shared markdown editor**: `.md-field-help` (the "Markdown is supported …" footer) is the
  cheapest "is this box the shared `MarkdownField`?" oracle. Sweep `document.textareas` and report
  `Boolean(ta.closest('.field')?.querySelector('.md-tabs'))` per box to separate converted boxes
  from deliberately untouched ones — the song sheet keeps `class="song-editor"`, no tabs, no
  footer. The footer's picture half (`· paste, drop or click 🖼`) tracks whether `upload` was
  wired. The textarea gets an `aria-label` only when `accessibleName` or `labelHidden` is set, so
  the Home and Organise → Events "Welcome text" fields want **`textarea.md-field-write`**, not
  `textarea[aria-label="Welcome text"]`. Gotcha: `field.querySelector('label')` finds _AddPicture's_
  label wrapping the hidden file input, so a `labelHidden` field reports `""` rather than `null`
  (#688, #716).
- **Proof a help page renders through the real renderer** rather than hand-written HTML: markdown
  `## Saturday` comes back as `<h3>` — the renderer's own heading demotion, which hand-written
  markup would have spelled `<h2>` (#688).

## Burns, the schedule, meals and the pantry

- **Seeding a burn end to end**: `POST /api/admin/events` (needs `member_cap` — there is no
  default, and without it a bare `400 bad_request`) → attendance for yourself → places (they take
  `color` from `placeColors = red|orange|…|grey`, not a hex `colour`) → sessions → meal slots and
  generate. Fourteen sessions is enough for a list long enough to scroll (#760, #770, #780).
- **Only `coming` burns are selectable.** The switcher's options are exactly
  `GET /api/events/mine` filtered to `coming`, and `?burn=<past or ended id>` silently falls back to
  a current burn — so anything on an ended burn is unreachable in the UI, which is what #782 rests
  on. You need **two** burns before `?burn=` proves anything at all (#780, #562, #555).
- **PATCH a burn's dates into the past** to make it "finished" (#562).
- **A burn with no attendees at all** has answered 509 on at least one page, so populate the burn
  before concluding a page is broken (#555).
- **The schedule grid only shows dreams that have both a `place_id` and a time slot**, so seed a
  place first or `?dream=` there never resolves (#783).
- **Deep links** are `/dreams?burn=<event **id**>&dream=<sessionId>` — `dreamLink` uses the id, not
  the slug — and `/schedule?burn=<id>&meal=<mealId>` for a sitting (#756, #820).
- **Dream panel selectors**: the panel is **`.dream-panel`** (`role=dialog`, `aria-label` = the
  dream title), **not** `dialog[open]` — `DreamPanel.tsx` renders a plain div inside
  `.dream-modal`, so a `dialog[open]` probe reports "no panel" even on a live dream. The offer form
  is `button[aria-label="Offer a dream"]` inside `.dream-pool` on `/schedule`; edit mode is
  `.dream-edit` and read mode `.markdown-preview`. `FoldDream` is in the panel's **read** mode and
  renders nothing unless the burn has another live dream (#783, #756, #824).
- **Escape versus ✕**: `dismiss = onBack ?? onClose`, so Escape _cancels the edit_ on a dream
  (`.dream-edit` goes, the dialog stays) and does **nothing at all** on the offer form
  (`onBack={() => undefined}`), while `button.panel-close` closes every one. That contrast is the
  whole "the ✕ always means out" claim, and it needs all three overlays on screen (#756).
- **`PATCH /api/sessions/:id` is 428-then-etag**: the 428 carries the etag to retry with. That is
  the only way to hand a dream's facilitation to a _different_ account, which is in turn the only
  way to tell "the author is the thread's `offered` line" apart from "the author is the
  facilitator" — a fresh dream has `facilitator_attendance_id` NULL, so an un-handed dream proves
  nothing (#553, #707).
- **Backdate `withdrawn_at`** in SQLite to walk the trashcan window: 29 days ago is still in the
  trashcan, 31 days ago is gone from the page entirely — both sides of `recentlyGone` with no clock
  faking. The Dreams page's withdrawn-row lookup searches the _full_ session list, so a chained
  fold (X→Y→Z) still names Y correctly even though Y is withdrawn (#780, #783).
- **Meals**: `GET /api/events/:id/meals` answers `meals: []` however many slots exist — the slots
  come first (`POST /api/admin/events/:id/meal-slots {label, at, kind}`) and then
  `POST /api/admin/events/:id/meals/generate`, which is the **admin** path (the non-admin one
  404s). A single meal is `POST /api/admin/events/:id/meals {label, date, at}`. The schedule chip
  is `span.meal-chip > button.dream-open[aria-label="Open <title>"]` — clicking the span itself
  opens nothing — and a block is `button[aria-label="Open Dinner"]` while
  `Open Cooking · Dinner` is the chore beside it. A meal→chore flip is what makes a
  chore-with-a-helper (#756, #820, #760, #555).
- **`POST /api/meals/:id/ingredients {name, unit, amount}`** writes a free line and answers the
  **whole meal** (find the line by name); `PATCH /api/meal-ingredients/:id {unit}` rewrites a free
  line behind an open page, which is how the adopt-400-then-retry-409 of #826 was driven (#824,
  #820).
- **A sitting's ingredients are not on `/meals`** (that page only links) — open
  `/schedule?burn=<id>&meal=<mealId>`, a `div.dream-panel` with `overflow-x: auto`, so it clips
  absolute bubbles (#820).
- **Pantry**: kinds are `breakfast|snack|staple|spice|household` (anything else is a bare 400). The
  TSV importer is a CLI, not a route — `cd apps/backend && node src/cli/import-pantry.ts x.tsv` —
  and it bounds nothing, so it is also the way to seed over-limit values the API refuses. Special
  buys need meals and free lines first; read `GET /api/admin/special-buys` and adopt at
  `POST /api/admin/pantry/:id/adopt {name, unit, amounts}`. `ul.pantry-list > li.pantry-row` also
  matches the "Written on sittings" buys; the "Inventory management" chip is
  `button.chip[aria-pressed]`, and the oracles are `.stock-step` / `Edit …` button counts plus
  `.pantry-state` text (#820).
- **The bring list**: bodyless requests must **omit** `content-type: application/json` or fastify
  answers 400 — that bites `POST /api/bring/:id/hands` (which also wants `{account_id}` and 400s
  `not_attending` unless that account is on the burn) and `DELETE /api/bring/:id` (#733, #674).
- **`HelperStrip`**: `button[aria-label^="Take the spot on"]` is 🙋 and
  `button[aria-label^="Appoint someone to"]` is the appoint control. On a burn nobody has joined,
  lead-role, meal-crew, bring-list and helping all offer the hand with **no** appoint, and a chore
  renders `—` in Lead _and_ Help (only its Cleanup opens) (#729).
- **`CopyFrom` renders only on a burn with zero roles, places and faq entries and ≥1 source**
  (`/api/events/:id/roles/sources`) (#824).
- **Meetings**: `meetingUpdateSchema` is `.strict()` and only `link` has a default, so a PATCH
  missing `ends_at` 400s silently — send `"ends_at": null`, and send the whole body. Create is
  `.strict()` too, with `notes` (not `note`). `starts_at` is **Z-only** (`+02:00` is a 400);
  `…:00.000Z` and `…:00Z` are the same instant respelt. The UI form's title is prefilled
  ("Planning call"), so `page.type` appends rather than replaces. Card oracles: reword the note →
  `body` changes while `last_at` and `entry_count` stay put; move it → `last_at` advances, the card
  goes to feed position 0, and the `scheduled` entry _coalesces_ (the single "put it in the diary"
  line becomes a single "moved it" line, never two) (#729, #824, #603).
- **The ICS feed** is `GET /calendar/:token/schedule.ics`, with the token from
  `GET /api/events/:id/calendar`. The `UID:` is the oracle that an edit is not a delete-and-recreate
  (#674, #780).
- **`PUT /api/admin/map {"url":"https://…"}`** sets the map entry (https only); restore it to
  `null` afterwards. The map entry only appears in the nav after that PUT, and it carries
  `target=_blank` (#694, #802).
- **`intercept /api/songs`** for an empty-songbook state (#553).
- **The post-Save read race** is real on this app — read back through the API, not from the DOM
  straight after Save (#553).

## Navigation, layout and page modes

- **The phone breakpoint is 45rem** — 719 against 721 is the pair worth measuring. `usePhone()`
  gates page mode, so **1280px is the free control**: a claim about the phone that also happens at
  1280 is not the panel's doing (#694, #770).
- **Both navs are `aria-label="Pages"`** — the bottom bar and the sidebar — so
  `nav[aria-label="Pages"]` matches on a phone too. Discriminate on `.sidebar` / `.bottom-bar`, and
  on `.layout` carrying `has-sidebar` against `has-bottom-bar` (#694).
- **Phone nav DOM map**: `.bottom-tab` (aria-label = page name, text = the icon only,
  `aria-current="page"`), `.menu-button` (aria-label "Menu", `aria-expanded`), `.menu-drawer`
  (aria-label "All pages", `position: fixed; overflow-y: auto`), `.menu-drawer .menu-entry` (text =
  `<icon> <name>`), `.menu-close`. Escape puts focus back on `.menu-button`. Desktop sidebar
  entries are the same `.menu-entry` class, so one selector compares drawer order to sidebar order
  (#802).
- **`.sidebar`'s scroll oracle**: `bar.scrollTop = bar.scrollHeight` (it clamps to max), then the
  last `.menu-entry`'s `getBoundingClientRect().bottom <= innerHeight` **and** `scrollY === 0`. The
  column is drawn above the phone breakpoint, so sweep 730→1280 to see whether a wrapping header
  breaks a one-constant token — it does not, because `.burn-selector` has `min-width: 0` and
  shrinks instead of wrapping (#733).
- **A panel that is a page is a _query_ change, not a path change**, so the oracles are boxes and
  history counters rather than routes. Read `nav.top-nav` / `nav.bottom-bar`
  `getBoundingClientRect().y` beside `window.scrollY` in one `page.evaluate`: `topNavY < 0` with
  `bottom-bar is-hidden` at `y === innerHeight` is "the page arrived with no navigation", and the
  contrast that makes it a finding is tapping `a.bottom-tab[aria-label="Schedule"]` from the same
  scroll (a real path change → `scrollY 0`, `topNavY 16`). `history.length` before and after is the
  push-versus-replace oracle: open (2→3), ✕ (stays 3), then `page.goBack()` must not reopen (#760).
- **`useHidingBar` resets on `path`**, so a query-only open **keeps** the hidden bar, and it only
  hides the tabs **away from both ends** (`nearTheEnd` refuses within 48px of the bottom) — scroll
  to ~40% of max, not to the end (#760, #770).
- **`:focus-visible` is path-dependent**: `panel.matches(':focus-visible')` is **true on a cold
  deep-link** (the notification arrival) and false when the same panel is opened by tapping the
  list, so the `2px solid rgb(253,186,116)` ember outline around an `is-page` body only ever shows
  to the person arriving from a push (#760).
- **`Destroy.tsx`'s focus contract, checkable anywhere**: pressing the bin moves focus to
  `aria-label="Really <verb> <what>"`, and **Keep it** returns it to the bin. A new sibling
  confirmation may _not_ manage focus — focus each trigger, press Enter, read
  `document.activeElement`, and that is a free same-panel A/B (#729, #783, #786).
- **`AddPicture` is a `<label class="syntax-button add-picture">` around a visually-hidden file
  input** — focus the _input_ and read `outlineStyle` on the label (solid 2px) against the
  enclosing `.syntax-row` (none) (#729).
- **When the app renders no link to the route you want**, inject an `<a href>`, click it and remove
  it — that is a genuine same-document route change (#769).
- **A pinned probe anchor** keeps the bottom nav from stealing the click it was meant for (#569).
- **The install banner re-renders on "Not now"** — that is the state to watch, not a disappearance
  (#576).

## The database, probes and migrations

- **A probe is a file under `apps/backend/src/`, run from `apps/backend`** — and **deleted
  afterwards**, because that is inside the clone. Bare specifiers resolve by walking up from the
  importing file, so a probe placed there gets the workspace's dependencies; `node -e` has no path,
  resolves from the working directory, and finds nothing. Import `createDb`
  plus whatever is under test and call it against the live database — that is exactly what a
  mutated route would do, and it settles "does this test actually catch that?" (it did not, in
  #687). `createDb({ url })` takes an options object and returns a **handle** (`.db`, `.close()`)
  (#679, #702, #730).
- **ESM will not resolve a bare specifier through a symlinked `node_modules` directory**, so a
  script sitting outside the workspace cannot borrow one wholesale — link the packages
  individually, or do what `lib/browser.mjs` does and go through `createRequire` (#733).
- **A SQLite `BEFORE INSERT … RAISE(ABORT)` trigger is the transaction-boundary oracle.** Arm it on
  something the route controls (`WHEN (SELECT title FROM thread WHERE id = NEW.thread_id) LIKE
'TRAP%'`), then POST and see whether the sibling rows survive: a route that rolls back leaves
  none, and a sibling route that still writes its entries _after_ the transaction leaves the orphan
  intact. That found #686 — the copy route's 500 also 409s on retry, so it is terminal. Query the
  leftovers with a second read-only probe (#679, #649).
- **`DrizzleQueryError`'s cause chain** is checkable with a probe that inserts a copied row
  (`{...row, id: randomUUID()}`) to force unique, check and FK failures against the live database
  (they write nothing), printing the `cause` chain beside `db/errors.ts`'s verdicts. The
  route-level half is the live 409s from a duplicate sign-up, a second application and a duplicate
  event slug (#828).
- **Read `sqlite_master.sql` for a CHECK's text** to verify a category migration from outside:
  count the rows to prove a table rebuild kept them, and try an invented category to prove the
  CHECK still bites. The `sqlite_master`/pragma sweep is the general shape for any rebuilt-table
  migration (#707, #603).
- **Mutate the migration, not `schema.ts`** — the test database is built by `runMigrations` from
  the generated SQL and never reads the Drizzle schema at runtime (`../AGENTS.md` says it too).
- **A kept database is a migration fixture.** `tryouts/up.sh` without `--fresh` keeps the file, so a
  rig that has been carrying tryout data for a while can check a data-fixing migration against real
  pre-existing damage instead of a construction — `20260822100000_dream_trashcan` resurrected two
  dreams that earlier tryouts had hard-deleted. `select … from __drizzle_migrations order by
created_at desc` proves it ran. **Idempotency without re-running it**: execute only the
  migration's own `SELECT` (its `NOT EXISTS` clause is what makes it idempotent) and assert 0 rows
  (#780).
- **Editing an applied migration's comments is safe**: drizzle's `getMigrationsToRun`
  (`drizzle-orm/migrator.utils.js`) filters local migrations by **name** against
  `__drizzle_migrations`, never by the stored `hash`, so a re-worded `.sql` neither re-runs nor
  fails on an existing database (#729).
- **Check _stored_ rows, not just producers, when a validator is tightened.**
  `routes/schedule.ts` `safeParse`s stored meetings and sessions and silently drops the failures, so
  a seeded `starts_at = '…T10:00Z'` row is listed by the API and missing from the ICS — that is
  #835 (#828).
- **Identical `created_at` rows** are how the sequence tie-break is reached (#783).

## A/B against pre-merge code

- **Get the pre-merge tree out of git, not out of the running copy.**
  `git archive <merge-sha>^1 | tar -x -C /tmp/pre` gives a read-only copy of the parent commit
  without touching the checkout; `git worktree add` does the same as a real directory. The merge
  tree itself is `git archive <merge-sha>` (#627, #769).
- **Run the pre-merge module beside the shipped one in one probe.** Copy the pre-merge file in
  under a distinct name (`src/_digest_pre730.ts`), rewrite its relative imports with `sed` if it
  pulls in siblings that also moved, then one probe imports both and runs the same fixture through
  each against the **same** live database. The diff is the whole finding — that is how the digest's
  two bodies were printed side by side, and how a pre-merge route was shown to really over-redeem a
  cap-1 group link while the shipped one answers `/login?from=refused` and makes no account.
  Delete the copies afterwards (#730, #720, #639, #769).
- **A CSS-only fix gets a clean A/B live**: measure, then set the pre-fix value as an **inline
  style** on the element (`el.style.maxHeight = '<the old value>'`, `foot.style.alignItems =
'flex-start'`, `menu.style.insetBlockStart = '100%'`, `bar.style.position = 'static'`) and
  measure again. Inline beats the stylesheet and no CSP applies; the pre-fix numbers came back to
  the digit (`lastEntryBox {top: 460, bottom: 509}`, `lastEntryVisible: false`), and a sticky bar
  went from `y: 44, reachable: true` to `y: -4827`, off the scrollport entirely (#733, #705, #756,
  #569).
- **Replay a removed _line_, not a removed build.** When a fix dropped `panel.current?.focus()` in
  page mode, running `document.querySelector('.dream-panel').focus()` by hand in a cold-arrival tab
  flipped `:focus-visible` true and moved `outline` from `3px none` to `2px solid rgb(253,186,116)`
  — the ember ring, in the same tab (#770).
- **Re-run the merge tree's own vitest, read-only**, for a test that imports nothing but `node:fs`
  and `vitest`: copy the test and its subject into a scratch directory, point `node_modules` at the
  **workspace** package's (`apps/web/node_modules` — the repository root has no `.bin/vitest`), and
  run `./node_modules/.bin/vitest run …` — the shell wrapper, because
  `node node_modules/.bin/vitest` chokes on its `#!/bin/sh` preamble, and `--reporter=basic` no
  longer exists. Then mutate the copy to reproduce the PR body's promised failure verbatim. Note
  `styles.test.ts` wants the CSS at `src/styles.css` **relative to the working directory**, not
  beside the test (#729, #730, #649).
- **A sweep PR is verified claim by claim**: back end first with curl and probes (fast, no
  browser), then one puppeteer script per UI claim (#824).
- **Configuration-dependent behaviour gets a second rig** rather than an argument from the source:
  `TRYOUT_DIR=/tmp/tryout-b TRYOUT_PORT=8083 SESSION_TTL_SECONDS=3600 tryouts/up.sh --fresh`, then
  probe, then `TRYOUT_DIR=/tmp/tryout-b tryouts/down.sh --purge`. That shape showed the "sliding
  does nothing when the TTL is ≤ a day" gap (#789) on the running app, and it is how the whole
  `iat`/half-TTL slide matrix was driven (#787, #824).
- **`TRUST_PROXY`**: one rig with `TRUST_PROXY=uniquelocal` and one without, then
  `curl -H 'X-Forwarded-For: 203.0.113.77' …?probe=xff` and read `"remoteAddress"` out of
  `server.log` — the request log line is the `request.ip` oracle. The per-IP bound is drivable with
  12 × `POST /api/auth/forgotten` per forwarded address (10 × 204 then 429; a second client gets its
  own bucket only under `uniquelocal`). `TRUST_PROXY=1` refuses to start, with the message
  explaining why (#828).
- **An old dependency version** can be checked against without downgrading the rig: point the probe
  at another checkout's `node_modules/.pnpm/<package>@<old version>` (#828).

## Traps

- **Every "0 failed" is a result to check, not to celebrate.** A mutation that does not apply looks
  exactly like one that was caught: the anchor may have gone stale after a reformat, a schema may
  reject the mutation before it can take effect, or deleting a whole `export const` line may break
  the import so the suite never runs. Assert the anchor was found (`../AGENTS.md`).
- **Check the PR's review follow-up issue before filing.** Two of three findings in one run were
  already listed there, so they went in as a comment instead (#820).
- **`docs/` claims are hypotheses and the app is the oracle** when a PR is documentation-only: the
  job is re-deriving each claim from the running app, not reading the diff (#729).
- **A bodyless request with `content-type: application/json` is a fastify 400** — omit the header
  (#733, #674).
- **Approve needs `-d '{}'`**; a bare POST with a JSON content type is a 400 (#769).
- **Node's `fetch` silently drops a custom `Host` header.** Use `curl -H` (#756, #746).
- **`curl -w '<<%{http_code}>>'` with `-o /dev/stdout` exits 23** after the request has already
  succeeded — drop the `-o` (#756).
- **`page.type` appends** to a prefilled input; clear it first (#828).
- **The demo account's roles are `admin` and `member`.** A "no new read scope" claim needs a
  roleless account, not this one (#791).
- **Anything that leaves the environment** — a real push subscribe, an external status endpoint —
  is "not drivable here", reported, never skipped in silence (#579).
