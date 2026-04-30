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
  const exploration = (card.full_exploration ?? {}) as Record<string, unknown>
  const translation = typeof exploration.translation === 'string' ? exploration.translation : ''

  const contextExample = exploration.context_example as { target?: unknown; native?: unknown } | undefined
  const targetExample = typeof contextExample?.target === 'string' ? contextExample.target : ''
  const nativeExample = typeof contextExample?.native === 'string' ? contextExample.native : ''

  // Backward-compat: cards processed before context_example existed only carry
  // examples[]. Fall back to examples[0] for the target example so old exports
  // keep working until those sessions are reprocessed.
  const examples = exploration.examples
  const fallbackTarget =
    targetExample || (Array.isArray(examples) && typeof examples[0] === 'string' ? (examples[0] as string) : '')

  const front = card.headword || card.surface_form
  const back = [translation, fallbackTarget, nativeExample].filter((s) => s.trim().length > 0).join('\n\n')
  return { front, back }
}

const extractContext = (card: DbCard, segmentText: string): string => {
  const exploration = (card.full_exploration ?? {}) as Record<string, unknown>
  if (typeof exploration.context_segment === 'string' && exploration.context_segment.trim().length > 0) {
    return exploration.context_segment
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
    const defaults = computeDefaults(card)
    const front = card.front_override ?? defaults.front
    const back = card.back_override ?? defaults.back
    const segmentText = segmentMap.get(card.segment_id)?.text ?? ''
    const context = extractContext(card, segmentText)
    const tags = 'flicktionary'
    const note = ''
    return renderRow([front, back, context, tags, card.headword, card.surface_form, note])
  })

  const csv = [header, ...rows].join('\n')
  return { csv, cards }
}
