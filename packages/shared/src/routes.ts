import type {
  AllergyItemCreate,
  AllergyItemOrder,
  AllergyItemUpdate,
  LoginRequest,
  InviteCreate,
  AccountRolesUpdate,
  AdminPasswordReset,
  ApplicationCreate,
  AttendanceCreate,
  AttendanceUpdate,
  CommentInput,
  ConnectionCreate,
  ConnectionOrder,
  ConnectionUpdate,
  CopyFrom,
  EventCreateInput,
  EventOptionCreateInput,
  EventOptionOrder,
  EventOptionUpdate,
  EventUpdate,
  EventWelcomeUpdate,
  FaqCreateInput,
  FaqUpdate,
  IdOrder,
  FormQuestionCreateInput,
  FormQuestionOrder,
  FormQuestionUpdate,
  InstallationUpdate,
  LeadRoleCreateInput,
  LeadRoleLead,
  LeadRoleTeam,
  LeadRoleUpdate,
  MealCreateInput,
  MealIdeaUpdate,
  MealIntroUpdate,
  MealLead,
  MealSlotCreateInput,
  Helper,
  MealSlotUpdate,
  MealUpdate,
  MailSettingsUpdate,
  NotificationSettings,
  PasskeyLogin,
  PasskeyRegistration,
  PaymentUpdate,
  PlaceCreate,
  PlaceTransfer,
  PlaceOrder,
  PlaceUpdate,
  ProfileUpdate,
  PushSubscriptionCreate,
  RedeemRequestInput,
  RideCreate,
  RideUpdate,
  SessionCreateInput,
  SessionUpdate,
} from './index.ts'

export type ApiMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

/**
 * One endpoint, in the one place both halves read it from.
 *
 * `fastify` is how the server registers it; `path` is how a caller builds it. They are
 * two spellings of the same route, which is why they live beside each other — the pair
 * was previously a literal in `client.ts` and another in a route file, with nothing
 * tying them together. `routes.test.ts` asserts every `path(...)` matches its own
 * `fastify`, so the two cannot drift apart unnoticed.
 *
 * Encoding belongs to `path`, not to its callers. It was a per-call-site chore in 61
 * places, which is 61 chances to forget.
 */
export interface ApiRoute {
  method: ApiMethod
  fastify: string
  path: (...params: string[]) => string
}

/**
 * Every endpoint the app has.
 *
 * `as const satisfies` rather than a plain annotation: the annotation alone would widen
 * each `path` to the shared signature and lose its arity, so `updateEvent.path()` with
 * no id would compile. This keeps each one's own parameters.
 */
