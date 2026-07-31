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
// maxSourcesPerGuest sources. The library is every non-adhoc source they
// created plus every one they attached via a live session — the union matters
// because movie/TV sources are globally deduped, so "adding" a show another
// user already registered creates no row yet still queues per-session
// enrichment. Deleting a session frees the slot of a source the guest didn't
// create; created sources stay counted (their enrichment already ran).
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
type GuestQuotaState = {
  is_anonymous: boolean | null
  library_count: number
  already_in_library: boolean
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
        SELECT count(*)::int FROM (
          SELECT cs.id FROM public.content_sources cs
          WHERE cs.created_by_user_id = ${userId} AND cs.type <> 'adhoc'
          UNION
          SELECT s.content_source_id
          FROM public.study_sessions s
          JOIN public.content_sources scs ON scs.id = s.content_source_id
          WHERE s.user_id = ${userId} AND s.deleted_at IS NULL AND scs.type <> 'adhoc'
        ) AS library
      ) AS library_count,
      (
        EXISTS (
          SELECT 1 FROM public.content_sources cs
          WHERE cs.id = ${contentSourceId} AND cs.created_by_user_id = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM public.study_sessions s
          WHERE s.user_id = ${userId} AND s.content_source_id = ${contentSourceId} AND s.deleted_at IS NULL
        )
      ) AS already_in_library
  `) as GuestQuotaState[]
  return rows[0]
}

// Call immediately before INSERTing a new content_sources row, on the branch
// that is about to create — reusing an existing source is not creation and
// must not run this (it goes through assertGuestSessionQuota instead when a
// session is attached).
export const assertGuestSourceQuota = async (userId: string, db: postgres.Sql = sql): Promise<void> => {
  const limit = getConfig().maxSourcesPerGuest
  const quota = await fetchGuestQuotaState(userId, null, db)
  if (!quota?.is_anonymous) return
  if (quota.library_count >= limit) throw new GuestSourceLimitError(limit)
}

// Call before attaching a session to an EXISTING source (studySessions.create,
// where globally-deduped movie/TV rows land): a source already in the guest's
// library re-attaches freely; a new one takes a library slot.
export const assertGuestSessionQuota = async (
  userId: string,
  contentSourceId: string,
  db: postgres.Sql = sql
): Promise<void> => {
  const limit = getConfig().maxSourcesPerGuest
  const quota = await fetchGuestQuotaState(userId, contentSourceId, db)
  if (!quota?.is_anonymous) return
  if (quota.already_in_library) return
  if (quota.library_count >= limit) throw new GuestSourceLimitError(limit)
}
