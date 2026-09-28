// Pure parsing of one kaikki record into its word-family facts: how the word
// is built (the structure line) and which words it derives from or relates to.
// Shared by the offline edge build (scripts/build-word-family.ts) and the
// gloss-time structure line, so both read the templates the same way. Kept
// free of workspace-package imports because the build script is a standalone
// tsx program. See docs/proposals/word-family-hints.md.

// U+0301 combining acute — the Russian stress mark kaikki puts on template
// components and form-of targets. NFC first so orthographic accents that
// arrive decomposed compose and survive the strip.
const stripStress = (s: string): string => s.normalize('NFC').replace(/́/g, '')

// A component prefixed with a language code (`la:cantāns`, `sla-pro:*tovarъ`)
// points at another language — never a same-language relative.
const FOREIGN_COMPONENT = /^[a-z][a-z-]*:/

// Etymology templates whose components describe how the word is built from
// same-language parts. Everything else (inh, bor, der, cog, clipping, blend…)
// is history or noise: clippings and blends are the main source of bogus
// links (en stab ← stabilizer).
const PARTS_TEMPLATES = new Set(['af', 'affix', 'surf', 'surface analysis', 'com', 'compound', 'afeq'])
const PREFIX_TEMPLATES = new Set(['pre', 'prefix'])
const SUFFIX_TEMPLATES = new Set(['suf', 'suffix'])
const CONFIX_TEMPLATES = new Set(['con', 'confix'])
const SOURCE_TEMPLATES = new Set(['deverbal', 'back-form', 'bf'])
// The unified {{ety}} template carries its own keyword segments; these are the
// structural ones (the rest — :inh, :bor, :der… — are skipped).
const ETY_STRUCTURAL_SEGMENTS = new Set([
  ...PARTS_TEMPLATES,
  ...PREFIX_TEMPLATES,
  ...SUFFIX_TEMPLATES,
  ...CONFIX_TEMPLATES,
  ...SOURCE_TEMPLATES,
])

export type FormOfKind = 'participle' | 'adverbial_participle' | 'gerund' | 'passive' | 'verbal_noun'

export type StructurePart = { text: string; isAffix: boolean }

export type ParsedWordFamily = {
  // Set when the entry is a participle / gerund / passive / verbal noun of
  // another word. Plain inflection form-of links are never followed: they are
  // homograph traps (de Schiene would inherit scheinen through subjunctive
  // schiene).
  formOf: { kind: FormOfKind; lemma: string } | null
  // The first structural template's components in order (за- + мёрзнуть). A
  // single non-affix part means "derived from" (deverbal / back-formation).
  parts: StructurePart[] | null
  // Every single-word, non-affix component across all structural templates,
  // plus the form-of target — the entry's direct ancestors, unfolded.
  parents: string[]
  // Single-word entries of the related/derived lists, unfolded.
  relatedWords: string[]
}

export type WordFamilyEntryData = {
  etymology_templates?: unknown
  senses?: unknown
  related?: unknown
  derived?: unknown
}

type RawTemplate = { name: string; args: Record<string, string> }

const asTemplates = (value: unknown): RawTemplate[] => {
  if (!Array.isArray(value)) return []
  const out: RawTemplate[] = []
  for (const t of value as Array<{ name?: unknown; args?: unknown }>) {
    if (typeof t?.name !== 'string' || !t.args || typeof t.args !== 'object') continue
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(t.args as Record<string, unknown>)) {
      if (typeof v === 'string') args[k] = v
    }
    out.push({ name: t.name, args })
  }
  return out
}

// Positional args from `from` until the first gap.
const positionalArgs = (args: Record<string, string>, from: number): string[] => {
  const out: string[] = []
  for (let i = from; args[String(i)] !== undefined; i++) out.push(args[String(i)])
  return out
}

// Where a template declares its language and components. Arg 1 is normally
// the language code; surface-analysis templates may lead with a `+directive`
// (`{{surf|+bf|ru|грецкий}}` — a back-formation), which shifts everything by
// one and names the real kind of derivation.
const readTemplate = (template: RawTemplate): { name: string; lang: string | undefined; components: string[] } => {
  const first = template.args['1']
  if ((template.name === 'surf' || template.name === 'surface analysis') && first?.startsWith('+')) {
    const directive = first.slice(1).trim()
    return {
      name: SOURCE_TEMPLATES.has(directive) ? directive : template.name,
      lang: template.args['2'],
      components: positionalArgs(template.args, 3),
    }
  }
  return { name: template.name, lang: first, components: positionalArgs(template.args, 2) }
}

