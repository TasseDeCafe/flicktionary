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

// One column per useful datum so Anki users can map fields individually
// instead of parsing a packed digest. front/back stay first as the
// ready-made defaults; the basic columns follow for custom note types;
// then the grammar bag and the exploration extras. Sparse cells are empty.
const CSV_COLUMNS = [
  'front',
  'back',
  'context',
  'tags',
  'headword',
  'sense',
  'surface_form',
  'translation',
  'definition',
  'target_example',
  'native_example',
  'pos',
  'display_form',
  'gender',
  'aspect',
  'aspect_pair_headword',
  'government',
  'morphology',
  'ipa',
  'notable_forms',
  'grammar_notes',
  'frequency',
  'register',
  'register_alternatives',
  'more_frequent_synonym',
  'regionalism',
  'collocations',
  'etymology',
  'l1_notes',
  'extra_notes',
] as const

const TAGS_COLUMN_INDEX = CSV_COLUMNS.indexOf('tags') + 1 // 1-based for the Anki directive

// Anki's CSV importer only understands #-prefixed directive lines; a bare
// header row would be imported as a junk note. The directives make import
// zero-config: separator, HTML mode (front/back use <br><br> joins), the
// tags column, and the field names for the mapping dialog.
const ankiDirectives = (): string[] => [
  '#separator:Comma',
  '#html:true',
  `#tags column:${TAGS_COLUMN_INDEX}`,
  `#columns:${CSV_COLUMNS.join(',')}`,
]

const escapeCell = (value: string): string => {
  if (value === '') return ''
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const renderRow = (cells: readonly string[]): string => cells.map(escapeCell).join(',')

// LLM-written JSONB bags occasionally carry explicit nulls or odd shapes;
// treat anything that isn't a non-empty string as absent.
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => str(v)).filter((s) => s.length > 0) : []

// Same default-computation rules the focus view documents (SPEC "Default card
// front/back at export time"), joined with <br><br> because the import runs
// with #html:true — literal newlines would collapse on the rendered card.
const computeDefaults = (chunk: ExportChunkRow): { front: string; back: string } => {
  const headword = chunk.headword || chunk.surfaceForm
  const targetExample = chunk.targetExample ?? ''
  const backFirstLine = chunk.translation || chunk.definition || ''
  const nativeExample = chunk.nativeExample ?? ''
  const front = [headword, targetExample].filter((s) => s.trim().length > 0).join('<br><br>')
  const back = [backFirstLine, nativeExample].filter((s) => s.trim().length > 0).join('<br><br>')
  return { front, back }
}

const extractContext = (chunk: ExportChunkRow): string => {
  const ctx = chunk.explorationExtras['context_segment']
  if (typeof ctx === 'string' && ctx.trim().length > 0) return ctx
  return chunk.segmentText
}

const buildTags = (chunk: ExportChunkRow, targetLanguage: string): string => {
  const tags = ['flicktionary', targetLanguage]
  if (chunk.isProductionEnabled) tags.push('active')
  // Anki natively treats a "leech" tag specially (suspend/flag filters).
  if (chunk.isLeechParked) tags.push('leech')
  return tags.join(' ')
}

// Compact morphology flags that don't warrant a column each.
const renderMorphology = (grammar: Record<string, unknown>): string => {
  const flags: string[] = []
  const numberOnly = str(grammar['number_only'])
  if (numberOnly === 'plurale_tantum') flags.push('plurale tantum')
  if (numberOnly === 'singulare_tantum') flags.push('singulare tantum')
  if (grammar['is_indeclinable'] === true) flags.push('indeclinable')
  const animacy = str(grammar['animacy'])
  if (animacy) flags.push(animacy)
  if (grammar['is_reflexive'] === true) flags.push('reflexive')
  return flags.join('; ')
}

// Exploration-extras IPA (plain string) wins; otherwise the grammar bag's
// dialect-tagged object ({ ga, rp, untagged }).
const renderIpa = (chunk: ExportChunkRow): string => {
  const extrasIpa = str(chunk.explorationExtras['ipa'])
  if (extrasIpa) return extrasIpa
  const grammarIpa = chunk.grammar['ipa']
  if (typeof grammarIpa !== 'object' || grammarIpa === null) return str(grammarIpa)
  const bag = grammarIpa as Record<string, unknown>
  const untagged = str(bag['untagged'])
  if (untagged) return untagged
  const parts: string[] = []
  const ga = str(bag['ga'])
  const rp = str(bag['rp'])
  if (ga) parts.push(`GA ${ga}`)
  if (rp) parts.push(`RP ${rp}`)
  return parts.join('; ')
}

const renderNotableForms = (grammar: Record<string, unknown>): string => {
  const forms = grammar['notable_forms']
  if (!Array.isArray(forms)) return ''
  return forms
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return ''
      const label = str((entry as Record<string, unknown>)['label'])
      const form = str((entry as Record<string, unknown>)['form'])
      if (!form) return ''
      return label ? `${label}: ${form}` : form
    })
    .filter((s) => s.length > 0)
    .join('; ')
}

const renderRegisterAlternatives = (extras: Record<string, unknown>): string => {
  const alternatives = extras['register_alternatives']
  if (typeof alternatives !== 'object' || alternatives === null) return ''
  const bag = alternatives as Record<string, unknown>
  const parts: string[] = []
  const moreFormal = str(bag['more_formal'])
  const lessFormal = str(bag['less_formal'])
  if (moreFormal) parts.push(`more formal: ${moreFormal}`)
  if (lessFormal) parts.push(`less formal: ${lessFormal}`)
  return parts.join('; ')
}

const buildRow = (chunk: ExportChunkRow, targetLanguage: string): string => {
  const { front, back } = computeDefaults(chunk)
  const grammar = chunk.grammar
  const extras = chunk.explorationExtras
  return renderRow([
    front,
    back,
    extractContext(chunk),
    buildTags(chunk, targetLanguage),
    chunk.headword,
    chunk.sense,
    chunk.surfaceForm,
    chunk.translation ?? '',
    chunk.definition ?? '',
    chunk.targetExample ?? '',
    chunk.nativeExample ?? '',
    str(grammar['pos']),
    str(grammar['display_form']),
    str(grammar['gender']),
    str(grammar['aspect']),
    str(grammar['aspect_pair_headword']),
    str(grammar['government']),
    renderMorphology(grammar),
    renderIpa(chunk),
    renderNotableForms(grammar),
    str(grammar['notes']),
    str(extras['frequency']),
    str(extras['register']),
    renderRegisterAlternatives(extras),
    str(extras['more_frequent_synonym']),
    str(extras['regionalism']),
    strArray(extras['collocations']).join('; '),
    str(extras['etymology']),
    str(extras['l1_notes']),
    str(extras['notes']),
  ])
}

export const buildVocabularyCsv = async (
  userId: string,
  targetLanguage: string,
  deps: BuildVocabularyCsvDependencies
): Promise<BuildVocabularyCsvResult> => {
  const chunks = await deps.userLookupsRepository.listKeptChunksForExport({ userId, targetLanguage })

  const rows = chunks.map((chunk) => buildRow(chunk, targetLanguage))
  const csv = [...ankiDirectives(), ...rows].join('\n')
  return { csv, chunkCount: chunks.length }
}
