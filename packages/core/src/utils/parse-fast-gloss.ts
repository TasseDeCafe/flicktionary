// Decodes the serialized `highlights.fast_gloss` column (gloss\n[POS]\n[register])
// into the {gloss, pos, register} triple the gloss popovers render — shared by
// the web gloss sheet and the extension's subtitle-overlay popovers so a saved
// highlight shows its cached gloss instantly while the fastGloss refresh is in
// flight.

export const FAST_GLOSS_POS_ALIASES = new Set([
  'n',
  'noun',
  'v',
  'verb',
  'transitive verb',
  'intransitive verb',
  'phrasal verb',
  'modal verb',
  'adj',
  'adjective',
  'adv',
  'adverb',
  'prep',
  'preposition',
  'pron',
  'pronoun',
  'particle',
  'conj',
  'conjunction',
  'num',
  'numeral',
  'intj',
  'interjection',
])

const normalizeToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/\s+/g, ' ')

const isPos = (value: string): boolean => FAST_GLOSS_POS_ALIASES.has(normalizeToken(value))

export const parseFastGloss = (raw: string): { gloss: string; pos: string | null; register: string | null } => {
  const lines = raw.trim().split(/\r?\n/)
  const gloss = lines[0] ?? ''
  const metadata = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const first = metadata[0] ?? null
  const second = metadata[1] ?? null

  if (first && isPos(first)) return { gloss, pos: first, register: second }
  if (second && isPos(second)) return { gloss, pos: second, register: first }
  return { gloss, pos: null, register: first }
}