// Inline modifiers (`Haus<t:house>`, `-ed<id:past participle>`, nested
// `<ety:…<…>>`) always follow the term, so everything from the first `<` goes.
// Returns null for empty or foreign-language components.
export const cleanComponent = (raw: string): string | null => {
  const cut = raw.indexOf('<')
  const text = stripStress((cut === -1 ? raw : raw.slice(0, cut)).trim())
  if (!text || FOREIGN_COMPONENT.test(text)) return null
  return text
}

const isAffixText = (text: string): boolean => text.startsWith('-') || text.endsWith('-')

const partsFromHyphenRule = (components: string[]): StructurePart[] =>
  components.flatMap((raw) => {
    const text = cleanComponent(raw)
    return text ? [{ text, isAffix: isAffixText(text) }] : []
  })

const asPrefix = (raw: string): StructurePart | null => {
  const text = cleanComponent(raw)
  return text ? { text: text.endsWith('-') ? text : `${text}-`, isAffix: true } : null
}

const asSuffix = (raw: string): StructurePart | null => {
  const text = cleanComponent(raw)
  return text ? { text: text.startsWith('-') ? text : `-${text}`, isAffix: true } : null
}

const asBase = (raw: string): StructurePart | null => {
  const text = cleanComponent(raw)
  return text ? { text, isAffix: false } : null
}

const compact = (parts: Array<StructurePart | null>): StructurePart[] =>
  parts.filter((p): p is StructurePart => p !== null)

// Parts of one named template (or {{ety}} segment) with the given components.
const partsForTemplate = (name: string, components: string[]): StructurePart[] | null => {
  if (components.length === 0) return null
  if (PARTS_TEMPLATES.has(name)) return partsFromHyphenRule(components)
  if (PREFIX_TEMPLATES.has(name)) {
    const [prefix, ...bases] = components
    return compact([asPrefix(prefix), ...bases.map(asBase)])
  }
  if (SUFFIX_TEMPLATES.has(name)) {
    const [base, ...suffixes] = components
    return compact([asBase(base), ...suffixes.map(asSuffix)])
  }
  if (CONFIX_TEMPLATES.has(name)) {
    if (components.length < 2) return null
    const prefix = components[0]
    const suffix = components[components.length - 1]
    return compact([asPrefix(prefix), ...components.slice(1, -1).map(asBase), asSuffix(suffix)])
  }
  if (SOURCE_TEMPLATES.has(name)) return compact([asBase(components[0])])
  return null
}

// {{ety}} args are `:keyword` markers each followed by that segment's
// components (`:af` скрипеть -ка). A keyword may carry modifiers
// (`:af<surf>`), which don't change the segment's kind.
const etySegments = (components: string[]): Array<{ name: string; components: string[] }> => {
  const out: Array<{ name: string; components: string[] }> = []
  for (const value of components) {
    if (value.startsWith(':')) {
      const cut = value.indexOf('<')
      out.push({ name: (cut === -1 ? value.slice(1) : value.slice(1, cut)).trim(), components: [] })
    } else if (out.length > 0) {
      out[out.length - 1].components.push(value)
    }
  }
  return out
}

// Templates describing another language are skipped: Russian etymologies
// embed ancestor-language breakdowns ({{af|sla-pro|*otъ-|*kryti}} before the
// Russian {{surf|ru|от-|крыть}}).
const structuresOf = (templates: RawTemplate[], targetLanguage: string): StructurePart[][] => {
  const out: StructurePart[][] = []
  for (const template of templates) {
    const { name, lang, components } = readTemplate(template)
    if (lang !== targetLanguage) continue
    if (name === 'ety') {
      for (const segment of etySegments(components)) {
        if (!ETY_STRUCTURAL_SEGMENTS.has(segment.name)) continue
        const parts = partsForTemplate(segment.name, segment.components)
        if (parts && parts.length > 0) out.push(parts)
      }
      continue
    }
    const parts = partsForTemplate(name, components)
    if (parts && parts.length > 0) out.push(parts)
  }
  return out
}

