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

| Viewer                   | Bar                                               |
| ------------------------ | ------------------------------------------------- |
| Signed out               | Apply, Log in                                     |
| An account, neither role | nothing — an applicant waiting on a decision      |
| `member`                 | Members, Schedule, Roles, and the initials circle |
| `admin` without `member` | Members, Schedule, Roles, ⚙️                      |

- **Members** is the roster a member may now read — see "What a member may change".
- **Dreams** is reached from Schedule. Offering a dream and placing one are the
  same activity, and two entries for it is what the restructure undid.
- **Places** is reached from Schedule too: the lanes are what the grid draws.
- **Signing out** is on the details page, under the line naming the account it ends,
  and on ⚙️ → Settings for the admin the details page refuses. Every entry in the
  bar is a _place_; this is an action, and it was the only one there.
- **The initials circle** is the details page: who you are, then a section per burn
  still to come — join it, or fill in your stay at it — then past burns behind
  _…show past burns_. It absorbed the page called "Your burn", singular, which was
  from when there was one burn worth showing and it was whichever came next.
- **The lodging and helping lists** are reached from that page, from
  _(edit lodging alternatives)_ beside the question they answer.
- **⚙️** is admin's alone. It used to be `Organise` and open to any approved member,
  because it was the only way to reach the two lists above; now those have their own
  way in, and what is left behind ⚙️ — the burn's shape, who gets in, payment, the
  installation — is admin's. It still links to both lists, since an admin
  holding `admin` without `member` has no details page to reach the lodging list from.

**Pages are full width.** `--measure` is a reading width and only the two pages that
are actually prose take it — the homepage's welcome text and the 404, through
`.prose`. Everything else is grids, rosters and registers, which a 38rem column
squeezed into a sliver with the rest of the screen empty. The schedule used to escape
that with a `:has()` override, which is the shape of a default that is wrong: one
page opting out, and the next wide thing having to remember to.

Hiding a link is presentation. Every page behind these is guarded again server-side,
and `Layout.test.tsx` asserts each absence by name — a negated `arrayContaining`
passes when any _one_ of the named links is missing, which is not the question.

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

`index.html` still ships `<title>Sage Burner</title>`, which is what the browser
tab says for the moment before the app boots. That is the software's name and it
is accurate until the app knows better; serving a per-installation shell would
mean injecting into the HTML at three separate entry points, which is not worth
it for one frame. Until the fetch lands the header renders no name at all,
rather than the software's — showing it and then replacing it is what would look
like a bug.

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

**That means an admin can upload a file carrying script, and that is the settled
trade** (#256): it is their own installation to break. Two things bound it. An
SVG cannot execute as a manifest icon or inside an `<img>` — only as a top-level
document — and that one remaining route is closed by serving the response
`Content-Security-Policy: default-src 'none'; sandbox`, which gives such a
document an opaque origin and no scripting. Uploading is admin-only.

**The tab wears it too** (#285), and `index.html` is where that starts: the link
points at the same route, so a signed-out visitor on the public homepage gets the
installation's mark rather than the browser's default. Adding the dot took a detour. The unseen-notification dot
(#248) was drawn as a `<circle>` inside an SVG data URL, and a data URL cannot
reference an external image to draw over — so for a while the tab kept the flame
while the home screen wore the upload. The tab now loads the icon into an image and
composes it with the dot on a canvas instead: the same trick the upload path already
uses, since a chosen file is cut square and resized in the browser. Same-origin, so
the canvas is not tainted, and still nothing decodes an image server-side.

**The plain icon is the floor under it.** `favicon.ts` finds the link the shell
declared — by `id`, so there is only ever one `rel="icon"` — sets it back to the route
synchronously, and only replaces it if the drawing succeeds. A failed fetch, a browser
that will not draw an SVG with no intrinsic size, or a missing 2D context all leave
the tab wearing the right mark without a dot. Two links rather than one would leave it
to the browser which wins, which is how the first attempt at this came out doing
nothing at all.

The dot's numbers are `notificationBadge` in `@sage-burner/shared`, and the mark
itself is `flameIcon` beside it — the backend reads one to serve the default icon,
`favicon.ts` reads both. The badge is stated once because it is now drawn twice, and
two copies would drift with only one of them ever looked at.

## Offline and installing

The app is a PWA: installable, and readable with no connection.

`GET /manifest.webmanifest` is served rather than shipped as a file, because it
carries the installation's own name and icon — both rows an admin can change, and
a static file would need a redeploy to stop saying `Sage Burner`. The icon `src`
carries the stored `updated_at` as a version, so a new icon is a new URL rather
than one an installed copy holds on to.

Two caches, and the split is the whole of what stays on a device:

- **`sage-burner-shell-v1`** — the HTML shell, the hashed bundles, the manifest,
  the icon. None of it is anybody's data. Kept across a sign-out, because
  dropping it would mean the next person to open the app offline gets nothing at
  all. Trimmed to the 40 most recently stored entries, oldest first, so old
  builds' chunks do not accumulate forever.
- **`sage-burner-api-v1`** — every API read: the roster, the schedule, who you
  are. **This is member data on disk, and signing out deletes the whole cache.**
  Not entries picked from it by URL, which would be a list to keep in step with
  the routes.

Reads are network-first with the cache as a floor under being offline; hashed
assets are cache-first, since their names change with their bytes. `/api/version`
is never cached — a stale answer there is the one reply that makes the redeploy
check pointless. Nothing cross-origin is touched.

**A navigation is only stored if it answered with HTML.** Not every same-origin
navigation returns the app: the ICS feed is a plain `<a href>` in the page, so
clicking it is a `mode: 'navigate'` fetch answering `text/calendar`. Without the
check the worker would store the calendar as the shell, and every offline open of
the app would render an ICS file until some later online navigation overwrote it.
A content type rather than a list of paths to skip — a list is a thing to keep in
step with the routes, and the route it goes stale against is the one that breaks
the app offline.

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