export const apiRoutes = {
  accountAvatar: {
    method: 'GET',
    fastify: '/api/accounts/:accountId/avatar',
    path: (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}/avatar`,
  },
  /**
   * Somebody, as the rest of the community sees them (#389).
   *
   * `requireApproved`, the same guard as the face beside the name and as the attendee
   * list. A separate route rather than a relaxed roster, for the reason
   * `/api/events/:eventId/attendees` gives: a route selecting the columns it names cannot
   * leak one it does not.
   */
  accountProfile: {
    method: 'GET',
    fastify: '/api/accounts/:accountId/profile',
    path: (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}/profile`,
  },
  addEventOption: {
    method: 'POST',
    fastify: '/api/events/:eventId/options',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/options`,
  },
  addFaqEntry: {
    method: 'POST',
    fastify: '/api/events/:eventId/faq',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/faq`,
  },
  addLeadRole: {
    method: 'POST',
    fastify: '/api/events/:eventId/roles',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/roles`,
  },
  /**
   * The ways somebody can be reached, which are their own to write (#388).
   *
   * Beside `/api/me/profile` and outside `/api/admin/`: nobody edits anybody else's,
   * and the account id comes from the session so there is no id in a body to tamper
   * with. Reading somebody else's belongs to their profile page, not here.
   */
  addMyConnection: {
    method: 'POST',
    fastify: '/api/me/connections',
    path: () => '/api/me/connections',
  },
  addMeal: {
    method: 'POST',
    fastify: '/api/admin/events/:eventId/meals',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/meals`,
  },
  addMealSlot: {
    method: 'POST',
    fastify: '/api/admin/events/:eventId/meal-slots',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/meal-slots`,
  },
  addPasskey: {
    method: 'POST',
    fastify: '/api/me/passkeys',
    path: () => '/api/me/passkeys',
  },
  addAllergyItem: {
    method: 'POST',
    fastify: '/api/admin/allergy-items',
    path: () => '/api/admin/allergy-items',
  },
  addPlace: {
    method: 'POST',
    fastify: '/api/events/:eventId/places',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places`,
  },
  addRide: {
    method: 'POST',
    fastify: '/api/events/:eventId/rides',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/rides`,
  },
  addQuestion: {
    method: 'POST',
    fastify: '/api/admin/questions',
    path: () => '/api/admin/questions',
  },
  adminAddAttendance: {
    method: 'POST',
    fastify: '/api/admin/events/:eventId/attendance',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/attendance`,
  },
  adminRemoveAttendance: {
    method: 'DELETE',
    fastify: '/api/admin/events/:eventId/attendance/:accountId',
    path: (eventId: string, accountId: string) =>
      `/api/admin/events/${encodeURIComponent(eventId)}/attendance/${encodeURIComponent(accountId)}`,
  },
  adminRoster: {
    method: 'GET',
    fastify: '/api/admin/events/:eventId/roster',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/roster`,
  },
  approveApplication: {
    method: 'POST',
    fastify: '/api/admin/applications/:id/approve',
    path: (id: string) => `/api/admin/applications/${encodeURIComponent(id)}/approve`,
  },
  copyFaq: {
    method: 'POST',
    fastify: '/api/events/:eventId/faq/copy',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/faq/copy`,
  },
  copyLeadRoles: {
    method: 'POST',
    fastify: '/api/events/:eventId/roles/copy',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/roles/copy`,
  },
  copyPlaces: {
    method: 'POST',
    fastify: '/api/events/:eventId/places/copy',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places/copy`,
  },
  createEvent: {
    method: 'POST',
    fastify: '/api/admin/events',
    path: () => '/api/admin/events',
  },
  createInvite: {
    method: 'POST',
    fastify: '/api/admin/invites',
    path: () => '/api/admin/invites',
  },
  deleteEventOption: {
    method: 'DELETE',
    fastify: '/api/event-options/:id',
    path: (id: string) => `/api/event-options/${encodeURIComponent(id)}`,
  },
  /**
   * Taking back what you said, or an admin taking it off. Comments only: a line
   * describing what the app did is not anybody's to rewrite.
   */
  deleteComment: {
    method: 'DELETE',
    fastify: '/api/comments/:id',
    path: (id: string) => `/api/comments/${encodeURIComponent(id)}`,
  },
  deleteFaqEntry: {
    method: 'DELETE',
    fastify: '/api/faq/:id',
    path: (id: string) => `/api/faq/${encodeURIComponent(id)}`,
  },
  deleteLeadRole: {
    method: 'DELETE',
    fastify: '/api/roles/:id',
    path: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
  },
  deleteMeal: {
    method: 'DELETE',
    fastify: '/api/admin/meals/:id',
    path: (id: string) => `/api/admin/meals/${encodeURIComponent(id)}`,
  },
  deleteMealSlot: {
    method: 'DELETE',
    fastify: '/api/admin/meal-slots/:id',
    path: (id: string) => `/api/admin/meal-slots/${encodeURIComponent(id)}`,
  },
  deleteAllergyItem: {
    method: 'DELETE',
    fastify: '/api/admin/allergy-items/:id',
    path: (id: string) => `/api/admin/allergy-items/${encodeURIComponent(id)}`,
  },
  deletePlace: {
    method: 'DELETE',
    fastify: '/api/places/:id',
    path: (id: string) => `/api/places/${encodeURIComponent(id)}`,
  },
  deleteRide: {
    method: 'DELETE',
    fastify: '/api/rides/:id',
    path: (id: string) => `/api/rides/${encodeURIComponent(id)}`,
  },
  deleteQuestion: {
    method: 'DELETE',
    fastify: '/api/admin/questions/:id',
    path: (id: string) => `/api/admin/questions/${encodeURIComponent(id)}`,
  },
  finishPasskeyLogin: {
    method: 'POST',
    fastify: '/api/auth/passkey/login',
    path: () => '/api/auth/passkey/login',
  },
  generateMeals: {
    method: 'POST',
    fastify: '/api/admin/events/:eventId/meals/generate',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/meals/generate`,
  },
  getActiveEvent: {
    method: 'GET',
    fastify: '/api/events/active',
    path: () => '/api/events/active',
  },
  getActiveRoster: {
    method: 'GET',
    fastify: '/api/admin/events/active/roster',
    path: () => '/api/admin/events/active/roster',
  },
  getAdminAccounts: {
    method: 'GET',
    fastify: '/api/admin/accounts',
    path: () => '/api/admin/accounts',
  },
  getApplications: {
    method: 'GET',
    fastify: '/api/admin/applications',
    path: () => '/api/admin/applications',
  },
  getEventAttendees: {
    method: 'GET',
    fastify: '/api/events/:eventId/attendees',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attendees`,
  },
  getEventOptions: {
    method: 'GET',
    fastify: '/api/events/:eventId/options',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/options`,
  },
  getEvents: {
    method: 'GET',
    fastify: '/api/admin/events',
    path: () => '/api/admin/events',
  },
  getInstallation: {
    method: 'GET',
    fastify: '/api/installation',
    path: () => '/api/installation',
  },
  /**
   * Public for the same reason as the icon, and more so: this is the picture a link
   * to the homepage shows, and the crawler fetching it carries nobody's session.
   */
  getInstallationBanner: {
    method: 'GET',
    fastify: '/api/installation/banner',
    path: () => '/api/installation/banner',
  },
  /**
   * Public, unlike `accountAvatar`: the browser fetches it for the home screen
   * without the app's cookies, and it is a logo rather than anybody's face.
   */
  getInstallationIcon: {
    method: 'GET',
    fastify: '/api/installation/icon',
    path: () => '/api/installation/icon',
  },
  getInviteState: {
    method: 'GET',
    fastify: '/api/invites/:token',
    path: (token: string) => `/api/invites/${encodeURIComponent(token)}`,
  },
  getInvites: {
    method: 'GET',
    fastify: '/api/admin/invites',
    path: () => '/api/admin/invites',
  },
  getFeed: {
    method: 'GET',
    fastify: '/api/feed',
    path: () => '/api/feed',
  },
  /**
   * One conversation, whole (#375).
   *
   * By thread id rather than by the dream's, because a withdrawn dream has no id left
   * to ask by and its thread is still worth reading. It is also the one read the
   * service worker keeps out of the offline cache — a key per dream ever opened, kept
   * until sign-out, is the shape of the problem #311 fixed for the banner.
   */
  getThread: {
    method: 'GET',
    fastify: '/api/threads/:id',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}`,
  },
  getFaq: {
    method: 'GET',
    fastify: '/api/events/:eventId/faq',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/faq`,
  },
  getFaqSources: {
    method: 'GET',
    fastify: '/api/events/:eventId/faq/sources',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/faq/sources`,
  },
  getLeadRoleSources: {
    method: 'GET',
    fastify: '/api/events/:eventId/roles/sources',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/roles/sources`,
  },
  getLeadRoles: {
    method: 'GET',
    fastify: '/api/events/:eventId/roles',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/roles`,
  },
  /**
   * How this installation posts, for the admin who set it up (#30).
   *
   * Behind the admin prefix, and never carrying the password — `mailSettingsSchema`
   * says why `has_password` is what comes back instead.
   */
  getMailSettings: {
    method: 'GET',
    fastify: '/api/admin/installation/mail',
    path: () => '/api/admin/installation/mail',
  },
  getMe: {
    method: 'GET',
    fastify: '/api/auth/me',
    path: () => '/api/auth/me',
  },
  getMealSlots: {
    method: 'GET',
    fastify: '/api/admin/events/:eventId/meal-slots',
    path: (eventId: string) => `/api/admin/events/${encodeURIComponent(eventId)}/meal-slots`,
  },
  getMeals: {
    method: 'GET',
    fastify: '/api/events/:eventId/meals',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/meals`,
  },
  getMembers: {
    method: 'GET',
    fastify: '/api/events/:eventId/members',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/members`,
  },
  getMyConnections: {
    method: 'GET',
    fastify: '/api/me/connections',
    path: () => '/api/me/connections',
  },
  getMyBurns: {
    method: 'GET',
    fastify: '/api/events/mine',
    path: () => '/api/events/mine',
  },
  getMyNotifications: {
    method: 'GET',
    fastify: '/api/me/notifications',
    path: () => '/api/me/notifications',
  },
  getMyNotificationSettings: {
    method: 'GET',
    fastify: '/api/me/notification-settings',
    path: () => '/api/me/notification-settings',
  },
  getMyPasskeys: {
    method: 'GET',
    fastify: '/api/me/passkeys',
    path: () => '/api/me/passkeys',
  },
  getMyProfile: {
    method: 'GET',
    fastify: '/api/me/profile',
    path: () => '/api/me/profile',
  },
  getPlaceSources: {
    method: 'GET',
    fastify: '/api/events/:eventId/places/sources',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places/sources`,
  },
  /**
   * Public, like `/api/questions`: a vocabulary of foods, carrying nothing about
   * anybody. That also lets the invite form offer the ticks without this route
   * learning to hand out anything new.
   */
  getAllergyItems: {
    method: 'GET',
    fastify: '/api/allergy-items',
    path: () => '/api/allergy-items',
  },
  getPlaces: {
    method: 'GET',
    fastify: '/api/events/:eventId/places',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places`,
  },
  getRides: {
    method: 'GET',
    fastify: '/api/events/:eventId/rides',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/rides`,
  },
  getPushKey: {
    method: 'GET',
    fastify: '/api/push/key',
    path: () => '/api/push/key',
  },
  getQuestions: {
    method: 'GET',
    fastify: '/api/questions',
    path: () => '/api/questions',
  },
  getSessions: {
    method: 'GET',
    fastify: '/api/events/:eventId/sessions',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/sessions`,
  },
  getChangelog: {
    method: 'GET',
    fastify: '/api/changelog',
    path: () => '/api/changelog',
  },
  getVersion: {
    method: 'GET',
    fastify: '/api/version',
    path: () => '/api/version',
  },
  helpWithSession: {
    method: 'POST',
    fastify: '/api/sessions/:id/helpers',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/helpers`,
  },
  joinEvent: {
    method: 'POST',
    fastify: '/api/events/:eventId/attendance/me',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attendance/me`,
  },
  joinLeadRoleTeam: {
    method: 'POST',
    fastify: '/api/roles/:id/team',
    path: (id: string) => `/api/roles/${encodeURIComponent(id)}/team`,
  },
  joinMealCrew: {
    method: 'PUT',
    fastify: '/api/meals/:id/crew/:role',
    path: (id: string, role: string) =>
      `/api/meals/${encodeURIComponent(id)}/crew/${encodeURIComponent(role)}`,
  },
  leaveEvent: {
    method: 'DELETE',
    fastify: '/api/events/:eventId/attendance/me',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attendance/me`,
  },
  leaveLeadRoleTeam: {
    method: 'DELETE',
    fastify: '/api/roles/:id/team/:accountId',
    path: (id: string, accountId: string) =>
      `/api/roles/${encodeURIComponent(id)}/team/${encodeURIComponent(accountId)}`,
  },
  leaveMealCrew: {
    method: 'DELETE',
    fastify: '/api/meals/:id/crew/:role/:accountId',
    path: (id: string, role: string, accountId: string) =>
      `/api/meals/${encodeURIComponent(id)}/crew/${encodeURIComponent(role)}/${encodeURIComponent(accountId)}`,
  },
  login: {
    method: 'POST',
    fastify: '/api/auth/login',
    path: () => '/api/auth/login',
  },
  logout: {
    method: 'POST',
    fastify: '/api/auth/logout',
    path: () => '/api/auth/logout',
  },
  markNotificationsSeen: {
    method: 'POST',
    fastify: '/api/me/notifications/seen',
    path: () => '/api/me/notifications/seen',
  },
  offerSession: {
    method: 'POST',
    fastify: '/api/events/:eventId/sessions',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/sessions`,
  },
  /**
   * Saying something on a thread.
   *
   * Not scoped to a burn still open, unlike every other write here: talking about a
   * burn is not arranging one, and "that was lovely" is a thing somebody wants to post
   * on the way home (#375).
   */
  postComment: {
    method: 'POST',
    fastify: '/api/threads/:id/comments',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}/comments`,
  },
  redeemInvite: {
    method: 'POST',
    fastify: '/api/invites/:token/redeem',
    path: (token: string) => `/api/invites/${encodeURIComponent(token)}/redeem`,
  },
  reissueInvite: {
    method: 'POST',
    fastify: '/api/admin/applications/:id/invite',
    path: (id: string) => `/api/admin/applications/${encodeURIComponent(id)}/invite`,
  },
  rejectApplication: {
    method: 'POST',
    fastify: '/api/admin/applications/:id/reject',
    path: (id: string) => `/api/admin/applications/${encodeURIComponent(id)}/reject`,
  },
  removeInstallationBanner: {
    method: 'DELETE',
    fastify: '/api/admin/installation/banner',
    path: () => '/api/admin/installation/banner',
  },
  removeInstallationIcon: {
    method: 'DELETE',
    fastify: '/api/admin/installation/icon',
    path: () => '/api/admin/installation/icon',
  },
  removeMailSettings: {
    method: 'DELETE',
    fastify: '/api/admin/installation/mail',
    path: () => '/api/admin/installation/mail',
  },
  removeMyConnection: {
    method: 'DELETE',
    fastify: '/api/me/connections/:id',
    path: (id: string) => `/api/me/connections/${encodeURIComponent(id)}`,
  },
  removeMyAvatar: {
    method: 'DELETE',
    fastify: '/api/me/avatar',
    path: () => '/api/me/avatar',
  },
  removePasskey: {
    method: 'DELETE',
    fastify: '/api/me/passkeys/:id',
    path: (id: string) => `/api/me/passkeys/${encodeURIComponent(id)}`,
  },
  reorderMyConnections: {
    method: 'PUT',
    fastify: '/api/me/connections/order',
    path: () => '/api/me/connections/order',
  },
  reorderFaq: {
    method: 'PUT',
    fastify: '/api/events/:eventId/faq/order',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/faq/order`,
  },
  reorderEventOptions: {
    method: 'PUT',
    fastify: '/api/events/:eventId/options/:kind/order',
    path: (eventId: string, kind: string) =>
      `/api/events/${encodeURIComponent(eventId)}/options/${encodeURIComponent(kind)}/order`,
  },
  reorderAllergyItems: {
    method: 'PUT',
    fastify: '/api/admin/allergy-items/order',
    path: () => '/api/admin/allergy-items/order',
  },
  reorderPlaces: {
    method: 'PUT',
    fastify: '/api/events/:eventId/places/order',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places/order`,
  },
  reorderQuestions: {
    method: 'PUT',
    fastify: '/api/admin/questions/order',
    path: () => '/api/admin/questions/order',
  },
  revokeInvite: {
    method: 'DELETE',
    fastify: '/api/admin/invites/:id',
    path: (id: string) => `/api/admin/invites/${encodeURIComponent(id)}`,
  },
  scheduleFeed: {
    method: 'GET',
    fastify: '/events/:eventId/schedule.ics',
    path: (eventId: string) => `/events/${encodeURIComponent(eventId)}/schedule.ics`,
  },
  /**
   * A message to the admin's own address, so a wrong password is found here rather
   * than by an applicant who never got an invite.
   */
  sendTestEmail: {
    method: 'POST',
    fastify: '/api/admin/installation/mail/test',
    path: () => '/api/admin/installation/mail/test',
  },
  setAccountPassword: {
    method: 'PUT',
    fastify: '/api/admin/accounts/:accountId/password',
    path: (accountId: string) => `/api/admin/accounts/${encodeURIComponent(accountId)}/password`,
  },
  setAccountRoles: {
    method: 'PUT',
    fastify: '/api/admin/accounts/:accountId/roles',
    path: (accountId: string) => `/api/admin/accounts/${encodeURIComponent(accountId)}/roles`,
  },
  setInstallationBanner: {
    method: 'PUT',
    fastify: '/api/admin/installation/banner',
    path: () => '/api/admin/installation/banner',
  },
  setInstallationIcon: {
    method: 'PUT',
    fastify: '/api/admin/installation/icon',
    path: () => '/api/admin/installation/icon',
  },
  setLeadRoleLead: {
    method: 'PUT',
    fastify: '/api/roles/:id/lead',
    path: (id: string) => `/api/roles/${encodeURIComponent(id)}/lead`,
  },
  setMealIdea: {
    method: 'PUT',
    fastify: '/api/meals/:id/idea',
    path: (id: string) => `/api/meals/${encodeURIComponent(id)}/idea`,
  },
  setMealLead: {
    method: 'PUT',
    fastify: '/api/meals/:id/lead',
    path: (id: string) => `/api/meals/${encodeURIComponent(id)}/lead`,
  },
  setMyAvatar: {
    method: 'PUT',
    fastify: '/api/me/avatar',
    path: () => '/api/me/avatar',
  },
  setPayment: {
    method: 'PATCH',
    fastify: '/api/admin/events/:eventId/attendance/:accountId/payment',
    path: (eventId: string, accountId: string) =>
      `/api/admin/events/${encodeURIComponent(eventId)}/attendance/${encodeURIComponent(accountId)}/payment`,
  },
  startPasskeyLogin: {
    method: 'POST',
    fastify: '/api/auth/passkey/challenge',
    path: () => '/api/auth/passkey/challenge',
  },
  /**
   * A picture somebody wrote into a markdown field (#379).
   *
   * `requireApproved`, like the avatar and the name beside it: the reference lives
   * inside prose the members write to each other, and a photograph in a comment thread
   * is at least as personal as a face. The id is unguessable, which is what keeps the
   * URL from being a list of everything anybody has uploaded.
   */
  storedImage: {
    method: 'GET',
    fastify: '/api/images/:id',
    path: (id: string) => `/api/images/${encodeURIComponent(id)}`,
  },
  startPasskeyRegistration: {
    method: 'POST',
    fastify: '/api/me/passkeys/challenge',
    path: () => '/api/me/passkeys/challenge',
  },
  stopHelpingWithSession: {
    method: 'DELETE',
    fastify: '/api/sessions/:id/helpers/:accountId',
    path: (id: string, accountId: string) =>
      `/api/sessions/${encodeURIComponent(id)}/helpers/${encodeURIComponent(accountId)}`,
  },
  submitApplication: {
    method: 'POST',
    fastify: '/api/applications',
    path: () => '/api/applications',
  },
  subscribeToPush: {
    method: 'POST',
    fastify: '/api/push/subscriptions',
    path: () => '/api/push/subscriptions',
  },
  supportSession: {
    method: 'POST',
    fastify: '/api/sessions/:id/support/me',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/support/me`,
  },
  transferMyPlace: {
    method: 'POST',
    fastify: '/api/events/:eventId/attendance/me/transfer',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attendance/me/transfer`,
  },
  unsubscribeFromPush: {
    method: 'DELETE',
    fastify: '/api/push/subscriptions',
    path: () => '/api/push/subscriptions',
  },
  /** Raw bytes in, an id out, which the field writes into the markdown at the cursor. */
  uploadImage: {
    method: 'POST',
    fastify: '/api/images',
    path: () => '/api/images',
  },
  /** Rewriting what you said. The author's own; nobody edits somebody else's words. */
  updateComment: {
    method: 'PATCH',
    fastify: '/api/comments/:id',
    path: (id: string) => `/api/comments/${encodeURIComponent(id)}`,
  },
  updateEvent: {
    method: 'PATCH',
    fastify: '/api/admin/events/:id',
    path: (id: string) => `/api/admin/events/${encodeURIComponent(id)}`,
  },
  updateEventOption: {
    method: 'PATCH',
    fastify: '/api/event-options/:id',
    path: (id: string) => `/api/event-options/${encodeURIComponent(id)}`,
  },
  updateInstallation: {
    method: 'PATCH',
    fastify: '/api/admin/installation',
    path: () => '/api/admin/installation',
  },
  updateFaqEntry: {
    method: 'PATCH',
    fastify: '/api/faq/:id',
    path: (id: string) => `/api/faq/${encodeURIComponent(id)}`,
  },
  updateLeadRole: {
    method: 'PATCH',
    fastify: '/api/roles/:id',
    path: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
  },
  updateMailSettings: {
    method: 'PUT',
    fastify: '/api/admin/installation/mail',
    path: () => '/api/admin/installation/mail',
  },
  updateMeal: {
    method: 'PATCH',
    fastify: '/api/meals/:id',
    path: (id: string) => `/api/meals/${encodeURIComponent(id)}`,
  },
  updateMealIntro: {
    method: 'PATCH',
    fastify: '/api/events/:eventId/meal-intro',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/meal-intro`,
  },
  updateMealSlot: {
    method: 'PATCH',
    fastify: '/api/admin/meal-slots/:id',
    path: (id: string) => `/api/admin/meal-slots/${encodeURIComponent(id)}`,
  },
  updateMyConnection: {
    method: 'PATCH',
    fastify: '/api/me/connections/:id',
    path: (id: string) => `/api/me/connections/${encodeURIComponent(id)}`,
  },
  updateMyNotificationSettings: {
    method: 'PUT',
    fastify: '/api/me/notification-settings',
    path: () => '/api/me/notification-settings',
  },
  updateMyProfile: {
    method: 'PATCH',
    fastify: '/api/me/profile',
    path: () => '/api/me/profile',
  },
  updateMyStay: {
    method: 'PATCH',
    fastify: '/api/events/:eventId/attendance/me',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/attendance/me`,
  },
  updateAllergyItem: {
    method: 'PATCH',
    fastify: '/api/admin/allergy-items/:id',
    path: (id: string) => `/api/admin/allergy-items/${encodeURIComponent(id)}`,
  },
  updateRide: {
    method: 'PATCH',
    fastify: '/api/rides/:id',
    path: (id: string) => `/api/rides/${encodeURIComponent(id)}`,
  },
  updatePlace: {
    method: 'PATCH',
    fastify: '/api/places/:id',
    path: (id: string) => `/api/places/${encodeURIComponent(id)}`,
  },
  updateQuestion: {
    method: 'PATCH',
    fastify: '/api/admin/questions/:id',
    path: (id: string) => `/api/admin/questions/${encodeURIComponent(id)}`,
  },
  updateSession: {
    method: 'PATCH',
    fastify: '/api/sessions/:id',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  },
  updateWelcome: {
    method: 'PATCH',
    fastify: '/api/events/:id/welcome',
    path: (id: string) => `/api/events/${encodeURIComponent(id)}/welcome`,
  },
  withdrawSession: {
    method: 'DELETE',
    fastify: '/api/sessions/:id',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  },
  withdrawSupportForSession: {
    method: 'DELETE',
    fastify: '/api/sessions/:id/support/me',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/support/me`,
  },
  /**
   * The second endpoint outside `/api`, after the ICS feed, and for the same
   * reason: a browser looking for a site's manifest looks at the site, not at
   * its API. `index.html` has to name this path in a `<link>` it cannot import,
   * so `apps/web`'s `shell.test.ts` reads the HTML and asserts the two spellings
   * still agree.
   */
  webManifest: {
    method: 'GET',
    fastify: '/manifest.webmanifest',
    path: () => '/manifest.webmanifest',
  },
} as const satisfies Record<string, ApiRoute>

