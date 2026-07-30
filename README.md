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
password verifications run at once, and up to eight further callers wait in a
FIFO queue; only an eleventh concurrent caller, or one still waiting after five
seconds, gets a `429` with `Retry-After`.

Queued rather than refused, deliberately. A hard cap would mean two sustained
anonymous requests denied every member's login for as long as they held them,
with nothing to wait out. Taking turns means a member arriving mid-flood is
served, and a client holding connections open competes for places rather than
owning them.

Why any of this is needed: every attempt costs ~230ms of CPU and 64 MiB —
including one for an address with no account, since the decoy derivation
deliberately spends the same work — and `scrypt` runs on libuv's threadpool,
four slots by default, shared with the reads that serve static files. Without a
bound, sustained login traffic would degrade the whole app rather than just that
route.

What the app does **not** do is bound the number of _attempts_. There is no
lockout and no backoff, and the gate does not provide one — it bounds concurrent
work, which is a different thing. Two slots at ~230ms is roughly 8–9 tries a
second, about 750,000 a day, sustained indefinitely against one address.

**So configure the proxy.** Something that counts requests per client IP against
`/api/auth/login` — `mod_evasive`, `mod_qos`, or fail2ban watching the access
log — sized well below that figure. A few attempts a minute is generous for a
membership of 42 and leaves an attacker nowhere to go. This matters from the
moment the first account exists, which is the setup step below.

`SESSION_SECRET` is required in production and the app refuses to start without
it. Generating one at boot instead would look like it works and log every member
out on each deploy — with watchtower redeploying on a tag move, every few
minutes after a merge.

[#17]: https://github.com/fiddur/sage-burner/issues/17
[#57]: https://github.com/fiddur/sage-burner/issues/57
[#58]: https://github.com/fiddur/sage-burner/issues/58

### Creating the first admin

`admin:create` makes the first organiser, or grants `admin` to an account that
already exists. Against a running container:

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
is the same one `pnpm admin:create` runs locally.

Or locally, against `./data/sage-burner.sqlite`:

```sh
read -rs -p 'Password: ' ADMIN_PASSWORD; echo
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  pnpm --filter sage-burner-backend admin:create
```

Then log in at `/login`; the nav gains an **Organise** link.

Both values come from the environment, never from arguments. `read -rs` keeps
the password out of the shell history, and `-e ADMIN_PASSWORD` with no `=`
forwards the value from the caller's environment rather than restating it — so
it never reaches the host's process arguments, where any local user can read it
off `ps`. Verified: the container receives it and it appears nowhere in docker's
argv. This is the one password on the system at the moment it is created.

It runs migrations first, so it works against an empty volume — an admin can
exist before the server has ever started.

Two things it deliberately does not do:

- **It never changes an existing password.** Given an address that is already
  here, it grants the role and stops. Otherwise the bootstrap command would
  double as an offline password reset for any account, and anyone who could run
  it could take over the organiser's login rather than merely create one. Run it
  twice and the second run says so.
- **It does not lowercase-and-hope.** The email goes through the same schema the
  API validates against, so `You@Example.org` finds the existing
  `you@example.org` rather than creating a second account beside it — the
  table's `UNIQUE` is byte-exact.

The password must be at least 12 characters. That floor applies to a password
being _set_, never at login: raising it later must not lock out someone whose
existing password no longer passes.

### Roles

Two roles, `admin` and `member`, in `account_role`. No finer-grained
permissions — at this size they would be more to get wrong than to gain.

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

## Events

There is never "the" event. `event` rows exist from day one and the app is built
around recurrence — up to four burns a year, each with its own applications,
members and payments.

### Which event is active

The public homepage and application form need one event, so the rule is written
down rather than inferred per call site:

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

Organise → **Events and welcome text**. Create events there, and edit the welcome
markdown with a live preview. Saving takes effect immediately in the API: the
public response is `Cache-Control: no-cache`, so a browser may store it but must
revalidate, and a correction cannot sit invisible in a cache.

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
- **An empty PATCH body (`{}`) is a 200**, returning the event unchanged. It is a
  no-op rather than an error, and it never reaches the `UPDATE` — which matters for
  the 404 below.
- **A PATCH names only what it changes.** Reading an event, editing the object and
  sending the whole thing back is therefore a 400 on `id` and `created_at`.
- **A date move that would invert the range answers 400**, not a 500 from the
  database. That holds for a body carrying one date as well as two — the check for
  a one-sided move rides in the `UPDATE` itself, so a second organiser moving the
  other date concurrently cannot slip between a read and a write.

A row that disappears between the read and the write answers **404**, the same as
one that was already gone — the body was not the problem, whatever it contained. The
two causes of a failed write are told apart by re-reading the row rather than
inferred from the request, so a well-ordered date move against an event someone else
has just deleted does not come back as "check the dates".

The one exception is the empty body above: `{}` never reaches the `UPDATE`, so
against a vanished row it still answers **200** with the event as it was read.

### Markdown is escaped, not filtered

`welcome_markdown` is admin-authored and rendered to every public visitor, so it
is treated as untrusted: an admin account is one phished password away from
belonging to someone else.

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
that images do not work at all. The cost: an image host an organiser links to
sees the IP of every homepage visitor, and this is the only external request the
app can produce. Narrow it back to `'self' data:` if uploads ever land.

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
