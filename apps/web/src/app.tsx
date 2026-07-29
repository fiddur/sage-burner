import { LocationProvider, Route, Router } from 'preact-iso'

import type { ApiClient } from './api/client.ts'
import type { Viewer } from './viewer.tsx'

/**
 * Only what the app reaches for, not the whole client.
 *
 * Narrow on purpose: a test supplying a stub then has to satisfy exactly these,
 * which is what lets it be a plain object rather than a cast.
 */
export type AppApi = Pick<ApiClient, 'getMe' | 'login' | 'logout'>

import { createApiClient } from './api/client.ts'
import { Layout } from './components/Layout.tsx'
import { Home } from './pages/Home.tsx'
import { Login } from './pages/Login.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { FetchedViewerProvider, ViewerProvider } from './viewer.tsx'

/**
 * The route table.
 *
 * Note the constraint the backend imposes: it tells a missing asset apart from
 * a client-side route by whether the last path segment has a file extension, so
 * **no route here may contain a dot** — no filenames, no email addresses in a
 * path, and invite tokens must be dot-free. A path with an extension gets a 404
 * from the server and never reaches this router.
 */
export const Routes = ({ api }: { api: Pick<ApiClient, 'login'> }) => (
  <Router>
    <Route path="/" component={Home} />
    <Route path="/login" component={() => <Login api={api} />} />
    <Route default component={NotFound} />
  </Router>
)

/**
 * `viewer` and `api` are injectable so tests drive the real route table and the
 * real layout rather than a copy that can silently fall out of step with this
 * one.
 *
 * Passing `viewer` also selects the provider: a test that states who is looking
 * gets that, and the app — which passes nothing — gets the one that asks the
 * API. Two providers rather than a flag, because "fetch unless told otherwise"
 * is the kind of conditional that ends up fetching in a test suite.
 */
export const App = ({ viewer, api = createApiClient() }: { viewer?: Viewer; api?: AppApi }) => {
  const content = (
    <Layout api={api}>
      <Routes api={api} />
    </Layout>
  )

  return (
    <LocationProvider>
      {viewer === undefined ? (
        <FetchedViewerProvider api={api}>{content}</FetchedViewerProvider>
      ) : (
        <ViewerProvider viewer={viewer}>{content}</ViewerProvider>
      )}
    </LocationProvider>
  )
}
