// Synthetic context blob stamped on every per-(user, language) adhoc session.
// Required to be non-empty: per-card chat (`buildPromptContext`) and
// "Generate full exploration" (`exploreCardIfMissing`) both refuse to run when
// `study_session.context_blob` is null. The wording is deliberately generic
// so it doesn't bias the LLM toward any particular topic, register, or genre.
export const ADHOC_CONTEXT_BLOB =
  'User-added vocabulary entries: standalone words and chunks the learner saved outside of any specific source (overheard in conversation, seen on the street, suggested by a teacher, etc.). Each chunk is a self-contained query — no surrounding narrative or recurring themes.'

// Title used for the synthetic content_source. Never surfaced in the Sessions
// list (filtered out at query time), but visible in DB inspection and any
// surface that happens to render the source title (e.g. card export columns
// when a chunk only exists in adhoc).
export const ADHOC_SOURCE_TITLE = 'Personal vocabulary'
