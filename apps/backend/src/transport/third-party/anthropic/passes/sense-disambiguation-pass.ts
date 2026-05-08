import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'

const TOOL_NAME = 'submit_disambiguations'

export type ExistingSense = {
  sense: string
  definition: string | null
}

export type CandidateForDisambiguation = {
  candidateId: string
  headword: string
  candidateSense: string
  candidateDefinition: string | null
  existingSenses: ExistingSense[]
}

export type DisambiguationResult = {
  candidateId: string
  isDuplicate: boolean
  matchedExistingSense: string | null
}

type SenseDisambiguationPassArgs = {
  targetLanguage: string
  candidates: CandidateForDisambiguation[]
}

const SYSTEM_PROMPT = `You decide whether each candidate chunk is a duplicate of an
existing sense the learner has already studied, or a genuinely new sense of
the same headword that should be kept as a separate entry.

Per-candidate, you receive:
- the candidate's headword, sense (1-5 word disambiguator), and contextual definition
- a list of existing senses already tracked under that headword (sense + definition)

Rules:
- "Duplicate" means the candidate sense conveys the same usage as one of the
  existing senses. Wording differences ("to flow" vs "flow, of liquid") are
  duplicates if the underlying meaning matches.
- "Distinct" means the candidate covers a meaningfully different sense of the
  headword (e.g. polysemy: 'correr | to run a race' vs 'correr | to spread,
  of news'). Distinct senses must be kept.
- When in doubt, prefer 'distinct' — a duplicate that slips through is fixable
  by the user at triage; a real distinct sense lost here is invisible.

Return one decision per candidate via the provided tool.`

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Submit a duplicate/distinct decision for each candidate chunk.',
  input_schema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            candidate_id: {
              type: 'string',
              description: 'The candidateId from the input.',
            },
            is_duplicate: {
              type: 'boolean',
              description: 'true = duplicate of an existing sense; false = distinct sense, keep.',
            },
            matched_existing_sense: {
              type: 'string',
              description:
                "When is_duplicate=true, the exact 'sense' string of the existing entry the candidate duplicates. Null/omitted otherwise.",
            },
          },
          required: ['candidate_id', 'is_duplicate'],
        },
      },
    },
    required: ['decisions'],
  },
})

export const senseDisambiguationPass = async ({
  targetLanguage,
  candidates,
}: SenseDisambiguationPassArgs): Promise<DisambiguationResult[]> => {
  if (candidates.length === 0) return []

  const candidateBlocks = candidates
    .map((c) => {
      const existingLines = c.existingSenses
        .map((s) => `    - sense: "${s.sense}"${s.definition ? ` | definition: ${s.definition}` : ''}`)
        .join('\n')
      const definitionLine = c.candidateDefinition ? `\n  candidateDefinition: ${c.candidateDefinition}` : ''
      return `- candidateId: ${c.candidateId}
  headword: ${c.headword}
  candidateSense: ${c.candidateSense}${definitionLine}
  existingSenses:
${existingLines}`
    })
    .join('\n')

  const userMessage = `Target language: ${targetLanguage}

Decide for each candidate whether it duplicates one of the existing senses or
is a genuinely distinct sense worth keeping. Return one decision per
candidate via the tool.

Candidates:
${candidateBlocks}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(
      `Sense-disambiguation pass produced no tool_use block (stop_reason=${response.stop_reason ?? 'unknown'})`
    )
  }
  const input = toolUse.input as { decisions?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.decisions)) {
    throw new Error('Sense-disambiguation pass returned malformed tool input (expected `decisions` array)')
  }
  return parseDisambiguationResults(input.decisions)
}

// Exported for unit tests. Coerces the raw tool_use objects into typed
// DisambiguationResult values, defending against missing or oddly-typed fields.
export const parseDisambiguationResults = (raw: Array<Record<string, unknown>>): DisambiguationResult[] =>
  raw
    .map((d) => {
      const candidateId = typeof d.candidate_id === 'string' ? d.candidate_id : ''
      if (candidateId.length === 0) return null
      const isDuplicate = d.is_duplicate === true
      const matched = typeof d.matched_existing_sense === 'string' ? d.matched_existing_sense : null
      return {
        candidateId,
        isDuplicate,
        matchedExistingSense: isDuplicate ? matched : null,
      }
    })
    .filter((d): d is DisambiguationResult => d !== null)
