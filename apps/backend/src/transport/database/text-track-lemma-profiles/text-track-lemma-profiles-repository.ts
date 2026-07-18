import { beginTx, sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbTextTrackLemmaProfileRow = Tables<'text_track_lemma_profiles'>

export type ProfileRowInput = {
  foldedToken: string
  tokenCount: number
  // Deduplicated by the builder; the table CHECK rejects empty arrays.
  candidateLemmas: string[]
}

export type ReplaceProfileInput = {
  textTrackId: string
  rows: ProfileRowInput[]
  segmentCount: number
  maxSegmentIndex: number | null
  wordTokenCount: number
  matchedTokenCount: number
}

const INSERT_CHUNK = 1_000

// Idempotent whole-profile swap: delete + insert + bookkeeping stamp in one
// transaction, serialized per track by an advisory lock so two concurrent
// builders produce one coherent winner, never an interleaved mix.
const replaceProfile = async (input: ReplaceProfileInput): Promise<void> => {
  await beginTx(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`track_lemma_profile:${input.textTrackId}`}))`
    await tx`DELETE FROM public.text_track_lemma_profiles WHERE text_track_id = ${input.textTrackId}`
    for (let i = 0; i < input.rows.length; i += INSERT_CHUNK) {
      const chunk = input.rows.slice(i, i + INSERT_CHUNK).map((row) => ({
        text_track_id: input.textTrackId,
        folded_token: row.foldedToken,
        token_count: row.tokenCount,
        candidate_lemmas: row.candidateLemmas,
      }))
      await tx`INSERT INTO public.text_track_lemma_profiles ${tx(chunk)}`
    }
    await tx`
      UPDATE public.text_tracks
      SET profile_built_at = now(),
          profile_segment_count = ${input.segmentCount},
          profile_max_segment_index = ${input.maxSegmentIndex},
          profile_word_token_count = ${input.wordTokenCount},
          profile_matched_token_count = ${input.matchedTokenCount}
      WHERE id = ${input.textTrackId}
    `
  })
}

const listRowsByTrackId = async (textTrackId: string): Promise<DbTextTrackLemmaProfileRow[]> => {
  return (await sql`
    SELECT * FROM public.text_track_lemma_profiles
    WHERE text_track_id = ${textTrackId}
    ORDER BY folded_token
  `) as DbTextTrackLemmaProfileRow[]
}

export interface TextTrackLemmaProfilesRepositoryInterface {
  replaceProfile: (input: ReplaceProfileInput) => Promise<void>
  listRowsByTrackId: (textTrackId: string) => Promise<DbTextTrackLemmaProfileRow[]>
}

export const TextTrackLemmaProfilesRepository = (): TextTrackLemmaProfilesRepositoryInterface => {
  return {
    replaceProfile,
    listRowsByTrackId,
  }
}
