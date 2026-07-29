# sage-burner

Membership, application, and scheduling platform for small "burner"-style
mini-events — up to ~42 members, a few times a year.

It replaces the spreadsheet-plus-Discord workflow that these gatherings
otherwise run on: people apply through a public form, organisers approve them
and hand out invite links, members fill in their own camp details, organisers
track payment, and the co-created programme of "dreams" (workshops, ceremonies,
happenings) is scheduled and published as a calendar feed anyone can subscribe
to.

Self-hosted, single container, single SQLite file. No external services
required.

**License:** AGPL-3.0-or-later.

## Status

Pre-MVP — under active construction. See the [MVP milestone][milestone] for
what ships first, and the `post-mvp` label for the longer roadmap.

[milestone]: https://github.com/fiddur/sage-burner/milestone/1

## Stack

| Layer    | Choice                                                            |
| -------- | ----------------------------------------------------------------- |
| Frontend | Preact + Vite                                                     |
| Backend  | Fastify (Node 24 LTS, TypeScript run directly via type stripping) |
| Database | SQLite via Drizzle ORM — one file on a mounted volume             |
| Auth     | Password **and** WebAuthn/passkey, coexisting per account         |
| Calendar | Public read-only `.ics` subscription feed                         |

One Node process serves the API, the built web app, and the calendar feed.

## Local development

Requires Node 24 LTS (see `.nvmrc`) and pnpm 10.

```sh
nvm use
pnpm install
pnpm check      # formatting, typecheck, lint — the same gate CI runs
pnpm test       # tests, non-watch
```

Run the two halves in separate terminals:

```sh
pnpm dev:backend   # Fastify on :3000, migrating on boot
pnpm dev:web       # Vite on :5173 with HMR, proxying /api to the backend
```

The app always talks to a same-origin `/api` — the backend serves both halves
in production, and Vite proxies to it in development — so there is no base URL
to configure and no CORS anywhere.

`GET /api/version` answers with the build SHA and doubles as the container
healthcheck.

**Client-side routes must not contain a dot.** The backend distinguishes a
missing asset from a client-side route by whether the last path segment has a
file extension, so anything with one gets a 404 and never reaches the router.
That is what stops a stale page requesting a vanished content-hashed chunk from
being handed the HTML shell. It also means invite tokens must be dot-free.

### Configuration

Every variable is optional; the defaults are what you get from a bare
`docker run`. An empty value is treated as unset, since `FOO: ${FOO}` in a
compose file with `FOO` undefined expands to an empty string rather than to
nothing.

