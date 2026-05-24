import { ContentSourcesRepository } from '../../transport/database/content-sources/content-sources-repository'
import { TextTracksRepository } from '../../transport/database/text-tracks/text-tracks-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { StudySessionsRepository } from '../../transport/database/study-sessions/study-sessions-repository'
import { HighlightsRepository } from '../../transport/database/highlights/highlights-repository'
import { CardsRepository } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepository } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { ProcessingTelemetryRepository } from '../../transport/database/processing-telemetry/processing-telemetry-repository'
import { WiktionaryEntriesRepository } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { ProcessingDependencies } from './discover-session'

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
  userLookupsRepository: UserLookupsRepository(),
  usersRepository: UsersRepository(),
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepository(),
  processingTelemetryRepository: ProcessingTelemetryRepository(),
  wiktionaryEntriesRepository: WiktionaryEntriesRepository(),
})
