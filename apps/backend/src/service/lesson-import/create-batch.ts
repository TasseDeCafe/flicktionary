import { createHash } from 'crypto'
import { beginTx } from '../../transport/database/postgres-client'
import { assertGuestLessonBatchQuota, assertGuestSourceQuota } from '../../transport/database/guests/guest-source-quota'
import type {
  DbImportBatch,
  ImportBatchesRepositoryInterface,
} from '../../transport/database/import-batches/import-batches-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { HardBlockCategory } from '../../transport/third-party/anthropic/passes/moderation-pass'
import { moderateIngestText } from '../moderation/moderate-ingest-text'

export type CreateBatchDeps = {
  importBatchesRepository: ImportBatchesRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
}

export type CreateBatchResult =
  | { ok: true; batch: DbImportBatch; resumed: boolean }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'blocked'; category: HardBlockCategory }

// Create (or resume) an import draft. Identity is the sha256 of the
// client-normalized markdown, per (user, target language): re-uploading the
// same text resumes the existing draft, and if that draft was already
// confirmed the caller routes to its study_session_id instead of showing a
// stale confirm screen. The batch insert and the extraction enqueue commit
// together — a batch can never sit in 'extracting' with no job to serve it.
export const createBatch = async (
  params: {
    userId: string
    targetLanguage: string
    sourceTitle: string
    rawText: string
    teacherProfileId: string | null
  },
  deps: CreateBatchDeps
): Promise<CreateBatchResult> => {
  const normalized = params.rawText.trim()
  if (normalized.length === 0) return { ok: false, reason: 'empty' }
  const inputHash = createHash('sha256').update(normalized).digest('hex')

  const existing = await deps.importBatchesRepository.findByHashForUser({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    inputHash,
  })
  if (existing) {
    // Resuming an existing draft is free — the quota below gates NEW drafts.
    // A resumed batch was normally checked at creation. NULL status means it
    // predates moderation or was created while the classifier failed open —
    // re-check so that gap can't be ridden forever; first verdict wins.
    if (existing.moderation_status === null) {
      const outcome = await moderateIngestText([params.sourceTitle, normalized].join('\n'), deps.anthropicPasses, {
        surface: 'lesson-import',
      })
      if (!outcome.allowed) return { ok: false, reason: 'blocked', category: outcome.category }
      if (outcome.status) {
        await deps.importBatchesRepository.backfillModeration(existing.id, {
          status: outcome.status,
          category: outcome.category,
        })
      }
    }
    return { ok: true, batch: existing, resumed: true }
  }

  // Guests are gated BEFORE the moderation call and the extraction enqueue —
  // drafts run LLM extraction before any source exists, so without this a
  // guest could queue unlimited extraction jobs while consuming zero library
  // slots. Both checks throw GuestSourceLimitError (mapped to the typed 403
  // by the error boundary): a full library means confirm would fail anyway,
  // and the pending-draft bound stops zero-slot spam.
  await assertGuestSourceQuota(params.userId)
  await assertGuestLessonBatchQuota(params.userId)

  // The title is user-authored too — moderate it with the body.
  const outcome = await moderateIngestText([params.sourceTitle, normalized].join('\n'), deps.anthropicPasses, {
    surface: 'lesson-import',
  })
  if (!outcome.allowed) return { ok: false, reason: 'blocked', category: outcome.category }

  const inserted = await beginTx(async (tx) => {
    const batch = await deps.importBatchesRepository.insertBatch(
      {
        userId: params.userId,
        targetLanguage: params.targetLanguage,
        teacherProfileId: params.teacherProfileId,
        sourceTitle: params.sourceTitle,
        rawText: normalized,
        inputHash,
        moderation: outcome.status ? { status: outcome.status, category: outcome.category } : null,
      },
      tx
    )
    if (batch) {
      await deps.processingJobsRepository.enqueueExtractLesson({ importBatchId: batch.id, userId: params.userId }, tx)
    }
    return batch
  })
  if (inserted) return { ok: true, batch: inserted, resumed: false }

  // Lost a concurrent-create race — the winner's batch is the resume target.
  const winner = await deps.importBatchesRepository.findByHashForUser({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    inputHash,
  })
  if (!winner) throw new Error('createBatch: insert conflicted but no existing batch found')
  return { ok: true, batch: winner, resumed: true }
}