| Variable       | Default                     | Meaning                                                            |
| -------------- | --------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`     | `development`               | `development` \| `test` \| `production`                            |
| `PORT`         | `3000`                      | Port to listen on                                                  |
| `HOST`         | `0.0.0.0`                   | Bind address — `0.0.0.0` to be reachable in Docker                 |
| `DATABASE_URL` | `./data/sage-burner.sqlite` | SQLite file; parent directory is created                           |
| `LOG_LEVEL`    | `info`                      | `fatal` … `trace`, or `silent`                                     |
| `BUILD_SHA`    | `unknown`                   | Commit the image was built from                                    |
| `WEB_ROOT`     | _(unset)_                   | Directory of the built web app. Unset in dev, where Vite serves it |
| `TRUST_PROXY`  | `false`                     | `false`, `true`, a hop count like `1`, or an address/CIDR list     |

Invalid configuration fails at boot with every problem listed, rather than
starting and behaving subtly wrong.

`TRUST_PROXY` defaults to trusting nothing. See the deployment notes below for
what to set it to.

Setting `WEB_ROOT` is a statement of intent to serve the frontend, so the app
refuses to start if that directory is missing, is not a directory, or has no
`index.html`. Without that check a typo'd variable or an unmounted volume would
produce a container that starts, keeps answering the healthcheck, and 404s every
page.

### Database

`apps/backend` holds the schema and migrations. The database is a single SQLite
file; `DATABASE_URL` sets its path and defaults to `./data/sage-burner.sqlite`,
whose parent directory is created for you.

```sh
pnpm --filter sage-burner-backend db:generate   # after editing src/db/schema.ts
pnpm --filter sage-burner-backend db:migrate    # apply migrations to DATABASE_URL
```

`db:generate` writes SQL to `apps/backend/drizzle/` — commit it. Read the
generated SQL before trusting it, particularly the first migration that alters
rather than creates a column: SQLite implements that as a table rebuild, which
interacts badly with foreign keys (see the note on `runMigrations`).

The server will also migrate on boot, so `db:migrate` is only for preparing a
database ahead of time.

To serve the built frontend from the backend the way production does, build it
and point `WEB_ROOT` at the output:

```sh
pnpm --filter sage-burner-web build
WEB_ROOT=$PWD/apps/web/dist pnpm dev:backend
```

`WEB_ROOT` is resolved against the backend's working directory, which `pnpm
dev:backend` sets to `apps/backend` — so an absolute path is the one that stays
correct wherever you are standing.

## Running it for real

### Before the first deploy

`docker compose up -d` pulls `fiddur/sage-burner:develop`, and the workflow in
`.github/workflows/docker.yml` is the only thing that publishes it. That
workflow needs two **repository secrets**, and without them the `build` job
fails at the login step on the first merge to `develop` — nothing is published,
and the tag the compose file names does not exist:

| Secret               | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| `DOCKERHUB_USERNAME` | The Docker Hub account that owns `fiddur/sage-burner`          |
| `DOCKERHUB_TOKEN`    | A Docker Hub **access token**, scoped to write that repository |

Use a scoped access token rather than the account password. Whoever can move
the `:develop` tag effectively has root on the deployment host, since watchtower
pulls it automatically and holds the Docker socket.

What keeps a broken image off Docker Hub is the ordering inside the `build` job
itself: it builds with `push: false`, smoke-tests the loaded sha tag, and pushes
only if the container came up healthy. That holds with no ruleset at all — do
not reorder it.

Both `CI Gate` and `build` are _also_ required status checks on `develop`. What
that adds is that the PR head was proven startable before merging — and since
the policy is strict, so the branch must be up to date, that is the tree the
merge commit gets. What is still not enforced is the review itself; see the note
in [`AGENTS.md`](./AGENTS.md) for what a green rollup does and does not mean.

### Deploying

```sh
cp .env.example .env
docker compose up -d
```

For the Apache deployment below, change `TRUST_PROXY` to `1` in that `.env` —
without it `request.ip` is the Docker bridge for every request. It ships as
`false` rather than `1` because a trusted hop with nothing in front appending to
`X-Forwarded-For` hands the client control of that value, and a default that is
only safe if you edit the file is not a safe default.

One service, one named volume holding the SQLite database, and a watchtower
sidecar that polls Docker Hub every five minutes and redeploys when the tag
moves. `docker compose down && docker compose up` preserves your data — the
volume is named, not a bind mount, so removing the container does not take the
members with it.

The image runs as an unprivileged user, migrates on boot, and reports healthy
only once `/api/version` actually answers — so a process that is up but not
serving is reported as unhealthy rather than fine.

Nothing acts on that, though: `restart: unless-stopped` reacts to the process
exiting, not to the health status, and watchtower does not roll back. An
unhealthy container will sit there being unhealthy until someone looks. Treat
the healthcheck as a signal to monitor, not as self-healing.

### Backups

The database is one file on the `sage_burner_data` volume — which Docker shows
as **`sage-burner_sage_burner_data`**, since compose prefixes volume names with
the project name. Use the full name with `docker volume` and `docker run -v`:
naming the short form does not error, it silently creates a new empty volume,
which during a restore means restoring into nothing.

It is in WAL mode, so copying the file alone can miss recent commits — use
SQLite's backup API, which is consistent against a live database:

```sh
# Meant to run from cron, so failures must be loud: without `set -e` the final
# `rm -f` always succeeds and the whole block exits 0 even when VACUUM INTO hit
# a full disk or the copy out failed. Cron sees success, nobody looks, and the
# gap surfaces on the day the restore below is needed.
set -euo pipefail

