// Languages for which we have a kaikki dump loaded into wiktionary_entries /
// wiktionary_forms. Grounding is a no-op for any other language. Add languages
// here only after running `pnpm load:kaikki` for them and validating the
// extraction shape (head_templates structure varies by language).
export const KAIKKI_ENABLED_LANGUAGES: ReadonlySet<string> = new Set(['ru', 'en'])
