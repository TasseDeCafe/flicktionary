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
//
// Opus 5.5 notes (https://github.com/TasseDeCafe/flicktionary/issues/467):
// thinking is always on (`{type: 'disabled'}` is a 400) — `effort` is the only
// dial, see reasoningParams; forced tool_choice (`tool`/`any`) is a 400, so
// tool-shaped passes run on TOOL_CHOICE_AUTO and name the tool in the prompt;
// thinking tokens count toward max_tokens, so caps leave room for them. The
// OPUS_MODEL env var rolls every Opus pass back in one line (e.g.
// `claude-opus-4-8`, which runs the same code with thinking disabled).
export const MODEL_OPUS = process.env.OPUS_MODEL ?? 'claude-opus-5-5'
export const MODEL_SONNET = 'claude-sonnet-5'
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Accepted on Sonnet 5 and Opus 4.8 alike. Not on Opus 5.5 — call sites that
// may run it go through reasoningParams instead.
export const THINKING_DISABLED = { type: 'disabled' } as const

export const TOOL_CHOICE_AUTO = { type: 'auto' } as const

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const ALWAYS_THINKING_MODELS = new Set(['claude-opus-5-5', 'claude-fable-5', 'claude-fable-5-1'])

// The passes were tuned thinking-off. Models that allow it keep running that
// way; always-thinking models get an explicit effort instead (the API default
// on Opus 5.5 is `medium`, too much for extraction-shaped passes).
export const reasoningParams = (
  model: string,
  effort: Effort
): { thinking: typeof THINKING_DISABLED } | { output_config: { effort: Effort } } =>
  ALWAYS_THINKING_MODELS.has(model) ? { output_config: { effort } } : { thinking: THINKING_DISABLED }

// Per-highlight background enrichment runs through this constant. Defaults to
// Opus: the pass writes the card the user studies from, so quality wins over
// Sonnet's lower price here (Sonnet 5 also omitted the tool schema's
// highlight_id in ~1/4 of calls — now defended mechanically, but the trial
// eroded confidence in it for this pass). The env override flips the model in
// one line for A/B comparison.
export const MODEL_ENRICHMENT = process.env.ENRICHMENT_MODEL ?? MODEL_OPUS

// Exercise verification defaults to Opus. A Sonnet 5 trial (for price + its
// 2048-token cacheable minimum) tripled the mc_cloze verifier rejection rate
// (~17% → ~75% of slots terminally failed) — without thinking it over-indexes
// on the adversarial brief, failing exercises over ironic or contrived
// distractor readings. The env override allows one-line A/B re-trials.
export const MODEL_EXERCISE_VERIFY = process.env.EXERCISE_VERIFY_MODEL ?? MODEL_OPUS

// Formerly-Opus pass trialing Sonnet 5 (near-Opus on selection tasks, 60% of
// the price, and its ~3-4k-token prefix actually caches on Sonnet — it was
// below Opus's 4096-token minimum cacheable length, see
// docs/proposals/prompt-caching-optimization.md). The env var flips the pass
// back to Opus in one line for A/B quality comparison.
export const MODEL_NOMINATE = process.env.NOMINATE_MODEL ?? MODEL_SONNET

let client: Anthropic | null = null

export const getAnthropicClient = (): Anthropic => {
  if (!client) {
    client = new Anthropic({ apiKey: getConfig().anthropicApiKey })
  }
  return client
}
