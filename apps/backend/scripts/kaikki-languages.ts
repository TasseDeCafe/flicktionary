// The languages the kaikki loader ingests and the verifier checks. Mirrors
// KAIKKI_LANGUAGES in packages/core/src/constants/language-grammar.ts —
// duplicated here so the scripts stay standalone tsx programs that don't
// import the app's workspace packages.
export const LOAD_LANGUAGES = ['ru', 'en', 'de', 'es', 'pt'] as const
