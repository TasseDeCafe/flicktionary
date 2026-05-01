import { CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import {
  TextSegmentsRepositoryInterface,
  DbTextSegment,
} from '../../transport/database/text-segments/text-segments-repository'

export type BuildCsvDependencies = {
  cardsRepository: CardsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
}

export type BuildCsvResult = {
  csv: string
  cards: DbCard[]
}

const CSV_COLUMNS = ['front', 'back', 'context', 'tags', 'headword', 'surface_form', 'note'] as const

const escapeCell = (value: string): string => {
  if (value === '') return ''
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const renderRow = (cells: readonly string[]): string => cells.map(escapeCell).join(',')

const computeDefaults = (card: DbCard): { front: string; back: string } => {
  const headword = card.headword || card.surface_form
  const targetExample = card.target_example ?? ''
  const backFirstLine = card.translation || card.definition || ''
  const nativeExample = card.native_example ?? ''

  const front = [headword, targetExample].filter((s) => s.trim().length > 0).join('\n\n')
  const back = [backFirstLine, nativeExample].filter((s) => s.trim().length > 0).join('\n\n')
  return { front, back }
}

const extractContext = (card: DbCard, segmentText: string): string => {
  const extras = (card.exploration_extras ?? {}) as Record<string, unknown>
  if (typeof extras.context_segment === 'string' && extras.context_segment.trim().length > 0) {
    return extras.context_segment
  }
  return segmentText
}

export const buildCsv = async (sessionId: string, deps: BuildCsvDependencies): Promise<BuildCsvResult> => {
  const cards = await deps.cardsRepository.listKeptForSession(sessionId)

  const segmentMap = new Map<string, DbTextSegment>()
  await Promise.all(
    cards.map(async (card) => {
      if (segmentMap.has(card.segment_id)) return
      const segment = await deps.textSegmentsRepository.findById(card.segment_id)
      if (segment) segmentMap.set(card.segment_id, segment)
    })
  )

  const header = renderRow(CSV_COLUMNS)
  const rows = cards.map((card) => {
    const { front, back } = computeDefaults(card)
    const segmentText = segmentMap.get(card.segment_id)?.text ?? ''
    const context = extractContext(card, segmentText)
    const tags = 'flicktionary'
    const note = ''
    return renderRow([front, back, context, tags, card.headword, card.surface_form, note])
  })

  const csv = [header, ...rows].join('\n')
  return { csv, cards }
}
