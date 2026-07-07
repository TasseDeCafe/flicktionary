import { describe, expect, it } from 'vitest'
import { splitLessonSections } from './split-lesson-sections'
import { planActionForRow } from './extract-lesson-job'
import { parseExtractedRows } from '../../transport/third-party/anthropic/passes/extract-lesson-pass'
import type { ExtractedLessonRow } from '../../transport/third-party/anthropic/passes/extract-lesson-pass'
import type { HeadwordMatch } from '../../transport/database/user-lookups/user-lookups-repository'

const row = (overrides: Partial<ExtractedLessonRow> = {}): ExtractedLessonRow => ({
  sourceText: 'я болел три дня (не- заболел)',
  type: 'grammar',
  headword: 'болеть',
  targetForm: 'болел',
  context: 'я болел три дня',
  wrongForm: 'заболел',
  stressMark: null,
  proposedFacets: ['production'],
  confidence: 0.9,
  ...overrides,
})

const match = (overrides: Partial<HeadwordMatch> = {}): HeadwordMatch => ({
  id: '00000000-0000-0000-0000-000000000001',
  headword: 'болеть',
  sense: '',
  count: 1,
  productionSrsState: null,
  productionEnabled: false,
  productionParked: false,
  enabledSkills: ['meaning_recognition'],
  ...overrides,
})

describe('splitLessonSections', () => {
  it('splits on Google-Docs date headings, keeping each heading with its section', () => {
    const text = `### **12/06/2026**

| грамматика | лексика |
| a | b |

### **19/06/2026**

| c | d |`
    const sections = splitLessonSections(text)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain('12/06/2026')
    expect(sections[0]).toContain('| a | b |')
    expect(sections[1]).toContain('19/06/2026')
    expect(sections[1]).toContain('| c | d |')
  })

  it('returns the whole input as one section when no date heading exists', () => {
    const sections = splitLessonSections('| attempt | correction |\n| a | b |')
    expect(sections).toHaveLength(1)
  })

  it('tolerates heading level, missing bold, and dot separators', () => {
    const sections = splitLessonSections('## 1.2.2026\nfoo\n#### **03/04/2026**\nbar')
    expect(sections).toHaveLength(2)
  })
})

describe('planActionForRow', () => {
  it('skips win and noise rows, and rows without a headword', () => {
    expect(planActionForRow(row({ type: 'win' }), null)).toBe('skip')
    expect(planActionForRow(row({ type: 'noise' }), null)).toBe('skip')
    expect(planActionForRow(row({ headword: '  ' }), null)).toBe('skip')
  })

  it('creates when the term is not in the vocabulary', () => {
    expect(planActionForRow(row(), null)).toBe('create')
  })

  it('lapses only a review-state, enabled, non-parked production facet', () => {
    expect(planActionForRow(row(), match({ productionEnabled: true, productionSrsState: 'review' }))).toBe(
      'lapse_and_add_facet'
    )
    // No production facet -> just add it.
    expect(planActionForRow(row(), match())).toBe('add_facet')
    // Learning-state (already being drilled) -> no lapse.
    expect(planActionForRow(row(), match({ productionEnabled: true, productionSrsState: 'learning' }))).toBe(
      'add_facet'
    )
    // Parked leech -> rating would be a no-op; keep it a facet add.
    expect(
      planActionForRow(row(), match({ productionEnabled: true, productionSrsState: 'review', productionParked: true }))
    ).toBe('add_facet')
  })
})

describe('parseExtractedRows', () => {
  it('drops rows with no traceable source text and defends field types', () => {
    const parsed = parseExtractedRows([
      { source_text: '', type: 'vocab', headword: 'x' },
      {
        source_text: 'перекупщик',
        type: 'vocab',
        headword: ' перекупщик ',
        target_form: '',
        context: 'перекупщики скупают билеты',
        wrong_form: null,
        stress_mark: 'переку́пщик',
        proposed_facets: ['production', 'recognition', 'bogus'],
        confidence: 1.7,
      },
      { source_text: 'junk row', type: 'mystery', headword: '', proposed_facets: 'nope', confidence: 'high' },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      headword: 'перекупщик',
      targetForm: null,
      stressMark: 'переку́пщик',
      proposedFacets: ['production', 'recognition'],
      confidence: 1,
    })
    // Unknown type coerces to noise (never imported), junk facets/confidence zeroed.
    expect(parsed[1]).toMatchObject({ type: 'noise', proposedFacets: [], confidence: 0 })
  })
})
