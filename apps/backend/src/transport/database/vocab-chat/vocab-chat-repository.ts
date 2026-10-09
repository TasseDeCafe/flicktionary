import type postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import type { Database, Tables } from '../database.public.types'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { DbStudySession, DbTextTrack } from '../study-sessions/study-sessions-repository'

export type DbVocabChatMessage = Tables<'vocab_chat_messages'>
export type VocabChatRole = Database['public']['Enums']['card_chat_role']

// Shape of vocab_chat_messages.proposal. highlightId is set once the item was
// added; the card itself is created by the enrichment pipeline from that
// highlight.
export type VocabChatProposalItem = {
  headword: string
  note: string
  example: string
  // The learner's saved senses of the headword when it was proposed, so the
  // model can tell a saved word from a homograph they don't have yet: null =
  // not saved, [] = saved without a sense label. Model-facing only; the rows
  // ask captureMatches fresh.
  savedSenses: string[] | null
  highlightId: string | null
}
export type VocabChatProposal = { items: VocabChatProposalItem[] }

// Shape of vocab_chat_messages.new_thread_suggestion.
export type VocabChatNewThreadSuggestion = { language: string; message: string }

export type VocabChatThread = {
  session: DbStudySession
  contentSourceId: string
  title: string
}

// Every thread is its own source -> track -> session chain, like a lesson
// import. The context blob is static and non-empty so the enrichment pipeline,
// per-card chat, and on-demand exploration never try to summarize the track
// (its lines are independent example sentences, not a narrative).
const createThread = async (params: {
  userId: string
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  title: string
}): Promise<VocabChatThread> =>
  beginTx(async (tx) => {
    const insertedSource = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('chat', ${params.title}, ${params.targetLanguage}, '{}'::jsonb, ${params.userId})
      RETURNING *
    `) as Tables<'content_sources'>[]
    const contentSource = insertedSource[0]
    if (!contentSource) throw new Error('createThread: content source insert returned no row')

    // The hash only has to be unique per (source, language); a fresh source
    // never collides, so its id doubles as the hash.
    const insertedTrack = (await tx`
      INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
      VALUES (${contentSource.id}, 'paste', ${params.targetLanguage}, NULL, ${contentSource.id})
      RETURNING *
    `) as DbTextTrack[]
    const track = insertedTrack[0]
    if (!track) throw new Error('createThread: track insert returned no row')

    const contextBlob = `Vocabulary collected in a chat between the learner and an assistant about ${getLanguageName(params.targetLanguage)}. Each line is an independent example sentence for one term the learner chose to study — there is no surrounding narrative.`

    const insertedSession = (await tx`
      INSERT INTO public.study_sessions (
        user_id, content_source_id, text_track_id,
        native_language, target_language, cefr_level, context_blob
      )
      VALUES (
        ${params.userId}, ${contentSource.id}, ${track.id},
        ${params.nativeLanguage}, ${params.targetLanguage}, ${params.cefrLevel}, ${contextBlob}
      )
      RETURNING *
    `) as DbStudySession[]
    const session = insertedSession[0]
    if (!session) throw new Error('createThread: session insert returned no row')

    return { session, contentSourceId: contentSource.id, title: contentSource.title }
  })

// Rolls back a thread whose first turn failed, so a failed start doesn't
// leave an empty chat in the Sessions list. Only ever called before any
// message or card exists.
const deleteEmptyThread = async (thread: VocabChatThread): Promise<void> => {
  await beginTx(async (tx) => {
    await tx`DELETE FROM public.study_sessions WHERE id = ${thread.session.id}`
    await tx`DELETE FROM public.content_sources WHERE id = ${thread.contentSourceId} AND type = 'chat'`
  })
}

const findThreadForUser = async (sessionId: string, userId: string): Promise<VocabChatThread | null> => {
  const rows = (await sql`
    SELECT s.*, cs.title AS content_source_title
    FROM public.study_sessions s
    JOIN public.content_sources cs ON cs.id = s.content_source_id
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.deleted_at IS NULL AND cs.type = 'chat'
  `) as Array<DbStudySession & { content_source_title: string }>
  const row = rows[0]
  if (!row) return null
  const { content_source_title, ...session } = row
  return { session, contentSourceId: session.content_source_id, title: content_source_title }
}

const setTitle = async (contentSourceId: string, title: string): Promise<void> => {
  await sql`UPDATE public.content_sources SET title = ${title} WHERE id = ${contentSourceId} AND type = 'chat'`
}

const insertMessage = async (params: {
  // Assistant turns pre-generate their id so the model can reference the
  // proposal (proposal_id) before the row exists.
  id?: string
  sessionId: string
  role: VocabChatRole
  content: string
  proposal?: VocabChatProposal | null
  newThreadSuggestion?: VocabChatNewThreadSuggestion | null
}): Promise<DbVocabChatMessage> => {
  const proposal = params.proposal ? sql.json(params.proposal as unknown as postgres.JSONValue) : null
  const suggestion = params.newThreadSuggestion
    ? sql.json(params.newThreadSuggestion as unknown as postgres.JSONValue)
    : null
  const result = (await sql`
    INSERT INTO public.vocab_chat_messages (id, study_session_id, role, content, proposal, new_thread_suggestion)
    VALUES (
      ${params.id ?? sql`extensions.uuid_generate_v4()`},
      ${params.sessionId}, ${params.role}, ${params.content}, ${proposal}, ${suggestion}
    )
    RETURNING *
  `) as DbVocabChatMessage[]
  return result[0]!
}

const listMessages = async (sessionId: string): Promise<DbVocabChatMessage[]> =>
  (await sql`
    SELECT * FROM public.vocab_chat_messages
    WHERE study_session_id = ${sessionId}
    ORDER BY created_at ASC
  `) as DbVocabChatMessage[]

// Locks the message row so two concurrent adds of the same proposal can't both
// see an item as not-yet-added.
const lockMessageForUpdate = async (
  messageId: string,
  sessionId: string,
  tx: postgres.Sql
): Promise<DbVocabChatMessage | null> => {
  const rows = (await tx`
    SELECT * FROM public.vocab_chat_messages
    WHERE id = ${messageId} AND study_session_id = ${sessionId}
    FOR UPDATE
  `) as DbVocabChatMessage[]
  return rows[0] ?? null
}

const setProposal = async (messageId: string, proposal: VocabChatProposal, tx: postgres.Sql): Promise<void> => {
  await tx`UPDATE public.vocab_chat_messages SET proposal = ${tx.json(proposal as unknown as postgres.JSONValue)} WHERE id = ${messageId}`
}

// Where an added proposal item stands: its enrichment job still running or
// failed, or done with a live, kept term (and the card the row opens). A
// highlight missing from the map is gone: its term was deleted or unkept, or
// the job finished without a card.
export type ProposalAdd = {
  state: 'pending' | 'failed' | 'added'
  card: { userLookupId: string; cardId: string; sessionId: string } | null
}

const resolveProposalAdds = async (
  params: { userId: string; highlightIds: string[] },
  executor: postgres.Sql = sql
): Promise<Map<string, ProposalAdd>> => {
  if (params.highlightIds.length === 0) return new Map()
  const rows = (await executor`
    SELECT h.id AS highlight_id, card.card_id, card.study_session_id, card.user_lookup_id, job.status AS job_status
    FROM public.highlights h
    JOIN public.study_sessions s ON s.id = h.study_session_id AND s.user_id = ${params.userId}
    LEFT JOIN LATERAL (
      SELECT c.id AS card_id, c.study_session_id, ul.id AS user_lookup_id
      FROM public.cards c
      JOIN public.user_lookups ul ON ul.id = c.user_lookup_id
      WHERE c.highlight_id = h.id AND ul.count > 0 AND ul.deleted_at IS NULL AND c.status = 'kept'
      ORDER BY c.created_at ASC
      LIMIT 1
    ) card ON true
    LEFT JOIN LATERAL (
      SELECT j.status FROM public.processing_jobs j
      WHERE j.highlight_id = h.id AND j.kind = 'enrich_highlight'
      ORDER BY j.created_at DESC
      LIMIT 1
    ) job ON true
    WHERE h.id = ANY(${params.highlightIds}::uuid[])
  `) as Array<{
    highlight_id: string
    card_id: string | null
    study_session_id: string | null
    user_lookup_id: string | null
    job_status: string | null
  }>
  const adds = new Map<string, ProposalAdd>()
  for (const row of rows) {
    if (row.card_id && row.study_session_id && row.user_lookup_id) {
      adds.set(row.highlight_id, {
        state: 'added',
        card: { userLookupId: row.user_lookup_id, cardId: row.card_id, sessionId: row.study_session_id },
      })
    } else if (row.job_status === 'failed') {
      adds.set(row.highlight_id, { state: 'failed', card: null })
    } else if (row.job_status !== null && row.job_status !== 'done') {
      adds.set(row.highlight_id, { state: 'pending', card: null })
    }
  }
  return adds
}

export type VocabChatRepositoryInterface = {
  createThread: typeof createThread
  deleteEmptyThread: typeof deleteEmptyThread
  findThreadForUser: typeof findThreadForUser
  setTitle: typeof setTitle
  insertMessage: typeof insertMessage
  listMessages: typeof listMessages
  lockMessageForUpdate: typeof lockMessageForUpdate
  setProposal: typeof setProposal
  resolveProposalAdds: typeof resolveProposalAdds
}

export const VocabChatRepository = (): VocabChatRepositoryInterface => ({
  createThread,
  deleteEmptyThread,
  findThreadForUser,
  setTitle,
  insertMessage,
  listMessages,
  lockMessageForUpdate,
  setProposal,
  resolveProposalAdds,
})
