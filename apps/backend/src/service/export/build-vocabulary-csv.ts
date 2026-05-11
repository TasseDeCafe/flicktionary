import type {
  ExportChunkRow,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'

export type BuildVocabularyCsvDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
}

export type BuildVocabularyCsvResult = {
  csv: string
  chunkCount: number
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

// Same default-computation rules the per-session export uses, but driven by
// chunk fields instead of card fields. Keep the column shape identical so a
// vocab-wide CSV imports into Anki the same way a per-session CSV does.
const computeDefaults = (chunk: ExportChunkRow): { front: string; back: string } => {
  const headword = chunk.headword || chunk.surfaceForm
  const targetExample = chunk.targetExample ?? ''
  const backFirstLine = chunk.translation || chunk.definition || ''
  const nativeExample = chunk.nativeExample ?? ''
  const front = [headword, targetExample].filter((s) => s.trim().length > 0).join('\n\n')
  const back = [backFirstLine, nativeExample].filter((s) => s.trim().length > 0).join('\n\n')
  return { front, back }
}

const extractContext = (chunk: ExportChunkRow): string => {
  const ctx = chunk.explorationExtras['context_segment']
  if (typeof ctx === 'string' && ctx.trim().length > 0) return ctx
  return chunk.segmentText
}

export const buildVocabularyCsv = async (
  userId: string,
  targetLanguage: string,
  deps: BuildVocabularyCsvDependencies
): Promise<BuildVocabularyCsvResult> => {
  const chunks = await deps.userLookupsRepository.listKeptChunksForExport({ userId, targetLanguage })

  const header = renderRow(CSV_COLUMNS)
  const rows = chunks.map((chunk) => {
    const { front, back } = computeDefaults(chunk)
    const context = extractContext(chunk)
    const tags = `flicktionary ${targetLanguage}`
    const note = ''
    return renderRow([front, back, context, tags, chunk.headword, chunk.surfaceForm, note])
  })

  const csv = [header, ...rows].join('\n')
  return { csv, chunkCount: chunks.length }
}
