// Decodes the fast-gloss text shape (gloss\n[POS]\n[register]) into the
// {gloss, pos, register} triple. One parser for every reader of that shape: the
// backend's fast-gloss pass (Haiku's raw output) and highlight router (the
// serialized `highlights.fast_gloss` column), plus the web gloss sheet and the
// extension's subtitle-overlay popovers, which render a saved highlight's
// cached gloss instantly while the fastGloss refresh is in flight.

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

// Opening → closing marks across the scripts we gloss (English, German „…“ and
// „…”, Russian/French «…», reversed »…«, CJK 「…」).
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['„', '“'],
  ['„', '”'],
  ['«', '»'],
  ['»', '«'],
  ['‘', '’'],
  ['‚', '‘'],
  ["'", "'"],
  ['「', '」'],
]

// When the selection itself is quoted («…» in a subtitle line), the model
// echoes the quotes around the whole gloss. Only a single wrapping pair is
// removed: an inner occurrence of either mark (`"yes" or "no"`, `'til` …) means
// the quotes belong to the content, so the gloss is left as is.
const stripWrappingQuotes = (gloss: string): string => {
  const trimmed = gloss.trim()
  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.length < open.length + close.length + 1) continue
    if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) continue
    const inner = trimmed.slice(open.length, trimmed.length - close.length)
    if (inner.includes(open) || inner.includes(close)) continue
    return inner.trim()
  }
  return trimmed
}

export const parseFastGloss = (raw: string): { gloss: string; pos: string | null; register: string | null } => {
  const lines = raw.trim().split(/\r?\n/)
  const gloss = stripWrappingQuotes(lines[0] ?? '')
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
