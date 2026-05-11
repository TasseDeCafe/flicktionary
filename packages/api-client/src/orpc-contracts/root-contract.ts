import { authenticationContract } from './authentication-contract'
import { billingContract } from './billing-contract'
import { userContract } from './user-contract'
import { contactEmailContract } from './contact-email-contract'
import { checkoutContract } from './checkout-contract'
import { portalSessionContract } from './portal-session-contract'
import { removalsContract } from './removals-contract'
import { healthCheckContract } from './health-check-contract'
import { sentryDebugContract } from './sentry-debug-contract'
import { configContract } from './config-contract'
import { contentSourcesContract } from './content-sources-contract'
import { textTracksContract } from './text-tracks-contract'
import { textSegmentsContract } from './text-segments-contract'
import { studySessionsContract } from './study-sessions-contract'
import { highlightsContract } from './highlights-contract'
import { cardsContract } from './cards-contract'
import { cardChatContract } from './card-chat-contract'
import { chunksContract } from './chunks-contract'
import { userPrefsContract } from './user-prefs-contract'
import { practiceContract } from './practice-contract'
import { languagesContract } from './languages-contract'

export const rootOrpcContract = {
  authentication: authenticationContract,
  billing: billingContract,
  user: userContract,
  contactEmail: contactEmailContract,
  checkout: checkoutContract,
  portalSession: portalSessionContract,
  removals: removalsContract,
  healthCheck: healthCheckContract,
  sentryDebug: sentryDebugContract,
  config: configContract,
  contentSources: contentSourcesContract,
  textTracks: textTracksContract,
  textSegments: textSegmentsContract,
  studySessions: studySessionsContract,
  highlights: highlightsContract,
  cards: cardsContract,
  cardChat: cardChatContract,
  chunks: chunksContract,
  userPrefs: userPrefsContract,
  practice: practiceContract,
  languages: languagesContract,
} as const
