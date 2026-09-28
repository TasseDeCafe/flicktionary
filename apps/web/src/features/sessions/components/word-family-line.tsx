import { useLingui } from '@lingui/react/macro'
import type { GlossWordFamily } from '@flicktionary/core/types/gloss-view-state'

type WordFamilyLineProps = {
  wordFamily: GlossWordFamily
}

// The gloss sheet's word-family line (docs/proposals/word-family-hints.md):
// how the tapped word is built, then the relatives the reader already has —
// "participle of замёрзнуть · за- + мёрзнуть" / "You know: мороз · Saved:
// мёрзнуть". Anchors are plain text, not tappable.
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
  const derivedFrom = parts && parts.length === 1 && !parts[0].isAffix ? parts[0].text : null
  const partsLabel = derivedFrom ? t`from ${derivedFrom}` : parts ? parts.map((p) => p.text).join(' + ') : null
  const structure = [formOfLabel, partsLabel].filter((s): s is string => !!s).join(' · ')

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

  if (!structure && !anchorLabels) return null
  return (
    <div className='text-muted-foreground flex flex-col gap-0.5 text-sm leading-snug'>
      {structure && <p>{structure}</p>}
      {anchorLabels && <p className='text-foreground/80'>{anchorLabels}</p>}
    </div>
  )
}
