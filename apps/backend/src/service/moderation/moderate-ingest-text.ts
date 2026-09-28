import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  HardBlockCategory,
  ModerationCategory,
  ModerationVerdict,
} from '../../transport/third-party/anthropic/passes/moderation-pass'
import { logError } from '../../transport/error-monitoring/error-monitoring'

export type IngestModerationSurface =
  | 'paste'
  | 'srt-upload'
  | 'extension-import'
  | 'telegram'
  | 'lesson-import'
  | 'book-upload'
  | 'vocab-chat'
  // Share-time checks for the Explore catalog: YouTube ingest is not gated, so
  // its tracks are moderated when (and only when) they are about to publish.
  | 'share-youtube'
  | 'share-title'

export type IngestModerationOutcome =
  // status null = incomplete coverage (a chunk failed or was unparseable):
  // nothing is persisted so a later re-import re-checks the content.
  | { allowed: true; status: 'clean' | 'flagged' | null; category: ModerationCategory | null }
  | { allowed: false; category: HardBlockCategory }

// Haiku classifies ~20k chars comfortably in one call; chunks run in parallel
// so wall-clock stays that of a single call regardless of document size.
const MODERATION_CHUNK_CHARS = 20_000

export const chunkForModeration = (text: string): string[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const chunks: string[] = []
  for (let start = 0; start < trimmed.length; start += MODERATION_CHUNK_CHARS) {
    chunks.push(trimmed.slice(start, start + MODERATION_CHUNK_CHARS))
  }
  return chunks
}

// The single moderation entry point for user-authored ingestion. Covers the
// FULL text (chunked, no sampling — deterministic sampling windows would be a
// predictable place to hide content) and fails open per chunk: a chunk whose
// call throws or returns no usable verdict counts as unchecked rather than
// failing the import, but a block from any surviving chunk still rejects.
export const moderateIngestText = async (
  text: string,
  anthropicPasses: AnthropicPassesInterface,
  context: {
    surface: IngestModerationSurface
    // Narrows which hard-block categories reject for this surface; any other
    // block verdict is downgraded to a flag. Defaults to the parser's full
    // hard-block set.
    hardBlockCategories?: readonly HardBlockCategory[]
  }
): Promise<IngestModerationOutcome> => {
  const chunks = chunkForModeration(text)
  if (chunks.length === 0) return { allowed: true, status: null, category: null }

  const verdicts: (ModerationVerdict | null)[] = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await anthropicPasses.moderationPass(chunk)
      } catch (error) {
        // Deliberately no text content in the log — imports are private user
        // material.
        logError({
          message: 'moderation pass failed open for a chunk',
          params: { surface: context.surface, textLength: text.length, chunkCount: chunks.length },
          error,
        })
        return null
      }
    })
  )

  const blocked = verdicts.find((v): v is ModerationVerdict & { verdict: 'block' } => v?.verdict === 'block')
  // The parser guarantees block only ever carries a hard-block category.
  if (blocked) {
    const category = blocked.category as HardBlockCategory
    if (!context.hardBlockCategories || context.hardBlockCategories.includes(category)) {
      return { allowed: false, category }
    }
    return { allowed: true, status: 'flagged', category }
  }

  const flagged = verdicts.find((v): v is ModerationVerdict & { verdict: 'flag' } => v?.verdict === 'flag')
  if (flagged) return { allowed: true, status: 'flagged', category: flagged.category }

  const fullCoverage = verdicts.every((v) => v?.verdict === 'allow')
  return { allowed: true, status: fullCoverage ? 'clean' : null, category: null }
}

// Four windows plus separators stay under one 20k moderation chunk.
const BOOK_SAMPLE_WINDOW_CHARS = 4_900
const BOOK_SAMPLE_RANDOM_WINDOWS = 3

// Books are the one surface moderated on a sample instead of the full text: a
// novel is up to millions of chars (dozens of calls per upload) and books are
// never shared. The sample is the opening window plus windows at random
// offsets, so the checked region isn't predictable from the file alone. Fits
// one moderation chunk.
export const buildBookModerationSample = (text: string, random: () => number = Math.random): string => {
  const trimmed = text.trim()
  const windowCount = BOOK_SAMPLE_RANDOM_WINDOWS + 1
  if (trimmed.length <= BOOK_SAMPLE_WINDOW_CHARS * windowCount) return trimmed
  const windows = [trimmed.slice(0, BOOK_SAMPLE_WINDOW_CHARS)]
  const maxStart = trimmed.length - BOOK_SAMPLE_WINDOW_CHARS
  // One random window per equal stretch after the opening, so the samples
  // spread across the whole book instead of clustering.
  const stretch = (maxStart - BOOK_SAMPLE_WINDOW_CHARS) / BOOK_SAMPLE_RANDOM_WINDOWS
  for (let i = 0; i < BOOK_SAMPLE_RANDOM_WINDOWS; i++) {
    const start = Math.floor(BOOK_SAMPLE_WINDOW_CHARS + stretch * (i + random()))
    windows.push(trimmed.slice(start, start + BOOK_SAMPLE_WINDOW_CHARS))
  }
  return windows.join('\n\n')
}

// Honest for the common case; deliberately non-specific for csam (no need to
// tell an uploader precisely what tripped that wire).
export const blockedContentMessage = (category: HardBlockCategory): string =>
  category === 'sexual-explicit'
    ? "This text appears to contain explicit sexual content, which can't be imported into Flicktionary."
    : "This text contains content that can't be imported into Flicktionary."
