import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../../../config/environment-config'

// Pinned model versions. Sonnet handles all heavy passes (context blob, L1 notes,
// difficult-words, full-exploration, per-card chat). Haiku handles the latency-sensitive
// tap-to-translate fast-gloss path.
export const MODEL_OPUS = 'claude-opus-4-7'
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

let client: Anthropic | null = null

export const getAnthropicClient = (): Anthropic => {
  if (!client) {
    client = new Anthropic({ apiKey: getConfig().anthropicApiKey })
  }
  return client
}
