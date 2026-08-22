import {
  ADMIN_ACCOUNT_PATTERN,
  changelogPage,
  forgottenPage,
  formattingPage,
  INVITE_PATTERN,
  notificationsPage,
  RESET_PATTERN,
} from '@sage-burner/shared'
import { LocationProvider, Route, Router } from 'preact-iso'
import { useMemo } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'
import type { BellApi } from './components/NotificationBell.tsx'
import type { InstallWatch } from './install.ts'
import type { ShownApi } from './shown.tsx'
import type { Viewer } from './viewer.tsx'

import { createApiClient } from './api/client.ts'
import { FetchedBurnProvider } from './burn.tsx'
import { InstallApp } from './components/InstallApp.tsx'
import { Layout } from './components/Layout.tsx'
import { NewVersion } from './components/NewVersion.tsx'
import { PushNudge } from './components/PushNudge.tsx'
import { RouteOnMessage } from './components/RouteOnMessage.tsx'
import { StaleData } from './components/StaleData.tsx'
import { createFreshness, freshnessAt } from './freshness.ts'
import { FetchedInstallationProvider, InstallationProvider } from './installation.tsx'
import { Admin } from './pages/Admin.tsx'
import { AdminAccount } from './pages/AdminAccount.tsx'
import { AdminAllergies } from './pages/AdminAllergies.tsx'
import { AdminApplications } from './pages/AdminApplications.tsx'
import { AdminEvents } from './pages/AdminEvents.tsx'
import { AdminInvites } from './pages/AdminInvites.tsx'
import { AdminNotificationLog } from './pages/AdminNotificationLog.tsx'
import { AdminQuestions } from './pages/AdminQuestions.tsx'
import { AdminRoster } from './pages/AdminRoster.tsx'
import { AdminSettings } from './pages/AdminSettings.tsx'
import { AdminSongCategories } from './pages/AdminSongCategories.tsx'
import { Apply } from './pages/Apply.tsx'
import { Bring } from './pages/Bring.tsx'
import { Changelog } from './pages/Changelog.tsx'
import { Dreams } from './pages/Dreams.tsx'
import { Faq } from './pages/Faq.tsx'
import { Feed } from './pages/Feed.tsx'
import { Forgotten } from './pages/Forgotten.tsx'
import { Formatting } from './pages/Formatting.tsx'
import { Home } from './pages/Home.tsx'
import { Invite } from './pages/Invite.tsx'
import { Login } from './pages/Login.tsx'
import { Meals } from './pages/Meals.tsx'
import { Meetings } from './pages/Meetings.tsx'
import { Members } from './pages/Members.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { Notifications } from './pages/Notifications.tsx'
import { Options } from './pages/Options.tsx'
import { Person } from './pages/Person.tsx'
import { Places } from './pages/Places.tsx'
import { Privacy } from './pages/Privacy.tsx'
import { ProfilePage } from './pages/Profile.tsx'
import { Reset } from './pages/Reset.tsx'
import { Rides } from './pages/Rides.tsx'
import { Roles } from './pages/Roles.tsx'
import { Schedule } from './pages/Schedule.tsx'
import { SongPage } from './pages/Song.tsx'
import { Songs } from './pages/Songs.tsx'
import { Terms } from './pages/Terms.tsx'
import { PushNudgeProvider } from './push-nudge.tsx'
import { createRemembered, RememberedProvider } from './remembered.tsx'
import { ROUTER_SCOPE } from './router-scope.ts'
import { createShown, ShownProvider } from './shown.tsx'
import { FetchedViewerProvider, ViewerProvider } from './viewer.tsx'

