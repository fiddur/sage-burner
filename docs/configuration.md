# Configuration and the database

Every environment variable this app reads, what it defaults to, and why the
awkward ones are the way they are. Also how the database file and its migrations
work.

[← back to the README](../README.md)

## Configuration

Every variable is optional except `SESSION_SECRET`, which is required for
anything a browser other than yours could reach. Three signals, any one of which
is enough: `NODE_ENV=production`, a non-loopback `HOST`, or a set `WEB_ROOT`. The
image sets all three, so any container needs a secret; `pnpm dev` needs nothing,
because it is none of them.

Two conditions rather than one because `NODE_ENV` cannot answer the question that
matters. It defaults to `development` when unset, so a bare `node
apps/backend/src/server.ts` — a systemd unit, a hand-rolled deploy, a compose
file that drops the image's environment — would otherwise bind every interface
and sign sessions with the development key that is committed to this
repository.

The other defaults are what you get without any configuration. An empty value is
treated as unset, since `FOO: ${FOO}` in a compose file with `FOO` undefined
expands to an empty string rather than to nothing.

| Variable              | Default                     | Meaning                                                                                                                                                 |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `development`               | `development` \| `test` \| `production`                                                                                                                 |
| `PORT`                | `3000`                      | Port to listen on                                                                                                                                       |
| `HOST`                | `127.0.0.1`                 | Bind address. Loopback by default; the image sets `0.0.0.0`. Binding anywhere else requires `SESSION_SECRET`                                            |
| `DATABASE_URL`        | `./data/sage-burner.sqlite` | SQLite file; parent directory is created                                                                                                                |
| `LOG_LEVEL`           | `info`                      | `fatal` … `trace`, or `silent`                                                                                                                          |
| `BUILD_SHA`           | `unknown`                   | Commit the image was built from                                                                                                                         |
| `WEB_ROOT`            | _(unset)_                   | Directory of the built web app. Unset in dev, where Vite serves it                                                                                      |
| `TRUST_PROXY`         | `false`                     | `false`, `true`, a hop count like `1`, or an address/CIDR list                                                                                          |
| `SESSION_SECRET`      | _(none)_                    | **Required if `NODE_ENV=production`, `HOST` is not loopback, or `WEB_ROOT` is set.** HMAC key for session cookies, 32+ chars. `openssl rand -base64 48` |
| `SESSION_TTL_SECONDS` | `1209600`                   | How long a session lasts. Two weeks                                                                                                                     |
| `PUBLIC_ORIGIN`       | _(unset)_                   | Where a browser reaches this installation, e.g. `https://burn.example.org`. Passkeys, the share card and links in email read it — see below             |

Invalid configuration fails at boot with every problem listed, rather than
starting and behaving subtly wrong.

`PUBLIC_ORIGIN` is reduced to an actual origin at parse: a trailing slash or a
path comes off, since the app is served at a domain root and
`https://burn.example.org/` would otherwise build `https://burn.example.org//api/…`,
which the router will not match.

**Set `PUBLIC_ORIGIN` if you use passkeys.** WebAuthn binds a credential to one
domain and hands it to no other, so the domain has to be settled and stay
settled. Left unset, each ceremony takes the browser's own `Origin` header, which
works — but it means an installation reachable as both a hostname and an IP gives
a member two separate sets of passkeys depending on which link they followed, and
only one set works on any given day. It also means a proxy relaying this app on
another domain would have its own origin accepted, so a member could be led to
register a passkey scoped to it. They still could not use anyone's _existing_
passkey — the authenticator will not sign for a domain the credential was not
registered under — but this closes the other half. It is one line, and it is not
required only because `docker compose up` has to stay sufficient.

The share card reads it too (#306), and is happier without it: `og:url` and
`og:image` are absolute and are otherwise built from the request's own `Host`,
which is what a crawler sends anyway. Setting it pins them to one address, which
is the right answer for an installation reachable at more than one.

`TRUST_PROXY` defaults to trusting nothing. See
[deploying.md](./deploying.md) for what to set it to — with it unset behind a TLS
proxy, `request.protocol` is `http`, so the share card names `http://` on an https
site.

Setting `WEB_ROOT` is a statement of intent to serve the frontend, so the app
refuses to start if that directory is missing, is not a directory, or has no
`index.html`. Without that check a typo'd variable or an unmounted volume would
produce a container that starts, keeps answering the healthcheck, and 404s every
page.

## Database

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
SESSION_SECRET=$(openssl rand -base64 48) WEB_ROOT=$PWD/apps/web/dist pnpm dev:backend
```

The secret is needed because a set `WEB_ROOT` means "serve the built frontend",
which the app counts as a deployment — see [Configuration](#configuration). This
run also gets `Secure` cookies, which is fine over `http://localhost` in Chrome
and Firefox because they treat it as a trustworthy origin, but is not universal;
if login does not stick in some other browser, that is why.

`WEB_ROOT` is resolved against the backend's working directory, which `pnpm
dev:backend` sets to `apps/backend` — so an absolute path is the one that stays
correct wherever you are standing.
