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
sed -i "s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 48)|" .env
docker compose up -d
```

The second line is not optional. `.env.example` ships `SESSION_SECRET=` with no
value, the image sets `NODE_ENV=production`, and the app refuses to start
without a secret — so `cp` followed straight by `up` crash-loops with
`Invalid environment configuration: SESSION_SECRET`. That refusal is deliberate
(see [Accounts and sessions](#accounts-and-sessions)); this is the step that
satisfies it. Editing that line by hand does the same job.

It fills the blank assignment rather than appending a second one. Compose's
dotenv takes the last occurrence, so appending would also work — but the file
would then read top-down as though no secret were set, which is the same trap
`.env.example` warns about for `TRUST_PROXY`.

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

> **A fresh deployment has no admin.** There is no open signup, so run
> [`admin:create`](#creating-the-first-admin) once against the new container
> before anything else — until then nobody can approve anything.

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

**Add throttling here too.** The app deliberately does not rate-limit login
(see [Accounts and sessions](#accounts-and-sessions)), so this vhost is the only
thing between an attacker and roughly 8–9 password guesses a second against one
address. Nothing else will stop it.

`POST /api/applications` is unthrottled for the same reason and is worth a
separate thought, because it is the only **unauthenticated write** in the app.
The exposure is different in kind: nothing there grants access, approval is a
deliberate human act, and the worst case is an organiser deleting junk out of the
review list rather than anyone getting in. It is a nuisance, not a way through —
but it is a nuisance a burst limiter on this vhost removes, and there is no
in-app limit that will.

fail2ban suits slow grinding better than a burst limiter, since the app answers
every failure with a plain `401`:

```
# /etc/fail2ban/filter.d/sage-burner-login.conf
[Definition]
failregex = ^<HOST> .* "POST /api/auth/login HTTP/[^"]*" 401
ignoreregex =
```

That uniformity is deliberate — a malformed body answers `401` too, so the shape
of the error cannot be used to probe which addresses parse as accounts — and it
is the one drawback of this filter: the pattern above cannot tell a password
guess from a client sending a body the schema rejects. A frontend bug would ban
the member rather than surface itself. Nothing in the access log distinguishes
them, so if you hit that, look at the app log (`login rejected` is logged only
for a real credential failure) before assuming an attack.

```ini
# /etc/fail2ban/jail.d/sage-burner.conf
[sage-burner-login]
enabled  = true
port     = http,https
filter   = sage-burner-login
logpath  = /var/log/apache2/sage-access.log   # must match this vhost's CustomLog
maxretry = 10
findtime = 10m
bantime  = 1h
```

Ten attempts in ten minutes is generous for a membership of 42 and leaves an
attacker nowhere to go. `mod_qos` or `mod_evasive` can cap bursts as well, but
they measure over seconds and a patient attacker simply goes slower.

Untested on your host — the log path in particular has to match whatever
`CustomLog` this vhost sets. Check `fail2ban-regex` against a real log line
before trusting it.

Note there are no `Header set` lines for CSP, HSTS or the rest: the app sends
those itself. Do not add them here — `Header set` _replaces_ what the backend
sent, so a policy written here shadows the app's rather than adding to it, and a
weaker one silently wins. See [Security headers](#security-headers).

`X-Forwarded-Proto` is not cosmetic: Apache terminates TLS, so without it the
app believes it is serving plain HTTP, and `request.protocol` is wrong for every
request — which matters for logging, for redirects, and for anything later that
keys on the scheme.

It does _not_ decide the session cookie's `Secure` flag. That is decided in
`config.ts`, on the same three signals as the secret requirement: `production`, a
non-loopback `HOST`, or a set `WEB_ROOT`. See
[Accounts and sessions](#accounts-and-sessions).

**Running without Docker?** Set `NODE_ENV=production` explicitly. A proxy in
front means the app binds loopback, so "not production" and "loopback" are both
true of a `pnpm start` or systemd unit behind this vhost — and neither says
"deployment". Serving the built frontend (`WEB_ROOT`) is what the app uses to
notice, and it will refuse to start without a `SESSION_SECRET` on that basis; but
`NODE_ENV=production` is what you actually mean, and it does not rely on that
inference.

Set it in the `:443` vhost, not in an include shared with a `:80` one. Hardcoded
to `https` it would lie about a plain-HTTP request, and a cookie marked `Secure`
on a connection that is not would simply never come back.

## Accounts and sessions

There is **no open sign-up**. Accounts are created only by redeeming an invite
([#17]); `/login` says so rather than offering a dead link.

- `POST /api/auth/login` — `{ email, password }`. 200 with `{ viewer }` and a
  session cookie, or 401 `invalid_credentials`.
- `POST /api/auth/logout` — clears the cookie.
- `GET /api/auth/me` — `{ viewer }` or `{ viewer: null }`. Always 200: an
  anonymous visitor on the public homepage is the expected case, not an error.

**Passwords** are hashed with scrypt from `node:crypto` (N=2^16, r=8, p=2 — one
of OWASP's listed configurations). #8 asked for argon2 or bcrypt; both are
native modules, which means a build toolchain in an image whose whole point is
that there is no build step, and the thing most likely to break a Node upgrade.
The parameters are stored in each hash, so raising them later re-hashes on next
login instead of invalidating every account.

Login deliberately spends the same work on an unknown address as on a wrong
password — measured at 220ms versus 0ms before that was fixed. Differing is an
account-enumeration oracle, and on a membership app the membership _is_ the
private part. For the same reason a malformed request body answers 401 rather
than 400.

That equal-work property is conditional, and nothing enforces the condition: it
holds while every stored hash uses the current parameters. Raising them would
make an account still on the old ones verify _faster_ than the decoy, reopening
the oracle in the other direction — and since the opportunistic upgrade runs
only after a successful login, an account whose owner never signs in keeps the
old parameters indefinitely. Raising the cost wants a plan for stale rows, not
just next-login.

**Sessions** are a signed value in an `HttpOnly`, `SameSite=Lax` cookie — not a
database row.

`Secure` is decided once in `config.ts` as `secure_cookies`, on exactly the same
predicate as the `SESSION_SECRET` requirement: `production`, a non-loopback
`HOST`, or a set `WEB_ROOT`. The image is all three, so **every containerised
deployment gets it** — and so does a hand-rolled `pnpm start` behind a proxy,
which is neither production nor non-loopback but does serve the built
frontend. Plain HTTP therefore works on `localhost` only, where browsers treat the origin as trustworthy — and that is
now true by construction rather than by coincidence of the Dockerfile. On any other
plain-HTTP origin — a LAN address, an internal hostname — the browser discards
the cookie silently: login answers 200, the page says you are signed in, and the
next load says you are not. Put TLS in front, as the Apache section below does.

One deliberate hardening, with a cost worth knowing. If a request arrives with
more than one session cookie, both are refused — a legitimate client only ever
sends one, so a second is planted, and refusing beats signing the member into
someone else's account. But logging in again does _not_ clear a planted cookie
set at a different path, so the member stays locked out until it expires or they
clear cookies by hand. Still the right trade against the alternative, and [#58]
is what actually ends it.

The consequence, stated plainly: **logout clears the cookie but does not
invalidate the token**, which stays valid until it expires. That follows from
sessions being signed rather than stored — there is no row to delete — and not
from anything above. A compromised session can only be revoked by rotating
`SESSION_SECRET`, which logs everyone out at once.

**Login is not rate-limited in the app, deliberately.** Throttling repeated
attempts is the reverse proxy's job for now — Apache sees every request first
and can drop a flood before it costs a scrypt hash. [#57] tracks doing it in
the app if that ever stops being enough.

There is a bound on concurrent _work_, which is a different thing. At most two
**scrypt hashes** run at once, and up to eight further callers wait in a FIFO
queue; the eleventh concurrent caller, or one still waiting after five seconds,
gets a `429` with `Retry-After`.

That bound is **shared with invite redemption**, not login's own. One gate covers
both, because what is being protected is libuv's threadpool rather than either
route — two gates of two slots would spend all four threads between them. So the
eleven are eleven of _either_: a flood of redemptions can shed a login and the
other way round, which is the point.

Queued rather than refused, deliberately. A hard cap would mean two sustained
anonymous requests denied every member's login for as long as they held them,
with nothing to wait out. Taking turns means a member arriving mid-flood is
served, and a client holding connections open competes for places rather than
owning them.

Why any of this is needed: every attempt costs ~230ms of CPU and 64 MiB —
including one for an address with no account, since the decoy derivation
deliberately spends the same work, and including a redemption that is going to be
refused — and `scrypt` runs on libuv's threadpool, four slots by default, shared
with the reads that serve static files. Without a bound, sustained traffic to
either route would degrade the whole app rather than just that route.

What the app does **not** do is bound the number of _attempts_. There is no
lockout and no backoff, and the gate does not provide one — it bounds concurrent
work, which is a different thing. Two slots at ~230ms is roughly 8–9 tries a
second, about 750,000 a day, sustained indefinitely against one address.

**So configure the proxy**, and for **both** paths that spend a hash:
`POST /api/auth/login` and `POST /api/invites/:token/redeem`. Something that counts
requests per client IP — `mod_evasive`, `mod_qos`, or fail2ban watching the access
log — sized well below that figure. A rule scoped to login alone leaves half the
gate's callers unthrottled, and redemption is the worse half: its `409` for an
address that already has an account never spends the invite, so one held link
drives it indefinitely. A few attempts a minute is generous for a membership of 42
and leaves an attacker nowhere to go. This matters from the moment the first
account exists, which is the setup step below.

`SESSION_SECRET` is required in production and the app refuses to start without
it. Generating one at boot instead would look like it works and log every member
out on each deploy — with watchtower redeploying on a tag move, every few
minutes after a merge.

[#17]: https://github.com/fiddur/sage-burner/issues/17
[#57]: https://github.com/fiddur/sage-burner/issues/57
[#58]: https://github.com/fiddur/sage-burner/issues/58

### Creating the first admin

`admin:create` makes the first organiser, or grants the roles to an account
that already exists. Against a running container:

```sh
read -rs -p 'Password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD

