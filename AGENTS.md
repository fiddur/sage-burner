# sage-burner

Membership, application, and scheduling platform for small "burner"-style
mini-events (up to ~42 members, up to 4x/year). Replaces a spreadsheet +
Discord workflow with a single self-hosted app.

Conventions here deliberately track the sibling project `aurboda` so both repos
feel the same to work in. Where this repo diverges, it says so and why.

Two deliberate divergences from aurboda:

- **Node 24 LTS, not 25.** Odd-numbered Node lines never become LTS and stop
  receiving security patches roughly six months in; 25's window closed in
  June 2026. This app holds contact details and allergies, so it runs on a
  supported runtime. Type stripping is on by default in 24, so the
  no-build-step decision is unaffected.
- **No nginx in the container.** One Node process serves the API, the SPA and
  the ICS feed. The app is small enough that a second process buys nothing but
  moving parts.

## Repository structure

- `apps/backend` — Fastify API. Also serves the built web app and the ICS feed.
- `apps/web` — Preact + Vite single-page app.
- `packages/shared` — Zod schemas and inferred types, shared by both.
- `docs/` — longer-form documentation.

One Node process serves everything in production.

## Shared schemas and types (`packages/shared`)

`@sage-burner/shared` is the single source of truth for validation schemas and
type definitions. All layers import from it — never duplicate a schema.

- Backend imports the **schemas** (runtime validation at the HTTP boundary).
- Web imports **no Zod**. Types always; runtime values only from modules that do
  not pull Zod in — today `enums.ts`, which imports nothing and holds the
  vocabularies plus `tickBoxRequired`. Nothing under `schemas/`.
- Field names are `snake_case` everywhere: schemas, REST API, DB columns, JSON
  keys, frontend types.

This is aurboda's `api-spec` idea without the OpenAPI/Kotlin generation — we
have no third client and no public API contract to publish.

The package sets `"sideEffects": false`, and that is load-bearing rather than
tidiness. `index.ts` is `export *` over eleven modules, so importing any runtime
value goes through a barrel whose schema modules evaluate `z.object(…)` at module
scope; without the flag Rollup must assume those are side effects and keeps them,
pulling Zod into the main chunk — which is not code-split, so it reaches the
public homepage. Measured on the `apps/web` bundle: 150,493 bytes with Zod
against 79,826 without. Both halves are needed — moving a value out of a schema
module without the flag, or the flag while the value stays put, each still ships
Zod. Verify with `pnpm --filter sage-burner-web build` and grep the bundle, not
by reading Rollup's docs.

## Data model rules

- **Never hardcode a single event.** `event` exists from day one; the whole
  point is that this recurs up to 4x/year.
- **Payment is per `(event, member)`**, not a global "has this person paid"
  flag. The same human may attend several burns and pays separately for each.
- **The application form is data, not code.** `form_question` rows are
  admin-editable — adding or reordering a question must never require a
  redeploy.
- Store data normalized: reference entities by id rather than duplicating
  mutable fields, and resolve names at query time.

## Code style

- Prefer functional style. No classes.
- Prefer code that is testable without heavy mocking — pass dependencies
  (db handle, clock, config) in as arguments rather than importing singletons.
- Avoid global variables, module-level mutable state, and singletons.
- Avoid casting. Use proper typing and type guards.
- **Comment sparingly.** Good naming should carry the code; in almost every case
  it can. Add a comment only where a reader needs to know _why_ the code is as it
  is — a decision they would otherwise undo, a constraint that is not visible
  locally. Do not narrate what the next line does, restate a well-named function,
  or record how a bug was found; that belongs in the commit message.

  If a block needs a comment to say what it does, give it a name instead.

  Much of the existing code predates this and is far more heavily commented.
  Follow the rule, not the surroundings, and thin the prose where you are editing
  anyway.

- `pnpm fix` formats and auto-fixes lint. `pnpm check` verifies formatting,
  type-checks, and lints — it is the same gate CI runs, so a green `check`
  locally means a green CI.