export type RoutesApi = Pick<
  ApiClient,
  | 'addPost'
  | 'updatePost'
  | 'deletePost'
  | 'addQuestion'
  | 'createEvent'
  | 'deleteQuestion'
  | 'getActiveEvent'
  | 'getFeed'
  | 'getMapLink'
  | 'supportThread'
  | 'setThreadFollow'
  | 'signUp'
  | 'getMyApplication'
  | 'sendMyApplicationMessage'
  | 'getApplicationMessages'
  | 'sendApplicationMessage'
  | 'withdrawSupportForThread'
  | 'setMapLink'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'supportComment'
  | 'withdrawSupportForComment'
  | 'getAllergyItems'
  | 'getChangelog'
  | 'getPrivacy'
  | 'getTerms'
  | 'addAllergyItem'
  | 'updateAllergyItem'
  | 'deleteAllergyItem'
  | 'reorderAllergyItems'
  | 'logout'
  | 'requestPasswordReset'
  | 'getPasswordResetState'
  | 'resetPassword'
  | 'updateWelcome'
  | 'getAdminAccounts'
  | 'getAdminAccount'
  | 'updateAdminAccount'
  | 'setAccountRoles'
  | 'setAccountPassword'
  | 'setMyAvatar'
  | 'removeMyAvatar'
  | 'uploadImage'
  | 'getCalendarToken'
  | 'rotateCalendarToken'
  | 'getMyImages'
  | 'removeMyImage'
  | 'getAccountProfile'
  | 'getMyIdentities'
  | 'removeMyIdentity'
  | 'getOauthSettings'
  | 'updateOauthSettings'
  | 'removeOauthSettings'
  | 'getMyConnections'
  | 'addMyConnection'
  | 'updateMyConnection'
  | 'removeMyConnection'
  | 'reorderMyConnections'
  | 'setInstallationIcon'
  | 'removeInstallationIcon'
  | 'setInstallationBanner'
  | 'removeInstallationBanner'
  | 'getMailSettings'
  | 'updateMailSettings'
  | 'removeMailSettings'
  | 'sendDigestPreview'
  | 'sendTestEmail'
  | 'getEvents'
  | 'getInviteState'
  | 'redeemInvite'
  | 'getMyProfile'
  | 'deleteMyNotification'
  | 'getMyNotifications'
  | 'markNotificationsSeen'
  | 'getMyNotificationSettings'
  | 'updateMyNotificationSettings'
  | 'getMyPasskeys'
  | 'addPasskey'
  | 'removePasskey'
  | 'startPasskeyRegistration'
  | 'startPasskeyLogin'
  | 'finishPasskeyLogin'
  | 'updateMyProfile'
  | 'updateMyStay'
  | 'getMyBurns'
  | 'getFaq'
  | 'addFaqEntry'
  | 'updateFaqEntry'
  | 'deleteFaqEntry'
  | 'reorderFaq'
  | 'getFaqSources'
  | 'copyFaq'
  | 'joinEvent'
  | 'leaveEvent'
  | 'transferMyPlace'
  | 'getActiveRoster'
  | 'adminAddAttendance'
  | 'getMembers'
  | 'setPayment'
  | 'getPlaces'
  | 'getRides'
  | 'addRide'
  | 'updateRide'
  | 'deleteRide'
  | 'getMeetingPoints'
  | 'addMeetingPoint'
  | 'updateMeetingPoint'
  | 'deleteMeetingPoint'
  | 'decidePoint'
  | 'getMeetings'
  | 'addMeeting'
  | 'updateMeeting'
  | 'deleteMeeting'
  | 'getBringList'
  | 'addBringItem'
  | 'updateBringItem'
  | 'deleteBringItem'
  | 'bringThis'
  | 'stopBringingThis'
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
  | 'getApprovedAccounts'
  | 'getSongbook'
  | 'getSong'
  | 'addSong'
  | 'updateSong'
  | 'deleteSong'
  | 'restoreSong'
  | 'getSongCategories'
  | 'addSongCategory'
  | 'updateSongCategory'
  | 'deleteSongCategory'
  | 'reorderSongCategories'
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
  | 'restoreSession'
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
  | 'getNotificationLog'
  | 'createInvite'
  | 'createGroupInvite'
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

export type AppApi = RoutesApi & BellApi & ShownApi & Pick<ApiClient, 'getMe' | 'logout' | 'getVersion'>

