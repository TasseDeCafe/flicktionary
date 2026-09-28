import type { ContentSourceType } from '../../transport/database/content-sources/content-sources-repository'

// Sources whose track is a list of independent vocabulary items rather than a
// narrative text: adhoc entries ("headword — context" lines), lesson imports,
// and vocabulary chats (one example sentence per added term). Difficulty
// stats, lemma profiles, and mark-known sweeps skip them.
export const isSyntheticSourceType = (type: ContentSourceType | null): boolean =>
  type === 'adhoc' || type === 'lesson' || type === 'chat'
