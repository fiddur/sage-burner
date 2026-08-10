/**
 * Which paths the client-side router may claim (#422).
 *
 * `preact-iso`'s `LocationProvider` installs one global click handler and routes *every*
 * same-origin `<a>` through it, bailing out only for a modifier key, a cross-origin href, a
 * `#` fragment, a `target`, a `download` — or an href outside this. With no scope passed, a
 * link to `/api/me/oauth/facebook` was intercepted, matched no route, and rendered "Nothing
 * here"; the redirect it was supposed to follow only happened on a reload, which is a real
 * browser request.
 *
 * So this names what the **backend** serves, and everything else is the app. Three families:
 * `/api/…`, the calendar feed — deliberately outside `/api`, because a calendar client asks
 * for a file rather than an API — and the manifest.
 *
 * A per-anchor opt-out (`target="_top"`) would fix a link at a time, and is the wrong shape
 * for the reason a narrow default is: one link opting out, and the next server path having to
 * remember to. `router-scope.test.ts` walks `apiRoutes` and fails if a registered path is not
 * covered here, so a fourth family cannot be added without this being updated.
 *
 * Matched against the raw `href` attribute, not a resolved URL. Every anchor in the app is an
 * absolute path or an external URL, so requiring the leading slash costs nothing.
 */
export const ROUTER_SCOPE = /^\/(?!api\/|calendar\/|manifest\.webmanifest)/u
