import type { FeedKind } from './enums.ts'
import type {
  AccountRolesUpdate,
  AdminAccountUpdate,
  AdminPasswordReset,
  AllergyItemCreate,
  AllergyItemOrder,
  AllergyItemUpdate,
  ApplicationCreate,
  ApplicationMessageInput,
  AttendanceCreate,
  AttendanceUpdate,
  BringCreateInput,
  BringUpdate,
  CommentInput,
  ConnectionCreate,
  ConnectionOrder,
  ConnectionUpdate,
  CopyFrom,
  DecisionInput,
  DigestPreviewInput,
  EventCreateInput,
  EventOptionCreateInput,
  EventOptionOrder,
  EventOptionUpdate,
  EventUpdate,
  EventWelcomeUpdate,
  FaqCreateInput,
  FaqUpdate,
  FollowInput,
  FormQuestionCreateInput,
  FormQuestionOrder,
  FormQuestionUpdate,
  GroupInviteCreate,
  Helper,
  IdOrder,
  InstallationUpdate,
  InviteCreate,
  LeadRoleCreateInput,
  LeadRoleLead,
  LeadRoleTeam,
  LeadRoleUpdate,
  LoginRequest,
  MailSettingsUpdate,
  MapLinkUpdate,
  MealCreateInput,
  MealIdeaUpdate,
  MealIntroUpdate,
  MealLead,
  MealSlotCreateInput,
  MealSlotUpdate,
  MealUpdate,
  MeetingCreateInput,
  MeetingPointCreateInput,
  MeetingPointUpdate,
  MeetingUpdateInput,
  NotificationSettings,
  OAuthSettingsUpdate,
  PasskeyLogin,
  PasskeyRegistration,
  PasswordReset,
  PasswordResetRequest,
  PaymentUpdate,
  PlaceCreate,
  PlaceOrder,
  PlaceTransfer,
  PlaceUpdate,
  PostCreate,
  PostUpdate,
  ProfileUpdate,
  PushSubscriptionCreate,
  RedeemRequestInput,
  RideCreate,
  RideUpdate,
  SessionCreateInput,
  SessionMerge,
  SessionUpdate,
  SignUpRequest,
  SongCategoryCreateInput,
  SongCategoryOrder,
  SongCategoryUpdate,
  SongCreateInput,
  SongUpdate,
  TargetShownInput,
} from './index.ts'

import { feedKindsQuery } from './enums.ts'

export type ApiMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export interface ApiRoute {
  method: ApiMethod
  fastify: string
  path: (...params: string[]) => string
}