- Per-package `check` runs `oxlint --type-aware`, which needs `oxlint-tsgolint`.
  Type-aware rules — `no-floating-promises` in particular — are silently skipped
  without that flag, so keep it on any new package's `check` script.

## Testing

- Write the unit test first where reasonable — it pressures the design toward
  clear dependency injection.
- The backend should be well covered.
- Always run tests non-watch (`pnpm test`, `pnpm check`) so no process hangs.

### Claims must be executed, not reasoned about

Roughly seventy review threads across #73 and #74 were one failure repeating:
**behaviour changes, and its description somewhere else goes one step stale.**
These are the habits that would have caught nearly all of them.

- **Never write a claim you have not run.** Any "this catches X", "without this,
  Y", or "the failure mode is Z" gets the mutation applied and the suite run
  _before_ the sentence is written. This caught a test that passed against the
  very implementation it existed to reject, and stopped an overstated claim about
  what a boundary test covers. A failure mode described from memory has been
  wrong more often than right here — including twice in the same direction.
- **A rejecting test needs a passing sibling.** Two real defects hid behind this:
  the `start_date` branch and the both-dates branch of `dateOrderCondition` each
  had a test proving refusal and none proving success. Refusal cases are easier
  to think of, so the success path is where the gap lands.
- **After changing behaviour, grep for its own vocabulary** — the function names,
  status codes and terms the old design used. Prose at a distance does not fail
  to compile, and a comment naming the wrong thing is worse than none because the
  next reader trusts it. This turned up a second stale reference twice.
- **Prefer deleting the thing that needs syncing over syncing it.** Every durable
  fix in those PRs was this shape: one `tickBoxRequired` replacing the same rule
  written out in four places; `.returning()` removing the `changes` coupling and
  the three comments describing it; scoping a pre-read removing a stub duplicated
  across three tests. If a comment has to keep being corrected, the code is
  telling you something.
- **Comments must not reference branch state.** "this branch", "two commits ago",
  or a symbol the PR deletes all dangle after the squash merge. Write what is true
  of the merged tree.
- **Gate the push on `pnpm check`, not on an `echo` beside it.** Two commits went
  out red from exactly that shell mistake:
  `if pnpm check >/dev/null 2>&1; then git push …; else echo "refusing"; fi`.

## Security expectations

These are member records, so treat them as such:

- Authorization is enforced **server-side** on every route. Hiding a button is
  not access control.
- A member can read and write only their own record.
- Invite tokens are CSPRNG-random and unguessable, single-use, and expiring.
- Admin-authored markdown is sanitized before rendering.
- The public ICS feed exposes session title, description, time and location —
  never member names beyond the host's display name, contact details,
  allergies, or payment state.

## Git workflow

- Base branch is `develop`. `main` holds released state.
- **Never push directly to `develop`.** Always a PR.
- **Never alter already-pushed commits.** No amend after push, no force push.
- **Never rebase. Always merge.**
- Merge the latest `origin/develop` into the branch before pushing a PR update.
- Branch naming: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<slug>`.
- Commit and PR titles use conventional-commit style: `feat(members): ...`.

## Working an issue: merge on approval

This project defaults to **merge on approval**. Once an issue is ironed out and
assigned, take it end to end without checking back in for permission. A webhook
service reviews every ready PR automatically; that review is the gate, not a
human prompt.

1. Sync: `git checkout develop && git fetch origin develop && git reset --hard
origin/develop`. Reset rather than pull — squash merges make local `develop`
   diverge.
2. Branch off `develop`.
3. Implement, tests first where reasonable.
4. `pnpm fix && pnpm check && pnpm test` all green locally.
5. Open a **Draft** PR against `develop`, body containing `Closes #<issue>`.
6. Watch CI — all of it, not one named check. Red → fix and push. Green →
   `gh pr ready <n>`.
7. Wait for the review by tailing `/home/fiddur/src/codereview/events.log` for
   the line `<pr url> updated` — do not poll GitHub on a timer. (`review
started` means it has only begun; keep waiting for `updated`.)
8. Read the review body **and every inline comment**. Fix genuine
   correctness/security findings; for trivial or subjective nits, resolve the
   thread with a brief rationale. Resolve every inline thread via the GraphQL
   `resolveReviewThread` mutation.
