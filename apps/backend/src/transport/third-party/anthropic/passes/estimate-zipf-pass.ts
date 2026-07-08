import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_ENRICHMENT, THINKING_DISABLED } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

const TOOL_NAME = 'report_zipf_estimates'

// How many headwords ride in one call. Validated in the zipf experiment
// (docs/proposals/llm-zipf-band-estimation.md Results): batching at 50 does
// not degrade accuracy vs single-term calls.
export const ZIPF_BATCH_SIZE = 50

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Report the estimated corpus frequency for every term in the list.',
  input_schema: {
    type: 'object',
    properties: {
      estimates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            headword: {
              type: 'string',
              description: 'The term, echoed back EXACTLY as it appears in the input list.',
            },
            zipf: {
              type: 'number',
              description: 'Estimated Zipf frequency, one decimal, 0-8.',
            },
          },
          required: ['headword', 'zipf'],
        },
      },
    },
    required: ['estimates'],
  },
})

const buildSystem = (targetLanguage: string): string =>
  `You estimate corpus word frequency for ${targetLanguage} vocabulary on the continuous Zipf scale: Zipf = log10 of occurrences per billion words of running text. Calibration anchors: ~7 = the most common function words ("the", "и"); ~5 = everyday high-frequency vocabulary; ~4 = common vocabulary any adult speaker knows; ~3 = educated / domain vocabulary; ~2 = genuinely rare words; below 1.5 = very rare or technical terms.

Rules:
- Report one estimate per input term, one decimal place, 0-8.
- Judge the LEXEME (citation form). If a term is inflected, estimate the lemma's frequency, not the surface form's.
- Multi-word expressions: estimate how often the EXPRESSION ITSELF occurs in running text, not its component words.
- Echo each term back exactly as given (character-for-character) so estimates can be matched to inputs.`

// Batched Zipf estimation over bare headwords — the backfill path for rows
// created before the basic-data pass started emitting `zipf` inline. One call
// covers up to ZIPF_BATCH_SIZE terms; the caller chunks. Returns a map keyed
// by the exact input headword; terms the model dropped or mangled are simply
// absent (callers treat missing as "leave NULL").
export const estimateZipfPass = async (params: {
  targetLanguage: string
  headwords: string[]
  model?: string
  // Injectable for the standalone backfill script, which runs outside the
  // app's config layer (no NODE_ENV) and builds its own client from
  // ANTHROPIC_API_KEY.
  client?: Anthropic
}): Promise<Map<string, number>> => {
  if (params.headwords.length === 0) return new Map()
  if (params.headwords.length > ZIPF_BATCH_SIZE) {
    throw new Error(`estimateZipfPass: batch too large (${params.headwords.length} > ${ZIPF_BATCH_SIZE})`)
  }
  const client = params.client ?? getAnthropicClient()
  const model = params.model ?? MODEL_ENRICHMENT

  const termLines = params.headwords.map((h) => `- ${h}`).join('\n')
  // MODEL_ENRICHMENT (Opus 4.8) rejects `temperature` — never send it here.
  const stream = client.messages.stream({
    model,
    thinking: THINKING_DISABLED,
    max_tokens: 8000,
    system: buildSystem(params.targetLanguage),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: `Estimate the Zipf frequency of every term below (${params.targetLanguage}):\n${termLines}`,
      },
    ],
  })
  const response = await stream.finalMessage()
  logAnthropicCacheUsage('estimate-zipf', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Anthropic response did not contain a tool_use block${reason}`)
  }
  const input = toolUse.input as { estimates?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.estimates)) {
    throw new Error(`Zipf pass produced no usable estimates (stop_reason=${response.stop_reason ?? 'unknown'})`)
  }

  const wanted = new Set(params.headwords)
  const result = new Map<string, number>()
  for (const row of input.estimates) {
    const headword = typeof row.headword === 'string' ? row.headword : null
    const zipf = typeof row.zipf === 'number' && Number.isFinite(row.zipf) ? row.zipf : null
    if (headword === null || zipf === null || !wanted.has(headword)) continue
    // Clamp to the scale so a stray emission can't overflow NUMERIC(3,1).
    result.set(headword, Math.min(8, Math.max(0, zipf)))
  }
  return result
}
