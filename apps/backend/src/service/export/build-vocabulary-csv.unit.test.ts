import { describe, expect, it, vi } from 'vitest'
import { buildVocabularyCsv } from './build-vocabulary-csv'
import type {
  ExportChunkRow,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'

const baseChunk = (overrides: Partial<ExportChunkRow> = {}): ExportChunkRow => ({
  headword: 'correr',
  sense: 'race',
  translation: 'to run',
  definition: 'moverse deprisa',
  targetExample: 'Corre todos los días.',
  nativeExample: 'He runs every day.',
  explorationExtras: {},
  grammar: {},
  surfaceForm: 'corre',
  segmentText: 'Mi hermano corre todos los días.',
  isProductionEnabled: false,
  isLeechParked: false,
  ...overrides,
})

const createDeps = (chunks: ExportChunkRow[]) => ({
  userLookupsRepository: {
    listKeptChunksForExport: vi.fn().mockResolvedValue(chunks),
  } as unknown as UserLookupsRepositoryInterface,
})

const parseLines = (csv: string) => csv.split('\n')

describe('buildVocabularyCsv', () => {
  it('emits Anki directives instead of a bare header row', async () => {
    const { csv, chunkCount } = await buildVocabularyCsv('u1', 'es', createDeps([baseChunk()]))
    const lines = parseLines(csv)
    expect(lines[0]).toBe('#separator:Comma')
    expect(lines[1]).toBe('#html:true')
    expect(lines[2]).toBe('#tags column:4')
    expect(lines[3]).toMatch(/^#columns:front,back,context,tags,headword,sense,surface_form,/)
    expect(lines).toHaveLength(4 + 1)
    expect(chunkCount).toBe(1)
  })

  it('joins front/back with <br><br> and prefers translation over definition on the back', async () => {
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([baseChunk()]))
    const row = parseLines(csv)[4]
    expect(row).toContain('correr<br><br>Corre todos los días.')
    expect(row).toContain('to run<br><br>He runs every day.')
  })

  it('exports sense and definition as their own columns', async () => {
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([baseChunk()]))
    const cells = parseLines(csv)[4].split(',')
    expect(cells[5]).toBe('race')
    expect(cells[8]).toBe('moverse deprisa')
  })

  it('tags production-pool and leech-parked terms', async () => {
    const { csv } = await buildVocabularyCsv(
      'u1',
      'es',
      createDeps([baseChunk({ isProductionEnabled: true, isLeechParked: true })])
    )
    const cells = parseLines(csv)[4].split(',')
    expect(cells[3]).toBe('flicktionary es production leech')
  })

  it('flattens grammar and exploration extras into individual columns', async () => {
    const chunk = baseChunk({
      grammar: {
        pos: 'verb',
        aspect: 'impf',
        aspect_pair_headword: 'побежать',
        government: '+ acc',
        is_reflexive: true,
        ipa: { ga: '/ˈrʌn/', rp: '/ˈrɐn/', untagged: null },
        notable_forms: [{ label: 'past', form: 'corrió' }],
        notes: 'stem-changing',
      },
      explorationExtras: {
        frequency: 'high',
        register: 'neutral',
        register_alternatives: { more_formal: 'desplazarse', less_formal: null },
        collocations: ['correr un riesgo', 'correr la voz'],
        etymology: 'from Latin currere',
        l1_notes: 'not "to course"',
        notes: 'extra usage note',
        context_segment: 'Mi hermano **corre** todos los días.',
      },
    })
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([chunk]))
    const row = parseLines(csv)[4]
    expect(row).toContain('Mi hermano **corre** todos los días.')
    expect(row).toContain('verb')
    expect(row).toContain('impf')
    expect(row).toContain('побежать')
    expect(row).toContain('+ acc')
    expect(row).toContain('reflexive')
    expect(row).toContain('GA /ˈrʌn/; RP /ˈrɐn/')
    expect(row).toContain('past: corrió')
    expect(row).toContain('stem-changing')
    expect(row).toContain('high')
    expect(row).toContain('more formal: desplazarse')
    expect(row).toContain('correr un riesgo; correr la voz')
    expect(row).toContain('from Latin currere')
    expect(row).toContain('extra usage note')
  })

  it('prefers extras ipa over the grammar ipa bag', async () => {
    const chunk = baseChunk({
      grammar: { ipa: { ga: '/x/', rp: null, untagged: null } },
      explorationExtras: { ipa: '/koˈrer/' },
    })
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([chunk]))
    const row = parseLines(csv)[4]
    expect(row).toContain('/koˈrer/')
    expect(row).not.toContain('GA /x/')
  })

  it('renders labeled dialect buckets for es/pt bags with no untagged value', async () => {
    const chunk = baseChunk({
      grammar: { ipa: { br: '/teˈzaw.ɾus/', eu: '/tɨˈzaw.ɾuʃ/' } },
      explorationExtras: {},
    })
    const { csv } = await buildVocabularyCsv('u1', 'pt', createDeps([chunk]))
    const row = parseLines(csv)[4]
    expect(row).toContain('BR /teˈzaw.ɾus/')
    expect(row).toContain('EU /tɨˈzaw.ɾuʃ/')
  })

  it('treats explicit nulls and odd shapes in the JSONB bags as absent', async () => {
    const chunk = baseChunk({
      grammar: { pos: null, notable_forms: 'oops', ipa: null },
      explorationExtras: { collocations: [null, '', 'real one'], register_alternatives: null },
    })
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([chunk]))
    const row = parseLines(csv)[4]
    expect(row).toContain('real one')
    expect(row).not.toContain('oops')
    expect(row).not.toContain('null')
  })

  it('escapes commas, quotes, and newlines in cells', async () => {
    const chunk = baseChunk({
      translation: 'to run, to race',
      definition: 'he said "go"',
      segmentText: 'line one\nline two',
      explorationExtras: {},
    })
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([chunk]))
    expect(csv).toContain('"to run, to race')
    expect(csv).toContain('"he said ""go"""')
    expect(csv).toContain('"line one\nline two"')
  })

  it('falls back to surface form for the front when headword is empty', async () => {
    const chunk = baseChunk({ headword: '', targetExample: null })
    const { csv } = await buildVocabularyCsv('u1', 'es', createDeps([chunk]))
    const cells = parseLines(csv)[4].split(',')
    expect(cells[0]).toBe('corre')
  })

  it('exports a German noun with the articled Anki front and the new grammar columns', async () => {
    const chunk = baseChunk({
      headword: 'Bestandteil',
      sense: 'component',
      translation: 'component',
      targetExample: 'Wasser ist ein Bestandteil.',
      nativeExample: 'Water is a component.',
      grammar: { pos: 'noun', gender: 'm', plural: 'Bestandteile', genitive: 'Bestandteils' },
    })
    const { csv } = await buildVocabularyCsv('u1', 'de', createDeps([chunk]))
    const lines = parseLines(csv)
    const columns = lines[3].replace('#columns:', '').split(',')
    const cells = lines[4].split(',')
    const cell = (name: string) => cells[columns.indexOf(name)]
    // Anki front matches the in-app card: article + headword.
    expect(cell('front')).toBe('der Bestandteil<br><br>Wasser ist ein Bestandteil.')
    expect(cell('gender')).toBe('m')
    expect(cell('plural')).toBe('Bestandteile')
    expect(cell('genitive')).toBe('Bestandteils')
  })

  it('exports German verb auxiliary and folds weak/separable into morphology', async () => {
    const chunk = baseChunk({
      headword: 'aufstehen',
      sense: 'get up',
      targetExample: null,
      grammar: { pos: 'verb', is_separable: true, auxiliary: 'sein' },
    })
    const { csv } = await buildVocabularyCsv('u1', 'de', createDeps([chunk]))
    const lines = parseLines(csv)
    const columns = lines[3].replace('#columns:', '').split(',')
    const cells = lines[4].split(',')
    const cell = (name: string) => cells[columns.indexOf(name)]
    expect(cell('auxiliary')).toBe('sein')
    expect(cell('morphology')).toContain('separable')
    // A verb is not a noun, so it keeps its bare headword on the front.
    expect(cell('front')).toBe('aufstehen')
  })
})
