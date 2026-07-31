import postgres from 'postgres'
import { sql } from '../postgres-client'
import { getConfig } from '../../../config/environment-config'

export class GuestSourceLimitError extends Error {
  readonly limit: number

  constructor(limit: number) {
    super(`Guest accounts can add up to ${limit} content sources — create a free account to keep going`)
    this.name = 'GuestSourceLimitError'
    this.limit = limit
  }
}

// Wallet protection for anonymous accounts: a guest's LIBRARY is capped at
// maxSourcesPerGuest sources. The library is every non-adhoc source the guest
// holds a live (non-deleted) session on — the user-visible sessions list.
// Counting sessions rather than created rows means an abandoned wizard (a
// source row that never got a session) can't permanently burn a slot, and
// deleting any session frees its slot. Sources are still gated at creation
// (assertGuestSourceQuota) so a full library blocks new flows before any
// third-party cost, and at session attach (assertGuestSessionQuota) where
// globally-deduped movie/TV sources actually enter the library.
//
// is_anonymous is read from auth.users rather than the JWT claim on purpose:
// it covers surfaces that have no JWT at all (the Telegram bot acts for a
// paired userId), and it un-caps a converted guest the moment conversion
// lands, before their token refreshes.
//
// Adhoc sources are exempt (from both the gates and the count): they are
// auto-created plumbing — one per (user, language) behind word saves — not
// something the user "adds", and hitting the cap must never block saving a
// word.
//
// Concurrency: for anonymous users the asserts serialize on a per-user
// advisory lock BEFORE counting, so parallel requests can't all read a
// below-cap count and insert past it. pg_advisory_xact_lock holds until the
// surrounding transaction commits — call these inside the transaction that
// performs the insert (every creating call site does). Outside a transaction
// the lock is released immediately and the check degrades to best-effort.
type GuestQuotaState = {
  is_anonymous: boolean | null
  library_count: number
  already_in_library: boolean
}

const takeGuestQuotaLock = async (userId: string, db: postgres.Sql): Promise<void> => {
  await db`SELECT pg_advisory_xact_lock(hashtext(${`guest-source-quota:${userId}`}))`
}

const fetchGuestQuotaState = async (
  userId: string,
  contentSourceId: string | null,
  db: postgres.Sql
): Promise<GuestQuotaState | undefined> => {
  const rows = (await db`
    SELECT
      (SELECT u.is_anonymous FROM auth.users u WHERE u.id = ${userId}) AS is_anonymous,
      (
        SELECT count(DISTINCT s.content_source_id)::int
        FROM public.study_sessions s
        JOIN public.content_sources cs ON cs.id = s.content_source_id
        WHERE s.user_id = ${userId} AND s.deleted_at IS NULL AND cs.type <> 'adhoc'
      ) AS library_count,
      EXISTS (
        SELECT 1 FROM public.study_sessions s
        WHERE s.user_id = ${userId} AND s.content_source_id = ${contentSourceId} AND s.deleted_at IS NULL
      ) AS already_in_library
  `) as GuestQuotaState[]
  return rows[0]
}

const assertQuota = async (userId: string, contentSourceId: string | null, db: postgres.Sql): Promise<void> => {
  const limit = getConfig().maxSourcesPerGuest
  const quota = await fetchGuestQuotaState(userId, contentSourceId, db)
  if (!quota?.is_anonymous) return
  // Re-read under the per-user lock — only guests pay the serialization.
  await takeGuestQuotaLock(userId, db)
  const locked = await fetchGuestQuotaState(userId, contentSourceId, db)
  if (!locked?.is_anonymous) return
  if (locked.already_in_library) return
  if (locked.library_count >= limit) throw new GuestSourceLimitError(limit)
}

// Call inside the transaction that is about to INSERT a new content_sources
// row, on the branch that is about to create — reusing an existing source is
// not creation (it goes through assertGuestSessionQuota when a session is
// attached).
export const assertGuestSourceQuota = async (userId: string, db: postgres.Sql = sql): Promise<void> => {
  await assertQuota(userId, null, db)
}

// Call inside the transaction that attaches a session to an EXISTING source
// (studySessions.create, extension re-ingests): a source the guest already
// holds a live session on re-attaches freely; a new one takes a library slot.
export const assertGuestSessionQuota = async (
  userId: string,
  contentSourceId: string,
  db: postgres.Sql = sql
): Promise<void> => {
  await assertQuota(userId, contentSourceId, db)
}

// Lesson-import drafts run LLM extraction BEFORE any source exists, so
// library gating alone would let a guest queue unlimited extraction jobs
// without ever confirming. Guests are additionally bounded to
// maxSourcesPerGuest live (unexpired, unconfirmed) drafts; confirmed batches
// hand over to the library cap, expired and failed drafts free their slot via
// the draft TTL. Called before moderation/enqueue for NEW batches only —
// resuming an existing draft stays free.
export const assertGuestLessonBatchQuota = async (userId: string, db: postgres.Sql = sql): Promise<void> => {
  const limit = getConfig().maxSourcesPerGuest
  const rows = (await db`
    SELECT
      (SELECT u.is_anonymous FROM auth.users u WHERE u.id = ${userId}) AS is_anonymous,
      (
        SELECT count(*)::int FROM public.import_batches b
        WHERE b.user_id = ${userId}
          AND b.status IN ('extracting', 'ready')
          AND b.expires_at > now()
      ) AS pending_count
  `) as { is_anonymous: boolean | null; pending_count: number }[]
  const quota = rows[0]
  if (!quota?.is_anonymous) return
  if (quota.pending_count >= limit) throw new GuestSourceLimitError(limit)
}
