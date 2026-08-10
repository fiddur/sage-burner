# Over the wire

The security headers every response carries, and the shape every error takes.

[← back to the README](../README.md)

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

The vocabulary is `errorCodes` in
[`packages/shared`](../packages/shared/src/schemas/error.ts), and that is where it is read
rather than copied — this paragraph listed eight of them and was five short, which is what a
list in prose does. It grows with the routes that emit it, rather than being listed in advance
and left unreachable.

`unauthenticated` and `forbidden` are separate because 401 and 403 are the one
distinction a client cannot safely collapse — signing in fixes the first and
does nothing for the second. `conflict` exists because a duplicate event slug is
something an admin fixes by choosing another, which a generic `bad_request`
would not convey.

`invalid_credentials` covers a wrong password and an unknown address alike:
telling those apart is an account-enumeration oracle.

**A `PATCH` that wrote nothing has to choose between them**, and asks rather than
guesses. The rule the write is only allowed under lives in the statement's own
`WHERE` — so the decision and the guard against a concurrent change are one thing —
which leaves "no rows" meaning either "no such row" or "the condition said no".
`patchRow` in [`db/patch.ts`](../apps/backend/src/db/patch.ts) re-reads to tell those
apart and answers `not_found` or `refused`; the route words `refused`, since a
tick-box rule is a `bad_request` and a burn that is already full is a `conflict`. It
also answers the one body that never reaches an `UPDATE`: `set({})` is not valid SQL,
and a `PATCH` naming no column is a read.

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
