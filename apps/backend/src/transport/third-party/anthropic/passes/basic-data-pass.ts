import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS, THINKING_DISABLED } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { buildMethodologySystem } from '../methodology-prompt'
import { buildGrammarSchema } from '../grammar-tool-schema'
import type { EnglishIpaDialect } from '../language-instructions'

const TOOL_NAME = 'submit_basic_data'

const GRAMMAR_OBJECT_DESCRIPTION =
  'Optional sparse bag of typed morphology / grammar facts for this chunk. Fill a key only when it is useful for THIS chunk in THIS target language; omit the whole object when nothing applies — EXCEPT `ipa`, which you include for every chunk. The per-target-language instructions in the system prompt say WHEN to fill which keys.'

type SegmentInput = {
  id: string
  index: number
  text: string
}

export type HighlightInput = {
  highlightId: string
  segmentId: string
  selectionText: string
}

type BasicDataPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  segments: SegmentInput[]
  highlights: HighlightInput[]
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
  // English IPA dialect preference (GA vs RP) — steers which grammar.ipa
  // bucket the model fills for English targets. Undefined for other languages.
  englishIpaDialect?: EnglishIpaDialect
  // Which model runs the pass. The per-highlight enrichment path passes
  // MODEL_ENRICHMENT (Opus 4.8 by default).
  model?: string
}

export type BasicDataChunk = {
  source: 'llm' | 'highlight'
  highlightId?: string
  headword: string
  sense: string
  surfaceForm: string
  segmentId: string
  translation: string | null
  // Translation of the inflected surface form as it reads in the sentence
  // (e.g. 'voyons' for surface 'посмотрим' under headword 'посмотреть').
  // Null when the surface form is already the citation form.
  surfaceTranslation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  // Optional language-specific morphology / grammar facts. Sparse — keys
  // populated only when relevant to the chunk and target language. See
  // packages/api-client/.../flicktionary-schemas.ts (GrammarSchema) and the
  // language-instructions block for per-language guidance.
  grammar?: Record<string, unknown>
  belowCefr: boolean
  reasoning?: string
}

const buildTool = (hideTranslationFields: boolean, targetLanguage: string): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    'Submit basic card data for the user-provided highlights. You must produce exactly one row per highlight.',
  input_schema: {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['highlight'],
              description: "Always 'highlight'. Do not discover new chunks from the context segments.",
            },
            highlight_id: {
              type: 'string',
              description:
                "When source='highlight', the id of the originating highlight. Required for source='highlight'.",
            },
            headword: {
              type: 'string',
              description:
                "The user's selection in dictionary citation form. Always lemmatized — verbs as infinitives, nouns as singular, never inflected. Anchor the EXTENT to what the user selected (see surface_form): cover the same word(s), just normalized. Do NOT widen a fully-selected, independently-meaningful word into a surrounding collocation just because the larger phrase reads naturally — e.g. selection 'назначения' → headword 'назначение', NOT 'специальное назначение'; selection 'так' → 'так', NOT 'не просто так'. The global 'chunks over single words' methodology does NOT apply here: the user drew the boundary, respect it. Only extend beyond the selected words when the selection is an incomplete fragment of a single fixed lexical unit that has no standalone citation form — a phrasal-verb particle, a required clitic, or a governed preposition that is part of the lemma (e.g. 'run out of', 'estar a punto de', 'fundirse con'). When in doubt, keep the headword to the selected word(s).",
            },
            sense: {
              type: 'string',
              description:
                "Short sense tag (1-5 words). A disambiguator, NOT a definition — the definition belongs in `definition`, do not duplicate it here. Just enough to tell apart different meanings of the same headword. Polysemous example for 'correr': 'race', 'flow (liquid)', 'spread (news)'. Monosemous example for 'desfibrilador': 'medical device'. Idiom example for 'estar a punto de': 'about to'. Never a full sentence. Never longer than 5 words.",
            },
            surface_form: {
              type: 'string',
              description: 'How the chunk literally appears in the segment text.',
            },
            segment_id: {
              type: 'string',
              description: 'The id of the segment where this chunk appears (provided in the segment list).',
            },
            translation: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Set to null. Translation fields are disabled for this target language.'
                : "Short translation of the HEADWORD (citation form) into the learner's native language — NOT a translation of the inflected surface form or of the selection as it reads in the sentence. Mirror the headword's dictionary form: singular for a noun headword ('investment', not 'investments'), infinitive for a verb headword ('to pick at', not 'they pick at' or 'it made me sick'). Carry over no person, tense, number, or case from the example. Null when below_cefr is true (we will skip this chunk).",
            },
            surface_translation: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Set to null. Translation fields are disabled for this target language.'
                : "Counterpart to `translation` for the inflected form: translate surface_form exactly as it reads in the sentence, into the learner's native language (e.g. headword 'посмотреть' with surface_form 'посмотрим' → 'let's see'). Unlike `translation`, this one DOES carry the person, tense, number, and case of the surface form. Null when surface_form is already the citation form (identical to the headword). Null when below_cefr is true.",
            },
            definition: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Short contextual paraphrase in the target language. Used as the back of the card when translation fields are hidden. Null when below_cefr is true.'
                : 'Short contextual paraphrase in the target language (one short sentence). Optional but encouraged. Null when below_cefr is true.',
            },
            target_example: {
              type: ['string', 'null'],
              description:
                'A self-contained example sentence in the target language using the chunk in its natural setting. Inspired by but not equal to the source line. Null when below_cefr is true.',
            },
            native_example: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Set to null. Native example fields are disabled for this target language.'
                : 'A natural translation of target_example into the native language. Null when below_cefr is true.',
            },
            below_cefr: {
              type: 'boolean',
              description:
                "Always false for user highlights. The user explicitly selected this text, so enrich it even if it is below the learner's CEFR level.",
            },
            grammar: buildGrammarSchema(targetLanguage, GRAMMAR_OBJECT_DESCRIPTION),
            reasoning: {
              type: 'string',
              description: 'One-line note on why this chunk is worth studying. Optional.',
            },
          },
          required: [
            'source',
            'highlight_id',
            'headword',
            'sense',
            'surface_form',
            'segment_id',
            'translation',
            'surface_translation',
            'definition',
            'target_example',
            'native_example',
            'below_cefr',
          ],
        },
      },
    },
    required: ['chunks'],
  },
})