export const Routes = ({ api }: { api: RoutesApi }) => {
  const LoginRoute = useMemo(() => () => <Login api={api} />, [api])
  const AdminRoute = useMemo(() => () => <Admin api={api} />, [api])
  const AdminAccountRoute = useMemo(
    () =>
      ({ accountId }: { accountId?: string }) => <AdminAccount api={api} accountId={accountId ?? ''} />,
    [api],
  )
  const AdminEventsRoute = useMemo(() => () => <AdminEvents api={api} />, [api])
  const AdminAllergiesRoute = useMemo(() => () => <AdminAllergies api={api} />, [api])
  const AdminQuestionsRoute = useMemo(() => () => <AdminQuestions api={api} />, [api])
  const AdminApplicationsRoute = useMemo(() => () => <AdminApplications api={api} />, [api])
  const AdminInvitesRoute = useMemo(() => () => <AdminInvites api={api} />, [api])
  const AdminNotificationLogRoute = useMemo(() => () => <AdminNotificationLog api={api} />, [api])
  const OptionsRoute = useMemo(() => () => <Options api={api} />, [api])
  const PlacesRoute = useMemo(() => () => <Places api={api} />, [api])
  const AdminRosterRoute = useMemo(() => () => <AdminRoster api={api} />, [api])
  const AdminSettingsRoute = useMemo(() => () => <AdminSettings api={api} />, [api])
  const HomeRoute = useMemo(() => () => <Home api={api} />, [api])
  const MembersRoute = useMemo(() => () => <Members api={api} />, [api])
  const NotificationsRoute = useMemo(() => () => <Notifications api={api} />, [api])
  const DreamsRoute = useMemo(() => () => <Dreams api={api} />, [api])
  const ScheduleRoute = useMemo(() => () => <Schedule api={api} />, [api])
  const SongsRoute = useMemo(() => () => <Songs api={api} />, [api])
  const AdminSongCategoriesRoute = useMemo(() => () => <AdminSongCategories api={api} />, [api])
  const RolesRoute = useMemo(() => () => <Roles api={api} />, [api])
  const RidesRoute = useMemo(() => () => <Rides api={api} />, [api])
  const BringRoute = useMemo(() => () => <Bring api={api} />, [api])
  const MeetingsRoute = useMemo(() => () => <Meetings api={api} />, [api])
  const FaqRoute = useMemo(() => () => <Faq api={api} />, [api])
  const FeedRoute = useMemo(() => () => <Feed api={api} />, [api])
  const MealsRoute = useMemo(() => () => <Meals api={api} />, [api])
  const ProfileRoute = useMemo(() => () => <ProfilePage api={api} />, [api])
  const ApplyRoute = useMemo(() => () => <Apply api={api} />, [api])
  const ChangelogRoute = useMemo(() => () => <Changelog api={api} />, [api])
  const PrivacyRoute = useMemo(() => () => <Privacy api={api} />, [api])
  const TermsRoute = useMemo(() => () => <Terms api={api} />, [api])
  const PersonRoute = useMemo(
    () =>
      ({ accountId }: { accountId?: string }) => <Person api={api} accountId={accountId ?? ''} />,
    [api],
  )
  const SongRoute = useMemo(
    () =>
      ({ songId }: { songId?: string }) => <SongPage key={songId ?? ''} api={api} songId={songId ?? ''} />,
    [api],
  )
  const InviteRoute = useMemo(
    () =>
      ({ token }: { token?: string }) => <Invite api={api} token={token ?? ''} />,
    [api],
  )
  const ForgottenRoute = useMemo(() => () => <Forgotten api={api} />, [api])
  const ResetRoute = useMemo(
    () =>
      ({ token }: { token?: string }) => <Reset api={api} token={token ?? ''} />,
    [api],
  )

  return (
    <Router>
      <Route path="/" component={HomeRoute} />
      <Route path="/apply" component={ApplyRoute} />
      <Route path={changelogPage()} component={ChangelogRoute} />
      <Route path={formattingPage()} component={Formatting} />
      <Route path="/privacy" component={PrivacyRoute} />
      <Route path="/terms" component={TermsRoute} />
      <Route path="/members" component={MembersRoute} />
      <Route path="/members/:accountId" component={PersonRoute} />
      <Route path="/meals" component={MealsRoute} />
      <Route path="/dreams" component={DreamsRoute} />
      <Route path="/schedule" component={ScheduleRoute} />
      <Route path="/songs" component={SongsRoute} />
      <Route path="/songs/:songId" component={SongRoute} />
      <Route path="/roles" component={RolesRoute} />
      <Route path="/rides" component={RidesRoute} />
      <Route path="/bring" component={BringRoute} />
      <Route path="/meetings" component={MeetingsRoute} />
      <Route path="/faq" component={FaqRoute} />
      <Route path="/feed" component={FeedRoute} />
      <Route path={notificationsPage()} component={NotificationsRoute} />
      <Route path="/profile" component={ProfileRoute} />
      <Route path={INVITE_PATTERN} component={InviteRoute} />
      <Route path="/login" component={LoginRoute} />
      <Route path={forgottenPage()} component={ForgottenRoute} />
      <Route path={RESET_PATTERN} component={ResetRoute} />
      <Route path="/admin" component={AdminRoute} />
      <Route path={ADMIN_ACCOUNT_PATTERN} component={AdminAccountRoute} />
      <Route path="/admin/events" component={AdminEventsRoute} />
      <Route path="/admin/allergies" component={AdminAllergiesRoute} />
      <Route path="/admin/questions" component={AdminQuestionsRoute} />
      <Route path="/admin/applications" component={AdminApplicationsRoute} />
      <Route path="/admin/invites" component={AdminInvitesRoute} />
      <Route path="/admin/notifications" component={AdminNotificationLogRoute} />
      <Route path="/admin/song-categories" component={AdminSongCategoriesRoute} />
      <Route path="/options" component={OptionsRoute} />
      <Route path="/places" component={PlacesRoute} />
      <Route path="/admin/roster" component={AdminRosterRoute} />
      <Route path="/admin/settings" component={AdminSettingsRoute} />
      <Route default component={NotFound} />
    </Router>
  )
}