export type RouteKey = keyof typeof apiRoutes

/**
 * The installation's own pictures, with the `?v=` that makes a new one a new URL.
 *
 * Here for the reason the per-segment encoding is: it was a chore at each call site,
 * and the icon's spelling had drifted three times over (#376, #378). Two versioned
 * spellings under one path evict each other in the offline cache, which is what makes
 * a drift here cost something rather than merely look untidy.
 *
 * `null` — or `undefined`, since callers hold both — is "nobody has uploaded one",
 * which the icon route answers with the app's own flame. The bare path is a separate live URL on purpose — the header's mark and the
 * favicon quote it, and nothing about them changes when an admin uploads.
 */
export const iconSrc = (version: string | null | undefined): string =>
  `${apiRoutes.getInstallationIcon.path()}?v=${encodeURIComponent(version ?? 'default')}`

/** The same for the homepage's banner, which has no default: there is one or there is none. */
export const bannerSrc = (version: string): string =>
  `${apiRoutes.getInstallationBanner.path()}?v=${encodeURIComponent(version)}`

/**
 * What each write accepts, as a caller sends it.
 *
 * Partial by design, and the criterion is exact: a route is here when it takes a JSON
 * body. Reads and bodiless writes are absent, and so is `setMyAvatar` — it sends image
 * bytes rather than JSON, and a `Blob` is not a shape a schema describes. Asking for a
 * key that is absent is a type error rather than `unknown`.
 *
 * The `Input` variant where a schema has one, since that is the pre-parse shape a
 * client actually sends.
 *
 * This is the half that made #152 worth doing rather than a tidy-up: a body type was
 * previously chosen at each client method by hand, with nothing checking it against
 * the schema the route parses.
 */