export const apiRoutes = {
  accountAvatar: {
    method: 'GET',
    fastify: '/api/accounts/:accountId/avatar',
    path: (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}/avatar`,
  },
  accountProfile: {
    method: 'GET',
    fastify: '/api/accounts/:accountId/profile',
    path: (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}/profile`,
  },
  addMeetingPoint: {
    method: 'POST',
    fastify: '/api/events/:eventId/points',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/points`,
  },
  getMeetingPoints: {
    method: 'GET',
    fastify: '/api/events/:eventId/points',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/points`,
  },
  updateMeetingPoint: {
    method: 'PATCH',
    fastify: '/api/points/:id',
    path: (id: string) => `/api/points/${encodeURIComponent(id)}`,
  },
  deleteMeetingPoint: {
    method: 'DELETE',
    fastify: '/api/points/:id',
    path: (id: string) => `/api/points/${encodeURIComponent(id)}`,
  },
  decidePoint: {
    method: 'PUT',
    fastify: '/api/points/:id/decision',
    path: (id: string) => `/api/points/${encodeURIComponent(id)}/decision`,
  },
  addMeeting: {
    method: 'POST',
    fastify: '/api/events/:eventId/meetings',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/meetings`,
  },
  getMeetings: {
    method: 'GET',
    fastify: '/api/events/:eventId/meetings',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/meetings`,
  },
  updateMeeting: {
    method: 'PATCH',
    fastify: '/api/meetings/:id',
    path: (id: string) => `/api/meetings/${encodeURIComponent(id)}`,
  },
  deleteMeeting: {
    method: 'DELETE',
    fastify: '/api/meetings/:id',
    path: (id: string) => `/api/meetings/${encodeURIComponent(id)}`,
  },
  addBringItem: {
    method: 'POST',
    fastify: '/api/events/:eventId/bring',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/bring`,
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
  addPost: {
    method: 'POST',
    fastify: '/api/events/:eventId/posts',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/posts`,
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
  addSong: {
    method: 'POST',
    fastify: '/api/songs',
    path: () => '/api/songs',
  },
  addSongCategory: {
    method: 'POST',
    fastify: '/api/admin/song-categories',
    path: () => '/api/admin/song-categories',
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
  bringThis: {
    method: 'POST',
    fastify: '/api/bring/:id/hands',
    path: (id: string) => `/api/bring/${encodeURIComponent(id)}/hands`,
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
  createGroupInvite: {
    method: 'POST',
    fastify: '/api/admin/invites/group',
    path: () => '/api/admin/invites/group',
  },
  deleteEventOption: {
    method: 'DELETE',
    fastify: '/api/event-options/:id',
    path: (id: string) => `/api/event-options/${encodeURIComponent(id)}`,
  },
  deleteBringItem: {
    method: 'DELETE',
    fastify: '/api/bring/:id',
    path: (id: string) => `/api/bring/${encodeURIComponent(id)}`,
  },
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
  deletePost: {
    method: 'DELETE',
    fastify: '/api/posts/:id',
    path: (id: string) => `/api/posts/${encodeURIComponent(id)}`,
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
  deleteSong: {
    method: 'DELETE',
    fastify: '/api/songs/:id',
    path: (id: string) => `/api/songs/${encodeURIComponent(id)}`,
  },
  deleteSongCategory: {
    method: 'DELETE',
    fastify: '/api/admin/song-categories/:id',
    path: (id: string) => `/api/admin/song-categories/${encodeURIComponent(id)}`,
  },
  finishOauth: {
    method: 'GET',
    fastify: '/api/auth/oauth/:provider/callback',
    path: (provider: string) => `/api/auth/oauth/${encodeURIComponent(provider)}/callback`,
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
  getAdminAccount: {
    method: 'GET',
    fastify: '/api/admin/accounts/:accountId',
    path: (accountId: string) => `/api/admin/accounts/${encodeURIComponent(accountId)}`,
  },
  getAdminAccounts: {
    method: 'GET',
    fastify: '/api/admin/accounts',
    path: () => '/api/admin/accounts',
  },
  getApprovedAccounts: {
    method: 'GET',
    fastify: '/api/accounts',
    path: () => '/api/accounts',
  },
  getApplications: {
    method: 'GET',
    fastify: '/api/admin/applications',
    path: () => '/api/admin/applications',
  },
  getMyApplication: {
    method: 'GET',
    fastify: '/api/me/application',
    path: () => '/api/me/application',
  },
  getApplicationMessages: {
    method: 'GET',
    fastify: '/api/admin/applications/:id/messages',
    path: (id: string) => `/api/admin/applications/${encodeURIComponent(id)}/messages`,
  },
  sendApplicationMessage: {
    method: 'POST',
    fastify: '/api/admin/applications/:id/messages',
    path: (id: string) => `/api/admin/applications/${encodeURIComponent(id)}/messages`,
  },
  sendMyApplicationMessage: {
    method: 'POST',
    fastify: '/api/me/application/messages',
    path: () => '/api/me/application/messages',
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
  getMapLink: {
    method: 'GET',
    fastify: '/api/map',
    path: () => '/api/map',
  },
  setMapLink: {
    method: 'PUT',
    fastify: '/api/admin/map',
    path: () => '/api/admin/map',
  },
  getInstallationBanner: {
    method: 'GET',
    fastify: '/api/installation/banner',
    path: () => '/api/installation/banner',
  },
  getInstallationIcon: {
    method: 'GET',
    fastify: '/api/installation/icon',
    path: () => '/api/installation/icon',
  },
  getThread: {
    method: 'GET',
    fastify: '/api/threads/:id',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}`,
  },
  getTouchIcon: {
    method: 'GET',
    fastify: '/api/installation/icons/:size',
    path: (size: string) => `/api/installation/icons/${encodeURIComponent(size)}`,
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
  getBringList: {
    method: 'GET',
    fastify: '/api/events/:eventId/bring',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/bring`,
  },
  getFeed: {
    method: 'GET',
    fastify: '/api/feed',
    path: () => '/api/feed',
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
  getMailSettings: {
    method: 'GET',
    fastify: '/api/admin/installation/mail',
    path: () => '/api/admin/installation/mail',
  },
  getOauthSettings: {
    method: 'GET',
    fastify: '/api/admin/installation/oauth/:provider',
    path: (provider: string) => `/api/admin/installation/oauth/${encodeURIComponent(provider)}`,
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
  getMyIdentities: {
    method: 'GET',
    fastify: '/api/me/identities',
    path: () => '/api/me/identities',
  },
  getCalendarToken: {
    method: 'GET',
    fastify: '/api/events/:eventId/calendar',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/calendar`,
  },
  getMyBurns: {
    method: 'GET',
    fastify: '/api/events/mine',
    path: () => '/api/events/mine',
  },
  getMyImages: {
    method: 'GET',
    fastify: '/api/me/images',
    path: () => '/api/me/images',
  },
  getNotificationLog: {
    method: 'GET',
    fastify: '/api/admin/notification-log',
    path: () => '/api/admin/notification-log',
  },
  getMyNotifications: {
    method: 'GET',
    fastify: '/api/me/notifications',
    path: () => '/api/me/notifications',
  },
  deleteMyNotification: {
    method: 'DELETE',
    fastify: '/api/me/notifications/:id',
    path: (id: string) => `/api/me/notifications/${encodeURIComponent(id)}`,
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
  getAllergyItems: {
    method: 'GET',
    fastify: '/api/allergy-items',
    path: () => '/api/allergy-items',
  },
  getPasswordResetState: {
    method: 'GET',
    fastify: '/api/auth/resets/:token',
    path: (token: string) => `/api/auth/resets/${encodeURIComponent(token)}`,
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
  getSong: {
    method: 'GET',
    fastify: '/api/songs/:id',
    path: (id: string) => `/api/songs/${encodeURIComponent(id)}`,
  },
  getSongbook: {
    method: 'GET',
    fastify: '/api/songs',
    path: () => '/api/songs',
  },
  getSongCategories: {
    method: 'GET',
    fastify: '/api/song-categories',
    path: () => '/api/song-categories',
  },
  getChangelog: {
    method: 'GET',
    fastify: '/api/changelog',
    path: () => '/api/changelog',
  },
  getPrivacy: {
    method: 'GET',
    fastify: '/api/privacy',
    path: () => '/api/privacy',
  },
  getTerms: {
    method: 'GET',
    fastify: '/api/terms',
    path: () => '/api/terms',
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
  markTargetShown: {
    method: 'POST',
    fastify: '/api/me/notifications/shown',
    path: () => '/api/me/notifications/shown',
  },
  offerSession: {
    method: 'POST',
    fastify: '/api/events/:eventId/sessions',
    path: (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/sessions`,
  },
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
  requestPasswordReset: {
    method: 'POST',
    fastify: '/api/auth/forgotten',
    path: () => '/api/auth/forgotten',
  },
  resetPassword: {
    method: 'POST',
    fastify: '/api/auth/resets/:token',
    path: (token: string) => `/api/auth/resets/${encodeURIComponent(token)}`,
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
  removeMyIdentity: {
    method: 'DELETE',
    fastify: '/api/me/identities/:provider',
    path: (provider: string) => `/api/me/identities/${encodeURIComponent(provider)}`,
  },
  removeOauthSettings: {
    method: 'DELETE',
    fastify: '/api/admin/installation/oauth/:provider',
    path: (provider: string) => `/api/admin/installation/oauth/${encodeURIComponent(provider)}`,
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
  removeMyImage: {
    method: 'DELETE',
    fastify: '/api/me/images/:id',
    path: (id: string) => `/api/me/images/${encodeURIComponent(id)}`,
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
  reorderSongCategories: {
    method: 'PUT',
    fastify: '/api/admin/song-categories/order',
    path: () => '/api/admin/song-categories/order',
  },
  mergeSession: {
    method: 'POST',
    fastify: '/api/sessions/:id/merge',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/merge`,
  },
  restoreSession: {
    method: 'POST',
    fastify: '/api/sessions/:id/restore',
    path: (id: string) => `/api/sessions/${encodeURIComponent(id)}/restore`,
  },
  restoreSong: {
    method: 'POST',
    fastify: '/api/songs/:id/restore',
    path: (id: string) => `/api/songs/${encodeURIComponent(id)}/restore`,
  },
  rotateCalendarToken: {
    method: 'POST',
    fastify: '/api/admin/events/:id/calendar',
    path: (id: string) => `/api/admin/events/${encodeURIComponent(id)}/calendar`,
  },
  revokeInvite: {
    method: 'DELETE',
    fastify: '/api/admin/invites/:id',
    path: (id: string) => `/api/admin/invites/${encodeURIComponent(id)}`,
  },
  scheduleFeed: {
    method: 'GET',
    fastify: '/calendar/:token/schedule.ics',
    path: (token: string) => `/calendar/${encodeURIComponent(token)}/schedule.ics`,
  },
  sendDigestPreview: {
    method: 'POST',
    fastify: '/api/admin/installation/mail/digest',
    path: () => '/api/admin/installation/mail/digest',
  },
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
  startOauthSignIn: {
    method: 'GET',
    fastify: '/api/auth/oauth/:provider',
    path: (provider: string) => `/api/auth/oauth/${encodeURIComponent(provider)}`,
  },
  startOauthLink: {
    method: 'GET',
    fastify: '/api/me/oauth/:provider',
    path: (provider: string) => `/api/me/oauth/${encodeURIComponent(provider)}`,
  },
  startPasskeyLogin: {
    method: 'POST',
    fastify: '/api/auth/passkey/challenge',
    path: () => '/api/auth/passkey/challenge',
  },
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
  stopBringingThis: {
    method: 'DELETE',
    fastify: '/api/bring/:id/hands/:accountId',
    path: (id: string, accountId: string) =>
      `/api/bring/${encodeURIComponent(id)}/hands/${encodeURIComponent(accountId)}`,
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
  signUp: {
    method: 'POST',
    fastify: '/api/auth/sign-up',
    path: () => '/api/auth/sign-up',
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
  supportThread: {
    method: 'POST',
    fastify: '/api/threads/:id/support/me',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}/support/me`,
  },
  supportComment: {
    method: 'POST',
    fastify: '/api/comments/:id/support/me',
    path: (id: string) => `/api/comments/${encodeURIComponent(id)}/support/me`,
  },
  setThreadFollow: {
    method: 'PUT',
    fastify: '/api/threads/:id/follow/me',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}/follow/me`,
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
  updateBringItem: {
    method: 'PATCH',
    fastify: '/api/bring/:id',
    path: (id: string) => `/api/bring/${encodeURIComponent(id)}`,
  },
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
  updateOauthSettings: {
    method: 'PUT',
    fastify: '/api/admin/installation/oauth/:provider',
    path: (provider: string) => `/api/admin/installation/oauth/${encodeURIComponent(provider)}`,
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
  updateAdminAccount: {
    method: 'PATCH',
    fastify: '/api/admin/accounts/:accountId',
    path: (accountId: string) => `/api/admin/accounts/${encodeURIComponent(accountId)}`,
  },
  updateAllergyItem: {
    method: 'PATCH',
    fastify: '/api/admin/allergy-items/:id',
    path: (id: string) => `/api/admin/allergy-items/${encodeURIComponent(id)}`,
  },
  updatePost: {
    method: 'PATCH',
    fastify: '/api/posts/:id',
    path: (id: string) => `/api/posts/${encodeURIComponent(id)}`,
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
  updateSong: {
    method: 'PATCH',
    fastify: '/api/songs/:id',
    path: (id: string) => `/api/songs/${encodeURIComponent(id)}`,
  },
  updateSongCategory: {
    method: 'PATCH',
    fastify: '/api/admin/song-categories/:id',
    path: (id: string) => `/api/admin/song-categories/${encodeURIComponent(id)}`,
  },
  updateWelcome: {
    method: 'PATCH',
    fastify: '/api/events/:id/welcome',
    path: (id: string) => `/api/events/${encodeURIComponent(id)}/welcome`,
  },
  uploadImage: {
    method: 'POST',
    fastify: '/api/images',
    path: () => '/api/images',
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
  withdrawSupportForThread: {
    method: 'DELETE',
    fastify: '/api/threads/:id/support/me',
    path: (id: string) => `/api/threads/${encodeURIComponent(id)}/support/me`,
  },
  withdrawSupportForComment: {
    method: 'DELETE',
    fastify: '/api/comments/:id/support/me',
    path: (id: string) => `/api/comments/${encodeURIComponent(id)}/support/me`,
  },
  webManifest: {
    method: 'GET',
    fastify: '/manifest.webmanifest',
    path: () => '/manifest.webmanifest',
  },
} as const satisfies Record<string, ApiRoute>

export type RouteKey = keyof typeof apiRoutes

export const feedPath = (kinds: readonly FeedKind[] = []): string =>
  `${apiRoutes.getFeed.path()}${feedKindsQuery(kinds)}`

export const iconSrc = (version: string | null | undefined): string =>
  `${apiRoutes.getInstallationIcon.path()}?v=${encodeURIComponent(version ?? 'default')}`

export const bannerSrc = (version: string): string =>
  `${apiRoutes.getInstallationBanner.path()}?v=${encodeURIComponent(version)}`

export interface RouteBodies {
  updateOauthSettings: OAuthSettingsUpdate
  addMyConnection: ConnectionCreate
  updateMyConnection: ConnectionUpdate
  reorderMyConnections: ConnectionOrder
  addBringItem: BringCreateInput
  addMeeting: MeetingCreateInput
  addMeetingPoint: MeetingPointCreateInput
  addEventOption: EventOptionCreateInput
  addFaqEntry: FaqCreateInput
  addLeadRole: LeadRoleCreateInput
  addMeal: MealCreateInput
  addMealSlot: MealSlotCreateInput
  addPasskey: PasskeyRegistration
  addAllergyItem: AllergyItemCreate
  addPlace: PlaceCreate
  addPost: PostCreate
  addRide: RideCreate
  addQuestion: FormQuestionCreateInput
  adminAddAttendance: AttendanceCreate
  bringThis: Helper
  copyFaq: CopyFrom
  copyLeadRoles: CopyFrom
  copyPlaces: CopyFrom
  createEvent: EventCreateInput
  createGroupInvite: GroupInviteCreate
  createInvite: InviteCreate
  finishPasskeyLogin: PasskeyLogin
  helpWithSession: Helper
  joinLeadRoleTeam: LeadRoleTeam
  joinMealCrew: Helper
  login: LoginRequest
  offerSession: SessionCreateInput
  postComment: CommentInput
  redeemInvite: RedeemRequestInput
  requestPasswordReset: PasswordResetRequest
  resetPassword: PasswordReset
  reorderEventOptions: EventOptionOrder
  reorderAllergyItems: AllergyItemOrder
  reorderFaq: IdOrder
  reorderPlaces: PlaceOrder
  reorderQuestions: FormQuestionOrder
  mergeSession: SessionMerge
  setAccountPassword: AdminPasswordReset
  setAccountRoles: AccountRolesUpdate
  setLeadRoleLead: LeadRoleLead
  setMealIdea: MealIdeaUpdate
  setMealLead: MealLead
  setPayment: PaymentUpdate
  submitApplication: ApplicationCreate
  signUp: SignUpRequest
  sendApplicationMessage: ApplicationMessageInput
  sendMyApplicationMessage: ApplicationMessageInput
  subscribeToPush: PushSubscriptionCreate
  transferMyPlace: PlaceTransfer
  unsubscribeFromPush: Pick<PushSubscriptionCreate, 'endpoint'>
  updateBringItem: BringUpdate
  updateMeeting: MeetingUpdateInput
  updateMeetingPoint: MeetingPointUpdate
  decidePoint: DecisionInput
  updateComment: CommentInput
  updateEvent: EventUpdate
  updateEventOption: EventOptionUpdate
  updateInstallation: InstallationUpdate
  setMapLink: MapLinkUpdate
  setThreadFollow: FollowInput
  updateMailSettings: MailSettingsUpdate
  updateFaqEntry: FaqUpdate
  updateLeadRole: LeadRoleUpdate
  updateMeal: MealUpdate
  updateMealIntro: MealIntroUpdate
  updateMealSlot: MealSlotUpdate
  markTargetShown: TargetShownInput
  sendDigestPreview: DigestPreviewInput
  updateMyNotificationSettings: NotificationSettings
  updateMyProfile: ProfileUpdate
  updateMyStay: AttendanceUpdate
  updateAdminAccount: AdminAccountUpdate
  updateAllergyItem: AllergyItemUpdate
  updatePlace: PlaceUpdate
  updatePost: PostUpdate
  updateRide: RideUpdate
  updateQuestion: FormQuestionUpdate
  updateSession: SessionUpdate
  updateWelcome: EventWelcomeUpdate
  addSong: SongCreateInput
  updateSong: SongUpdate
  addSongCategory: SongCategoryCreateInput
  updateSongCategory: SongCategoryUpdate
  reorderSongCategories: SongCategoryOrder
}

export type BodyOf<K extends keyof RouteBodies> = RouteBodies[K]
