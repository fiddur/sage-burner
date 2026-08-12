# sage-burner

Membership, application, and scheduling platform for small "burner"-style
mini-events — up to ~42 members, a few times a year.

It replaces the spreadsheet-plus-Discord workflow that these gatherings
otherwise run on: people sign up and apply, admins approve them and answer
their questions, members fill in their own camp details, admins
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

**Installability and offline are production-build-only.** Vite proxies `/api` and
nothing else, so under `pnpm dev:web` the manifest 404s and there is no `sw.js` to
register — the registration failure is swallowed on purpose. Build and run the
backend against `dist` to try either.

**Client-side routes must not contain a dot.** The backend distinguishes a
missing asset from a client-side route by whether the last path segment has a
file extension, so anything with one gets a 404 and never reaches the router.
That is what stops a stale page requesting a vanished content-hashed chunk from
being handed the HTML shell. It also means invite tokens must be dot-free.

Everything else — the environment table, the database file, and why the awkward
variables are awkward — is in [docs/configuration.md](./docs/configuration.md).

## Deploying

```sh
git clone https://github.com/fiddur/sage-burner.git && cd sage-burner
cp .env.example .env
sed -i "s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 48)|" .env
docker compose up -d
```

That is the whole of it. No payment gateway, no external database, nothing to
sign up for. Email is optional and set up from inside the app — with no SMTP
server named, no invite is posted and no notification is, and nothing else
changes. The third line is not optional: `.env.example` ships
`SESSION_SECRET=` with no value, and the app refuses to start without one rather
than inventing a temporary key that would sign every member out on each
redeploy. `cp` followed straight by `up` crash-loops with
`Invalid environment configuration: SESSION_SECRET`.

Sign in as the first admin, name the installation, and create a burn. Backups,
reverse proxies, `TRUST_PROXY`, fail2ban and the upgrade path are in
[docs/deploying.md](./docs/deploying.md).

## Documentation

The README is the quickstart. What the app does, feature by feature, is
[docs/features.md](./docs/features.md); each area's decisions — what it does,
and why it does it that way rather than the obvious other way — live in `docs/`:

| Document                                    | What is in it                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| [features.md](./docs/features.md)           | The feature map — everything the app does, one line each                             |
| [testing.md](./docs/testing.md)             | The tryout protocol: walking a running copy through the features                     |
| [configuration.md](./docs/configuration.md) | Every environment variable, the database file, migrations                            |
| [deploying.md](./docs/deploying.md)         | Running it for real: proxy, backups, restore, fail2ban, upgrades                     |
| [accounts.md](./docs/accounts.md)           | Signing up, applying, invites, sessions, passwords, passkeys, roles                  |
| [the-app.md](./docs/the-app.md)             | Getting around, what the installation calls itself, installing it, avatars, markdown |
| [burns.md](./docs/burns.md)                 | Events, attendance, lodging, helping out, the calendar feed                          |
| [schedule.md](./docs/schedule.md)           | Meals, dreams, the lead roles register, places and the grid                          |
| [http.md](./docs/http.md)                   | Security headers, and the shape every API error takes                                |

What changed, release by release, is [`CHANGELOG.md`](./CHANGELOG.md) — which the app
serves at `/changelog`, and which the "a new version is out" notification leads to.

## Repository layout

```
apps/backend      Fastify API, static serving, Drizzle schema + migrations
apps/web          Preact + Vite single-page app
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation, one file per area
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
