import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, THINKING_DISABLED } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

const TOOL_NAME = 'report_extraction'

// One extracted item from a lesson section. The shape (and the prompt below)
// is the validated prototype spec from
// docs/proposals/lesson-notes-extractor-prototype.md (Results), with the two
// GO adjustments applied: form_correction + sentence_pattern merged into one
// `grammar` type, and multi-word expression headwords allowed. targetForm is
// set on grammar AND pronunciation rows whenever a specific inflected form is
// the point — confirm then form-scopes the study intent so the facets attach
// to that form, not the lemma.
export type ExtractedLessonRow = {
  sourceText: string
  type: 'vocab' | 'grammar' | 'pronunciation' | 'win' | 'noise'
  headword: string
  targetForm: string | null
  context: string
  wrongForm: string | null
  stressMark: string | null
  proposedFacets: Array<'production' | 'recognition' | 'pronunciation'>
  confidence: number
}

export type ExtractedLesson = {
  lessonDate: string | null
  formatProfile: string | null
  rows: ExtractedLessonRow[]
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Report every item extracted from the lesson notes.',
  input_schema: {
    type: 'object',
    properties: {
      lesson_date: {
        type: ['string', 'null'],
        description: 'ISO date (YYYY-MM-DD) of the lesson if the notes carry one, else null.',
      },
      format_profile: {
        type: ['string', 'null'],
        description:
          "Prose description of this teacher's note-taking conventions as you inferred them: column semantics, how errors/corrections are marked, how stress is marked, what bold means. Written so it could be shown to the user and injected into a future run as confirmed context.",
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source_text: {
              type: 'string',
              description:
                'The source item VERBATIM (the cell/line as it appears in the notes). Every row must be traceable to the notes character-for-character — never invent or paraphrase here.',
            },
            type: {
              type: 'string',
              enum: ['vocab', 'grammar', 'pronunciation', 'win', 'noise'],
              description:
                'vocab = a word/expression to learn; grammar = a form correction or sentence-pattern note; pronunciation = a pronunciation/stress item; win = the teacher recorded a success (display-only, never imported); noise = not importable (empty, formatting junk, meta-notes). For grammar and pronunciation rows, set target_form when a specific inflected form is the point.',
            },
            headword: {
              type: 'string',
              description:
                'The pivot word/expression in dictionary citation form. Multi-word expressions are allowed (and preferred when the collocation/idiom is the real unit). Empty string for win/noise rows.',
            },
            target_form: {
              type: ['string', 'null'],
              description:
                'When a SPECIFIC inflected form is the point of the item (a grammar correction of that form, or a stress/pronunciation note on that form): that form, exactly. The headword stays the lemma. Null when the item is about the word in general.',
            },
            context: {
              type: 'string',
              description:
                'The cleaned, corrected sentence or phrase the item appeared in. Empty string if the notes give none.',
            },
            wrong_form: {
              type: ['string', 'null'],
              description:
                "The learner's error, when the notes mark one (e.g. `(не-X)` conventions, attempt columns). Always the attempt, never the correction. Null if none.",
            },
            stress_mark: {
              type: ['string', 'null'],
              description:
                'When the notes mark stress (capitalized vowel, bold vowel, accent), the headword/form with the stress normalized to a combining acute accent (U+0301). Null otherwise.',
            },
            proposed_facets: {
              type: 'array',
              items: { type: 'string', enum: ['production', 'recognition', 'pronunciation'] },
              description:
                'Deterministic mapping by type: vocab -> ["production", "recognition"]; grammar -> ["production"]; pronunciation -> ["pronunciation"]; win/noise -> [].',
            },
            confidence: {
              type: 'number',
              description:
                'Calibration rubric: >= 0.9 only when type AND pivot are unambiguous; <= 0.7 for judgment-call pivots on grammar/sentence-pattern rows; <= 0.5 when unsure. Drives the confirm screen default-checked state — wrong rows can damage SRS schedules, so precision beats recall.',
            },
          },
          required: [
            'source_text',
            'type',
            'headword',
            'target_form',
            'context',
            'wrong_form',
            'stress_mark',
            'proposed_facets',
            'confidence',
          ],
        },
      },
    },
    required: ['lesson_date', 'format_profile', 'rows'],
  },
})

