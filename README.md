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

| Layer    | Choice                                                        |
| -------- | ------------------------------------------------------------- |
| Frontend | Preact + Vite                                                 |
| Backend  | Fastify (Node 25, TypeScript run directly via type stripping) |
| Database | SQLite via Drizzle ORM — one file on a mounted volume         |
| Auth     | Password **and** WebAuthn/passkey, coexisting per account     |
| Calendar | Public read-only `.ics` subscription feed                     |

One Node process serves the API, the built web app, and the calendar feed.

## Local development

Requires Node 25 (see `.nvmrc`) and pnpm 10.

```sh
nvm use
pnpm install
pnpm check      # typecheck + lint
pnpm test       # unit tests, non-watch
```

> **Not available yet.** There is no dev server to run — `apps/backend` and
> `apps/web` don't exist. `pnpm dev:backend` and `pnpm dev:web` are wired up in
> the root `package.json` but will fail until the Fastify backend ([#4]) and the
> Preact frontend ([#5]) land.

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
apps/backend      Fastify API, static serving, ICS feed      (planned, #4)
apps/web          Preact + Vite single-page app              (planned, #5)
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation                  (planned)
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
