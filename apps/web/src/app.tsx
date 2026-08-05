import { LocationProvider, Route, Router } from 'preact-iso'
import { useMemo } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'
import type { Viewer } from './viewer.tsx'

import { createApiClient } from './api/client.ts'
import { FetchedBurnProvider } from './burn.tsx'
import { Layout } from './components/Layout.tsx'
import { FetchedInstallationProvider, InstallationProvider } from './installation.tsx'
import { Admin } from './pages/Admin.tsx'
import { AdminApplications } from './pages/AdminApplications.tsx'
import { AdminEvents } from './pages/AdminEvents.tsx'
import { AdminInvites } from './pages/AdminInvites.tsx'
import { AdminQuestions } from './pages/AdminQuestions.tsx'
import { AdminRoster } from './pages/AdminRoster.tsx'
import { AdminSettings } from './pages/AdminSettings.tsx'
import { Apply } from './pages/Apply.tsx'
import { Dreams } from './pages/Dreams.tsx'
import { Home } from './pages/Home.tsx'
import { Invite } from './pages/Invite.tsx'
import { Login } from './pages/Login.tsx'
import { Meals } from './pages/Meals.tsx'
import { Members } from './pages/Members.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { Options } from './pages/Options.tsx'
import { Places } from './pages/Places.tsx'
import { ProfilePage } from './pages/Profile.tsx'
import { Roles } from './pages/Roles.tsx'
import { Schedule } from './pages/Schedule.tsx'
import { FetchedViewerProvider, ViewerProvider } from './viewer.tsx'

/**
 * What the route table reaches for.
 *
 * Narrow on purpose: a test supplying a stub then has to satisfy exactly these,
 * which is what lets it be a plain object rather than a cast.
 *
 * One list, consumed twice. It was written out again as `Routes`' prop type, in a
 * different key order — two ~50-key lists nobody would diff by eye, which is how
 * they drift.
 */
export type RoutesApi = Pick<
  ApiClient,
  | 'addQuestion'
  | 'createEvent'
  | 'deleteQuestion'
  | 'getActiveEvent'
  | 'logout'
  | 'updateWelcome'
  | 'getAdminAccounts'
  | 'setAccountRoles'
  | 'getEvents'
  | 'getInviteState'
  | 'redeemInvite'
  | 'getMyProfile'
  | 'updateMyProfile'
  | 'updateMyStay'
  | 'getMyBurns'
  | 'joinEvent'
  | 'leaveEvent'
  | 'getActiveRoster'
  | 'getMembers'
  | 'setPayment'
  | 'getPlaces'
  | 'addPlace'
  | 'updatePlace'
  | 'deletePlace'
  | 'reorderPlaces'
  | 'getPlaceSources'
  | 'copyPlaces'
  | 'getEventOptions'
  | 'addEventOption'
  | 'updateEventOption'
  | 'deleteEventOption'
  | 'reorderEventOptions'
  | 'getEventAttendees'
  | 'getLeadRoles'
  | 'getLeadRoleSources'
  | 'addLeadRole'
  | 'updateLeadRole'
  | 'deleteLeadRole'
  | 'setLeadRoleLead'
  | 'joinLeadRoleTeam'
  | 'leaveLeadRoleTeam'
  | 'copyLeadRoles'
  | 'getMeals'
  | 'setMealLead'
  | 'joinMealCrew'
  | 'leaveMealCrew'
  | 'setMealIdea'
  | 'updateMealIntro'
  | 'getMealSlots'
  | 'addMealSlot'
  | 'updateMealSlot'
  | 'deleteMealSlot'
  | 'generateMeals'
  | 'addMeal'
  | 'deleteMeal'
  | 'updateMeal'
  | 'getSessions'
  | 'offerSession'
  | 'updateSession'
  | 'withdrawSession'
  | 'helpWithSession'
  | 'stopHelpingWithSession'
  | 'supportSession'
  | 'withdrawSupportForSession'
  | 'getInstallation'
  | 'updateInstallation'
  | 'getPushKey'
  | 'subscribeToPush'
  | 'unsubscribeFromPush'
  | 'getApplications'
  | 'getInvites'
  | 'createInvite'
  | 'revokeInvite'
  | 'approveApplication'
  | 'reissueInvite'
  | 'rejectApplication'
  | 'getQuestions'
  | 'login'
  | 'reorderQuestions'
  | 'submitApplication'
  | 'updateEvent'
  | 'updateQuestion'
