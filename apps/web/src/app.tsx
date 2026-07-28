import { LocationProvider, Route, Router } from 'preact-iso'

import type { Viewer } from './viewer.tsx'

import { Layout } from './components/Layout.tsx'
import { Home } from './pages/Home.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { ViewerProvider } from './viewer.tsx'

/**
 * The route table.
 *
 * Note the constraint the backend imposes: it tells a missing asset apart from
 * a client-side route by whether the last path segment has a file extension, so
 * **no route here may contain a dot** — no filenames, no email addresses in a
 * path, and invite tokens must be dot-free. A path with an extension gets a 404
 * from the server and never reaches this router.
 */
export const Routes = () => (
  <Router>
    <Route path="/" component={Home} />
    <Route default component={NotFound} />
  </Router>
)

/**
 * `viewer` is injectable so tests drive the real route table and the real
 * layout rather than a copy that can silently fall out of step with this one.
 */
export const App = ({ viewer }: { viewer?: Viewer }) => (
  <LocationProvider>
    <ViewerProvider viewer={viewer}>
      <Layout>
        <Routes />
      </Layout>
    </ViewerProvider>
  </LocationProvider>
)
