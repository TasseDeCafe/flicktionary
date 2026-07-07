import { createHash } from 'crypto'
import { beginTx } from '../../transport/database/postgres-client'
import type {
  DbImportBatch,
  ImportBatchesRepositoryInterface,
} from '../../transport/database/import-batches/import-batches-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'

export type CreateBatchDeps = {
  importBatchesRepository: ImportBatchesRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

export type CreateBatchResult = { ok: true; batch: DbImportBatch; resumed: boolean } | { ok: false; reason: 'empty' }

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
  if (existing) return { ok: true, batch: existing, resumed: true }

  const inserted = await beginTx(async (tx) => {
    const batch = await deps.importBatchesRepository.insertBatch(
      {
        userId: params.userId,
        targetLanguage: params.targetLanguage,
        teacherProfileId: params.teacherProfileId,
        sourceTitle: params.sourceTitle,
        rawText: normalized,
        inputHash,
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
