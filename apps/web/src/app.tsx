import { LocationProvider, Route, Router } from 'preact-iso'

import { Layout } from './components/Layout.tsx'
import { Home } from './pages/Home.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { SessionProvider } from './session.tsx'

/**
 * Routes.
 *
 * Note the constraint the backend imposes: it tells a missing asset apart from
 * a client-side route by whether the last path segment has a file extension, so
 * **no route here may contain a dot** — no filenames, no email addresses in a
 * path, and invite tokens must be dot-free. A path with an extension gets a 404
 * from the server and never reaches this router.
 */
export const App = () => (
  <LocationProvider>
    <SessionProvider>
      <Layout>
        <Router>
          <Route path="/" component={Home} />
          <Route default component={NotFound} />
        </Router>
      </Layout>
    </SessionProvider>
  </LocationProvider>
)