docker compose exec \
  -e ADMIN_EMAIL=you@example.org \
  -e ADMIN_PASSWORD \
  sage-burner node apps/backend/src/cli/create-admin.ts
```

`node` rather than `pnpm` inside the container on purpose: the image purges
corepack's cache to keep ~24 MB out of a layer watchtower re-pulls on every
deploy, so `pnpm` there re-downloads itself from the network first. The script
is the same one `pnpm --filter sage-burner-backend admin:create` runs locally.

Or locally, against `./data/sage-burner.sqlite`:

```sh
read -rs -p 'Password: ' ADMIN_PASSWORD; echo
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  pnpm --filter sage-burner-backend admin:create
```

Then log in at `/login`; the nav gains an **Organise** link, plus **Your burn**
and **Your details** — it grants `member` alongside `admin`, because an
organiser is almost always also coming.

Both values come from the environment, never from arguments. `read -rs` keeps
the password out of the shell history, and `-e ADMIN_PASSWORD` with no `=`
forwards the value from the caller's environment rather than restating it — so
it never reaches the host's process arguments, where any local user can read it
off `ps`. Verified: the container receives it and it appears nowhere in docker's
argv. This is the one password on the system at the moment it is created.

The **local** invocation runs migrations first, so it works against an empty
volume: an admin can exist before the server has ever started. That is not what
makes the container recipe above work — `docker compose exec` needs a container
already running, which has already migrated on boot. There the migration has
happened regardless.

Two things it deliberately does not do:

- **It never changes an existing password.** Given an address that is already
  here, it grants the roles and stops. Otherwise the bootstrap command would
  double as an offline password reset for any account, and anyone who could run
  it could take over the organiser's login rather than merely create one. Run it
  twice and the second run says so.
- **It does not lowercase-and-hope.** The email goes through the same schema the
  API validates against, so `You@Example.org` finds the existing
  `you@example.org` rather than creating a second account beside it — the
  table's `UNIQUE` is byte-exact.

The password only has to be non-empty. There is no length or composition rule:
those are the app deciding what a good password is on someone else's behalf, and
they push people towards the one they already reuse everywhere. A rule here would
also have to apply to a password being _set_ and never at login, so that adding
one later cannot lock out an existing member.

### Notifications

Admins can be told when someone applies, per **browser** rather than per person:
a subscription belongs to the browser it was made in, so an admin with a laptop
and a phone turns it on in both. Organise → Settings.

Browser push is the one thing in this app that reaches outward at runtime. The
notification travels via whichever push service the browser chose — Google's for
Chrome, Mozilla's for Firefox — and the container therefore needs outbound HTTPS.
Nothing has to be signed up for or configured: the VAPID pair is minted into the
`installation` row the first time an admin asks for the key, so an installation
that never turns notifications on never acquires one. That keeps `docker compose
up` sufficient, which is the same argument #59 makes for `SESSION_SECRET`.

The endpoint is **https-only**. It is the one field whose stored value the server
itself then requests, on every application, so a `http://10.0.0.5/…` there would
point the container at something on its own network. Only admins can write it and a
real push service is always https, so requiring the scheme costs nothing. Narrowing
past that would mean an allowlist of every browser vendor's endpoint, which goes
stale the moment a new one appears.

**The payload says only that someone applied.** No name, no contact, nothing from
the application. Push payloads are encrypted to the browser's own key, so the push
service cannot read them — but a notification is read on a lock screen, and the
applicant's details are theirs until an admin opens the page.

Sending is **fire-and-forget**. `POST /api/applications` is public and
unauthenticated, so awaiting a push service there would let a stranger make the
server wait, and a push outage would turn a successful application into an error
for the person applying. Failures go to the log and nowhere else.

A subscription the push service answers `404` or `410` for is **deleted**: the
browser has thrown it away, and keeping the row would retry a dead endpoint on
every application forever. Any other failure keeps it — a 500 from Google is not a
reason to forget someone's phone. Subscriptions also cascade with the account, so
a deleted account leaves none behind.

The service worker is `apps/web/public/sw.js`, deliberately plain JavaScript and
deliberately tiny: it is copied verbatim to the site root, which is where a worker
has to live to claim `/` as its scope, and that puts it outside the type-check and
the suite. It handles `push` and `notificationclick` and nothing else — no fetch
handler, no caching — so there is nothing in it worth testing. `@fastify/static`
serves everything outside `assets/` as `no-cache`, which is what lets a redeploy
replace it.

**Delivery itself has no test**, and cannot have one here: it needs a real browser
to produce a subscription and a real push service to accept it. What is tested is
everything around it — who may subscribe, that the payload carries no personal
detail, that an application still answers 201 when the push service is down, and
that a gone subscription is deleted while a failed one is kept. `deliver` is
injected for exactly that reason, and `web-push` sits behind it as the one place
that does RFC 8291 encryption.

### Roles

Two roles, `admin` and `member`, in `account_role`. No finer-grained
permissions — at this size they would be more to get wrong than to gain.

They are separate concepts and neither implies the other. `admin` opens the
organising pages; `member` opens a person's own details and saying they are
coming to a burn. An organiser who is not attending is coherent, so `admin`
deliberately does not confer `member` — but the ordinary case is both, which is
why `admin:create` grants both.

### What a member may change

This replaces a shared spreadsheet where everyone could edit everything except
paid status, so the default for the burn's **shared furniture** is any approved
member — not admin:

| Open to any approved member   | Still admin                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Schedule places, per burn     | The burn's shape: name, slug, dates, gate times, `member_cap`, and creating one |
| The lodging and helping lists | Payment                                                                         |
| A burn's welcome text         | Applications, invites, role grants, installation settings                       |
| The lead-roles register       |                                                                                 |
| Who is coming, by name        |                                                                                 |

"Approved" means **`member` or `admin`**, and the second half is load-bearing.
The roles are independent — the accounts table grants either on its own, and an
organiser who is not attending is coherent — so an account can hold `admin` and
not `member`. A `member`-only guard would lock that person out of setting the burn
up. That is `requireApproved` in `auth/guards.ts`.

(`admin:create` grants both, as the Roles section says, so the account an
installation starts with is not the example. The example is anyone given `admin`
afterwards without `member`.)

Personal details stay the person's own: nobody edits somebody else's name, contact
or allergies.

**The roster is still admin-only**, and that is the code rather than the intent. It
is served from `/api/admin/events/:eventId/roster`, it carries contact details,
allergies and payment state, and a member cannot read it — which is a gap, since
whoever cooks needs the allergies. Opening the read while keeping the write to a
person's own stay is #159; this section describes what the guards do today, not what
was decided for later.

What a member _can_ read is **who is coming, by name**:
`GET /api/events/:eventId/attendees` returns account ids and display names and
nothing else. The lead-roles register has to offer somebody to hand a role to, and
that is the whole of what it needs. It is a separate route rather than a relaxed
roster on purpose — a route that selects two columns cannot leak a third by
someone later returning whole rows, and `attendance.test.ts` asserts the body
carries no contact, allergies or payment state.

Two consequences worth knowing rather than discovering.

**The welcome text is last-write-wins, over the whole field.** `PATCH
…/welcome` overwrites it rather than merging, so two people editing at once means
one of them loses their paragraph and neither is told. The editor re-reads the
current text when it opens, which shrinks the window from "since the page loaded"
to "since Edit was pressed" — that is the difference that matters for a field
forty-odd people now share, and it does not close it. Closing it properly means
versioning the field and answering 409, which is more machinery than four burns a
year justifies. The admin `PATCH` under Organise → Events is partial per field, so
two organisers touching different fields there do not collide; this one is a single
field, so they always do.