export interface RouteBodies {
  addMyConnection: ConnectionCreate
  updateMyConnection: ConnectionUpdate
  reorderMyConnections: ConnectionOrder
  addEventOption: EventOptionCreateInput
  addFaqEntry: FaqCreateInput
  addLeadRole: LeadRoleCreateInput
  addMeal: MealCreateInput
  addMealSlot: MealSlotCreateInput
  addPasskey: PasskeyRegistration
  addAllergyItem: AllergyItemCreate
  addPlace: PlaceCreate
  addRide: RideCreate
  addQuestion: FormQuestionCreateInput
  adminAddAttendance: AttendanceCreate
  copyFaq: CopyFrom
  copyLeadRoles: CopyFrom
  copyPlaces: CopyFrom
  createEvent: EventCreateInput
  createInvite: InviteCreate
  finishPasskeyLogin: PasskeyLogin
  helpWithSession: Helper
  joinLeadRoleTeam: LeadRoleTeam
  joinMealCrew: Helper
  login: LoginRequest
  offerSession: SessionCreateInput
  postComment: CommentInput
  redeemInvite: RedeemRequestInput
  reorderEventOptions: EventOptionOrder
  reorderAllergyItems: AllergyItemOrder
  reorderFaq: IdOrder
  reorderPlaces: PlaceOrder
  reorderQuestions: FormQuestionOrder
  setAccountPassword: AdminPasswordReset
  setAccountRoles: AccountRolesUpdate
  setLeadRoleLead: LeadRoleLead
  setMealIdea: MealIdeaUpdate
  setMealLead: MealLead
  setPayment: PaymentUpdate
  submitApplication: ApplicationCreate
  subscribeToPush: PushSubscriptionCreate
  transferMyPlace: PlaceTransfer
  unsubscribeFromPush: Pick<PushSubscriptionCreate, 'endpoint'>
  updateComment: CommentInput
  updateEvent: EventUpdate
  updateEventOption: EventOptionUpdate
  updateInstallation: InstallationUpdate
  updateMailSettings: MailSettingsUpdate
  updateFaqEntry: FaqUpdate
  updateLeadRole: LeadRoleUpdate
  updateMeal: MealUpdate
  updateMealIntro: MealIntroUpdate
  updateMealSlot: MealSlotUpdate
  updateMyNotificationSettings: NotificationSettings
  updateMyProfile: ProfileUpdate
  updateMyStay: AttendanceUpdate
  updateAllergyItem: AllergyItemUpdate
  updatePlace: PlaceUpdate
  updateRide: RideUpdate
  updateQuestion: FormQuestionUpdate
  updateSession: SessionUpdate
  updateWelcome: EventWelcomeUpdate
}

/** The body a route takes, by key. A key with no body is a type error. */
export type BodyOf<K extends keyof RouteBodies> = RouteBodies[K]
