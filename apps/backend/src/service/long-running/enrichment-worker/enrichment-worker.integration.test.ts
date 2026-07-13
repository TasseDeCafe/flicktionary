import { describe, expect, test, vi } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'
import { MockAnthropicPasses } from '../../../transport/third-party/anthropic/anthropic-passes'
import { buildProcessingDependencies } from '../../processing/processing-dependencies'
import {
  ProcessingJobsRepository,
  type DbProcessingJob,
  type ProcessingJobsRepositoryInterface,
} from '../../../transport/database/processing-jobs/processing-jobs-repository'
import { ImportBatchesRepository } from '../../../transport/database/import-batches/import-batches-repository'
import { sql } from '../../../transport/database/postgres-client'
import { createBatch } from '../../lesson-import/create-batch'
import { EnrichmentWorker } from './enrichment-worker'

// Drives one real job through the worker loop via tickOnce: claim → dispatch
// by kind (extract_lesson, with the LLM seam scripted) → markDone, and the
// job's side effects land (batch flipped to 'ready' with planned rows). The
// per-kind job logic has its own unit tests; this asserts the driver plumbing.
describe('enrichment-worker', () => {
  test('tickOnce claims a pending extract_lesson job, runs it, and marks it done', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const importBatchesRepository = ImportBatchesRepository()
    const jobsRepository = ProcessingJobsRepository()

    // Unique per run: batch identity is the content hash per (user, language)
    // and the test DB never resets.
    const rawText = `der Tisch — the table (${userId})`
    const created = await createBatch(
      { userId, targetLanguage: 'de', sourceTitle: 'Lesson notes', rawText, teacherProfileId: null },
      { importBatchesRepository, processingJobsRepository: jobsRepository }
    )
    if (!created.ok) throw new Error('createBatch failed')
    const batchId = created.batch.id
    expect(created.batch.status).toBe('extracting')

    // The claim scoped to this batch: same shape as the repository's
    // claimBatch (lease + attempts bump), narrowed so a tick in the shared,
    // never-reset test DB cannot claim other tests' jobs (their passes aren't
    // scripted here, and failing them would corrupt concurrent tests).
    const scopedJobsRepository: ProcessingJobsRepositoryInterface = {
      ...jobsRepository,
      claimBatch: async (limit, workerId) =>
        (await sql`
          WITH claimed AS (
            SELECT id FROM public.processing_jobs
            WHERE status = 'pending' AND run_after <= now() AND import_batch_id = ${batchId}
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE public.processing_jobs j
          SET status = 'processing',
              locked_at = now(),
              locked_by = ${workerId},
              attempts = attempts + 1,
              updated_at = now()
          FROM claimed
          WHERE j.id = claimed.id
          RETURNING j.*
        `) as DbProcessingJob[],
    }

    const extractLessonPass = vi.fn().mockResolvedValue({
      lessonDate: '2026-07-10',
      formatProfile: 'Two-column vocab table',
      rows: [
        {
          sourceText: 'der Tisch — the table',
          type: 'vocab',
          headword: 'Tisch',
          targetForm: null,
          context: 'der Tisch — the table',
          wrongForm: null,
          stressMark: null,
          proposedFacets: ['recognition'],
          confidence: 0.95,
        },
        {
          sourceText: 'Great progress!',
          type: 'win',
          headword: '',
          targetForm: null,
          context: '',
          wrongForm: null,
          stressMark: null,
          proposedFacets: [],
          confidence: 0.9,
        },
      ],
    })

    const worker = EnrichmentWorker(scopedJobsRepository, {
      ...buildProcessingDependencies(),
      anthropicPasses: MockAnthropicPasses({ extractLessonPass: extractLessonPass as never }),
    })

    await worker.tickOnce()

    expect(extractLessonPass).toHaveBeenCalledTimes(1)

    const [job] = (await sql`
      SELECT status FROM public.processing_jobs WHERE import_batch_id = ${batchId}
    `) as Array<{ status: string }>
    expect(job.status).toBe('done')

    const batch = await importBatchesRepository.findById(batchId)
    expect(batch?.status).toBe('ready')
    expect(batch?.format_profile).toBe('Two-column vocab table')

    const rows = await importBatchesRepository.listRows(batchId)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.planned_action)).toEqual(['create', 'skip'])
  })
})
