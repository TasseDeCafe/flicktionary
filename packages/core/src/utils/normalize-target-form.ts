// The KEY normalizer for study-facet target forms (Phase 4).
//
// A facet's identity is (user_lookup_id, skill, target_form); `target_form` is a
// free string (an inflected surface form like `стола`, `êtes`, `houses`), and
// distinct spellings of the SAME form must collapse to ONE key so they don't
// spawn duplicate facets. This is the function applied on EVERY target_form
// write path — form enable, payload edit, and the candidate-suggestion DISTINCT.
//
// It is NOT the display stress-stripper (Trap 21). `stripStressMarks` (in the
// flashcard view) strips combining stress for the *front render* but preserves
// case and display shape; this one LOWERCASES — keys must collapse case
// (`Houses`/`houses`), display must not. Keep the two separate.
//
// Steps, in this exact order (must stay byte-identical to the SQL twin in the
// Phase-4b migrate_study_form_to_form_facet migration):
//   1. strip combining acute U+0301 (Russian stress mark) — `стола́` → `стола`
//   2. Unicode NFC normalization — canonical composition
//   3. trim surrounding whitespace
//   4. lowercase (casefold)
// SQL twin: lower(trim(normalize(regexp_replace(form, '<U+0301>', '', 'g'), NFC)))
//
// Lowercasing is language-independent today, matching the Postgres `lower()` in
// the SQL twin. A `langCode` param for locale-aware casefolding (e.g. Turkish
// dotted/dotless i) is deferred to Phase 4b's form-write callers — add it there
// in lockstep with the SQL twin, never one side alone.
export const normalizeTargetForm = (text: string): string => text.replace(/́/g, '').normalize('NFC').trim().toLowerCase()