const formOfKindFromTags = (tags: unknown): FormOfKind | null => {
  if (!Array.isArray(tags)) return null
  const has = (tag: string) => tags.includes(tag)
  if (has('participle')) return has('adverbial') ? 'adverbial_participle' : 'participle'
  if (has('gerund')) return 'gerund'
  if (has('noun-from-verb') || has('nominalization')) return 'verbal_noun'
  if (has('passive')) return 'passive'
  return null
}

const formOfOf = (senses: unknown): ParsedWordFamily['formOf'] => {
  if (!Array.isArray(senses)) return null
  for (const sense of senses as Array<{ form_of?: unknown; tags?: unknown }>) {
    if (!Array.isArray(sense?.form_of) || sense.form_of.length === 0) continue
    const kind = formOfKindFromTags(sense.tags)
    if (!kind) continue
    const word = (sense.form_of[0] as { word?: unknown })?.word
    const lemma = typeof word === 'string' ? cleanComponent(word) : null
    if (lemma) return { kind, lemma }
  }
  return null
}

const isSingleWord = (text: string): boolean => !/\s/.test(text)

const relatedWordsOf = (data: WordFamilyEntryData): string[] => {
  const out = new Set<string>()
  for (const list of [data.related, data.derived]) {
    if (!Array.isArray(list)) continue
    for (const item of list as Array<{ word?: unknown }>) {
      if (typeof item?.word !== 'string') continue
      const word = stripStress(item.word.trim())
      if (word && isSingleWord(word)) out.add(word)
    }
  }
  return [...out]
}

export const parseWordFamily = (data: WordFamilyEntryData, targetLanguage: string): ParsedWordFamily => {
  const structures = structuresOf(asTemplates(data.etymology_templates), targetLanguage)
  const formOf = formOfOf(data.senses)
  const parents = new Set<string>()
  if (formOf && isSingleWord(formOf.lemma)) parents.add(formOf.lemma)
  for (const parts of structures) {
    for (const part of parts) {
      if (!part.isAffix && isSingleWord(part.text)) parents.add(part.text)
    }
  }
  return {
    formOf,
    parts: structures[0] ?? null,
    parents: [...parents],
    relatedWords: relatedWordsOf(data),
  }
}

// Affixes that say nothing about a word's meaning on their own: a bare
// `X + -ся` breakdown is suppressed unless an anchor makes the line useful.
const UNINFORMATIVE_AFFIXES: Record<string, ReadonlySet<string>> = {
  ru: new Set(['-ся', '-сь']),
}

// Whether the structure line teaches something by itself (without anchors).
export const isInformativeStructure = (
  structure: { formOf: ParsedWordFamily['formOf']; parts: StructurePart[] | null },
  targetLanguage: string
): boolean => {
  if (structure.formOf) return true
  const parts = structure.parts
  if (!parts || parts.length === 0) return false
  const bases = parts.filter((p) => !p.isAffix)
  if (bases.length === 0) return false
  // "derived from X" (deverbal, back-formation) or a compound of 2+ words.
  if (parts.length === 1 || bases.length >= 2) return true
  const trivial = UNINFORMATIVE_AFFIXES[targetLanguage]
  return parts.some((p) => p.isAffix && !trivial?.has(p.text))
}

// Related/derived lists mix real family members (рукав ~ рука) with synonyms
// and hypernyms (халат ~ одежда). A related word only counts when both words
// share a stem of at least 3 letters once a known prefix is removed from
// either (насквозь ~ сквозь). Inputs are folded (lowercase) strings;
// `prefixes` are folded prefix texts without the trailing hyphen.
const MIN_SHARED_STEM = 3

const stemVariants = (word: string, prefixes: readonly string[]): string[] => {
  const out = [word]
  for (const prefix of prefixes) {
    if (word.startsWith(prefix) && word.length - prefix.length >= MIN_SHARED_STEM) {
      out.push(word.slice(prefix.length))
    }
  }
  return out
}

const commonPrefixLength = (a: string, b: string): number => {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}

export const sharesStem = (a: string, b: string, prefixes: readonly string[]): boolean => {
  const aVariants = stemVariants(a, prefixes)
  const bVariants = stemVariants(b, prefixes)
  return aVariants.some((x) => bVariants.some((y) => commonPrefixLength(x, y) >= MIN_SHARED_STEM))
}
