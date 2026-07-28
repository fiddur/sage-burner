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

```sh
cp .env.example .env
docker compose up -d
```

Copying `.env` is a required step, not a convenience: `TRUST_PROXY` defaults to
`false` so that a compose file run without a reverse proxy in front cannot be
handed a client-controlled `request.ip`. `.env.example` ships the `1` that the
Apache deployment below wants.

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

It is in WAL mode, so
copying the file alone can miss recent commits — use SQLite's backup API, which
is consistent against a live database:

```sh
STAMP=$(date +%F-%H%M)
# Sweep any leftovers first. The cleanup at the end only runs on the happy path,
# so an interrupted copy — or watchtower recreating the container mid-backup —
# leaves a full database-sized file on the same volume the live database is on.
# Repeated failures accumulate one each, and filling that disk takes SQLite's
# write path down with it.
docker compose exec -T sage-burner sh -c 'rm -f /data/backup-*.sqlite'
# VACUUM INTO refuses to overwrite, so write to a fresh name each time — a run
# that dies before the cleanup below must not block the next one.
docker compose exec -T sage-burner \
  node -e "const {DatabaseSync}=require('node:sqlite');
           new DatabaseSync(process.env.DATABASE_URL).exec(\"VACUUM INTO '/data/backup-$STAMP.sqlite'\")"
docker compose cp "sage-burner:/data/backup-$STAMP.sqlite" "./sage-burner-$STAMP.sqlite"
docker compose exec -T sage-burner rm -f "/data/backup-$STAMP.sqlite"
```

Worth doing before any deploy that includes a migration, since a migration that
alters a column is a table rebuild and restoring the volume is the documented
recovery path if one goes wrong.

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

`X-Forwarded-Proto` is not cosmetic: Apache terminates TLS, so without it the
app believes it is serving plain HTTP — which decides whether the session cookie
gets its `Secure` flag.

Set it in the `:443` vhost, not in an include shared with a `:80` one. Hardcoded
to `https` it would lie about a plain-HTTP request, and a cookie marked `Secure`
on a connection that is not would simply never come back.

[#10]: https://github.com/fiddur/sage-burner/issues/10

## Repository layout

```
apps/backend      Fastify API, static serving, Drizzle schema + migrations
apps/web          Preact + Vite single-page app
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation                           (planned)
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
