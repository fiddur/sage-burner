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
pnpm check      # typecheck + lint
pnpm test       # unit tests, non-watch
```

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

> **No dev server yet.** `pnpm dev:backend` and `pnpm dev:web` are wired up in
> the root `package.json` but will fail until the Fastify backend ([#4]) and the
> Preact frontend ([#5]) land — `apps/backend` currently contains the database
> layer only, and `apps/web` does not exist.

## Running it for real

> **Not available yet.** Deployment needs the Dockerfile and compose file from
> [#6]. Once those exist, deploying is `cp .env.example .env` followed by
> `docker compose up -d` — one service, one named volume holding the SQLite
> database, and a watchtower sidecar picking up new images automatically, with
> `docker compose down && docker compose up` preserving your data.
>
> There will be no open signup, so a fresh deployment also needs a way to seed
> the first admin before anybody can be approved ([#10]).

[#4]: https://github.com/fiddur/sage-burner/issues/4
[#5]: https://github.com/fiddur/sage-burner/issues/5
[#6]: https://github.com/fiddur/sage-burner/issues/6
[#10]: https://github.com/fiddur/sage-burner/issues/10

## Repository layout

```
apps/backend      Drizzle schema + migrations; Fastify API to follow (#4)
apps/web          Preact + Vite single-page app                       (planned, #5)
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation                           (planned)
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