export const basicDataPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  segments,
  highlights,
  hideTranslationFields = false,
  allowL1Notes,
  englishIpaDialect,
  model = MODEL_OPUS,
}: BasicDataPassArgs): Promise<BasicDataChunk[]> => {
  const sameLanguage = nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const shouldHideTranslationFields = hideTranslationFields || sameLanguage
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')

  // The learner's note / preset tags are intentionally NOT injected here: they
  // are answered directly in the per-card chat (seed_card_chat) rather than
  // shaping the card's base fields.
  const highlightLines = highlights
    .map((h) => `- ${h.highlightId} :: segment_id=${h.segmentId} :: "${h.selectionText}"`)
    .join('\n')

  const highlightsBlock = highlights.length
    ? `\nUser highlights (you MUST emit exactly one row per highlight, with source='highlight' and the matching highlight_id; below_cefr=false; basic data fully populated even when the chunk is below ${cefrLevel}):
${highlightLines}\n`
    : ''

  const translationModeNote = shouldHideTranslationFields
    ? `\n- Translation fields are disabled for this target language. Set translation=null, surface_translation=null and native_example=null on every row. Keep definition and target_example in ${targetLanguage}.`
    : ''

  const userMessage = `Emit one row per user highlight only. DO NOT discover any new chunks
on your own — ghost nomination handles suggestions separately. Every row must
have source='highlight' and a matching highlight_id from the list below. Do not
emit any source='llm' rows.

For every emitted row, populate the basic data: headword, sense, surface_form,
segment_id, translation, surface_translation, definition, target_example,
native_example. Populate
the optional \`grammar\` object per chunk when relevant for the target
language (see the system prompt for per-language guidance).
The learner is at ${cefrLevel}, native language ${nativeLanguage}, target
${targetLanguage}. Headwords must be in dictionary citation form (lemmatized),
and translation must render that citation form (infinitive for verbs, singular
for nouns) — never the inflected selection as it appears in the segment. Each
headword must cover the SAME word(s) the user selected, only normalized — do NOT
absorb neighbouring words into a wider collocation (selection 'назначения' →
'назначение', never 'специальное назначение'). Widen past the selection only when
it is an incomplete fragment of a single fixed unit (a phrasal-verb particle, a
required preposition/clitic).${translationModeNote}${highlightsBlock}

Segments (id followed by text — only for context, do NOT mine them for new chunks):
${segmentLines}`

  // Keep streaming even for highlight-only enrichment so long responses do not hit
  // the SDK's non-streaming duration limit.
  const stream = getAnthropicClient().messages.stream({
    model,
    // Sonnet 5 runs adaptive thinking when the param is omitted; disable it
    // explicitly (also accepted on Opus 4.7/4.8) so the pass behaves the same
    // regardless of which model the env overrides pick.
    thinking: THINKING_DISABLED,
    max_tokens: 32000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      hideTranslationFields: shouldHideTranslationFields,
      allowL1Notes,
      englishIpaDialect,
    }),
    tools: [buildTool(shouldHideTranslationFields, targetLanguage)],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })
  const response = await stream.finalMessage()
  logAnthropicCacheUsage('basic-data', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Anthropic response did not contain a tool_use block${reason}`)
  }
  const input = toolUse.input as { chunks?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.chunks)) {
    const truncated = response.stop_reason === 'max_tokens'
    const detail = truncated
      ? 'output truncated at max_tokens — increase max_tokens or lower CEFR target count'
      : `unexpected tool_use input shape (stop_reason=${response.stop_reason ?? 'unknown'})`
    throw new Error(`Basic-data pass produced no usable chunks: ${detail}`)
  }
  return parseBasicDataChunks(input.chunks)
}

// Deterministic attribution for the single-highlight callers (per-highlight
// enrichment, adhoc add-a-word): exactly one highlight goes in and exactly one
// row is expected back, so there is nothing to "match" — bind that row to the
// known highlight instead of trusting the model to echo ids. Sonnet 5 omitted
// highlight_id often enough (~1/4 of calls, legal while the schema didn't
// require it) that the data landed on an orphan highlight-less card while the
// real highlight got a data-less stub. Forcing segmentId likewise keeps the
// card anchored to the highlight's own segment even when the model echoes a
// neighboring window segment. Extra rows beyond the first are dropped (the
// prompt demands exactly one; materializing spares would mint orphan cards).
export const bindChunksToSingleHighlight = (chunks: BasicDataChunk[], highlight: HighlightInput): BasicDataChunk[] => {
  const row = chunks.find((c) => c.source === 'highlight') ?? chunks[0]
  if (!row) return []
  return [{ ...row, source: 'highlight', highlightId: highlight.highlightId, segmentId: highlight.segmentId }]
}

// Defensive shape-check on the model's grammar.ipa: keep only recognized
// dialect buckets with non-empty string values, drop the key entirely when
// nothing survives (a malformed bag must never reach the JSONB merge — the
// renderer and the pronunciation readiness gate both index into it).
const IPA_BUCKETS = ['ga', 'rp', 'untagged'] as const
export const sanitizeGrammarIpa = (grammar: Record<string, unknown>): Record<string, unknown> => {
  if (!('ipa' in grammar)) return grammar
  const { ipa, ...rest } = grammar
  if (!ipa || typeof ipa !== 'object' || Array.isArray(ipa)) return rest
  const bag: Record<string, string> = {}
  for (const bucket of IPA_BUCKETS) {
    const value = (ipa as Record<string, unknown>)[bucket]
    if (typeof value === 'string' && value.trim().length > 0) bag[bucket] = value
  }
  return Object.keys(bag).length > 0 ? { ...rest, ipa: bag } : rest
}

// Exported for unit tests. Maps the raw tool_use chunk objects to typed
// BasicDataChunk values, defending against the model's occasional sloppiness.
export const parseBasicDataChunks = (raw: Array<Record<string, unknown>>): BasicDataChunk[] =>
  raw.map((c) => ({
    source: c.source === 'highlight' ? 'highlight' : 'llm',
    highlightId: typeof c.highlight_id === 'string' ? c.highlight_id : undefined,
    headword: String(c.headword ?? ''),
    sense: typeof c.sense === 'string' ? c.sense : '',
    surfaceForm: String(c.surface_form ?? ''),
    segmentId: String(c.segment_id ?? ''),
    translation: typeof c.translation === 'string' ? c.translation : null,
    surfaceTranslation: typeof c.surface_translation === 'string' ? c.surface_translation : null,
    definition: typeof c.definition === 'string' ? c.definition : null,
    targetExample: typeof c.target_example === 'string' ? c.target_example : null,
    nativeExample: typeof c.native_example === 'string' ? c.native_example : null,
    grammar:
      c.grammar && typeof c.grammar === 'object' && !Array.isArray(c.grammar)
        ? sanitizeGrammarIpa(c.grammar as Record<string, unknown>)
        : undefined,
    belowCefr: Boolean(c.below_cefr),
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
  }))