>

/**
 * What the whole app reaches for: the route table, plus what the providers and
 * the layout need — the viewer they resolve on mount, and signing out.
 */
export type AppApi = RoutesApi & Pick<ApiClient, 'getMe' | 'logout'>

/**
 * The route table.
 *
 * Note the constraint the backend imposes: it tells a missing asset apart from
 * a client-side route by whether the last path segment has a file extension, so
 * **no route here may contain a dot** — no filenames, no email addresses in a
 * path, and invite tokens must be dot-free. A path with an extension gets a 404
 * from the server and never reaches this router.
 */
export const Routes = ({ api }: { api: RoutesApi }) => {
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
  const AdminInvitesRoute = useMemo(() => () => <AdminInvites api={api} />, [api])
  const OptionsRoute = useMemo(() => () => <Options api={api} />, [api])
  const PlacesRoute = useMemo(() => () => <Places api={api} />, [api])
  const AdminRosterRoute = useMemo(() => () => <AdminRoster api={api} />, [api])
  const AdminSettingsRoute = useMemo(() => () => <AdminSettings api={api} />, [api])
  const HomeRoute = useMemo(() => () => <Home api={api} />, [api])
  const MembersRoute = useMemo(() => () => <Members api={api} />, [api])
  const DreamsRoute = useMemo(() => () => <Dreams api={api} />, [api])
  const ScheduleRoute = useMemo(() => () => <Schedule api={api} />, [api])
  const RolesRoute = useMemo(() => () => <Roles api={api} />, [api])
  const MealsRoute = useMemo(() => () => <Meals api={api} />, [api])
  const ProfileRoute = useMemo(() => () => <ProfilePage api={api} />, [api])
  const ApplyRoute = useMemo(() => () => <Apply api={api} />, [api])
  // The token arrives as a prop from the route pattern, so this one takes props
  // rather than closing over nothing like the others.
  const InviteRoute = useMemo(
    () =>
      ({ token }: { token?: string }) => <Invite api={api} token={token ?? ''} />,
    [api],
  )

  return (
    <Router>
      <Route path="/" component={HomeRoute} />
      <Route path="/apply" component={ApplyRoute} />
      <Route path="/members" component={MembersRoute} />
      <Route path="/meals" component={MealsRoute} />
      <Route path="/dreams" component={DreamsRoute} />
      <Route path="/schedule" component={ScheduleRoute} />
      <Route path="/roles" component={RolesRoute} />
      <Route path="/profile" component={ProfileRoute} />
      <Route path="/invite/:token" component={InviteRoute} />
      <Route path="/login" component={LoginRoute} />
      <Route path="/admin" component={AdminRoute} />
      <Route path="/admin/events" component={AdminEventsRoute} />
      <Route path="/admin/questions" component={AdminQuestionsRoute} />
      <Route path="/admin/applications" component={AdminApplicationsRoute} />
      <Route path="/admin/invites" component={AdminInvitesRoute} />
      <Route path="/options" component={OptionsRoute} />
      <Route path="/places" component={PlacesRoute} />
      <Route path="/admin/roster" component={AdminRosterRoute} />
      <Route path="/admin/settings" component={AdminSettingsRoute} />
      <Route default component={NotFound} />
    </Router>
  )
}

/**
 * `viewer`, `title` and `api` are injectable so tests drive the real route
 * table and the real layout rather than a copy that can silently fall out of
 * step with this one.
 *
 * `viewer` and `title` each select their provider: a test that states who is
 * looking, or what this installation is called, gets that, and the app — which
 * passes neither — gets the pair that ask the API. Two providers rather than a
 * flag, because "fetch unless told otherwise" is the kind of conditional that
 * ends up fetching in a test suite.
 */
export const App = ({ viewer, title, api }: { viewer?: Viewer; title?: string; api?: AppApi }) => {
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

  // Inside the viewer provider, since which burns can be chosen between depends on
  // who is looking, and outside `Layout`, since the selector is in the bar and every
  // burn-scoped page below it reads the same choice.
  const framed = (
    <FetchedBurnProvider api={client}>
      <Layout>
        <Routes api={client} />
      </Layout>
    </FetchedBurnProvider>
  )

  const content =
    title === undefined ? (
      <FetchedInstallationProvider api={client}>{framed}</FetchedInstallationProvider>
    ) : (
      <InstallationProvider title={title}>{framed}</InstallationProvider>
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
