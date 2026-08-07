# Running it for real

Deploying sage-burner, backing it up, and the one thing `docker compose up` does not do for you.

[← back to the README](../README.md)

## Before the first deploy

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
in [`AGENTS.md`](../AGENTS.md) for what a green rollup does and does not mean.

## Deploying

```sh
cp .env.example .env
sed -i "s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 48)|" .env
docker compose up -d
```

The second line is not optional. `.env.example` ships `SESSION_SECRET=` with no
value, the image sets `NODE_ENV=production`, and the app refuses to start
without a secret — so `cp` followed straight by `up` crash-loops with
`Invalid environment configuration: SESSION_SECRET`. That refusal is deliberate
(see [Accounts and sessions](./accounts.md)); this is the step that
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

## Backups

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

## Restoring

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
> [`admin:create`](./accounts.md#creating-the-first-admin) once against the new container
> before anything else — until then nobody can approve anything.

## Deployment shape

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
(see [Accounts and sessions](./accounts.md)), so this vhost is the only
thing between an attacker and roughly 8–9 password guesses a second against one
address. Nothing else will stop it.

`POST /api/applications` is unthrottled for the same reason and is worth a
separate thought, because it is the only **unauthenticated write** in the app.
The exposure is different in kind: nothing there grants access, approval is a
deliberate human act, and the worst case is an admin deleting junk out of the
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
weaker one silently wins. See [Security headers](./http.md#security-headers).

`X-Forwarded-Proto` is not cosmetic: Apache terminates TLS, so without it the
app believes it is serving plain HTTP, and `request.protocol` is wrong for every
request — which matters for logging, for redirects, and for anything later that
keys on the scheme.

It does _not_ decide the session cookie's `Secure` flag. That is decided in
`config.ts`, on the same three signals as the secret requirement: `production`, a
non-loopback `HOST`, or a set `WEB_ROOT`. See
[Accounts and sessions](./accounts.md).

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
