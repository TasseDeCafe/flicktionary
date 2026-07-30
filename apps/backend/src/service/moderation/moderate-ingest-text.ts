import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  HardBlockCategory,
  ModerationCategory,
  ModerationVerdict,
} from '../../transport/third-party/anthropic/passes/moderation-pass'
import { logError } from '../../transport/error-monitoring/error-monitoring'

export type IngestModerationSurface = 'paste' | 'srt-upload' | 'extension-import' | 'telegram' | 'lesson-import'

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
  context: { surface: IngestModerationSurface }
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
  if (blocked) return { allowed: false, category: blocked.category as HardBlockCategory }

  const flagged = verdicts.find((v): v is ModerationVerdict & { verdict: 'flag' } => v?.verdict === 'flag')
  if (flagged) return { allowed: true, status: 'flagged', category: flagged.category }

  const fullCoverage = verdicts.every((v) => v?.verdict === 'allow')
  return { allowed: true, status: fullCoverage ? 'clean' : null, category: null }
}

// Honest for the common case; deliberately non-specific for csam (no need to
// tell an uploader precisely what tripped that wire).
export const blockedContentMessage = (category: HardBlockCategory): string =>
  category === 'sexual-explicit'
    ? "This text appears to contain explicit sexual content, which can't be imported into Flicktionary."
    : "This text contains content that can't be imported into Flicktionary."