And deleting a helping option takes every member's ticks for it with it — `attendance_helping` cascades — so a
member can now remove something other people signed up for. That follows from the
spreadsheet default rather than being an oversight, and it is the same trust the
lead-roles register assumes in #27.

The welcome text is edited **on the homepage**, where it is read — whoever spots a
typo is the one likely to fix it — through `PATCH /api/events/:id/welcome`. An admin
can also edit it under Organise → Events, alongside the dates and the cap, which
goes through the admin `PATCH` with everything else. That is
a route of its own rather than a carve-out in the admin `PATCH`, and the reason is
the paragraph below: opening one field of the admin route would move the burn's
shape out from under the prefix hook and turn its protection back into a branch. A
`.strict()` body means a `member_cap` sent there is a `400`, not a dropped key.

**Every route under `/api/admin/` requires `admin`, whether or not the route
asked.** One `onRequest` hook on the prefix, rather than a `preHandler` per
route: opt-in protection is a line a new route has to remember, and forgetting
it ships that route world-readable — nothing type-checks it, nothing fails, and
the tests written beside it pass. There is a test that registers a route and
never guards it, and it is refused.

The hook keys on the matched route's own pattern, so an encoded path cannot step
around it. It covers the bare `/api/admin` as well as everything beneath it — an
admin index page is the obvious route to add next, and matching only
`/api/admin/` would have let exactly that one in unauthenticated. For an
unmatched path the hook still runs, since the not-found handler inherits the same
`onRequest` chain; there is simply no route pattern there to match. A Fastify
plugin scope would be the more idiomatic seam and is weaker here — it covers
what is registered on it, so a future route declared on the root instance with
an `/api/admin` path would slip past. The prefix is what the paths already agree
on.

One consequence worth knowing: `onRequest` runs _before_ body parsing, where a
`preHandler` ran after it. A caller with no session gets 401 rather than a parse
error describing their own JSON, and the body of an unauthorized request is
never read at all.

Organise → the **Accounts** table sets them, a checkbox per role per account.
`PUT /api/admin/accounts/:id/roles` takes the whole set the account should end
up with, not a delta: the editor sends what the row now says, so it cannot
express "add admin, forget to remove member".

Removing the last `admin` is refused with **409**. The count is taken inside the
transaction, after the write, so the rule is decided against the state the write
actually produced; a `throw` rolls it back. Two organisers stepping down at the
same moment leave one, and a test asserts it.

Nothing stops an organiser removing their _own_ `admin` while another exists —
that is stepping down, not a lockout.

Authorization is a `preHandler` on the route, not a hidden link:
`/api/admin/*` answers **401** with `{ "error": "unauthenticated" }` when nobody
is signed in and **403** with `{ "error": "forbidden" }` for a signed-in account
without the role. The two are different on purpose: 401 is a client's cue to
send the visitor to login, and 403 must never be — that would bounce a member
around a loop logging in again cannot fix. That is the contract, not yet a
description; the web app currently renders both as a message rather than
redirecting.

The web app hides what a viewer cannot use, but that is presentation. Every
admin route refuses server-side regardless of what the nav rendered.

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

## Events

There is never "the" event. `event` rows exist from day one and the app is built
around recurrence — up to four burns a year, each with its own members and
payments.

Applications are the exception, and deliberately so: you apply to the community
once, not to a burn. Approval admits you to any of them, so `application` and
`form_question` carry no `event_id` and outlive any single event.

### Who a person is, and which burns they come to

Two different lifetimes, so two different places.

**The `account` carries the person.** `name`, `contact`, `allergies_notes` and the
invite they came in on live there, one row per human. They are nullable because an
account can exist before anyone fills them in — the bootstrap admin is created
from the CLI with an email and nothing else.

**`attendance` carries one stay**, keyed `(event, account)`: arrival and
departure, lodging, shift preference, notes, and payment. Payment is per burn and
never a flag on a person.

The split is not cosmetic. Held per burn, `allergies_notes` meant a copy for every
burn someone attended, and correcting one left the others wrong — on data that
exists to keep people safe. It is also what the central application model implies:
you are approved into the community once, so the details describing _you_ cannot
hang off a single event.

An invite's single use is enforced by a **partial unique index on
`account.invite_token_id`** — partial because NULLs compare distinct in SQLite and
every CLI-created account has none. Deleting the account would stop the index
objecting, so redemption stamps `used_at` in the same transaction; neither
mechanism is sufficient alone.

### Which event is active

The public homepage needs one event, so the rule is written down rather than
inferred per call site. (The application form does not — it is not tied to a
burn, so it works with no events at all.)

> The **active event** is the soonest-ending event whose end date has not passed.
> Ties break on start date, then slug.

Consequences worth knowing:

- An event **running today is still active** — mid-burn is when the homepage
  matters most, and a rule keyed on the start date would drop it the moment it
  began.
- An event **ending today is still active**, until UTC midnight. The comparison
  is in UTC rather than a configured timezone: the only thing it decides is when
  an event stops being the active one, and a few hours either way on the closing
  day is not something an organiser would notice. A timezone setting would be a
  config knob, a migration and a test matrix bought for that.
- Once **every** event has ended there is no active event. The endpoint answers
  `{ "event": null }`, and it deliberately does not fall back to the most recent
  past event — that would leave last year's welcome text served as though it
  were an invitation. Creating the next event is what fills the gap.

`GET /api/events/active` is public and answers `{ "event": null }` rather than a
404 before the first event exists — that is the ordinary state of a fresh
deployment, not an error.

### Editing an event

Organise → **Events**. Create burns there, and edit any of it afterwards — name,
dates, hours, member cap and the welcome text are all on the same form. The hours
in particular need to be editable: a burn created before anyone thought about them
takes the whole-day default, and the schedule grid is drawn from them.

The public homepage renders it: name, dates and the welcome markdown, with
"Apply to join" and "Log in" for a signed-out visitor. The editor's preview uses
the same renderer, so what it shows is what a visitor gets.

A slug collision answers **409** rather than a generic failure — the slug appears
in URLs, so it is something the organiser fixes by choosing another.

Four more things the write routes do, for anyone writing a second client:

- **An unrecognised key is a 400**, on create and update alike. A body is not
  filtered down to what the schema knows: `welcome` instead of `welcome_markdown`
  is refused rather than silently dropped, which on create would have produced an
  event whose welcome text was quietly empty and on update a "saved" that saved
  nothing.
- **An empty PATCH body (`{}`) is a 200** for an event that exists, returning it
  unchanged, and a **404** for one that does not. It is a no-op rather than an
  error, and it is the only body that reads instead of writing.
- **A PATCH names only what it changes.** Reading an event, editing the object and
  sending the whole thing back is therefore a 400 on `id` and `created_at`.
- **A date move that would invert the range answers 400**, not a 500 from the
  database. That holds for a body carrying one date as well as two — the check for
  a one-sided move rides in the `UPDATE` itself, so a second organiser moving the
  other date concurrently cannot slip between a read and a write.

A PATCH responds with the event **as written**, not with the body merged onto what
was read a moment earlier — so if another organiser's change landed in between, the
response reflects it rather than reporting a value nobody stored.

A row that disappears before the `UPDATE` reaches it answers **404**, the same as
one that was already gone — the body was not the problem, whatever it contained. The
two causes of a failed write are told apart by re-reading the row afterwards rather
than inferred from the request, so a well-ordered date move against an event someone
else has just deleted does not come back as "check the dates".

### The application form's questions

