// `preact-iso` claims every same-origin `<a>` click; these are the paths the backend serves.
export const ROUTER_SCOPE = /^\/(?!api\/|calendar\/|manifest\.webmanifest)/u
