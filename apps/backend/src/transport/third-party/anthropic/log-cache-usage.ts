import type Anthropic from '@anthropic-ai/sdk'

// Per-call prompt-cache observability. `usage.input_tokens` is only the
// UNCACHED remainder — the full prompt is input + cache_creation + cache_read.
// A pass whose tools+system prefix is below the model's minimum cacheable
// length (4096 tokens on Opus/Haiku, 2048 on Sonnet) silently reports 0 for
// both cache fields; this line is how we see that in prod.
// See docs/proposals/prompt-caching-optimization.md.
export const logAnthropicCacheUsage = (pass: string, response: Anthropic.Message): void => {
  // Mocked responses in unit tests carry no usage; skip rather than throw.
  const usage = response.usage as Anthropic.Usage | undefined
  if (!usage) return
  console.log('anthropic cache usage', {
    pass,
    model: response.model,
    inputTokens: usage.input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  })
}