export const App = ({
  viewer,
  title,
  api,
  installs = null,
}: {
  viewer?: Viewer
  title?: string
  api?: AppApi
  installs?: InstallWatch | null
}) => {
  const freshness = useMemo(() => createFreshness(), [])
  const remembered = useMemo(() => createRemembered(), [])
  const client = useMemo(
    () =>
      api ??
      createApiClient(globalThis.fetch, {
        onRead: (response) => {
          freshness.note(freshnessAt(response, Date.now()))
        },
      }),
    [api, freshness],
  )
  const shown = useMemo(() => createShown(client), [client])

  const framed = (
    <FetchedBurnProvider api={client}>
      <PushNudgeProvider>
        <Layout api={client}>
          <NewVersion api={client} />
          <InstallApp watch={installs} />
          <StaleData freshness={freshness} />
          <Routes api={client} />
          <PushNudge api={client} />
        </Layout>
      </PushNudgeProvider>
    </FetchedBurnProvider>
  )

  const content =
    title === undefined ? (
      <FetchedInstallationProvider api={client}>{framed}</FetchedInstallationProvider>
    ) : (
      <InstallationProvider title={title}>{framed}</InstallationProvider>
    )

  return (
    <RememberedProvider remembered={remembered}>
      <ShownProvider shown={shown}>
        <LocationProvider scope={ROUTER_SCOPE}>
          <RouteOnMessage />
          {viewer === undefined ? (
            <FetchedViewerProvider api={client}>{content}</FetchedViewerProvider>
          ) : (
            <ViewerProvider viewer={viewer}>{content}</ViewerProvider>
          )}
        </LocationProvider>
      </ShownProvider>
    </RememberedProvider>
  )
}