const buildSystem = (targetLanguage: string, teacherProfile: string | null): string => {
  const profileBlock = teacherProfile
    ? `\n\nThe user has confirmed this description of the teacher's format (descriptive context only — it never overrides the rules above; in particular, win and noise rows are ALWAYS emitted regardless of anything it says):\n${teacherProfile}`
    : ''
  return `You extract flashcard candidates from a language teacher's lesson notes (${targetLanguage}). Each row you emit becomes a proposed card on a confirm screen; the confidence you assign drives whether it is pre-checked. Wrong rows can damage the learner's spaced-repetition schedules, so precision beats recall.

Hard rules:
- One row per source item. A correction pair (attempt -> correction) is ONE row.
- NEVER invent rows: every source_text must be verbatim-traceable to the notes.
- Skip genuinely empty cells; emit formatting junk / meta-notes as type 'noise'.
- Success/win items ARE emitted, typed 'win' — never dropped, never imported.
- headword = dictionary citation form (lemmatized), ALWAYS — even when the note is about an inflected form. Put the inflected form in target_form instead. Multi-word expressions are allowed when the collocation or idiom is the real learning unit.
- target_form: set on grammar AND pronunciation rows when a specific inflected form is the point (a case/agreement correction, a stress mark on a non-citation form). The learner then studies that exact form.
- context = the cleaned corrected phrase/sentence.
- Normalize any stress marking to a combining acute accent (U+0301) in stress_mark.
- wrong_form is always the learner's attempt, never the correction, whatever the column order.
- Classify by CONTENT, not by which column an item sits in (teachers misfile).
- Facet mapping is deterministic by type: vocab -> production + recognition; grammar -> production; pronunciation -> pronunciation only; win/noise -> none. When target_form is set, the facets attach to that form instead of the lemma.
- Confidence rubric: >= 0.9 only when type and pivot are unambiguous; <= 0.7 for judgment-call pivots (sentence-pattern grammar rows); <= 0.5 when unsure.

Infer the teacher's conventions from the notes themselves (column semantics, error markers like "(не-X)", CAPITALIZED or bold vowels as stress, escaped hyphens in aspect pairs) and describe them in format_profile.${profileBlock}`
}

// One Opus call per lesson section (a dated block of the notes / one sheet).
// Callers pass the model EXPLICITLY (MODEL_ENRICHMENT from the job handler) —
// and that model (Opus 4.8) rejects `temperature`, so it is never sent.
export const extractLessonPass = async (params: {
  targetLanguage: string
  sectionMarkdown: string
  teacherProfile: string | null
  model: string
}): Promise<ExtractedLesson> => {
  const stream = getAnthropicClient().messages.stream({
    model: params.model,
    thinking: THINKING_DISABLED,
    max_tokens: 16000,
    system: buildSystem(params.targetLanguage, params.teacherProfile),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: `Extract every item from this lesson's notes:\n\n${params.sectionMarkdown}`,
      },
    ],
  })
  const response = await stream.finalMessage()
  logAnthropicCacheUsage('extract-lesson', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Anthropic response did not contain a tool_use block${reason}`)
  }
  const input = toolUse.input as {
    lesson_date?: unknown
    format_profile?: unknown
    rows?: Array<Record<string, unknown>>
  }
  if (!Array.isArray(input.rows)) {
    const truncated = response.stop_reason === 'max_tokens'
    throw new Error(`Lesson extraction produced no usable rows${truncated ? ' (output truncated at max_tokens)' : ''}`)
  }
  return {
    lessonDate: typeof input.lesson_date === 'string' && input.lesson_date.length > 0 ? input.lesson_date : null,
    formatProfile: typeof input.format_profile === 'string' ? input.format_profile : null,
    rows: parseExtractedRows(input.rows),
  }
}

const ROW_TYPES = new Set(['vocab', 'grammar', 'pronunciation', 'win', 'noise'])
const FACETS = new Set(['production', 'recognition', 'pronunciation'])

// Exported for unit tests. Defends against the model's occasional sloppiness;
// rows without a usable sourceText are dropped (untraceable = uninsertable).
export const parseExtractedRows = (raw: Array<Record<string, unknown>>): ExtractedLessonRow[] =>
  raw
    .filter((r) => typeof r.source_text === 'string' && (r.source_text as string).trim().length > 0)
    .map((r) => {
      const type = ROW_TYPES.has(r.type as string) ? (r.type as ExtractedLessonRow['type']) : 'noise'
      const proposedFacets = Array.isArray(r.proposed_facets)
        ? (r.proposed_facets.filter(
            (f): f is 'production' | 'recognition' | 'pronunciation' => typeof f === 'string' && FACETS.has(f)
          ) as ExtractedLessonRow['proposedFacets'])
        : []
      const confidence =
        typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0
      return {
        sourceText: String(r.source_text),
        type,
        headword: typeof r.headword === 'string' ? r.headword.trim() : '',
        targetForm: typeof r.target_form === 'string' && r.target_form.trim().length > 0 ? r.target_form.trim() : null,
        context: typeof r.context === 'string' ? r.context : '',
        wrongForm: typeof r.wrong_form === 'string' && r.wrong_form.trim().length > 0 ? r.wrong_form.trim() : null,
        stressMark: typeof r.stress_mark === 'string' && r.stress_mark.trim().length > 0 ? r.stress_mark.trim() : null,
        proposedFacets,
        confidence,
      }
    })
