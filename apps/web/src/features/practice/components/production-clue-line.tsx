import { useLingui } from '@lingui/react/macro'
import type { ProductionClue, ProductionCluePart } from '../utils/card-word-family'

// The word-family Clue on a production front (#517): how the answer is built,
// in meanings only — "participle · prefix into a state + root to freeze (a
// word you know)". Never a spelling: the answer is the word itself.
export const ProductionClueLine = ({ clue }: { clue: ProductionClue }) => {
  const { t } = useLingui()

  const formOfLabel = (() => {
    switch (clue.formOfKind) {
      case 'participle':
        return t`participle`
      case 'adverbial_participle':
        return t`adverbial participle`
      case 'gerund':
        return t`gerund`
      case 'passive':
        return t`passive`
      case 'verbal_noun':
        return t`verbal noun`
      case null:
        return null
    }
  })()

  const roleLabel = (role: ProductionCluePart['role']) => {
    switch (role) {
      case 'prefix':
        return t`prefix`
      case 'root':
        return t`root`
      case 'suffix':
        return t`suffix`
    }
  }

  return (
    <p className='text-muted-foreground text-sm leading-snug'>
      {formOfLabel && (
        <>
          <span className='text-foreground/80'>{formOfLabel}</span>
          {' · '}
        </>
      )}
      {clue.parts.map((part, index) => (
        <span key={index}>
          {index > 0 && ' + '}
          <span className='text-xs tracking-wide uppercase'>{roleLabel(part.role)}</span>{' '}
          <span className='italic'>{part.meaning}</span>
          {part.anchor === 'known' && <span className='text-foreground/80'> {t`(a word you know)`}</span>}
          {part.anchor === 'saved' && <span className='text-foreground/80'> {t`(a word you saved)`}</span>}
        </span>
      ))}
    </p>
  )
}
