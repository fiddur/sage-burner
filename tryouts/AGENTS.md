# Tryouts

A **tryout** happens after a pull request merges to `develop`: boot the merged tree, exercise
the behaviour the PR promised, and file an issue for anything surprising. It is not a second
test suite and not a second protocol — [`../docs/testing.md`](../docs/testing.md) is the
walk-through of the whole app, for a human or an agent, and this folder is the **rig** and the
**method** for checking one merged PR against a copy that is really running.

The rule the whole thing exists to serve is the repository's own: **a claim is only verified if
it was executed** (`../AGENTS.md` → _Claims must be executed, not reasoned about_), pointed at
the running app rather than at the suite.

[← back to the README](../README.md)

## The rig

Everything runs **from source**. Node 24 runs the backend TypeScript directly, the database is
`node:sqlite`, and the web app is a real `vite build` served through `WEB_ROOT` — the same
shape the image has, without the image. **The Docker image is not exercised here.** CI's smoke
test is the check on that, and compose hardening and watchtower are checked nowhere but on the
server.

| Script                 | What it does                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup-environment.sh` | Installs fonts, puppeteer and its matched Chrome under `$TRYOUT_HOME` (default `/opt/tryout`) and records the binary in `chrome-path`. Idempotent — a fast no-op once done. Needs root or `sudo`. |
| `up.sh [--fresh]`      | Installs dependencies, builds the web app, ensures the demo admin, starts the server, signs in. `--fresh` throws the old database away first.                                                     |
| `down.sh [--purge]`    | Stops the server through the pid file. `--purge` also deletes `$TRYOUT_DIR`.                                                                                                                      |
| `login.mjs`            | Signs the demo account in again and rewrites the cookie. Run it when an `/api/*` call starts answering 401.                                                                                       |
| `lib/browser.mjs`      | `launchBrowser`, `signedInPage` and `readState` for puppeteer scripts.                                                                                                                            |

Knobs, all by environment: `TRYOUT_DIR` (default `/tmp/tryout`), `TRYOUT_PORT` (default
`8082`), `TRYOUT_HOME` (default `/opt/tryout`), `TRYOUT_CHROME` (a browser to use instead of
the installed one), `DEMO_EMAIL` (default `demo@sage-burner.test`).

`up.sh` sets `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `WEB_ROOT`, `BUILD_SHA`
and `SESSION_SECRET`, and **passes everything else through**. That is the whole mechanism for
configuration-dependent behaviour: `PUBLIC_ORIGIN=http://127.0.0.1:8082 tryouts/up.sh` restarts
the same database with links in mail turned on, and `TRUST_PROXY=uniquelocal tryouts/up.sh`
restarts it behind a notional proxy. `NODE_ENV`, `HOST` and `LOG_LEVEL` honour an exported
value too; the rest are the run's own.

### What lands in `$TRYOUT_DIR`

| Path                 | What it is                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| `state.json`         | `{ baseUrl, email, password, sessionSecret, cookieName, token, account }`         |
| `token.txt`          | The bare session cookie value, for `curl`                                         |
| `server.log`         | The server's pino output — emptied on every `up.sh`, so a grep sees this run only |
| `sage-burner.sqlite` | The database (plus its `-wal`/`-shm` sidecars)                                    |
| `server.pid`         | What `down.sh` stops                                                              |
| `run/`, `run/shots/` | Yours: scripts, fixtures, screenshots                                             |

**Write your own scripts in `$TRYOUT_DIR/run`, never in the repository.** The one exception is a
backend probe, which has to sit under `apps/backend/src/` for its bare imports to resolve — name
it `_probe-something.ts` and delete it when you are done. Either way a tryout leaves `git status` exactly
as it found it.

The session secret and the demo password are generated per rig, not checked in, and live only
in `state.json`. Do not paste either into an issue, a PR comment or a script in the repo.

## Auth

Cookie only. There is no `Authorization: Bearer` path in this app.

```sh
curl -s -H "Cookie: $(node -p 'JSON.parse(require("node:fs").readFileSync(process.env.TRYOUT_DIR + "/state.json","utf8")).cookieName')=$(cat "$TRYOUT_DIR/token.txt")" \
  "$BASE/api/auth/me"
```

In practice the cookie is `sage_session`, but read `cookieName` from `state.json` rather than
hard-coding it. In puppeteer the cookie is `HttpOnly`, so `document.cookie` cannot set it —
`signedInPage(browser)` from `lib/browser.mjs` does it for you.

The demo account holds **`admin` and `member` both**; read `account.roles` from `state.json`
rather than assuming. When a journey is supposed to start with no roles — signing up, applying,
being approved — make a fresh account through the app's own `POST /api/auth/sign-up` (it needs
`name`, and answers with roles `[]`) and drive apply → admin-approve from there. Do not reuse
the demo admin for it.

A 401 out of nowhere means the cookie expired or the database was replaced: run
`node tryouts/login.mjs` again.

## How to verify

1. Read what the PR claims. The title and body are the promise; the diff is what was actually
   done. Where they disagree, the diff wins and the gap is itself a finding.
2. Boot the rig, and seed whatever state the behaviour needs. Most of this app is burn-scoped,
   so that usually starts with a burn.
3. Back-end or data change: `curl` with the cookie, assert with `jq`.
4. UI change: write a puppeteer script in `$TRYOUT_DIR/run`, exercise the feature, screenshot
   to `run/shots/`, print a JSON summary — and then **Read the screenshots back**. The vision
   pass catches overlap, clipping and dark-mode breakage that no text assertion will.
5. [`recipes.md`](./recipes.md) has the accumulated selectors, API shapes, fixtures and traps,
   grouped by area. Read the section for the area the PR touches **before** writing the script;
   most of what costs an hour is already in there.

**Verification holds only if all three of these do:**

1. You can name the specific behaviour the PR body promised.
2. You executed an API call or a browser interaction that exercises **that** behaviour.
3. You can quote the response or describe the screenshot that shows it happened.

"200 OK" and "the page rendered" are neither. If you cannot get all three, try another approach
before declaring anything.

## What replaces the Docker-era techniques

The recipes were learned against an image and a compose stack. Everything in them still
applies; the mechanics translate like this.

| Then                                             | Now                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `docker exec … node src/_probe.ts`               | The same probe as a file under `apps/backend/src/`, run with `cd apps/backend && node src/_probe.ts`                             |
| `docker cp` a file in                            | Write it where it needs to be, and delete it afterwards                                                                          |
| `docker logs`                                    | `$TRYOUT_DIR/server.log`                                                                                                         |
| `docker compose restart`                         | `tryouts/up.sh` again (the database survives without `--fresh`)                                                                  |
| A throwaway container with different env         | A second rig: `TRYOUT_DIR=/tmp/tryout-b TRYOUT_PORT=8083 PUBLIC_ORIGIN=… tryouts/up.sh --fresh`                                  |
| An SMTP sink at the compose gateway address      | A `node:net` sink on `127.0.0.1`, and point the app's mail settings at `127.0.0.1:<port>`                                        |
| `git archive <sha> \| tar -x` for the merge tree | Still that, or `git worktree add`, for the **pre-merge** tree: `git archive <merge-sha>^1 \| tar -x -C /tmp/pre`                 |
| Reading web sources out of the dist `.js.map`    | The repository is right here — read `apps/web/src/…`. The sourcemap is still the way to check what the **built** bundle contains |
| Diffing the container against the clone          | Nothing to diff: the rig runs the checkout                                                                                       |

One trap survives the translation intact: **never `node -e` for anything that imports a
workspace dependency.** Bare specifiers resolve by walking up from the importing file, and an
`-e` script has no path, so it resolves from the current directory and finds nothing. Write the
probe to a file under `apps/backend/src/`, run it from `apps/backend`, and delete it after.

## Filing what you find

One issue per distinct finding, labelled `tryout-finding`. **Search the open `tryout-finding`
issues first** — and the PR's own review follow-up issue, if it has one — so a known finding is
not filed twice.

```
Title: <short summary>

Followup from #<pr>.

## Problem
<what you observed, with the evidence quoted — response body, log line, or a described screenshot>

## Suggestion
<what should change>

## Repro
<the commands or steps, against a rig booted with tryouts/up.sh --fresh>
```

In the cloud there is no `gh`: the GitHub MCP tools are the whole interface (`issue_write` with
method `create`; their schemas load through `ToolSearch`). On Fredrik's machine it is
`gh issue create --label tryout-finding`. Either way, **never install `gh`**.

If everything works as promised, file nothing. A tryout that finds nothing is a good tryout.

## What this rig cannot do

Say so plainly when you hit one of these. "Not drivable here" is a result; silently skipping is
not.

- **The image, the compose hardening and watchtower.** Out of scope, by design.
- **Anything needing a host outside the environment's network allowlist.** A real browser push
  subscription reaches `fcm.googleapis.com`, and the accepted/gone/failed push endpoints the
  recipes use are on `httpbun.com`. Without those the push paths stop at the app's own edge.
- **Real mail.** There is no SMTP server; the `node:net` sink is the whole of it, and it proves
  what the app sent, not that anything was delivered.
- **More than one browser at a time.** Close each one as soon as its check is done.

## Keeping the recipes alive

[`recipes.md`](./recipes.md) is the reason a tryout costs an hour instead of a day, and it only
stays that way if it grows. A tryout cannot push to `develop`, so when a run learns a technique
worth keeping — a selector, an oracle, a fixture, a trap that cost time — open an issue titled
`tryout recipe: <the technique>` labelled `documentation`, with the recipe written out the way
it would read in the file. Somebody folds it in with the next change.
