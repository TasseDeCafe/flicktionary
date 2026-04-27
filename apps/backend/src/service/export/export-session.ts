import { buildCsv, BuildCsvDependencies } from './build-csv'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type ExportSessionDependencies = BuildCsvDependencies & {
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

export type ExportSessionResult = {
  csv: string
  cardCount: number
}

export const exportSession = async (
  sessionId: string,
  userId: string,
  deps: ExportSessionDependencies
): Promise<ExportSessionResult> => {
  const session = await deps.studySessionsRepository.findByIdForUser(sessionId, userId)
  if (!session) throw new Error('Session not found')

  const { csv, cards } = await buildCsv(sessionId, deps)

  await Promise.all(
    cards.map((card) =>
      deps.userLookupsRepository.upsertOnExport({
        userId,
        targetLanguage: session.target_language,
        headword: card.headword,
        firstCardId: card.id,
      })
    )
  )

  await deps.studySessionsRepository.updateStatus(sessionId, userId, 'exported')

  return { csv, cardCount: cards.length }
}
