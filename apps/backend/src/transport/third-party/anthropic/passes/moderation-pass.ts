import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

export const MODERATION_CATEGORIES = [
  'sexual-explicit',
  'csam',
  'sexual-suggestive',
  'violence',
  'hate',
  'self-harm',
  'harassment',
  'other',
] as const

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number]

// Only these categories reject an import; everything else is at most flagged.
export const HARD_BLOCK_CATEGORIES = ['sexual-explicit', 'csam'] as const satisfies readonly ModerationCategory[]

export type HardBlockCategory = (typeof HARD_BLOCK_CATEGORIES)[number]

export type ModerationVerdict = { verdict: 'allow' } | { verdict: 'flag' | 'block'; category: ModerationCategory }

const isModerationCategory = (value: string): value is ModerationCategory =>
  (MODERATION_CATEGORIES as readonly string[]).includes(value)

const isHardBlockCategory = (category: ModerationCategory): category is HardBlockCategory =>
  (HARD_BLOCK_CATEGORIES as readonly ModerationCategory[]).includes(category)

const SYSTEM_PROMPT = `You classify text that a user wants to import into Flicktionary, a language-learning app. The text is private study material (subtitles, articles, chat messages, lesson notes) and may be in any language.

Respond with exactly one line and nothing else:
allow
flag <category>
block <category>

Categories: ${MODERATION_CATEGORIES.join(', ')}.

Rules:
- block ONLY pornographic / explicitly sexual content (sexual-explicit), or ANY content that sexualizes minors (csam).
- flag content that is notable but acceptable for private study: graphic violence (violence), hateful content (hate), self-harm content (self-harm), harassment or bullying (harassment), sexually suggestive but not explicit (sexual-suggestive), anything else concerning (other).
- allow everything ordinary: fiction, news, song lyrics, profanity, action or war violence, romance, medical or educational text.
When unsure between allow and flag, choose allow. When unsure between flag and block, choose flag.`

// Pure parser, unit-tested directly. The hard-block policy is enforced HERE,
// not trusted to the prompt: sexual-explicit/csam always block (even if the
// model said "flag"), every other category never blocks (a "block violence"
// downgrades to flag). Unrecognized output returns null so callers fail open.
export const parseModerationVerdict = (raw: string): ModerationVerdict | null => {
  const [verb, categoryToken] = raw.trim().toLowerCase().split(/\s+/)
  if (verb === 'allow') return { verdict: 'allow' }
  if (verb !== 'flag' && verb !== 'block') return null

  // A recognized verb with a bogus category still carries signal — keep it as
  // a generic flag rather than discarding the verdict.
  const category = categoryToken && isModerationCategory(categoryToken) ? categoryToken : 'other'
  return isHardBlockCategory(category) ? { verdict: 'block', category } : { verdict: 'flag', category }
}

// Classifies ONE chunk of ingested text (callers chunk long documents and
// aggregate — see service/moderation/moderate-ingest-text.ts). Null means
// "no usable verdict" and is treated as fail-open upstream.
export const moderationPass = async (chunk: string): Promise<ModerationVerdict | null> => {
  const trimmed = chunk.trim()
  if (trimmed.length === 0) return { verdict: 'allow' }

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 16,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: trimmed }],
  })
  logAnthropicCacheUsage('moderation', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null

  return parseModerationVerdict(textBlock.text)
}
