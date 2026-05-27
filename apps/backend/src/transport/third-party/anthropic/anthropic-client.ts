import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../../../config/environment-config'

// Pinned model versions. Sonnet handles all heavy passes (context blob, L1 notes,
// difficult-words, full-exploration, per-card chat). Haiku handles the latency-sensitive
// tap-to-translate fast-gloss path.
export const MODEL_OPUS = 'claude-opus-4-7'
const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Per-highlight background enrichment runs through this constant. Defaults to
// Sonnet — each job enriches a single highlight (no whole-text discovery), so
// the cheaper/faster model is plenty, and the env override flips it back to Opus
// in one line for A/B quality comparison.
export const MODEL_ENRICHMENT = process.env.ENRICHMENT_MODEL ?? MODEL_SONNET

let client: Anthropic | null = null

export const getAnthropicClient = (): Anthropic => {
  if (!client) {
    client = new Anthropic({ apiKey: getConfig().anthropicApiKey })
  }
  return client
}
