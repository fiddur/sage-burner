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
pnpm dev:backend   # Fastify on :3000, migrating on boot
```

`GET /api/version` answers with the build SHA and doubles as the container
healthcheck.

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

> **No frontend yet.** `pnpm dev:web` will fail until the Preact app ([#5])
> lands. Until then the backend serves the API only; set `WEB_ROOT` once there
> is a build to point it at.

## Running it for real

> **Not available yet.** Deployment needs the Dockerfile and compose file from
> [#6]. Once those exist, deploying is `cp .env.example .env` followed by
> `docker compose up -d` — one service, one named volume holding the SQLite
> database, and a watchtower sidecar picking up new images automatically, with
> `docker compose down && docker compose up` preserving your data.
>
> There will be no open signup, so a fresh deployment also needs a way to seed
> the first admin before anybody can be approved ([#10]).

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

[#5]: https://github.com/fiddur/sage-burner/issues/5
[#6]: https://github.com/fiddur/sage-burner/issues/6
[#10]: https://github.com/fiddur/sage-burner/issues/10

## Repository layout

```
apps/backend      Fastify API, static serving, Drizzle schema + migrations
apps/web          Preact + Vite single-page app                       (planned, #5)
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation                           (planned)
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
