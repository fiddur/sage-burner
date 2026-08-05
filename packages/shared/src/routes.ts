import type {
  LoginRequest,
  InviteCreate,
  AccountRolesUpdate,
  AdminPasswordReset,
  ApplicationCreate,
  AttendanceCreate,
  AttendanceUpdate,
  CopyFrom,
  EventCreateInput,
  EventOptionCreateInput,
  EventOptionOrder,
  EventOptionUpdate,
  EventUpdate,
  EventWelcomeUpdate,
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
  MealSlotUpdate,
  MealUpdate,
  PaymentUpdate,
  PlaceCreate,
  PlaceOrder,
  PlaceUpdate,
  ProfileUpdate,
  PushSubscriptionCreate,
  RedeemRequestInput,
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
  addEventOption: {
    method: 'POST',
    fastify: '/api/events/:eventId/options',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/options`,
  },
  addLeadRole: {
    method: 'POST',
    fastify: '/api/events/:eventId/roles',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/roles`,
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
  addPlace: {
    method: 'POST',
    fastify: '/api/events/:eventId/places',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places`,
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
  deletePlace: {
    method: 'DELETE',
    fastify: '/api/places/:id',
    path: (id: string) => `/api/places/${encodeURIComponent(id)}`,
  },
  deleteQuestion: {
    method: 'DELETE',
    fastify: '/api/admin/questions/:id',
    path: (id: string) => `/api/admin/questions/${encodeURIComponent(id)}`,
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
  getMyBurns: {
    method: 'GET',
    fastify: '/api/events/mine',
    path: () => '/api/events/mine',
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
  getPlaces: {
    method: 'GET',
    fastify: '/api/events/:eventId/places',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/places`,
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
  getVersion: {
    method: 'GET',
    fastify: '/api/version',
    path: () => '/api/version',
  },
  helpWithSession: {
    method: 'POST',
    fastify: '/api/sessions/:id/helpers/me',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/helpers/me`,
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
    fastify: '/api/meals/:id/:role/me',
    path: (id: string, role: string) => `/api/meals/${encodeURIComponent(id)}/${encodeURIComponent(role)}/me`,
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
    fastify: '/api/meals/:id/:role/me',
    path: (id: string, role: string) => `/api/meals/${encodeURIComponent(id)}/${encodeURIComponent(role)}/me`,
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
  offerSession: {
    method: 'POST',
    fastify: '/api/events/:eventId/sessions',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/sessions`,
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
  removeMyAvatar: {
    method: 'DELETE',
    fastify: '/api/me/avatar',
    path: () => '/api/me/avatar',
  },
  reorderEventOptions: {
    method: 'PUT',
    fastify: '/api/events/:eventId/options/:kind/order',
    path: (eventId: string, kind: string) =>
      `/api/events/${encodeURIComponent(eventId)}/options/${encodeURIComponent(kind)}/order`,
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
  stopHelpingWithSession: {
    method: 'DELETE',
    fastify: '/api/sessions/:id/helpers/me',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/helpers/me`,
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
  unsubscribeFromPush: {
    method: 'DELETE',
    fastify: '/api/push/subscriptions',
    path: () => '/api/push/subscriptions',
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
  updateLeadRole: {
    method: 'PATCH',
    fastify: '/api/roles/:id',
    path: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
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
} as const satisfies Record<string, ApiRoute>

export type RouteKey = keyof typeof apiRoutes

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
  addEventOption: EventOptionCreateInput
  addLeadRole: LeadRoleCreateInput
  addMeal: MealCreateInput
  addMealSlot: MealSlotCreateInput
  addPlace: PlaceCreate
  addQuestion: FormQuestionCreateInput
  adminAddAttendance: AttendanceCreate
  copyLeadRoles: CopyFrom
  copyPlaces: CopyFrom
  createEvent: EventCreateInput
  createInvite: InviteCreate
  joinLeadRoleTeam: LeadRoleTeam
  login: LoginRequest
  offerSession: SessionCreateInput
  redeemInvite: RedeemRequestInput
  reorderEventOptions: EventOptionOrder
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
  unsubscribeFromPush: Pick<PushSubscriptionCreate, 'endpoint'>
  updateEvent: EventUpdate
  updateEventOption: EventOptionUpdate
  updateInstallation: InstallationUpdate
  updateLeadRole: LeadRoleUpdate
  updateMeal: MealUpdate
  updateMealIntro: MealIntroUpdate
  updateMealSlot: MealSlotUpdate
  updateMyProfile: ProfileUpdate
  updateMyStay: AttendanceUpdate
  updatePlace: PlaceUpdate
  updateQuestion: FormQuestionUpdate
  updateSession: SessionUpdate
  updateWelcome: EventWelcomeUpdate
}

/** The body a route takes, by key. A key with no body is a type error. */
export type BodyOf<K extends keyof RouteBodies> = RouteBodies[K]