9. Any push starts a fresh review round. Repeat from step 7.
10. **Merge without asking** once all four gates hold:
    - the latest review body starts with `✅Approved`, **and** it is on the
      current head commit (a `✅Approved` left on an older commit is stale),
    - every inline review thread is resolved,
    - **every** check is green — not a named one. `CI Gate` runs the tests,
      but `build` is what proves the image starts, and naming only the first
      would let a red `build` through. Check the whole rollup:
      `gh pr view <n> --json statusCheckRollup`.
    - `mergeStateStatus` is `CLEAN`.
      Then `gh pr merge <n> --merge`. Never `--admin`. Avoid `--auto` — a push
      clears it and the PR sits `BLOCKED`.
11. If `BEHIND`: `git fetch origin develop && git merge origin/develop
--no-edit`, re-run `pnpm check`, push, and re-confirm the gate from step 7.
12. After merge: `git checkout develop && git fetch origin develop && git reset
--hard origin/develop`, delete the merged branch, and pick up the next
    assigned issue.

The gate is not optional. "Merge on approval" removes the human confirmation
step, not the review — never merge an unapproved PR, and never merge with open
threads or red CI.

**Most of it is enforced now.** The `CI and PR` ruleset targets the repository's
default branch — which is `develop` — and enforces, with no bypass actors:

- a pull request, merge-commit only (so step 10's `--merge` is the only method
  the platform will accept),
- both checks, `CI Gate` and `build`, strictly — so the branch must also be up
  to date with `develop`,
- resolution of every review thread,
- no force-push, no branch deletion.

That covers three of step 10's four gates. Two things remain unenforced:

- **No approval is required** (`required_approving_review_count: 0`). GitHub will
  not let an author approve their own pull request, and every commit and review
  here is authored by the same account, so an approval requirement would deadlock
  rather than protect. The `✅Approved` gate is therefore discipline, and this
  document is the only thing enforcing it. The review agent's verdicts are
  `COMMENTED`, not `APPROVED`, so they would not satisfy the setting even if it
  could be turned on.
- **`main` is unprotected**, deliberately for now — deployment runs from the
  `:develop` tag, so `main` is unused. `GET /repos/fiddur/sage-burner/rules/branches/main`
  returns nothing: no required check, force-push and deletion both allowed. Set
  it up before the first promotion to `:latest`.

So a green rollup means the tests passed, the image starts, and the threads are
closed. It does not mean anything reviewed the change.

This paragraph caches an answer that actually lives in repository settings, and
it has already gone stale several times while being written. Check rather than
trust it:

```sh
gh api repos/:owner/:repo/rules/branches/develop --jq '.[] | "\(.type): \(.parameters // {} | tojson)"'
```

(Beware `// empty` as a jq fallback: `empty` produces _no_ outputs, so any
expression needing a value from it yields nothing and the whole surrounding
output disappears — silently, and still exiting 0. Substituting
`.parameters.required_status_checks // empty` into the interpolation above drops
every rule that lacks the field, which reads as a ruleset that does not have
them.)

## Deployment

- Merge to `develop` builds and pushes `fiddur/sage-burner:develop` to Docker
  Hub. Watchtower on the server polls every 5 minutes and redeploys.
- Merge to `main` promotes the image to `:latest`.
- The app is served at a **domain root** — there is no sub-path/`BASE_PATH`
  handling, deliberately.
- No external services are required to run it: no SMTP, no payment gateway, no
  external database.
- `docker compose up` must be sufficient — with one current exception: the app
  refuses to start without `SESSION_SECRET`, so a bare clone needs it generated
  first (the README's Deploying section is one `sed` line). Failing loudly beats
  minting an in-memory secret that logs every member out on each redeploy;
  minting one into the data volume would restore the invariant, and #59 tracks
  that decision. Do not read this as licence for a second exception.

## Documentation

Keep `README.md` and `docs/` current when behavior changes. If a change makes
the README's setup instructions wrong, it is not finished.
