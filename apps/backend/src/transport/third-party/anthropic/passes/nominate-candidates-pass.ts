import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_candidates'

// Candidate budget for a window, anchored to how much TEXT it holds rather than a
// flat per-window count — a window can be a few short subtitle lines or a couple of
// dense article paragraphs, and a flat count starves the latter (the bug this
// replaces). Density is chars-per-candidate, scaled by CEFR: lower levels hit more
// unknown vocab so they nominate denser. Calibrated against the old whole-text
// discovery pass (which surfaced ~25 chunks from a ~2k-char A2 news article).
const CHARS_PER_CANDIDATE: Record<string, number> = {
  A1: 90,
  A2: 90,
  B1: 130,
  B2: 130,
  C1: 190,
  C2: 240,
}
const MAX_CANDIDATES_PER_WINDOW = 40

const targetForWindow = (cefrLevel: string, totalChars: number): number => {
  if (totalChars === 0) return 0
  const perCandidate = CHARS_PER_CANDIDATE[cefrLevel.trim().toUpperCase()] ?? 130
  const raw = Math.round(totalChars / perCandidate)
  return Math.min(MAX_CANDIDATES_PER_WINDOW, Math.max(1, raw))
}

type SegmentInput = {
  id: string
  index: number
  text: string
}

// A nominated span, anchored to a segment + character offsets in that segment's
// (already-SRT-stripped) stored text. Offsets — not just the surface string —
// kill the ambiguity of a unit that occurs more than once in the window. The
// caller reconciles these offsets against the stored text before persisting.
export type NominatedSpan = {
  segmentId: string
  charStart: number
  charEnd: number
  surfaceForm: string
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    "Submit the spans in this reading window worth studying for this learner — single words or multi-word units at or above the learner's CEFR level. Each span is anchored to the exact segment and character offsets where it appears.",
  input_schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            segment_id: {
              type: 'string',
              description: 'The id of the segment where this span appears (from the provided list).',
            },
            surface_form: {
              type: 'string',
              description:
                'The span exactly as it literally appears in that segment text (verbatim substring — same casing, accents, and punctuation).',
            },
            char_start: {
              type: 'number',
              description:
                'Zero-based character offset of the first character of surface_form within the segment text.',
            },
            char_end: {
              type: 'number',
              description:
                'Character offset one past the last character of surface_form (so text.slice(char_start, char_end) === surface_form).',
            },
          },
          required: ['segment_id', 'surface_form', 'char_start', 'char_end'],
        },
      },
    },
    required: ['candidates'],
  },
})

// Nominate-only pass: an Opus tool call over one reading window. Tiny output — no
// translations, definitions, or grammar (those are produced later by the
// per-highlight enrichment pass, only if the user adopts the span). Reuses the
// cached methodology system prefix so successive windows hit the prompt cache.
export const nominateCandidatesPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  segments,
  hideTranslationFields,
  allowL1Notes,
}: {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  segments: SegmentInput[]
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
}): Promise<NominatedSpan[]> => {
  const totalChars = segments.reduce((n, s) => n + s.text.length, 0)
  const target = targetForWindow(cefrLevel, totalChars)
  // Number each segment's characters implicitly by giving the model the raw text;
  // it returns offsets it must keep consistent with surface_form. The caller
  // re-derives offsets from surface_form when the model miscounts.
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')

  const userMessage = `Identify the spans in the reading window below that a learner
at ${cefrLevel} (native ${nativeLanguage}, target ${targetLanguage}) would benefit
from studying. Aim for about ${target}, but be guided by the content, not the
number: a dense passage can hold more than ${target} worthwhile spans, a sparse one
fewer. Capture everything that genuinely meets the bar — don't artificially limit
yourself, and don't pad with trivial items.

Selection criteria:
- Include items AT OR ABOVE ${cefrLevel}. Do not include items clearly below
  ${cefrLevel}. When unsure, lean towards including — a passive ghost the learner can
  ignore costs little, a missed useful word costs more.
- Include BOTH single words and multi-word units — do not skew toward multi-word
  units. An advanced single word the learner likely does not know (abstract,
  literary, technical, formal/bookish, archaic, slang, jargon) is just as worth
  studying as a collocation. For news/expository text this includes topic
  vocabulary, abstract nouns, and formal verbs. Multi-word units to consider:
  collocations, fixed expressions, idioms, phrasal verbs, pronominal verbs (with
  their canonical preposition), discourse markers. Aim for a natural mix that
  reflects what is actually difficult in this source.
- Prefer regional/dialectal/colloquial usage that exemplifies this source over
  neutral pan-language equivalents (see the source-context block in the system
  prompt for register and regional cues).

For each nominated span, return: segment_id, surface_form (the verbatim substring
as it appears in that segment), and char_start/char_end such that
text.slice(char_start, char_end) === surface_form. If the same unit appears more
than once in the window, return the specific occurrence you mean via its offsets.

Reading window (segment id followed by text):
${segmentLines}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 8000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      hideTranslationFields,
      allowL1Notes,
    }),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Nominate pass did not contain a tool_use block${reason}`)
  }
  const input = toolUse.input as { candidates?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.candidates)) {
    throw new Error(`Nominate pass produced no usable candidates (stop_reason=${response.stop_reason ?? 'unknown'})`)
  }
  return parseNominatedSpans(input.candidates)
}

// Exported for unit tests. Maps raw tool_use objects to typed NominatedSpan
// values, dropping anything missing the anchor fields.
export const parseNominatedSpans = (raw: Array<Record<string, unknown>>): NominatedSpan[] =>
  raw
    .map((c) => ({
      segmentId: String(c.segment_id ?? ''),
      surfaceForm: String(c.surface_form ?? ''),
      charStart: typeof c.char_start === 'number' ? c.char_start : Number.NaN,
      charEnd: typeof c.char_end === 'number' ? c.char_end : Number.NaN,
    }))
    .filter((c) => c.segmentId.length > 0 && c.surfaceForm.length > 0)
