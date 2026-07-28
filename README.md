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

Run the two halves in separate terminals:

```sh
pnpm dev:backend   # Fastify on :3000, against a local SQLite file
pnpm dev:web       # Vite dev server with HMR, proxying /api to the backend
```

## Running it for real

```sh
cp .env.example .env    # then edit it
docker compose up -d
```

That is the whole deployment. One service, one named volume holding the SQLite
database, plus a watchtower sidecar that picks up new images automatically.
`docker compose down && docker compose up` preserves your data.

### First admin

A fresh deployment has no accounts, and there is no open signup — accounts are
only created by redeeming an invite. See `.env.example` for how to seed the
first admin, which you need before you can approve anybody.

## Repository layout

```
apps/backend      Fastify API, static serving, ICS feed
apps/web          Preact + Vite single-page app
packages/shared   Zod schemas and types shared by both
docs/             Longer-form documentation
```

Conventions, code style, and the contribution workflow live in
[`AGENTS.md`](./AGENTS.md).
