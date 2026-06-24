import { useLingui } from '@lingui/react/macro'
import { Badge } from '@flicktionary/ui/components/badge'
import { getEffectiveGrammarFields } from '@flicktionary/core/constants/language-grammar'
import type { Grammar } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

const asString = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim().length > 0) return v
  return null
}

const isTruthyBool = (v: unknown): boolean => v === true

const renderGenderLabel = (gender: string): string => {
  switch (gender) {
    case 'm':
      return 'm.'
    case 'f':
      return 'f.'
    case 'n':
      return 'n.'
    case 'c':
      return 'c.'
    default:
      return gender
  }
}

const renderAspectLabel = (aspect: string): string => {
  switch (aspect) {
    case 'impf':
      return 'impf.'
    case 'perf':
      return 'perf.'
    case 'biaspectual':
      return 'biasp.'
    default:
      return aspect
  }
}

// Render POS as a full lowercased word so it doesn't collide visually with the
// gender chip (`n.` would mean "noun" here and "neuter" in the gender slot).
const renderPosLabel = (pos: string): string => pos.toLowerCase()

type Props = {
  grammar: Grammar | Record<string, unknown> | null | undefined
  targetLanguage?: string
}

// Compact pills surfaced near the headword so the highest-signal grammar
// facts (gender for surprising nouns, aspect + pair for verbs, government,
// plurale tantum, indeclinable) are glanceable. The full editable set lives
// in EditableGrammarPanel below.
export const GrammarChips = ({ grammar, targetLanguage }: Props) => {
  const { t } = useLingui()
  const g = (grammar ?? {}) as Record<string, unknown>

  const pos = asString(g.pos)
  const gender = asString(g.gender)
  const aspect = asString(g.aspect)
  const aspectPair = asString(g.aspect_pair_headword)
  const government = asString(g.government)
  const numberOnly = asString(g.number_only)
  const isIndeclinable = isTruthyBool(g.is_indeclinable)
  const isReflexive = isTruthyBool(g.is_reflexive)
  const isWeakNoun = isTruthyBool(g.is_weak_noun)
  const isSeparable = isTruthyBool(g.is_separable)
  const auxiliary = asString(g.auxiliary)

  // Narrow by language allowlist AND by POS — stray data on the wrong POS
  // (e.g. an aspect value accidentally left on an adjective by the LLM)
  // shouldn't surface as a chip even if the language config lists it.
  const allowed = getEffectiveGrammarFields(targetLanguage, pos)

  const chips: React.ReactNode[] = []

  if (pos && allowed.includes('pos')) {
    chips.push(
      <Badge key='pos' variant='outline' aria-label={t`Part of speech`}>
        {renderPosLabel(pos)}
      </Badge>
    )
  }
  if (gender && allowed.includes('gender')) {
    chips.push(
      <Badge key='gender' variant='secondary' aria-label={t`Gender`}>
        {renderGenderLabel(gender)}
      </Badge>
    )
  }
  if (aspect && allowed.includes('aspect')) {
    chips.push(
      <Badge key='aspect' variant='secondary' aria-label={t`Aspect`}>
        {renderAspectLabel(aspect)}
      </Badge>
    )
  }
  if (aspectPair && allowed.includes('aspect_pair_headword')) {
    chips.push(
      <Badge key='aspect_pair' variant='outline' aria-label={t`Aspect pair`}>
        ↔ {aspectPair}
      </Badge>
    )
  }
  if (government && allowed.includes('government')) {
    chips.push(
      <Badge key='government' variant='outline' aria-label={t`Government`}>
        {government}
      </Badge>
    )
  }
  if (allowed.includes('number_only')) {
    if (numberOnly === 'plurale_tantum') {
      chips.push(
        <Badge key='pl_tantum' variant='outline'>
          pl. tantum
        </Badge>
      )
    } else if (numberOnly === 'singulare_tantum') {
      chips.push(
        <Badge key='sg_tantum' variant='outline'>
          sg. tantum
        </Badge>
      )
    }
  }
  if (isIndeclinable && allowed.includes('is_indeclinable')) {
    chips.push(
      <Badge key='indecl' variant='outline'>
        indecl.
      </Badge>
    )
  }
  if (isReflexive && allowed.includes('is_reflexive')) {
    chips.push(
      <Badge key='refl' variant='outline'>
        refl.
      </Badge>
    )
  }
  if (isWeakNoun && allowed.includes('is_weak_noun')) {
    chips.push(
      <Badge key='weak' variant='outline' aria-label={t`Weak noun (n-declension)`}>
        weak
      </Badge>
    )
  }
  if (isSeparable && allowed.includes('is_separable')) {
    chips.push(
      <Badge key='sep' variant='outline' aria-label={t`Separable verb`}>
        sep.
      </Badge>
    )
  }
  // 'haben' is the default auxiliary and not worth a chip; surface only the
  // notable 'sein' and dual 'haben/sein'.
  if (auxiliary && auxiliary !== 'haben' && allowed.includes('auxiliary')) {
    chips.push(
      <Badge key='aux' variant='outline' aria-label={t`Perfect auxiliary`}>
        {auxiliary === 'haben_or_sein' ? 'aux haben/sein' : 'aux sein'}
      </Badge>
    )
  }

  if (chips.length === 0) return null

  return <div className='flex flex-wrap gap-1.5'>{chips}</div>
}