STAMP=$(date +%F-%H%M%S)
# Sweep leftovers older than an hour. The cleanup at the end only runs on the
# happy path, so an interrupted copy — or watchtower recreating the container
# mid-backup — leaves a full database-sized file on the same volume the live
# database is on, and repeated failures accumulate one each until the disk is
# full, which takes SQLite's write path with it.
#
# Age-based rather than a blanket delete: a nightly cron and a manual
# pre-deploy backup can overlap, and removing everything would delete the other
# run's in-flight target out from under it.
docker compose exec -T sage-burner find /data -name 'backup-*.sqlite' -mmin +60 -delete
# VACUUM INTO refuses to overwrite, so write to a fresh name each time — a run
# that dies before the cleanup below must not block the next one.
docker compose exec -T sage-burner \
  node -e "const {DatabaseSync}=require('node:sqlite');
           new DatabaseSync(process.env.DATABASE_URL).exec(\"VACUUM INTO '/data/backup-$STAMP.sqlite'\")"
docker compose cp "sage-burner:/data/backup-$STAMP.sqlite" "./sage-burner-$STAMP.sqlite"
docker compose exec -T sage-burner rm -f "/data/backup-$STAMP.sqlite"
```

Worth doing before any deploy that includes a migration, since a migration that
alters a column is a table rebuild, and the restore below is the recovery path
if one goes wrong.

### Restoring

```sh
docker compose down

docker run --rm \
  -v sage-burner_sage_burner_data:/data \
  -v "$PWD:/backup" \
  alpine sh -c '
    rm -f /data/sage-burner.sqlite /data/sage-burner.sqlite-wal /data/sage-burner.sqlite-shm &&
    cp /backup/sage-burner-<stamp>.sqlite /data/sage-burner.sqlite &&
    chown -R 1000:1000 /data'

docker compose up -d
```

Three things that will bite otherwise:

- **Delete the `-wal` and `-shm` sidecars.** Leaving a stale WAL beside a
  restored database means SQLite replays transactions belonging to the database
  you just replaced. The backup is already a complete, checkpointed copy.
- **Use the full volume name.** `-v sage_burner_data:/data` does not error — it
  creates a new empty volume, and you restore into nothing.
- **`chown -R`, not just the file.** The container runs as `node`. If the volume
  no longer exists — lost host, `docker volume rm`, restoring onto a new machine,
  which is exactly when this section is needed — this `docker run` is the first
  to mount it, so Docker creates it root-owned from the `alpine` image. Chowning
  only the file leaves the _directory_ unwritable, SQLite cannot create the
  `-wal`/`-shm` sidecars, and the container exits immediately with
  `ERR_SQLITE_ERROR: attempt to write a readonly database` — pointing at the file
  you just fixed. `restart: unless-stopped` then crash-loops it, so read
  `docker compose logs` rather than hunting through request logs.

The watchtower here is **scoped** — it runs with `--scope sage-burner` and only
touches containers carrying the matching label — so it coexists with any other
watchtower on the host. The one thing to avoid is an _unscoped_ watchtower
elsewhere on the same machine: that one grabs every container it can see,
including these. If one exists, give it a scope too.

> **No admin yet.** There is no open signup, so a fresh deployment currently has
> nobody who can approve anything — seeding the first admin arrives with [#10].

### Deployment shape

Apache on the host holds the public IP for several domains and reverse-proxies
to the container:

```
client ──https──▶ Apache (host) ──http──▶ 127.0.0.1:8081 ──▶ container :3000
```

Two things follow from that, both easy to get wrong:

**Set `TRUST_PROXY=1`.** Apache is the only hop that appends to
`X-Forwarded-For` — Docker's port mapping is NAT, not an HTTP proxy, so it adds
nothing. Trusting exactly one hop makes `request.ip` the real client address,
and it is spoof-resistant: a client can only _prepend_ to the header, while
Apache appends the address it actually saw. `true` would trust the whole chain
and let any client claim any address; the default `false` leaves every request
looking like it came from the Docker bridge.

**Publish the port on loopback only** — `127.0.0.1:8081:3000`, never
`8081:3000`. Docker writes its own iptables rules ahead of ufw/firewalld, so a
plainly-published port is reachable from the internet even with a host firewall
that denies it, bypassing Apache and its TLS entirely.

The vhost needs roughly:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass        / http://127.0.0.1:8081/
ProxyPassReverse / http://127.0.0.1:8081/
```

Note there are no `Header set` lines for CSP, HSTS or the rest: the app sends
those itself, and a second policy here could only further restrict it. See
[Security headers](#security-headers).

`X-Forwarded-Proto` is not cosmetic: Apache terminates TLS, so without it the
app believes it is serving plain HTTP — which decides whether the session cookie
gets its `Secure` flag.

Set it in the `:443` vhost, not in an include shared with a `:80` one. Hardcoded
to `https` it would lie about a plain-HTTP request, and a cookie marked `Secure`
on a connection that is not would simply never come back.

[#10]: https://github.com/fiddur/sage-burner/issues/10

## Security headers

Every routed response carries a `Content-Security-Policy`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`Strict-Transport-Security: max-age=31536000; includeSubDomains` and the rest,
via `@fastify/helmet` registered before any route.

"Routed" is the limit: helmet hooks `onRequest`, which runs after routing, so the
two paths that answer outside it — `clientErrorHandler`, and `frameworkErrors`
for a URL the router rejects — send their JSON error envelope bare. Both are
error bodies rather than documents, so there is nothing there for a policy to
protect.

The policy is:

```
default-src 'self'; base-uri 'none'; font-src 'self'; form-action 'self';
frame-ancestors 'none'; img-src 'self' data:; object-src 'none';
script-src 'self'; script-src-attr 'none'; style-src 'self';
upgrade-insecure-requests
```

Four deliberate departures from helmet's defaults, each pinned by a test in
`apps/backend/src/security-headers.test.ts`:

- **No `'unsafe-inline'` on `style-src`.** Helmet ships it by default, and it is
  the allowance that makes a CSP mostly decorative. The app has no inline styles
  and no `style=` attributes, and `styles.css` uses only system font stacks — no
  `@font-face`, no `url()` — so it does not need one.
- **`frame-ancestors 'none'` and `X-Frame-Options: DENY`**, rather than helmet's
  `'self'`/`SAMEORIGIN`. Nothing here frames anything, and approving an
  application is a single click.
- **`font-src 'self'`**, not helmet's `'self' https: data:`, for the same reason
  — there are no web fonts to fetch.
- **`base-uri 'none'`**, since no `<base>` is ever emitted.

`Referrer-Policy: no-referrer` is helmet's default and stricter than it needs to
be for most pages — kept because an invite token travels in a URL path
([#17]), and a member clicking any outbound link from `/invite/<token>` would
otherwise hand the token to the destination.

Two things to know before deploying anywhere other than the documented setup:

- **HSTS is `max-age=31536000; includeSubDomains`** — one year, covering every
  subdomain of whatever host serves the app. Fine on a dedicated subdomain like
  `sage.example.org`. On an apex it would make every plain-HTTP sibling
  subdomain unreachable for anyone who has visited, and shortening it only takes
  effect for a visitor who returns.
- **`upgrade-insecure-requests` assumes TLS terminates in front.** Browsers
  exempt `localhost` and loopback, so `docker compose up` locally is unaffected —
  but reaching the container over plain HTTP at a LAN address or hostname
  upgrades every subresource to `https://` and yields a blank page.

**Do not add these headers in the Apache vhost as well.** Browsers _intersect_
multiple `Content-Security-Policy` headers rather than letting one win, so a
second policy can only ever make the page more restricted — and debugging why a
script is blocked when neither policy alone blocks it is miserable. The app is
the single place this is configured.

One assumption the policy rests on is pinned rather than trusted:
`apps/web/index.html` must stay free of inline `<script>`, `<style>`, `on*=` and
`style=`, **and of any absolute `src`/`href`** — a CDN link is blocked by
`script-src 'self'` just as surely as an inline block. Vite copies that file
through verbatim, so either would break the built app in production with nothing
else failing. There is a test asserting it.

[#17]: https://github.com/fiddur/sage-burner/issues/17

## API errors

Every error response the app produces has the same body, and nothing else:

```json
{ "error": "not_found" }
```

`error` is a machine-readable slug, never a sentence — it is the thing a client
branches on. The message a member reads is the frontend's to choose, because
only the frontend knows what the member was trying to do. The real error goes to
the server log, where a SQL fragment or a file path is useful rather than public.

The vocabulary today is `bad_request`, `not_found` and `internal_error`, defined
in [`packages/shared`](./packages/shared/src/schemas/error.ts). It grows with the
routes that emit it — authentication codes arrive with accounts ([#8]), rather
than being listed in advance and left unreachable.

Clients should tolerate a slug they do not recognise: the schema accepts any
string so an older frontend can still read a newer API's error instead of
failing to parse the explanation of what went wrong.

"Error response" rather than "non-2xx": a conditional request for an asset
answers `304` with no body at all, which is a cache hit rather than a failure.

One thing a route can do to break this promise, since the failure is silent in
both directions — no test fails, and the response is a valid-looking `{}` that
the client reads as an unknown code. A route that declares
`schema.response` **for an error status** runs the envelope through that
serializer, and anything the schema does not declare is stripped:

```ts
// Strips the envelope: answers 400 {}
schema: { response: { 400: { type: 'object', properties: { detail: … } } } }

// Keeps it
schema: { response: { 400: z.toJSONSchema(errorResponseSchema) } }
```

Declaring only a success shape is safe — a `200` schema does not touch the
error path, which is the case a route is actually likely to have.

Three separate Fastify options are needed to make that hold, because a request
can fail before it reaches a route: `setErrorHandler` for anything thrown,
`frameworkErrors` for a URL the router rejects, and `clientErrorHandler` for a
request Node's HTTP parser rejects — an oversized header block, a client
timeout. Each default writes a sentence into `error` instead of a slug.

"The app produces" is the limit of the promise. A reverse proxy in front can
answer with its own error page — an Apache 502 while the container is
restarting, for instance — and that will not be JSON at all. The web client
handles this: a non-JSON error body yields `code: 'unknown'` rather than a
parse error that hides the real status.

[#8]: https://github.com/fiddur/sage-burner/issues/8

## Repository layout

```
apps/backend      Fastify API, static serving, Drizzle schema + migrations
apps/web          Preact + Vite single-page app
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation                           (planned)
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
