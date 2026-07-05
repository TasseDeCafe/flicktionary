import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from '../../../config/environment-config'

// Pinned model versions. Opus handles the accuracy-first passes (full
// exploration, exercise generation, practice texts, card chat). Sonnet 5
// handles the passes where near-Opus quality at 60% of the price is the better
// trade. Haiku handles the latency-sensitive tap-to-translate fast-gloss path.
//
// Sonnet 5 notes: it runs ADAPTIVE THINKING by default when the `thinking`
// param is omitted (Sonnet 4.6 ran thinking-off), so every Sonnet call site
// passes THINKING_DISABLED to keep the passes' tuned behavior and max_tokens
// budgets; and it uses a new tokenizer (~30% more tokens for the same text),
// which also pushes the tools+system prefixes further past the minimum
// cacheable length.
export const MODEL_OPUS = 'claude-opus-4-7'
export const MODEL_OPUS_4_8 = 'claude-opus-4-8'
export const MODEL_SONNET = 'claude-sonnet-5'
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Accepted on Sonnet 5 and Opus 4.7/4.8 alike, so it is safe on env-overridable
// call sites that may run any of those models.
export const THINKING_DISABLED = { type: 'disabled' } as const

// Per-highlight background enrichment runs through this constant. Defaults to
// Opus 4.8: the pass writes the card the user studies from, so quality wins
// over Sonnet's lower price here (Sonnet 5 also omitted the tool schema's
// highlight_id in ~1/4 of calls — now defended mechanically, but the trial
// eroded confidence in it for this pass). Note Opus's minimum cacheable prefix
// is 4096 tokens vs Sonnet's 2048; the basic-data prefix (~4.9k tokens) still
// caches, with little headroom. The env override flips the model in one line
// for A/B comparison.
export const MODEL_ENRICHMENT = process.env.ENRICHMENT_MODEL ?? MODEL_OPUS_4_8

// Formerly-Opus passes trialing Sonnet 5 (near-Opus on verification/selection
// tasks, 60% of the price, and their ~3-4k-token prefixes actually cache on
// Sonnet — they were below Opus's 4096-token minimum cacheable length, see
// docs/proposals/prompt-caching-optimization.md). Each env var flips its pass
// back to Opus in one line for A/B quality comparison.
export const MODEL_EXERCISE_VERIFY = process.env.EXERCISE_VERIFY_MODEL ?? MODEL_SONNET
export const MODEL_NOMINATE = process.env.NOMINATE_MODEL ?? MODEL_SONNET

let client: Anthropic | null = null

export const getAnthropicClient = (): Anthropic => {
  if (!client) {
    client = new Anthropic({ apiKey: getConfig().anthropicApiKey })
  }
  return client
}
