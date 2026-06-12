import { useLingui } from '@lingui/react/macro'

// Preset tags offered in the gloss popovers' note editor — shared by the web
// gloss sheet and the extension's saved-mode popover so the ids, the localized
// labels, and the composed chat-seed question stay identical across platforms
// (the composed prompt seeds the card chat server-side, so divergence here
// would mean notes written on one platform seed different chats than the other).
export const PRESET_TAGS = ['explain', '3_examples', 'synonyms', 'etymology', 'why_this_form'] as const
export type PresetTag = (typeof PRESET_TAGS)[number]

// Localized button labels + the natural-language phrasing composed into the
// chat question. Localizing here (in the UI locale) keeps the backend
// language-agnostic; the model is told separately which language to answer in.
export const usePresetTagTexts = (): { labels: Record<PresetTag, string>; prompts: Record<PresetTag, string> } => {
  const { t } = useLingui()
  return {
    labels: {
      explain: t`Explain`,
      '3_examples': t`3 examples`,
      synonyms: t`Synonyms`,
      etymology: t`Etymology`,
      why_this_form: t`Why this form?`,
    },
    prompts: {
      explain: t`Explain this term in more depth.`,
      '3_examples': t`Give me three more example sentences using it.`,
      synonyms: t`What are some synonyms or near-synonyms, and how do they differ?`,
      etymology: t`What's the etymology or origin of this term?`,
      why_this_form: t`Why does it appear in this particular form here?`,
    },
  }
}

// Compose the localized chat question: each selected preset's sentence (in
// PRESET_TAGS button order) followed by the verbatim note. Null when there is
// nothing to ask, which suppresses the seed_card_chat job server-side.
export const composeChatSeedPrompt = (
  selectedTags: readonly string[],
  prompts: Record<PresetTag, string>,
  note: string
): string | null => {
  const selectedPrompts = PRESET_TAGS.filter((tag) => selectedTags.includes(tag)).map((tag) => prompts[tag])
  const trimmedNote = note.trim()
  const parts = trimmedNote ? [...selectedPrompts, trimmedNote] : selectedPrompts
  return parts.length ? parts.join('\n') : null
}
