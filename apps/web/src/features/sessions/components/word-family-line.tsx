import { useLingui } from '@lingui/react/macro'
import type { GlossWordFamily } from '@flicktionary/core/types/gloss-view-state'

type WordFamilyLineProps = {
  wordFamily: GlossWordFamily
}

// The gloss sheet's word-family line (docs/proposals/word-family-hints.md):
// how the tapped word is built — with what each part contributes once the
// word's insight is generated — then the relatives the reader already has and
// native-language cognates: "participle of замёрзнуть · за- into a state +
// мёрзнуть to freeze" / "You know: мороз · Saved: мёрзнуть" / "Looks like:
// dozen". Anchors are plain text, not tappable.
export const WordFamilyLine = ({ wordFamily }: WordFamilyLineProps) => {
  const { t } = useLingui()

  const formOfLabel = (() => {
    if (!wordFamily.formOf) return null
    const lemma = wordFamily.formOf.lemma
    switch (wordFamily.formOf.kind) {
      case 'participle':
        return t`participle of ${lemma}`
      case 'adverbial_participle':
        return t`adverbial participle of ${lemma}`
      case 'gerund':
        return t`gerund of ${lemma}`
      case 'passive':
        return t`passive of ${lemma}`
      case 'verbal_noun':
        return t`verbal noun of ${lemma}`
    }
  })()

  const parts = wordFamily.parts
  // A single non-affix part is a derivation source (deverbal, back-formation).
  const derivedFrom = parts && parts.length === 1 && !parts[0].isAffix ? parts[0] : null
  const derivedFromText = derivedFrom?.text ?? ''
  const partsNode = derivedFrom ? (
    <>
      {t`from ${derivedFromText}`}
      {derivedFrom.meaning && <PartMeaning meaning={derivedFrom.meaning} />}
    </>
  ) : parts ? (
    parts.map((part, index) => (
      <span key={index}>
        {index > 0 && ' + '}
        <span className='text-foreground/80'>{part.text}</span>
        {part.meaning && <PartMeaning meaning={part.meaning} />}
      </span>
    ))
  ) : null
  const hasStructure = !!formOfLabel || !!partsNode

  const knownList = wordFamily.anchors
    .filter((a) => a.source === 'known')
    .map((a) => a.lemma)
    .join(', ')
  const savedList = wordFamily.anchors
    .filter((a) => a.source === 'saved')
    .map((a) => a.lemma)
    .join(', ')
  const anchorLabels = [knownList ? t`You know: ${knownList}` : null, savedList ? t`Saved: ${savedList}` : null]
    .filter((s): s is string => !!s)
    .join(' · ')

  const cognateList = wordFamily.cognates.join(', ')

  if (!hasStructure && !anchorLabels && !cognateList) return null
  return (
    <div className='text-muted-foreground flex flex-col gap-0.5 text-sm leading-snug'>
      {hasStructure && (
        <p>
          {formOfLabel}
          {formOfLabel && partsNode && ' · '}
          {partsNode}
        </p>
      )}
      {anchorLabels && <p className='text-foreground/80'>{anchorLabels}</p>}
      {cognateList && <p>{t`Looks like: ${cognateList}`}</p>}
    </div>
  )
}

const PartMeaning = ({ meaning }: { meaning: string }) => <span className='ml-1 italic'>{meaning}</span>
