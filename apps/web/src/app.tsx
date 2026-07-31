import { LocationProvider, Route, Router } from 'preact-iso'
import { useMemo } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'
import type { Viewer } from './viewer.tsx'

import { createApiClient } from './api/client.ts'
import { Layout } from './components/Layout.tsx'
import { Admin } from './pages/Admin.tsx'
import { AdminApplications } from './pages/AdminApplications.tsx'
import { AdminEvents } from './pages/AdminEvents.tsx'
import { AdminQuestions } from './pages/AdminQuestions.tsx'
import { Apply } from './pages/Apply.tsx'
import { Home } from './pages/Home.tsx'
import { Login } from './pages/Login.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { FetchedViewerProvider, ViewerProvider } from './viewer.tsx'

/**
 * Only what the app reaches for, not the whole client.
 *
 * Narrow on purpose: a test supplying a stub then has to satisfy exactly these,
 * which is what lets it be a plain object rather than a cast.
 */
export type AppApi = Pick<
  ApiClient,
  | 'createEvent'
  | 'getActiveEvent'
  | 'getAdminAccounts'
  | 'getEvents'
  | 'getMe'
  | 'login'
  | 'logout'
  | 'updateEvent'
  | 'addQuestion'
  | 'deleteQuestion'
  | 'getApplications'
  | 'approveApplication'
  | 'rejectApplication'
  | 'getQuestions'
  | 'reorderQuestions'
  | 'submitApplication'
  | 'updateQuestion'
>

/**
 * The route table.
 *
 * Note the constraint the backend imposes: it tells a missing asset apart from
 * a client-side route by whether the last path segment has a file extension, so
 * **no route here may contain a dot** — no filenames, no email addresses in a
 * path, and invite tokens must be dot-free. A path with an extension gets a 404
 * from the server and never reaches this router.
 */
export const Routes = ({
  api,
}: {
  api: Pick<
    ApiClient,
    | 'addQuestion'
    | 'createEvent'
    | 'deleteQuestion'
    | 'getActiveEvent'
    | 'getAdminAccounts'
    | 'getEvents'
    | 'getApplications'
    | 'approveApplication'
    | 'rejectApplication'
    | 'getQuestions'
    | 'login'
    | 'reorderQuestions'
    | 'submitApplication'
    | 'updateEvent'
    | 'updateQuestion'
  >
}) => {
  // Memoised because `component` is compared by identity: a fresh arrow each
  // render is a *different component type*, so a re-rendered `Routes` would
  // unmount and remount `Login` — and its `useState` — rather than diff it.
  //
  // Not a live bug today, which was measured rather than assumed. `Routes` does
  // not re-render when the viewer resolves: `Layout` consumes the context and
  // re-renders, but `children` is the same vnode reference it was handed, and
  // Preact skips diffing an identical vnode. Typing into `/login` during the
  // first `getMe` round-trip keeps the same DOM node and the same value.
  //
  // Kept anyway, at one line: it stops being true the moment anything makes
  // `Routes` itself re-render — a prop from a consumer, a route-level context —
  // and the symptom then is a member losing what they typed.
  const LoginRoute = useMemo(() => () => <Login api={api} />, [api])
  const AdminRoute = useMemo(() => () => <Admin api={api} />, [api])
  const AdminEventsRoute = useMemo(() => () => <AdminEvents api={api} />, [api])
  const AdminQuestionsRoute = useMemo(() => () => <AdminQuestions api={api} />, [api])
  const AdminApplicationsRoute = useMemo(() => () => <AdminApplications api={api} />, [api])
  const HomeRoute = useMemo(() => () => <Home api={api} />, [api])
  const ApplyRoute = useMemo(() => () => <Apply api={api} />, [api])

  return (
    <Router>
      <Route path="/" component={HomeRoute} />
      <Route path="/apply" component={ApplyRoute} />
      <Route path="/login" component={LoginRoute} />
      <Route path="/admin" component={AdminRoute} />
      <Route path="/admin/events" component={AdminEventsRoute} />
      <Route path="/admin/questions" component={AdminQuestionsRoute} />
      <Route path="/admin/applications" component={AdminApplicationsRoute} />
      <Route default component={NotFound} />
    </Router>
  )
}

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
export const App = ({ viewer, api }: { viewer?: Viewer; api?: AppApi }) => {
  // Not a default parameter. `api = createApiClient()` builds a fresh client on
  // every render of `App`, and that identity is load-bearing twice over: it is
  // the `useEffect` dependency in `FetchedViewerProvider`, so a new one aborts
  // the in-flight `getMe` and refetches, and it is the `useMemo` dependency for
  // `LoginRoute`, so a new one makes `Login` a different component type and
  // remounts it with its state reset — defeating the memo that exists to
  // prevent exactly that.
  //
  // Inert while `App` is the root and holds no state. The memo below it is
  // written to survive that changing; this would have stopped it.
  const client = useMemo(() => api ?? createApiClient(), [api])

  const content = (
    <Layout api={client}>
      <Routes api={client} />
    </Layout>
  )

  return (
    <LocationProvider>
      {viewer === undefined ? (
        <FetchedViewerProvider api={client}>{content}</FetchedViewerProvider>
      ) : (
        <ViewerProvider viewer={viewer}>{content}</ViewerProvider>
      )}
    </LocationProvider>
  )
}
