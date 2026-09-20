# The post-merge tryout routine

A tryout used to run on a webhook service on Fredrik's machine, against the freshly built Docker
image. It runs instead as a **Claude Code routine**: a cloud session fired by a GitHub trigger,
which boots the merged tree from source with the scripts in this folder.

This file is what to type into the routine's settings, and the instructions to paste into it.

**None of this has been through a cloud run yet.** The environment half in particular —
whether Chrome's download passes the network level, whether the setup script caches — is
unverified until the first tryout actually fires. Fix what the first run shows and correct this
file in the same PR.

[← back to the tryout brief](./AGENTS.md)

## Trigger

| Field      | Value                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source     | GitHub                                                                                                                               |
| Repository | `fiddur/sage-burner`                                                                                                                 |
| Event      | `pull_request`, action **closed** (or "All PR events" if the form offers no per-action choice — the instructions re-check it anyway) |
| Filter     | Is merged = **true**                                                                                                                 |
| Filter     | Base branch **equals** `develop`                                                                                                     |
| Connectors | GitHub only                                                                                                                          |

## Environment

- **Setup script**: the contents of [`setup-environment.sh`](./setup-environment.sh). It is
  optional — the instructions run it again at the start of every tryout, where it is a fast
  no-op — but putting it here caches the ~200 MB browser install into the environment image
  instead of paying for it on every merge.
- **Node** needs no setup script: `.claude/hooks/session-start.sh` is checked in and installs
  Node 24 at session start. This environment's setup script is the **one exception** to the rule
  in the root `AGENTS.md` that the field stays empty, and it is an exception for the browser, not
  for the toolchain.
- **Network.** The rig needs `registry.npmjs.org` and `nodejs.org`, which the _Trusted_ level
  allows. `setup-environment.sh` also needs the Ubuntu apt mirrors and
  **`storage.googleapis.com`**, which is where `puppeteer browsers install chrome` downloads from
  — if Trusted refuses it, switch to a custom allowlist that adds it. Two hosts are needed only by
  the push recipes and are otherwise best left out: `fcm.googleapis.com` (a real browser push
  subscription) and `httpbun.com` (the accepted/gone/failed push endpoints).

## Instructions

Paste this into the routine's instructions field.

```
You are running a post-merge tryout of sage-burner. A pull request has just merged to `develop`;
your job is to prove by execution that the behaviour it promised actually happens in a running
copy, and to file an issue for anything surprising.

There is no `gh` in this environment and no GraphQL. GitHub is the GitHub MCP tools, the
`mcp__github__*` set; their schemas load through ToolSearch when only their names are listed.
Never install `gh`. Never commit, never push, never open a pull request.

1. Find the pull request number from the event that started this session.
2. `pull_request_read` with method `get`. If it is not merged, or its base is not `develop`,
   stop and do nothing.
3. Read the title, the body and the diff (`get_diff`, or `get_files` when the diff is large).
   If the change touches only markdown and documentation, `.github/`, or `tryouts/` itself,
   there is nothing to run: stop without filing anything and without commenting.
4. Check out the merged tree:
   git fetch origin develop && git checkout --detach <merge_commit_sha>
5. `node --version` must print v24. If it does not, run
   `CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh` by hand and prefix every later
   command with `export PATH="/opt/node24/bin:$PATH"` — the repository's AGENTS.md says why.
6. `tryouts/setup-environment.sh` (a fast no-op if the environment already has the browser),
   then `tryouts/up.sh --fresh`.
   If the rig will not boot after two attempts, comment on the pull request with the tail of
   $TRYOUT_DIR/server.log and stop. Do not spend the session fighting the rig.
7. Read `tryouts/AGENTS.md` and follow it. Consult `tryouts/recipes.md` for the area the pull
   request touches before writing any script — the selectors, API shapes, fixtures and traps are
   already in there.

Verification holds only if all three hold: you can name the specific behaviour the PR body
promised; you executed an API call or a browser interaction that exercises that behaviour; you
can quote the response or describe the screenshot showing it happened. "200 OK" and "the page
rendered" are neither.

File findings as issues exactly as `tryouts/AGENTS.md` describes — one issue per distinct
finding, label `tryout-finding`, and search the open `tryout-finding` issues first so a known one
is not filed twice. If nothing is surprising, file nothing.

Finish by posting ONE comment on the merged pull request with `add_issue_comment`:
- what you verified, with the evidence quoted,
- what you could not drive and why (an external host, the image, anything out of reach),
- links to any issues you filed.
That comment is the only artifact of this session a human will ever see, so write it for
somebody who was not here.
```

## What this does not cover

The Docker image, the compose hardening and watchtower are not exercised by a cloud tryout —
the rig runs from source. CI's smoke test stays the check on the image, and the server is the
check on the deployment.
