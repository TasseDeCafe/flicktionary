import type Anthropic from '@anthropic-ai/sdk'
import { getLanguageInstructions, type EnglishIpaDialect } from './language-instructions'

// Static methodology preamble — applies to every pipeline pass and per-card chat turn.
// Stable across all sessions and users; first cacheable layer.
const METHODOLOGY_PREAMBLE = `You are a linguistic co-pilot for a language learner. Methodology: lexical approach.

Core principles — apply to everything you do:

- Chunks over single words. Always present language in its natural environment.
  Not 'suggest' but 'suggest doing something' / 'suggest that someone do something'.
- Register and frequency awareness. Flag whether something is frequent in speech
  vs writing. A word can dominate written prose but sound alien in conversation.
- Functional load. Many unnatural learner productions are fixed by common verbs
  + preposition, not fancier vocabulary. Flag these patterns when relevant.
- Connotation and prosody. Synonyms can share a denotation but differ in emotional
  weight or rhythm. Always flag this.
- L1 interference. Apply your knowledge of typical interference patterns from the
  user's native language to the target language: false friends, structural transfer,
  missing or extra grammatical features, register mismatches.
- Discourse markers and pragmatics. Words like 'well', 'I mean', 'the thing is'
  carry no lexical meaning but are essential for natural speech. Don't ignore them.
- Collocational range. Some words are promiscuous (big, great, nice), some are
  highly restricted. This affects teachability.
- Default to standard educated target language. Flag regional or dialectal usage.

The user is a serious self-directed learner. Be efficient and direct. No praise,
no pedagogical fluff. Skimmable formatting.

When asked to explore a chunk, output the Full exploration via the provided tool
and stop. For follow-up chat about an already-explored chunk, answer
directly and concisely. Never ask 'want me to explore X?' or suggest further
lookups. Never offer multiple follow-up options at the end. If a clarifying
question is needed, ask exactly one.`

type BuildMethodologySystemArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
  // Only meaningful when the target language is English. Selects the dialect
  // variant of the English instructions (usage defaults + IPA dialect). The
  // instructions sit inside the cacheable prefix, so each dialect is its own
  // stable cache variant.
  englishIpaDialect?: EnglishIpaDialect
}

const buildTranslationModeBlock = (args: { hideTranslationFields?: boolean; allowL1Notes?: boolean }): string => {
  const lines = ['Translation field mode:']
  if (args.hideTranslationFields) {
    lines.push('- Do not populate card fields `translation` or `native_example`; set them to null or empty.')
    lines.push('- Keep definitions, target examples, glosses, and general explanations in the target language.')
  } else {
    lines.push(
      "- Populate `translation` and `native_example` in the learner's native language when those fields are requested."
    )
  }
  if (args.allowL1Notes) {
    lines.push(
      "- You may still populate `extras.l1_notes` for false friends, transfer mistakes, translation traps, or other contrastive notes tied to the learner's real native language."
    )
  } else {
    lines.push('- Do not populate `extras.l1_notes`.')
  }
  return lines.join('\n')
}

// Builds a system prompt as an array of TextBlockParam, with a single ephemeral
// cache breakpoint at the end of the stable prefix. Each per-chunk LLM call shares
// this exact prefix, so after the first call the prefix is served from cache.
export const buildMethodologySystem = ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  hideTranslationFields = nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase(),
  allowL1Notes = nativeLanguage.trim().toLowerCase() !== targetLanguage.trim().toLowerCase(),
  englishIpaDialect,
}: BuildMethodologySystemArgs): Anthropic.TextBlockParam[] => {
  const userProfile = `User profile:
- Native language: ${nativeLanguage}
- Target language: ${targetLanguage}
- CEFR level: ${cefrLevel}`

  const contextBlock = `Source context for this session:
${movieContextBlob}`

  const languageInstructions = getLanguageInstructions(targetLanguage, { englishIpaDialect })
  const translationMode = buildTranslationModeBlock({ hideTranslationFields, allowL1Notes })

  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: METHODOLOGY_PREAMBLE }]
  if (languageInstructions) {
    blocks.push({ type: 'text', text: languageInstructions })
  }
  blocks.push({ type: 'text', text: userProfile })
  // Second breakpoint before the per-session context blob: a NEW session in the
  // same target language re-reads everything up to here (~4.9k tokens) from
  // cache instead of paying a full write — only the ~300-token blob is fresh.
  blocks.push({ type: 'text', text: translationMode, cache_control: { type: 'ephemeral' } })
  blocks.push({ type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } })
  return blocks
}

type BuildPracticeMethodologySystemArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
  englishIpaDialect?: EnglishIpaDialect
  // Additional STABLE system blocks appended after the user profile — pass-static
  // text (rubrics, hard rules) that must sit inside the cacheable prefix instead
  // of being rebuilt into every user message. Anything that varies per call must
  // stay in the user message instead, after the breakpoint.
  extraStableBlocks?: string[]
}

// Variant for the Practice tab. Same cacheable prefix structure but without the
// per-session source-context block (Practice texts aren't tied to a movie/source).
// The cache breakpoint sits on the LAST stable block — the user profile, or the
// last of the caller's extraStableBlocks when provided.
export const buildPracticeMethodologySystem = ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  hideTranslationFields = nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase(),
  allowL1Notes = nativeLanguage.trim().toLowerCase() !== targetLanguage.trim().toLowerCase(),
  englishIpaDialect,
  extraStableBlocks = [],
}: BuildPracticeMethodologySystemArgs): Anthropic.TextBlockParam[] => {
  const userProfile = `User profile:
- Native language: ${nativeLanguage}
- Target language: ${targetLanguage}
- CEFR level: ${cefrLevel}`

  const languageInstructions = getLanguageInstructions(targetLanguage, { englishIpaDialect })
  const translationMode = buildTranslationModeBlock({ hideTranslationFields, allowL1Notes })

  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: METHODOLOGY_PREAMBLE }]
  if (languageInstructions) {
    blocks.push({ type: 'text', text: languageInstructions })
  }
  blocks.push({ type: 'text', text: translationMode })
  blocks.push({ type: 'text', text: userProfile })
  for (const text of extraStableBlocks) {
    blocks.push({ type: 'text', text })
  }
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }
  return blocks
}
