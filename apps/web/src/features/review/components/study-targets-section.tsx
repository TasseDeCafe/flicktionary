import { useLingui } from '@lingui/react/macro'
import { Pencil, Star } from 'lucide-react'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { useSetFacetEnabled, useStudyTargets } from '@/features/vocabulary/api/vocabulary-hooks'

// Minimal slice of a chunk this control needs. `learningMode` is the wire's
// DERIVED flag: 'active' iff the citation meaning_production facet is enabled.
// `grammar`/`targetLanguage` gate the pronunciation row: that facet renders its
// back from grammar.ipa, so it's only offerable when an IPA is displayable.
type StudyTargetsChunk = {
  id: string
  headword: string
  learningMode: 'passive' | 'active'
  grammar: Record<string, unknown>
  targetLanguage: string
}

type StudyTargetsSectionProps = {
  chunk: StudyTargetsChunk
}

// One chip per study target. Phase 3 surfaces only the citation target
// (target_form='') with the two meaning skills; forms arrive in Phase 4, so the
// per-chip control is built to grow (more chips, more skills) without rework.
export const StudyTargetsSection = ({ chunk }: StudyTargetsSectionProps) => {
  const { t } = useLingui()

  return (
    <section>
      <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Study targets`}</h2>
      <div className='flex flex-wrap gap-2'>
        <CitationChip chunk={chunk} />
      </div>
    </section>
  )
}

const CitationChip = ({ chunk }: { chunk: StudyTargetsChunk }) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending } = useSetFacetEnabled()
  const { data: facets } = useStudyTargets(chunk.id)
  const productionOn = chunk.learningMode === 'active'
  const headword = chunk.headword

  // Pronunciation is a citation-only recognition facet (passive queue). It's
  // offerable only when the term has a displayable IPA — its card back is the
  // IPA, derived at render (Trap 12). Enabled state comes from the facet read.
  const ipaAvailable = hasDisplayableIpa((chunk.grammar?.ipa ?? null) as IpaBagShape | null, chunk.targetLanguage)
  const pronunciationOn = !!facets?.some((f) => f.skill === 'pronunciation' && f.targetForm === '' && f.enabled)

  const toggleProduction = (next: boolean) => {
    setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_production', targetForm: '', enabled: next })
  }

  const togglePronunciation = (next: boolean) => {
    setFacetEnabled({ chunkId: chunk.id, skill: 'pronunciation', targetForm: '', enabled: next })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={t`Edit study targets for ${headword}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
            productionOn
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-input bg-background hover:bg-accent'
          )}
        >
          {productionOn && <Star className='h-3.5 w-3.5' />}
          <span>{chunk.headword}</span>
          <Pencil className='h-3 w-3 opacity-70' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 p-2'>
        <p className='text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wide uppercase'>{t`Skills`}</p>
        <div className='flex flex-col gap-1'>
          {/* Recognition: created on keep, always-on for a kept term. Disabling
              it is a Phase-4+ capability, so it's locked checked here. */}
          <SkillRow id={`recognition-${chunk.id}`} label={t`Recognition`} hint={t`Always studied`} checked disabled />
          <SkillRow
            id={`production-${chunk.id}`}
            label={t`Production`}
            checked={productionOn}
            disabled={isPending}
            onCheckedChange={toggleProduction}
          />
          {/* Pronunciation (citation only): a passive-queue card drilling the
              headword's sound. Offerable only when an IPA is displayable; on a
              term with none it's greyed with a "needs data" hint. */}
          <SkillRow
            id={`pronunciation-${chunk.id}`}
            label={t`Pronunciation`}
            hint={ipaAvailable ? undefined : t`No pronunciation data yet`}
            checked={pronunciationOn}
            disabled={isPending || !ipaAvailable}
            onCheckedChange={ipaAvailable ? togglePronunciation : undefined}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

type SkillRowProps = {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange?: (next: boolean) => void
}

const SkillRow = ({ id, label, hint, checked, disabled, onCheckedChange }: SkillRowProps) => (
  <label
    htmlFor={id}
    className={cn(
      'hover:bg-muted flex items-start gap-2.5 rounded-sm px-2 py-1.5 transition-colors',
      disabled ? 'cursor-default' : 'cursor-pointer'
    )}
  >
    <Checkbox
      id={id}
      className='mt-0.5'
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange ? (value) => onCheckedChange(value === true) : undefined}
    />
    <span className='flex flex-col'>
      <span className='text-sm leading-none'>{label}</span>
      {hint && <span className='text-muted-foreground mt-1 text-xs'>{hint}</span>}
    </span>
  </label>
)
