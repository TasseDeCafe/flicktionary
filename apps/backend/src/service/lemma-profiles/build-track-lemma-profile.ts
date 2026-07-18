import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { TextTrackLemmaProfilesRepositoryInterface } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { countFoldedTokens } from './count-tokens'

// Builds (or rebuilds) a track's lemma profile: batch-tokenize the segments
// with occurrence counts, resolve every distinct folded token to its candidate
// lemma set through the shared checkpoint matcher, and swap the profile rows +
// track bookkeeping in one transaction (see the repository). Synthetic tracks
// (adhoc: mutable, "headword — context" lines; lesson: independent imported
// vocabulary items, non-narrative) and languages without loaded wiktionary
// data are skipped — the difficulty stat treats them as unsupported.

const SEGMENT_BATCH_SIZE = 500
const RESOLVE_CHUNK_SIZE = 5_000

export type BuildTrackLemmaProfileDependencies = {
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepositoryInterface
}

export type BuildTrackLemmaProfileResult =
  | { status: 'built'; wordTokenCount: number; matchedTokenCount: number }
  | { status: 'skipped'; reason: 'track_not_found' | 'synthetic_source' | 'unsupported_language' }

export const buildTrackLemmaProfile = async (
  textTrackId: string,
  deps: BuildTrackLemmaProfileDependencies
): Promise<BuildTrackLemmaProfileResult> => {
  const track = await deps.textTracksRepository.findByIdWithSourceType(textTrackId)
  if (!track) return { status: 'skipped', reason: 'track_not_found' }
  if (track.content_source_type === 'adhoc' || track.content_source_type === 'lesson') {
    return { status: 'skipped', reason: 'synthetic_source' }
  }
  if (!KAIKKI_LANGUAGES.has(track.language)) return { status: 'skipped', reason: 'unsupported_language' }

  // Bounded keyset pages over actual rows — never the whole track in one load
  // (subtitle tracks are small, but book-length pastes are not), and never a
  // walk of the raw index space (extension-supplied indices are not
  // guaranteed dense, so a sparse or crafted max index must not turn into
  // millions of empty range queries). The bookkeeping totals derive from the
  // rows actually scanned, keeping the staleness check honest.
  const counts = new Map<string, number>()
  let segmentCount = 0
  let maxSegmentIndex: number | null = null
  let cursor: number | null = null
  for (;;) {
    const segments = await deps.textSegmentsRepository.listPageAfterIndex({
      textTrackId,
      afterIndex: cursor,
      limit: SEGMENT_BATCH_SIZE,
    })
    if (segments.length === 0) break
    segmentCount += segments.length
    countFoldedTokens(segments, track.language, counts)
    cursor = segments[segments.length - 1].index
    maxSegmentIndex = cursor
    if (segments.length < SEGMENT_BATCH_SIZE) break
  }

  const tokens = [...counts.keys()]
  const lemmasByToken = new Map<string, Set<string>>()
  for (let i = 0; i < tokens.length; i += RESOLVE_CHUNK_SIZE) {
    const resolved = await deps.wiktionaryMatchRepository.resolveFoldedLemmasForTokens({
      targetLanguage: track.language,
      foldedTokens: tokens.slice(i, i + RESOLVE_CHUNK_SIZE),
    })
    for (const [token, lemmas] of resolved) lemmasByToken.set(token, lemmas)
  }

  // Unresolved tokens (proper nouns, numbers, typos) stay out of the profile:
  // resolution failure IS the filter, and the difficulty denominator is
  // matched tokens. Both totals are stored so the gap stays visible.
  let wordTokenCount = 0
  let matchedTokenCount = 0
  const rows: Array<{ foldedToken: string; tokenCount: number; candidateLemmas: string[] }> = []
  for (const [foldedToken, tokenCount] of counts) {
    wordTokenCount += tokenCount
    const lemmas = lemmasByToken.get(foldedToken)
    if (!lemmas || lemmas.size === 0) continue
    matchedTokenCount += tokenCount
    rows.push({ foldedToken, tokenCount, candidateLemmas: [...lemmas] })
  }

  await deps.textTrackLemmaProfilesRepository.replaceProfile({
    textTrackId,
    rows,
    segmentCount,
    maxSegmentIndex,
    wordTokenCount,
    matchedTokenCount,
  })
  return { status: 'built', wordTokenCount, matchedTokenCount }
}
