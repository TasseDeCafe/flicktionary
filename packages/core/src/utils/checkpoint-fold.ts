// The checkpoint-review matching fold — TS twin of the SQL function
// `public.checkpoint_fold(input, lang)` created in the
// `20260718023224_checkpoint_fold_index.sql` migration. Applied to BOTH sides
// of every checkpoint match: content tokens / user headwords fold here, the
// wiktionary forms/headwords fold through the SQL function's expression
// indexes. The two implementations MUST stay byte-for-byte equivalent (same
// discipline as normalizeTargetForm's SQL twin); a SQL-vs-TS parity test in
// the backend enforces it over shared vectors — change both sides in lockstep
// or neither.
//
// Steps, in this exact order:
//   1. Unicode NFC normalization — canonical composition
//   2. strip combining acute U+0301 (Russian stress mark) — `стола́` → `стола`
//   3. trim surrounding whitespace
//   4. lowercase
//   5. per-language orthography fold: ru `ё`→`е`, de `ß`→`ss`
//
// NFC runs BEFORE the strip so orthographic acutes survive decomposed input:
// NFD `más` composes to precomposed `á` (no U+0301 left to strip) instead of
// folding to the different word `mas`. A U+0301 still present after NFC is by
// definition a mark with no precomposed form — a Russian-style stress mark —
// so stripping it is always safe.
export const foldCheckpointToken = (text: string, lang: string): string => {
  const base = text.normalize('NFC').replace(/́/g, '').trim().toLowerCase()
  if (lang === 'ru') return base.replace(/ё/g, 'е')
  if (lang === 'de') return base.replace(/ß/g, 'ss')
  return base
}

// user_lookups.headword is LLM-normalized and not guaranteed to equal the
// kaikki lemma (`to run` vs `run`, `sich freuen` vs `freuen`). Returns the
// folded headword plus per-language de-particled variants, deduped — every
// candidate is matched against the folded wiktionary side.
export const foldUserHeadwordCandidates = (headword: string, lang: string): string[] => {
  const folded = foldCheckpointToken(headword, lang)
  const candidates = [folded]
  if (lang === 'en' && folded.startsWith('to ')) candidates.push(folded.slice('to '.length))
  if (lang === 'de' && folded.startsWith('sich ')) candidates.push(folded.slice('sich '.length))
  return [...new Set(candidates.filter((c) => c.length > 0))]
}
