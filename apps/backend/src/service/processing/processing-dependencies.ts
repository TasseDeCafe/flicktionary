import { ContentSourcesRepository } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepository } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepository } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepository } from '../../transport/database/highlights/highlights-repository'
import { CardsRepository } from '../../transport/database/cards/cards-repository'
import { CardChatMessagesRepository } from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { UserLookupsRepository } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { ProcessingTelemetryRepository } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { WiktionaryEntriesRepository } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { GhostCandidatesRepository } from '../../transport/database/ghost-candidates/ghost-candidates-repository'
import { NominatedWindowsRepository } from '../../transport/database/nominated-windows/nominated-windows-repository'
import { StudyFacetsRepository } from '../../transport/database/study-facets/study-facets-repository'
import { ImportBatchesRepository } from '../../transport/database/import-batches/import-batches-repository'
import { TeacherProfilesRepository } from '../../transport/database/teacher-profiles/teacher-profiles-repository'
import { ProcessingJobsRepository } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { PracticeRatingEventsRepository } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { TelegramPendingImportsRepository } from '../../transport/database/telegram-pending-imports/telegram-pending-imports-repository'
import { TelegramAuthNoncesRepository } from '../../transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'
import type { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import type { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import type { CardChatMessagesRepositoryInterface } from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { GhostCandidatesRepositoryInterface } from '../../transport/database/ghost-candidates/ghost-candidates-repository'
import type { NominatedWindowsRepositoryInterface } from '../../transport/database/nominated-windows/nominated-windows-repository'
import type { StudyFacetsRepositoryInterface } from '../../transport/database/study-facets/study-facets-repository'
import type { ImportBatchesRepositoryInterface } from '../../transport/database/import-batches/import-batches-repository'
import type { TeacherProfilesRepositoryInterface } from '../../transport/database/teacher-profiles/teacher-profiles-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { TelegramPendingImportsRepositoryInterface } from '../../transport/database/telegram-pending-imports/telegram-pending-imports-repository'
import type { TelegramAuthNoncesRepositoryInterface } from '../../transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'

export type ProcessingDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  cardChatMessagesRepository: CardChatMessagesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  processingTelemetryRepository: ProcessingTelemetryRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
  ghostCandidatesRepository: GhostCandidatesRepositoryInterface
  nominatedWindowsRepository: NominatedWindowsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  importBatchesRepository: ImportBatchesRepositoryInterface
  teacherProfilesRepository: TeacherProfilesRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  telegramPendingImportsRepository: TelegramPendingImportsRepositoryInterface
  telegramAuthNoncesRepository: TelegramAuthNoncesRepositoryInterface
}

// Repos are stateless factories over the shared postgres client, so the worker
// (built in server.ts) holding its own bundle is equivalent to app.ts's. Used by
// the enrichment worker, which lives outside the request-scoped router wiring.
export const buildProcessingDependencies = (): ProcessingDependencies => ({
  contentSourcesRepository: ContentSourcesRepository(),
  textTracksRepository: TextTracksRepository(),
  textSegmentsRepository: TextSegmentsRepository(),
  studySessionsRepository: StudySessionsRepository(),
  highlightsRepository: HighlightsRepository(),
  cardsRepository: CardsRepository(),
  cardChatMessagesRepository: CardChatMessagesRepository(),
  userLookupsRepository: UserLookupsRepository(),
  usersRepository: UsersRepository(),
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepository(),
  processingTelemetryRepository: ProcessingTelemetryRepository(),
  wiktionaryEntriesRepository: WiktionaryEntriesRepository(),
  ghostCandidatesRepository: GhostCandidatesRepository(),
  nominatedWindowsRepository: NominatedWindowsRepository(),
  studyFacetsRepository: StudyFacetsRepository(),
  importBatchesRepository: ImportBatchesRepository(),
  teacherProfilesRepository: TeacherProfilesRepository(),
  processingJobsRepository: ProcessingJobsRepository(),
  practiceRatingEventsRepository: PracticeRatingEventsRepository(),
  telegramPendingImportsRepository: TelegramPendingImportsRepository(),
  telegramAuthNoncesRepository: TelegramAuthNoncesRepository(),
})