`form_question` rows, never code — and **one central set**, not one per burn.
Someone applies to join the community once, the way they would be let into the
Discord server; attending a particular burn is a separate act afterwards (#76).
Organisers retune the questions between burns, so adding, editing, reordering or
removing one must never need a redeploy, and the web app renders whatever it is
handed rather than knowing the questions.

Organise → **Application questions**. Types in v1: short text, long text,
checkbox, and _agreement_ — a checkbox that must be ticked to submit.

Two rules that are the server's, not the browser's:

- **`order` is assigned by the server.** A new question goes last; a client
  cannot pick a position. Two organisers adding at once would otherwise collide
  over a number neither of them chose, so the read and the insert run in one
  transaction.
- **Reordering sends the complete list of ids**, in the order wanted, and a
  partial list is rejected with 400. Moving one question renumbers several, so a
  request naming only some of them would leave the rest on stale positions — an
  order nobody chose. The renumbering itself runs in a transaction, so a reorder
  is all-or-nothing.

  The check deciding _whether_ to renumber is evaluated before that transaction
  opens, so the check-and-apply as a whole is not atomic the way `POST`'s
  read-and-insert is. That is fine rather than overlooked: a question created
  concurrently takes `order = max + 1` and still sorts after the positions being
  written, and one deleted concurrently updates zero rows and leaves a gap, which
  `order` tolerates because it only has to sort.

`GET /api/questions` is public — the application form is public, so its questions
are — and `no-cache`, so a question added a moment ago is not hidden behind a
stale response. Every write is admin-only.

**Help text is markdown**, edited in a textarea with Write and Preview tabs. It
carries the things that need more than a line — the 10+1 principles an
`agreement` asks someone to accept, for instance — so it needs lists and
paragraphs. It was a 2000-character single-line `<input>`, which made writing
them impossible.

The label stays plain single-line text: it is the field's accessible name, and a
list inside a `<label>` is not markup a screen reader can make sense of. Long
text belongs in the help text below it.

Rendering is the same `renderMarkdown` the welcome text uses — raw HTML escaped
rather than filtered, link and image URLs checked against an allowlist. See
[Markdown is escaped, not filtered](#markdown-is-escaped-not-filtered).

**`required` is decided by the type for the two tick-box kinds, not chosen.**

- An **`agreement`** is always required. The type exists because submission is
  blocked when it is unticked, so `{ type: 'agreement', required: false }`
  contradicts itself.
- A **`checkbox`** is never required. It always has an answer — `false` is one —
  so "must be present" is vacuous, and the only other reading of a required
  checkbox is "must be ticked", which is what `agreement` already means. Two
  spellings of one rule is the ambiguity, so the second is refused.

The API rejects both combinations, on create and on any PATCH that would produce
one — including a PATCH naming only `type` or only `required`. The schema cannot
decide a lone key, so that case is settled **inside the `UPDATE` statement**
rather than by re-reading the row and checking in JavaScript: a check either side
of an `await` is check-then-act, and two concurrent patches could each pass their
own before either wrote.
`db/schema.ts` carries a CHECK for each, because `required` has `.default(false)`
and an insert that omits it never touches a Zod schema. The editor disables the
control with a note rather than letting a tick become a 400.

All four places derive from one function, `tickBoxRequired`, rather than restating
it — including the database, whose CHECKs are generated from the vocabulary the
same way the type constraint is. Written out separately the copies drifted within
the hour: the handler covered `agreement` and not `checkbox`, and the gap surfaced
as a 500 from the CHECK instead of a 400. Generating the SQL matters for the same
reason it mattered in the API — a fifth type with a fixed `required` would
otherwise be enforced everywhere except the one place that is supposed to hold
when nothing else does.

`options` exists as a JSON column for future select/radio types and is not yet
consumed by any type. Both it and `help_text` are optional in a create body —
`.nullable()` does not make a key optional, so omitting them used to be a bare
`bad_request` naming no field. `required` is enforced server-side on submission,
which is [#14]'s half of the work.

[#14]: https://github.com/fiddur/sage-burner/issues/14

## The calendar feed

`GET /events/:eventId/schedule.ics` is the programme as a calendar subscription,
so people can put it in their phone rather than reloading a page.

**Unauthenticated**, because a calendar client cannot hold a session — subscribing
is a URL a phone re-fetches on its own. The event id is a UUID, so the URL is
unguessable, but it is not a secret beyond that: **do not post it anywhere outside
the gathering.** That is the trade that lets descriptions go out in full.

What leaves the building is the title, the description, the times, and the place's
name, emoji and colour. No host, no contact details, no allergies, no payment
state.

Two guards, catching different things:

- **The route parses every row through `publicSessionSchema`**, which strips what
  it does not name. Widening the `select` cannot widen the feed — the extra
  column is dropped before rendering. Adding the field to that schema instead
  fails `schemas.test.ts`, which pins its exact key set. So a field reaches the
  feed only if someone deliberately edits the allowlist and its test.
- **A denylist in `schedule.test.ts`**, asserted against the **rendered feed**
  rather than the query. It only catches what someone thought of, so it is seeded
  with every field the fixtures carry.

The first was written before the feed existed and then not wired in: the schema
was declared "the guard rail for an unauthenticated endpoint" while the route
hand-built the same shape beside it, so the key-set test gated nothing anyone
used. It is invoked now, and a test bypasses the parse to prove the feed depends
on it.

### Choices worth knowing

**Everything is emitted in UTC `Z` form.** No `VTIMEZONE`, nothing to get wrong
across a DST boundary: an instant is an instant and the client renders it wherever
the reader is. Emitting Europe/Stockholm wall-clock time would mean shipping
timezone rules that go stale. There is a test for an October burn, which is where
a local-time renderer drifts by an hour.

**No `SEQUENCE`.** It exists for iTIP — emailed invitations, where a client has to
tell a newer copy of one event from an older one. A subscription feed is refetched
whole and replaced by `UID`, so there is nothing for it to decide, and there is no
version column to derive an honest number from. Always-`0` would look like
handling and be none.

**`grey` is emitted as `gray`.** RFC 7986 `COLOR` takes CSS3 names, and a name
outside that list is silently ignored — the lane would just lose its colour with
nothing to say why.

Folding counts **octets, not characters**, per RFC 5545: a place emoji is four
bytes, so a line that looks short can be well over the 75-octet limit, and a fold
in the middle of a multi-byte sequence corrupts it.

## Dreams

The workshops, ceremonies and happenings members offer each other. **A dream with
no time slot is offered but not yet scheduled** — that is where most of them sit
right up until the burn, and it is the normal state, not an error.

**Members**, not admins. `/api/events/active/sessions` and `/api/sessions/:id` are
behind `requireMember`, because the schedule belongs to the people coming: any
member may reschedule any dream, not only the one who offered it. Gated on the
`member` role rather than on having an `attendance` row, so someone can help plan
next burn's programme before they have said they are coming.

The host is **the member who offered it**, taken from the session and never from
the body — `sessionCreateSchema` omits `host_account_id` entirely, so a dream in
someone else's name is a 400 rather than an edit anyone can make by hand.
Reassigning one is still not offered; the list to pick from now exists
(`GET /api/events/:eventId/attendees`, added for the roles register), so what is
missing is the route and the control, not the names.

`session.location` was free text; it is now `place_id`, referencing #78's places.
The scheduling grid draws one column per place, and a column cannot be spelled
three ways. The column has no `onDelete`, so **deleting a place a dream stands in
is refused with a 409** rather than quietly unscheduling it; `places.ts`
translates the foreign key failure. Not a pre-read, which would be check-then-act
— the dream can be created between the read and the delete.

### The slot rule, applied to the row as it would be

A slot is both ends or neither, and the end comes after the start.
`withValidTimeSlot` enforces both at the boundary whenever both keys are present.
A PATCH carrying **one** end cannot be judged on its own, so the handler reads the
row, merges the update onto it, and runs `hasValidTimeSlot` — the same rule, one
copy of it.

Deliberately **not** composed into the `UPDATE`'s `WHERE`, unlike
`stayOrderCondition` in `profile.ts`.
Those compare calendar dates, which are fixed-width `YYYY-MM-DD` and so sort
correctly as SQL strings. These are ISO **instants**, where
`'…T09:00:00.500Z' < '…T09:00:00Z'` is true lexicographically — a string
comparison would accept a slot ending half a second before it starts. Reading the
row and comparing with `Date.parse` is both simpler and the only sound option.

Two bugs lived here, and both were single-user, no concurrency needed:

- `hasWholeSlot` used `== null`, so an **absent** key read the same as a null one
  and every single-ended reschedule was a 400 before the row was consulted. An
  absent key now defers to the merged-row check, exactly as
  `violatesTickBoxRules` already did for the tick-box pair.
- The first attempt at the merged rule only checked that the _other_ end existed,
  never that the two were in order — so `PATCH { time_slot_start: '23:00' }` on an
  18:00–20:00 dream stored an inverted slot and answered 200.

### Editing is scoped to the burn that is open

`PATCH` and `DELETE` take a session id, and both check that the dream belongs to
the active event, the way every other member-facing route does. A finished burn's
programme is history; an id noted while it was current is not a way to rewrite
it.

### Editing sends only what changed

The edit form seeds its state once, at mount. Sending all five fields back would
carry the values it loaded — so fixing a typo in a title would put the place and
slot back as they were then, undoing whatever another member scheduled in the
meantime. Concurrent editing is the _premise_ of this page, so that is the
ordinary case rather than a rare one. The form sends only the fields it changed, which
`sessionUpdateSchema`'s `.partial()` already accepts. An untouched save sends
`{}`, the documented no-op read.

Each field is compared **in the form's own units**. Comparing a round-tripped
timestamp against the stored one instead calls an untouched slot changed whenever
the stored value carries seconds — the inputs are minute-precision — and quietly
zeroes them.

This is not optimistic locking and does not pretend to be: two members editing
the same _field_ still last-writer-wins. It removes the case where they edit
different fields and one loses anyway.

### The timetable

`/schedule` draws places across and hours down, over **the hours the burn is
actually open** — `start_date`/`start_time` through `end_date`/`end_time`. A burn
that opens midday Friday and closes midday Sunday is 49 rows, not three whole
days of mostly-empty grid.

Those hours are the organiser's, set on the event form beside the dates. They
replaced a guess: the grid used to run 00:00 on the first day through the last
hour of the day _after_ `end_date`, the extra day being a stand-in for a last
night that carries past midnight. An organiser who can say "ends 04:00 on the
6th" does not need the app inventing anything.

Rows are walked by adding an hour to an instant rather than by setting hours on a
date, which also disposed of a bug: on the spring-forward day `setHours(2)` lands
on 03:00, so 03:00 appeared twice and two rows shared a key. Crossing the gap by
addition passes it exactly once, and the deduplication that used to paper over it
is gone.

Editing an event reads the row, merges the patch onto it, and checks the result.
A body carrying one date — or only a time — cannot be judged on its own: a
multi-day burn may legitimately run 22:00 to 10:00, and narrowing it to a single
day makes that pair invalid without the body saying anything. The condition this
replaced was composed into the `UPDATE ... WHERE`, which handled one date against
the stored other but could not see the times at all, so those patches reached the
database and came back as a **500** from `event_date_order_check`.

The times are `HH:MM`, fixed width, and both Zod and a CHECK compare them as
strings — sound only because `09:00` cannot also arrive as `9:00`, which is why
the format is enforced in both places. The ordering rule compares the **pair**:
times decide it only when the days are equal, since across days an end earlier on
the clock than the start is the ordinary case.

**A dream occupies every row it runs through**, via `rowSpan`. Drawn only in its
start row, a three-hour session reads as an hour long — which is exactly how one
was misread. The rows underneath must then render no cell at all, or the whole
column shifts sideways; `laneCells` returns `covered` for those. Two dreams
starting in the same hour share a cell, and one starting inside another's block
joins it rather than disappearing, because an overlap in one lane is an
organiser's mistake to see.

Each chip also carries its own `18:00–21:00`, so the length is readable without
counting rows.

The page opts out of the site's reading measure — `--measure` is a width for
prose and squeezes a timetable into a sliver on a wide screen. **That one is not
covered by a test**: the suite renders in happy-dom, which applies no CSS, so
nothing here can tell a styled grid from an unstyled one.

**The pool holds whatever the grid does not draw**, derived rather than guessed.
Missing a time or a place is the common case, but a dream can also be timed
outside the days on show, and guessing "unplaced means a null field" left that one
in neither the grid nor the pool — gone from the page while still fine on
`/dreams`. Deriving it means nothing can vanish whatever the date.

The grid runs one day **past** `end_date`, because a burn's last night regularly
carries into the small hours of the day after. A dream at 01:00 is part of the
burn whatever the calendar says.

Dragging an already-scheduled dream to another lane **keeps the length it had**.
Forcing an hour would quietly shorten a two-hour session for the crime of being
moved.

Rows are built from the event's calendar days rather than from any instant,
because that is what "the burn runs the 1st to the 5th" means to whoever typed
it. They are also deduplicated, for the one hour a year that does not exist:
on the spring-forward day `setHours(2)` lands on 03:00, so 03:00 would appear
twice and two rows would share a key. Checked in Europe/Stockholm, which the web
suite is pinned to.

Both drag sources write to `dataTransfer` on `dragstart`. The id travels in
component state, so nothing reads it back — but Firefox refuses to begin a drag
whose data store was never written to, so without it the gesture simply does not
start there. Test it in Firefox as well as Chrome.

**Dragging is not really unit-tested, and cannot be.** `fireEvent.drop` exercises
these handlers, not a browser's drag implementation — so the tests prove the
wiring and the drag itself wants one click-through in a browser. The Dreams page
is the precise route and the accessible one: a form with a place and two datetime
fields, reachable by keyboard, which is what anyone who cannot drag should use.

### Times are UTC, wall clocks are not

The API stores and transports UTC; `<input type="datetime-local">` has no timezone
at all and speaks the browser's wall clock. `apps/web/src/datetime.ts` converts
both ways. Slicing the ISO string is the obvious-looking shortcut and is wrong by
the UTC offset everywhere but London in winter.

The web suite is pinned to `Europe/Stockholm` in `vite.config.ts` for exactly this
reason: **in UTC every wrong implementation of that conversion looks right**, so
running the suite in UTC would silently stop testing it. Verified — with the pin,
the slicing shortcut fails whatever the ambient `TZ`; without it, it passes in CI.

## Roles

The spreadsheet's roles tab: who is looking after what at this burn. `/roles`,
open to any approved member.

A role carries a title, a **purpose** and a **tasks include** — both markdown,
like every longer field shown to other people — three independent effort answers
for before, during and after, and a **wanted team size**. It has one lead and may
be vacant, and one person may lead several roles and be on several teams.

**Any approved member may add, edit and remove any role, staffed or not.** This is
a deliberate divergence from every other structural edit here, which is admin's:
the events are co-created, and at forty-odd people trust is the mechanism rather
than a permission table. There is no undo, which is the accepted cost — the page
asks before removing, and the removal takes the team's sign-ups with it.

**The wanted team size is advisory and the API never enforces it.** The page shows
"2 of 4 wanted" and still offers "join the team" at 4 of 4. That is the opposite of
the lodging list, which disables a full option, and the difference is the point: a
bed is finite and a pair of hands is not.

The lead and the team reference **`attendance`, not `account`**, so only somebody
coming to that burn can hold something in its register, and withdrawing vacates
the role and drops the team membership through the foreign keys rather than through
a cleanup somebody has to remember. The role itself stays, vacant. Handing a role
to an account with no attendance on that burn is a **400** rather than a 404 — the
account exists, it is the pairing that is wrong.

Names are resolved at read time from `account`, never copied into the register: a
name corrected on the profile page is corrected here too.

### Seeding a new burn from a previous one

Fifteen roles retyped four times a year is the friction worth removing.
`POST /api/events/:eventId/roles/copy` takes a `from_event_id` and brings the
definitions — titles, purpose, tasks, effort, team sizes — and **none of the
people**: who led the sauna last summer is a fact about last summer.

It answers **409** when this register already has roles. Merging two registers is a
decision nobody asked for, and "copy into empty" is the case that removes the
retyping. The page offers the control only while the register is empty, for the
same reason.

`GET /api/events/:eventId/roles/sources` is what fills that picker: the other burns
that already have a register, newest first, with their name and how many roles they
hold. It exists because `GET /api/admin/events` is admin-only and a member picking
a burn to copy from would otherwise have nothing to choose between. Only burns with
a register appear, and only their name — a burn's dates and cap stay admin's.

## Lodging, and helping out

The two things a member says about their stay used to be free text, so nobody
could count them and every burn re-invented the vocabulary. `event_option` holds
both lists as rows — **per event**, unlike the application questions and the
places, because what there is to sleep in depends on the site and what wants
doing depends on the year.

Organise → **Lodging and helping**, which follows the burn that is open. Setting
them up before it starts works, since "active" is the soonest-ending burn that has
not finished.

A lodging entry can carry a number of spaces — "Temple mattress: 9" — or leave it
blank for the ones that do not run out, like a tent of one's own. Helping entries
never do: nothing runs short of people willing to tend a sauna. Zero spaces is
refused rather than allowed; an option nobody fits in is a deleted option spelled
confusingly.

Free text became a reference, and the migration folds whatever was already typed
into `notes` rather than dropping it — "hammock in the barn" is not an id, so
there is nothing to map it onto, but an organiser still reads notes. Truncated to
2000 there, which is what the schema allows.

A member picks one lodging option on **your burn**, and the select disables the
ones that are full, reading "— full". That is presentation: the API takes what it
is sent, so `PATCH /api/events/active/attendance` counts the takers and answers
**409** for a full option.

The count is a plain read-and-compare, not race protection. Two people taking the
last mattress in the same millisecond can both succeed; at forty-odd people that
is an organiser moving one of them, not something to build machinery against.

The option a member already holds is never disabled for them, even when it reads
as full — their own bed counts towards the total, so disabling it would make the
select fall back to "not decided" and quietly give the bed up on the next save.

The lists carry a `taken` count per option, derived every read. It is the only way
to tell a member the Temple is full without showing them who is sleeping in it.

A member ticks **as many helping-out options as they like**, and can write in one
the list does not have. The ticks are rows in `attendance_helping`, not a JSON
array: the whole reason the list exists is so an organiser can count who is up for
the kitchen, and counting inside a JSON column is the thing that gets rewritten
later. The write-in sits beside them rather than instead of them — the point of
the list is counting, the point of the write-in is that a list is never complete.

The columns and the ticks arrive in one PATCH and are written in one transaction.
The ticks are validated before anything is written, but that check has a window:
an option deleted in the moment between it and the write rolls the column write
back too, rather than answering an error over a half-saved stay.

Both sides of that join cascade. Withdrawing from a burn takes the ticks with it,
and so does an organiser removing an option — **unlike lodging**, where a bed
someone is in must not vanish underneath them. Nobody is displaced by "kitchen"
ceasing to be offered.

`kind` is not editable. The two lists number independently, so changing it would
leave an entry ordered against the list it came from — moving one is deleting and
adding.

The number of spaces is checked by `min` and the input's implicit whole-number
step, and by nothing in JavaScript. A browser will not submit a form containing an
invalid number, so a guard beside it is unreachable code — the same two-validator
trap as `required` versus `aria-required`, reaching the opposite conclusion: for a
name the page must be the authority because it has something to say, for a count
the browser already says it. There is a test asserting the form does not submit,
which is what proves the guard would have been dead.

## Places

Somewhere a dream can happen — the Temple, the Sauna, the Front Lawn. Rows
rather than code, the same as the application questions: the site changes
between burns and adding a place must never need a redeploy. **One grid per
event**, seeded from a previous burn.

That was one central list until #156, on the reasoning that the venue outlives the
burn. Half right: the venue does, the set in use does not. Some spots are
summer-only and a large event tent is there some years and not others, so a global
list meant every schedule grid carried lanes that do not exist at this burn — and
the grid is the thing the list exists to build. The same shape `event_option`
already had for lodging and helping: definitions per burn, seeded rather than
retyped.

Organise → **Places**, which follows the burn that is open. A pencil edits, a trashcan removes, and the ⠿ handle
reorders — by dragging, and by ArrowUp/ArrowDown while it has focus. The handle
takes keys as well as drags because a reorder only a pointer can do is one some
people cannot do at all.

Each place carries an emoji and a colour, which is how a lane is recognised at a
glance in the scheduling grid (#20) and what the ICS feed will carry alongside
the location (#21).

The colour is a **name from a fixed palette** — `red`, `orange`, `yellow`,
`green`, `blue`, `purple`, `pink`, `grey` — not free hex. An organiser who
picked `#fefefe` for a lane would produce unreadable text that nothing in the
app could correct, and naming the colour rather than valuing it lets light and
dark themes each choose their own shade. A CHECK generated from the same
vocabulary keeps the database from drifting.

The emoji is bounded but not pattern-matched. A ZWJ sequence such as 👩‍🚀 is
several code points and the set grows with every Unicode release, so a regex
would reject valid input on a schedule nobody could fix without a deploy.

`GET /api/events/:eventId/places` is **public**, like `/api/questions`: the ICS
feed publishes a session's location to anyone holding the link, so the list of
places is already public by design. Writes are open to any approved member — the
lanes are the burn's furniture, not admin's. Editing and deleting stay on
`/api/places/:id`, since an id already names one burn's lane.

**Every write needs the burn to be open — to have not ended yet** (#171). A
finished burn's grid is the record of what happened there, and an id noted while
that burn was current should not still be a way to rewrite it. The rule is "has
not ended" rather than "is the active burn", which is what the dreams routes use:
a lane is laid down per burn, and that is how a burn still months off gets its
grid set up, so scoping to the single soonest-ending burn would refuse the setup
the copy exists for. A burn ending _today_ is still open, so the last day is not
too late. All five writes are scoped the same way — closing only the two that
take a bare id would be an archive half shut. Reading is untouched, including
reading a finished grid in order to copy it forward.

`order` is the server's to assign, so `POST` refuses a caller that sends one —
otherwise two places could claim the same lane. `event_id` is refused for the same
kind of reason: the path already says which burn, and a body naming another would
be a second, disagreeing opinion. New places land after **this burn's** last row,
assigned inside a transaction so two simultaneous adds cannot both read it; each
burn therefore numbers from zero rather than continuing wherever the previous one
stopped. `PUT /api/events/:eventId/places/order` takes **every** place of that
burn exactly once; a partial list would renumber some rows and leave the rest on
stale positions, and an id from another burn is refused rather than allowed to
reach into a grid the request is not about. Deleting does not renumber the
survivors: `order` only has to sort, not be contiguous.

**A dream can only stand in its own burn's lane.** The foreign key cannot say
that — it only knows the place exists — so `sessions.ts` checks the pairing and
answers 400. Without it a dream could hold a lane the grid does not draw, and it
would vanish from the page while still holding a row.

### Seeding a grid from a previous burn

`POST /api/events/:eventId/places/copy` takes a `from_event_id` and brings the
lanes, **carrying their order** so the copied grid reads left to right the way the
burn it came from did. Never the dreams standing in them: which burn's Temple a
dream was in is a fact about that burn. It answers **409** into a grid that already
has lanes, and the page offers the control only while the grid is empty — merging
two grids is a decision nobody asked for. The _target_ has to be open; the source
does not, since copying forward out of a finished burn is the case it was built
for.

`GET /api/events/:eventId/places/sources` fills that picker, and
`GET /api/events/:eventId/roles/sources` is the same query for the roles register;
both go through `copySourcesFor`. It exists because `GET /api/admin/events` is
admin-only, so a member choosing a burn to copy from would otherwise have nothing
to choose between. Only burns that already hold something appear, and only their
name and count — a burn's dates and cap stay admin's.

### The migration

`place` gained `event_id NOT NULL`, and existing rows went to **the last created
event**, ordered by `created_at` — there was one event, and every row belonged to
it. `created_at` rather than `start_date` because "last created" is what was
decided, and it does not change meaning when somebody edits a burn's dates.

The SQL is hand-written, which is unusual here. drizzle-kit emits
`ALTER TABLE place ADD event_id text NOT NULL REFERENCES event(id)`, and SQLite
refuses that outright — _Cannot add a NOT NULL column with default value NULL_ —
with nowhere to put the backfill even if it did not. So it is the
create-copy-drop-rename rebuild, which is also what lets the foreign key carry
`on delete cascade`.

**With no event, the places are dropped.** The join selects nothing. That is the
right answer rather than a loss: no event means no `session` rows either, since
they reference one, so the places are unreferenced decoration — but it is worth
saying out loud, because "the migration deleted my lanes" is otherwise a surprise
on a fresh install that happened to seed places.

A data migration is only tested by running it over the old shape with rows in it,
so `db.integration.test.ts` stages a migrations folder holding everything up to but
excluding the rebuild, seeds through the old table, and then runs the full set. It
asserts the staged set does not contain the rebuild — a mistyped tag would stage
every migration and every one of those tests would pass while proving nothing.

### Applying

`POST /api/applications` is the only public write in the app, and that is the
point — an applicant has no account yet. Everything in the body is therefore
attacker-controlled, so two things are true by construction:

- **The submitter names their answers and which questions they were shown, and
  nothing else.** `id`, `status` and the timestamps are the server's. The schema
  is `.strict()`, so an attempt at any of them is a 400 rather than a quietly
  dropped key — a request that tried to approve itself must not look like it
  succeeded. What `asked` is allowed to decide — and what it is not — is set out
  below.
- **The questions are re-read from the database on every submission**, never
  taken from the request.

**Answers store the question, not a reference to it.** Each entry is
`{ question_id, label, type, value }`: the id so a reviewer can line the same
question up across applications, and the wording exactly as that applicant saw
it. A bare reference does not survive the form changing, and the form is meant to
change — questions are rows precisely so organisers can retune them between
burns. Without the snapshot, editing a question would silently re-file every past
answer under wording nobody was shown, and deleting one would leave answers that
cannot be labelled at all. Neither is recoverable afterwards, which is why the
cost is paid on write.

One entry is stored per question **asked**, answered or not, so a reviewer can
tell "said no" from "was never asked". An absent tick box stores `false`; an
absent optional text answer stores `""`.

**"Asked" means the form said so, not that the question exists now.** The
submission carries `asked` — the ids the page actually rendered — and only those
get an entry. Without it, a question an organiser added while someone was filling
the form in was stored against them as `""` or `false`, which reads as "asked and
declined" about a question they never saw.

`asked` narrows what is **stored**, never what is **checked**. Validation runs
against the server's own list, or "I wasn't shown that" would be the way to skip a
required question or an agreement — so a required question added in that window
still answers 400, and the form still says to reload rather than to try again.

An answer naming a question outside `asked` is a **400** rather than a dropped
key: the body disagrees with itself, and silently discarding it would lose what
somebody typed.

An id in `asked` that the server no longer has is a question deleted while the
form was open, and what happens then depends on whether it was answered:

- **with no answer key in the body, it is a 201** with no entry. There is nothing
  to store — the wording comes from the question row, and the row is gone.
- **with a key, it is a 400**, and not by the `asked` rule at all: `answerProblems`
  sees an answer naming no question it holds and says `unknown`, before the
  filtering is reached. The form's advice for a 400 — reload and send again — is
  right for it.

The distinction is the key, not what the field looked like. `Apply.tsx` writes
`answers[id]` on every keystroke, so a text question typed into and then cleared
sends `''` — a key, and therefore the 400 — while one never touched sends
nothing.

**The wording is still read at submission, not sent.** All of the above is about
which questions get an entry; the label on each one comes from the question row
as it is when the application lands. So an admin who _edits_ a question's text
while someone is filling the form in has that answer stored under the new
wording, against a question they were shown the old one for. That is the trade
`asked` does not touch and deliberately: taking the wording from the body would
let a submission record a question in words nobody wrote, which is the worse of
the two. #85's fix narrows what is stored, not where the words come from.

What this does _not_ claim: a crafted body can omit an optional question it was
shown and left blank, so it records as never-asked rather than as `false` or
`""`. Understating your own application is not an attack worth defending against,
and the direction that matters is closed — nothing can be recorded as answered
that the body does not claim was asked.

**What makes a submission valid** lives in `answerProblems`, in
`packages/shared`, and both sides use it: the server refuses on it, and the form
marks its fields with it. Written twice they drift, and the drift is a form that
says everything is fine against an API that answers 400. The rules:

- a `required` question must have a non-blank answer — trimmed, so `required`
  means "said something" rather than "sent the key";
- an `agreement` must be ticked, which is the entire reason the type exists.
  Absent counts as unticked, because that is what a browser sends for a box
  nobody touched;
- a tick box takes a boolean and a text question a string — `'false'` is truthy,
  so accepting a string for a tick box would tick an agreement nobody ticked;
- an answer to a question that was not asked is refused rather than stored.

The module is deliberately free of Zod so the browser can import it — see the
`sideEffects` note under [Shared schemas and types](AGENTS.md#shared-schemas-and-types-packagesshared).

The form itself hardcodes nothing about the questions: it renders whatever
`GET /api/questions` returns, in `order`. Adding a question in the admin UI makes
it appear on the public form with no deploy, which is the acceptance criterion
`form_question` exists for.

There is **no email**. Nothing is sent on submission and nothing is sent on
approval, so the confirmation screen says so outright rather than leaving an
applicant waiting for a message that will never arrive.

### Reviewing applications

`GET /api/admin/applications` lists everything sent in, newest first, with the
answers as stored — the question wording included, so an organiser reads what the
applicant was actually asked rather than what the form says today.

Approving and rejecting are the same shape, and the shape is the point:

```sql
UPDATE application SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
```

Zero affected rows means someone already decided it, which is answered `409`
rather than silently re-deciding. The decision and the guard against
re-deciding are **one statement**, so there is no window between them — a
double-clicked Approve mints one invite, not two. `invite_token_application_idx`
is the backstop underneath that, and the page tells the organiser to reload
rather than to try again, since retrying cannot help.

**Approval mints the invite.** 32 CSPRNG bytes, base64url, valid 30 days. Only
the SHA-256 digest is stored, so the raw token exists in that one response and
nowhere else — a leaked backup or a stray copy of the volume hands out no
invites. The organiser copies it into Discord or Messenger themselves; there is
no email.

**A lost link is re-issued, not worked around.**
`POST /api/admin/applications/:id/invite` mints a replacement and shows it once,
the same way approving does. The link is shown in a paragraph that vanishes on
reload and the organiser has to paste it into Discord before navigating away, so
losing it is a realistic accident rather than carelessness.

**The row is updated, not replaced**, which is what makes this safe. One invite per
application stays the invariant `invite_token_application_idx` already enforces, and
rewriting `token_hash` kills the lost link in the same statement that mints its
replacement — the old token no longer hashes to anything stored.

That matters because of what the previous workaround cost. Until this route,
recovery meant minting a _direct_ invite with `POST /api/admin/invites`, and:

- **the original link stayed live.** It is the token that is lost, not the row, and
  `DELETE /api/admin/invites/:id` refuses an application's invite precisely because
  it belongs to one. A lost link turning up later could still be redeemed — with a
  _different_ email, since the same address answers `409` against the account they
  now have. An invite is forwardable and whoever holds it is a stranger, so that was
  the likelier shape anyway: a second, unrelated account off an approval meant for
  one person (#137).
- **the answers were orphaned.** A direct invite carries no `application_id`, so
  what they wrote was not tied to the account they ended up with.

Re-issuing closes both by construction. Direct invites remain, for the person who
never applied through the form.

**Refused once the invite has been used.** By then they are already in, and a fresh
link would be a second account by another name — the same hole from the other end.
An application that is pending or rejected is refused too: pending is approved
instead, and rejected is not reopened by a side door.

The copy button is deliberately silent on failure rather than claiming a copy
that did not happen.

The link is assembled in the browser from `window.location.origin`, so the API
needs no notion of its own public URL.

**An invite carries no `event_id`.** It admits you to the community, not to a
burn — the application has no event either — and which burns you then come to is
a separate decision each time.

### Direct invites

For people already known — returning members, partners — who should skip the form
entirely. `POST /api/admin/invites` mints the **same** token an approval does, so
both kinds redeem through one path: CSPRNG bytes, digest stored, raw value
returned once. The default is 30 days; an organiser can set `expires_at`, and one
already in the past is refused rather than stored, since it would be a link
nobody could use.

`GET /api/admin/invites` lists them with a **derived** status — `outstanding`,
`used`, `expired`. Derived rather than stored, because an invite becomes expired
by time passing, not by anyone writing to it, and a stored status would be a
value in the database that quietly stops being true. `used` beats `expired`: a
redeemed invite that later lapses is spent, and calling it expired would suggest
re-issuing a link to someone who is already in.

The list never carries the digest, let alone the token.

**Only an unredeemed direct invite can be revoked.** The other two cases are
refused with `409`, for different reasons:

- a **redeemed** invite is the record of how someone got in, and `account`
  references it — deleting it would rewrite how the group formed;
- an **application's** invite is the only one that application will ever have, so
  revoking it would leave that applicant with nothing to redeem. A direct invite
  gets them in; what cannot be recovered is the tie back to what they wrote, and
  #91 owns re-issuing against the application itself.

The organiser UI offers Revoke on exactly those — every unredeemed direct invite,
**expired ones included**, since an expired link is still a row worth clearing
out and the route deletes it happily.

### Redeeming an invite

`/invite/:token` is where both membership paths converge. Unauthenticated, and the
token is the only credential — an invite is unguessable but **forwardable**, so
whoever holds it is a stranger until they redeem.

`GET /api/invites/:token` answers `200` with one of four statuses —
`outstanding`, `expired`, `used`, `unknown` — and **nothing else**. Not a 404 for
an unknown token, and not who the invite was minted for: either would turn a
leaked link into a way of probing for live ones, or into a disclosure. The page
needs the distinction because the three dead ends want three different things
done about them: an expired link can be re-sent, a used one usually means you
already have an account, an unknown one is usually a truncated paste.

`POST /api/invites/:token/redeem` creates the account, fills in the person-level
fields, grants the `member` role and signs them in. **One transaction**, because
half a redemption is the worst outcome: a spent token with no account behind it
leaves the person unable to finish with the link they were sent, and that link
cannot be re-sent — somebody with admin has to notice and mint a direct invite
(#91).

Two races are closed, and each has a test that fails without it:

- **Two people, one link.** Both requests read the invite as outstanding, then
  both spend ~230ms in `scrypt` before writing, so they genuinely interleave. The
  stamp is `UPDATE … WHERE id = ? AND used_at IS NULL` requiring one affected
  row, so the loser's transaction rolls back whole.
- **Two links, one email.** Both pass the email pre-check before either writes, so
  the loser's insert meets the `UNIQUE` and its stamp rolls back with it — leaving
  that invite still usable.

The password is hashed _outside_ the transaction. Holding a write transaction open
across 230ms of scrypt would block every other writer for that long.

It is also hashed **before** the check for an address that already has an
account, so the refusal costs what a success costs. `POST /api/auth/login` is
shaped the same way.

**This throttles an enumeration channel; it does not close one, and the
difference is worth stating plainly.** A `409` does not spend the token, so
whoever holds one unspent invite can ask "does this address have an account?"
about address after address — and the _status code_ answers that regardless of
timing: `409` for a member, `201` for anyone else. Latency was a redundant second
copy of an answer the status line already gives. What the ordering buys is cost:
each probe now spends a gated scrypt. With `SCRYPT_GATE`'s two slots and scrypt at
~230ms that is a ceiling of **about nine probes a second**, shared with every
login — against thousands a second when the refusal was free. #57 is what would bound it
properly, and there is a test that pins the residual so this paragraph cannot
quietly go stale.

Spending the token on the taken-address refusal would cap a held invite at one
probe. It is deliberately not done: someone who typos an address that happens to
belong to a member would lose their invite over it, and a new one needs an admin.

That hash goes through the **same gate as login**, not one of its own — the gate
bounds concurrent scrypt against libuv's four threads, so two gates of two slots
would spend the whole pool between them. There is a test holding the only slot
from the redemption side and asserting login is shed, which fails if they ever
drift apart. Over the bound both answer `429` with `Retry-After`.

The `POST` gives **one answer** — `409` — for unknown, expired and spent alike.
Not to hide which it is: the `GET` above says so plainly to anyone who asks, and
could not usefully do otherwise. It is that the client has nothing to do with the
difference at this point — the page has already read the status, and by the time
it POSTs all three mean the same thing, that this link cannot be spent.

**No `attendance` row is created.** Redeeming makes you a member of the community;
saying which burn you are coming to is a separate act, and #76 owns it.

A signed-in visitor is not offered the form — redeeming would create a second
account for the same human, and the page cannot tell whether that was meant.

### Coming to a burn

Being in the community and coming to a _particular_ burn are separate acts.
Approval admits you once; then you decide, burn by burn. `attendance` is that
second decision, keyed `(event, account)`, and it is what arrival dates, dreams
and shifts hang off later.

A member says it for themselves at `/my-burn`:

- `GET /api/events/active/attendance` — the open burn and their row, either of
  which may be null. "No burn open" and "open, not coming" are different states
  and the page says so rather than showing a dead button.
- `POST` — **idempotent**. Saying it twice is the same statement, not an error: a
  double click, a retried request and a second tab all land there.
- `DELETE` — withdrawing, but **only while nothing has been paid**. What a refund
  means is a real decision and #31 owns it; deleting the row here would quietly
  discard the record that money changed hands.

An organiser can do it for someone, because people ask over Discord and an
organiser should not have to talk them through a UI:
`POST|DELETE /api/admin/events/:eventId/attendance`. The admin delete carries **no
payment guard** — undoing a mistaken add has to be possible, and an organiser
doing it is making the call deliberately.

**Being able to sign in is not being a member.** These routes are behind
`requireMember`, so an account with no roles — invited but not yet redeemed — and
an admin who is not also a member are both refused. The two roles are separate
rows in `account_role`, and redemption grants only `member`. `admin:create`
grants both, and the accounts table under Organise is where either is added or
taken away afterwards.

### A stay starts as the whole burn

Joining writes `arrival_date` and `departure_date` from the event, rather than
leaving them null for everyone to type in what the event already knows. The
organiser adding someone gets the same default.

Written on join, not merely prefilled in the form. Prefilling keeps "never said"
distinguishable from "said the whole burn", but it leaves the roster showing
blanks for almost everyone — which is the column an organiser is reading it for.
The people arriving late or leaving early are the ones who should have to change
something.

It is a default, not a decision: the dates stay editable, and the ordering rule
still applies to whatever replaces them.

### Every date pair binds to its partner

`arrival`/`departure`, a burn's `start`/`end`, and a dream's slot each set `min`
or `max` from the other end, so the picker will not offer an inverted range. No
date library — two native inputs bound to each other were enough, which is worth
knowing before anyone reaches for a dependency.

**A hint, not a rule.** A `max` is something a keyboard can walk straight past and
an API client never sees, so `withStayOrder`, `withEventDateOrder` and
`hasValidTimeSlot` all still decide it, along with their CHECKs. What this removes
is the ordinary way to produce an invalid pair and be told off afterwards.

One detail with a test on it: an unset partner means the attribute is **absent**,
not empty. `max=""` is not reliably "no maximum".

### Members maintain their own record

Two pages, because the record has two lifetimes.

`/profile` edits the **person**: name, contact, allergies. These follow you from
burn to burn, so correcting an allergy corrects it everywhere — which is the
whole reason they live on `account` rather than per stay.

`/my-burn` edits the **stay**: arrival, departure, lodging, shift preference,
notes, for the burn you have said you are coming to.

**Whose row is written comes from the session, never from the body.** There is no
id in either request to guess at or tamper with, and `account_id` in a profile
PATCH is a 400 rather than a redirect of the write.

`payment_status` and `payment_date` are omitted from what a member may send. A
member who could write them could mark themselves paid, so the page shows the
status and offers no control for it — a control that always failed would be worse
than none.

`email` is not editable here either: it is the login identity, and changing it is
a different act with verification nothing implements yet. The page says so rather
than offering a field that fails.

**A partial date edit is checked against the row, not against the body.** A PATCH
carrying only `departure_date` can invert the stored pair without ever containing
both values, so the schema's refinement cannot see it. The condition is composed
into the `UPDATE ... WHERE`, which is sound here because both are fixed-width
calendar dates. `events.ts` and `sessions.ts` read the row and check the merge
instead, their rules having grown to span fields a string comparison cannot
judge.

### Who is coming, and who has a place

`/admin/roster` is the spreadsheet's Members tab. Person-level fields are joined
in from `account` rather than copied, so an allergy corrected on someone's own
profile page is corrected here in the same moment.

**The order decides who gets a place:**

> Paid first, then unpaid. Within each group, order of joining that burn. The
> first `member_cap` entries have a place; everything below the line is waiting.

The consequence is the point rather than a side effect: **paying moves you above
every unpaid member**, regardless of who joined first — so an unpaid member can
be pushed onto the waiting list by someone else paying, without doing anything
themselves. That is what makes paying the thing that secures a place, and it is
why recording a payment reloads the whole list rather than ticking one row.

**The cut is derived, never stored.** A `waiting` flag would go stale the moment
anyone paid, and the whole rule is that paying re-sorts the list. `withPlaces` in
`packages/shared` computes it — placed there rather than in the route because
#79's member-facing list has to give the same answer, and two pages telling
someone different things about where they stand is worse than one of them being
absent.

Recording a payment sends **the status and nothing else** — an organiser
recording money received has no business rewriting an arrival date in the same
request. `payment_date` is not accepted at all: it is derived from the status and
the server's clock in the same statement that writes the status, the way
`joined_at` already is, so unmarking clears the date and one can never outlive the
payment it recorded.

That is the invariant as a property of the write rather than of the caller. It
used to be neither: the schema was `.partial()` over both columns, so
`{ payment_status: 'unpaid' }` alone left yesterday's date standing and a date
alone recorded a payment the status denied. Nothing enforced it and no `CHECK`
linked the columns — it held because the one caller always sent both.

**Backdating is deliberately not supported.** An organiser recording a transfer
that landed last week is a real need, and the answer to it is a field with the
status validated against it, not one the server silently overrides. Sending
`payment_date` is a `400` rather than an ignored key, so nobody can believe they
backdated something that in fact reads as today.

**`partial` is gone from the payment vocabulary.** Two values, not three: a
half-payment is chased out of band. It was never set by anything, drove a
database CHECK and a branch in the member's page, and an unreachable value every
consumer has to handle is the trap the error-code vocabulary already argues
against.

CSV export quotes every field unconditionally rather than only when needed.
Allergies and notes are free text that will contain commas, quotes and newlines,
and a rule applied some of the time is one that gets tested some of the time.

### Markdown is escaped, not filtered

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

**Do not add these headers in the Apache vhost as well**, in either direction:

- `Header set` **replaces** the app's header, so a policy written there is the
  only one the browser sees — including a weaker one, and including a
  `Strict-Transport-Security: max-age=300` that quietly undoes the year above.
- `Header add`/`append` emits a second header, and browsers _intersect_ multiple
  CSP headers rather than letting one win — so the page ends up more restricted
  than either policy alone, and debugging why a script is blocked when neither
  policy blocks it is miserable.

The app is the single place this is configured.

One assumption the policy rests on is pinned rather than trusted:
`apps/web/index.html` must stay free of inline `<script>`, `<style>`, `on*=` and
`style=`, **and of any absolute URL that starts a fetch** — a `src` on a script
or image, or an `href` on a `<link>` that actually loads something
(`stylesheet`, `modulepreload`, `icon`, `manifest`, `preload`, `prefetch`). A
CDN stylesheet is blocked by `style-src 'self'` just as surely as an inline
block. A `rel="canonical"` or `rel="preconnect"` is not checked, because no
directive governs it.

Vite passes most of that file through untouched, so either would break the built
app in production with nothing else failing. One exception, verified rather than
assumed: an inline `<script type="module">` is extracted into the entry chunk and
never reaches `dist/index.html`. A classic inline `<script>`, a `<style>` block,
`on*=` and `style=` all survive verbatim. There is a test asserting all of it —
stricter than strictly necessary, which is the safe direction.

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

The vocabulary today is `bad_request`, `not_found`, `internal_error`,
`invalid_credentials`, `unauthenticated`, `forbidden`, `conflict` and
`rate_limited`, defined in
[`packages/shared`](./packages/shared/src/schemas/error.ts). It grows with the
routes that emit it, rather than being listed in advance and left unreachable.

`unauthenticated` and `forbidden` are separate because 401 and 403 are the one
distinction a client cannot safely collapse — signing in fixes the first and
does nothing for the second. `conflict` exists because a duplicate event slug is
something an organiser fixes by choosing another, which a generic `bad_request`
would not convey.

`invalid_credentials` covers a wrong password and an unknown address alike:
telling those apart is an account-enumeration oracle.

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
