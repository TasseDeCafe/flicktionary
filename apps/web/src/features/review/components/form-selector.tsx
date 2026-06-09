import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import type { StudyFacetSummary } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { useDeleteFacet, useSetFacetEnabled } from '@/features/vocabulary/api/vocabulary-hooks'
import {
  enabledSkillCount,
  formDisplay,
  formRecognitionFacets,
  payloadString,
  type SelectedTarget,
  type StudyTargetsChunk,
} from './study-target-helpers'

type FormSelectorProps = {
  chunk: StudyTargetsChunk
  facets: StudyFacetSummary[]
  candidateForms: string[]
  selectedTarget: SelectedTarget
  onSelect: (target: SelectedTarget) => void
}

const isSelected = (selected: SelectedTarget, target: SelectedTarget): boolean =>
  selected.kind === 'citation'
    ? target.kind === 'citation'
    : target.kind === 'form' && target.targetForm === selected.targetForm

// The study-target picker: a row of chips (Citation + one per form + "Add a
// form") that selects which target the editor below edits, plus the selected
// target's skill toggles (inline on desktop, behind a pencil→sheet on mobile).
// Selection is local navigation only — no popover; the editor reacts to the
// `selectedTarget` the parent owns.
export const FormSelector = ({ chunk, facets, candidateForms, selectedTarget, onSelect }: FormSelectorProps) => {
  const { t } = useLingui()
  const formFacets = formRecognitionFacets(facets)

  return (
    <section>
      <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Study targets`}</h2>
      <div className='flex flex-wrap gap-2'>
        <SelectorChip
          label={chunk.headword}
          selected={isSelected(selectedTarget, { kind: 'citation' })}
          dormant={enabledSkillCount(facets, '') === 0}
          showStar={chunk.isProductionEnabled}
          onClick={() => onSelect({ kind: 'citation' })}
        />
        {formFacets.map((facet) => (
          <SelectorChip
            key={facet.targetForm}
            label={formDisplay(facet)}
            selected={isSelected(selectedTarget, { kind: 'form', targetForm: facet.targetForm })}
            dormant={enabledSkillCount(facets, facet.targetForm) === 0}
            pending={facet.dataStatus === 'pending_data'}
            showStar={facets.some(
              (f) => f.skill === 'meaning_production' && f.targetForm === facet.targetForm && f.enabled
            )}
            onClick={() => onSelect({ kind: 'form', targetForm: facet.targetForm })}
          />
        ))}
        <AddFormControl chunk={chunk} candidateForms={candidateForms} onAdded={onSelect} />
      </div>

      <SkillsForTarget
        chunk={chunk}
        facets={facets}
        selectedTarget={selectedTarget}
        onRemoved={() => onSelect({ kind: 'citation' })}
      />
    </section>
  )
}

type SelectorChipProps = {
  label: string
  selected: boolean
  dormant?: boolean
  pending?: boolean
  showStar?: boolean
  onClick: () => void
}

const SelectorChip = ({ label, selected, dormant, pending, showStar, onClick }: SelectorChipProps) => (
  <button
    type='button'
    onClick={onClick}
    aria-pressed={selected}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
      selected ? 'ring-primary ring-2 ring-offset-1' : '',
      pending
        ? 'border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
        : dormant
          ? 'border-input bg-muted text-muted-foreground hover:bg-accent'
          : 'border-input bg-background hover:bg-accent'
    )}
  >
    {showStar && <Star className='h-3.5 w-3.5' />}
    <span>{label}</span>
    {pending && <Sparkles className='h-3 w-3 opacity-70' />}
  </button>
)

// "+ Add a form": turns an encountered surface form into a pending_data
// recognition facet seeded with its display string, then auto-selects it so the
// editor opens on the new form's Generate / Enter-manually affordance.
const AddFormControl = ({
  chunk,
  candidateForms,
  onAdded,
}: {
  chunk: StudyTargetsChunk
  candidateForms: string[]
  onAdded: (target: SelectedTarget) => void
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending } = useSetFacetEnabled()
  const [open, setOpen] = useState(false)

  if (candidateForms.length === 0) return null

  const addForm = (surfaceForm: string) => {
    const targetForm = normalizeTargetForm(surfaceForm)
    setFacetEnabled(
      {
        chunkId: chunk.id,
        skill: 'meaning_recognition',
        // Key normalized client-side too (the server re-normalizes); payload
        // keeps the full display form (stress/case intact).
        targetForm,
        enabled: true,
        payload: { form: surfaceForm },
      },
      {
        onSuccess: () => {
          setOpen(false)
          onAdded({ kind: 'form', targetForm })
        },
      }
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={t`Add a form to study`}
          className='border-input bg-background hover:bg-accent inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-sm font-medium transition-colors'
        >
          <Plus className='h-3.5 w-3.5' />
          <span>{t`Add a form`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 p-2'>
        <p className='text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wide uppercase'>
          {t`Forms you've encountered`}
        </p>
        <div className='flex flex-col gap-1'>
          {candidateForms.map((form) => (
            <button
              key={form}
              type='button'
              disabled={isPending}
              onClick={() => addForm(form)}
              className='hover:bg-muted flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50'
            >
              <Plus className='h-3.5 w-3.5 opacity-70' />
              <span>{form}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// The selected target's skill toggles. Desktop renders them inline beneath the
// chips; mobile collapses them behind a pencil that opens a sheet with the same
// rows. A pending_data form has no skills to toggle yet (it isn't queued until
// its data is filled), so the panel is hidden until it's ready.
const SkillsForTarget = ({
  chunk,
  facets,
  selectedTarget,
  onRemoved,
}: {
  chunk: StudyTargetsChunk
  facets: StudyFacetSummary[]
  selectedTarget: SelectedTarget
  onRemoved: () => void
}) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  const targetForm = selectedTarget.kind === 'form' ? selectedTarget.targetForm : ''
  const recognitionFacet = facets.find((f) => f.skill === 'meaning_recognition' && f.targetForm === targetForm)
  // A form target that has no filled data yet has no skills to toggle (it isn't
  // queued until ready — its data is filled in the editor body below), but it
  // can still be removed before it's filled.
  if (selectedTarget.kind === 'form' && recognitionFacet?.dataStatus === 'pending_data') {
    return (
      <div className='mt-3'>
        <RemoveFormButton chunkId={chunk.id} facets={facets} targetForm={targetForm} onRemoved={onRemoved} />
      </div>
    )
  }

  const rows = <SkillRows chunk={chunk} facets={facets} selectedTarget={selectedTarget} onRemoved={onRemoved} />

  if (isMobile) {
    const label =
      selectedTarget.kind === 'citation' ? chunk.headword : recognitionFacet ? formDisplay(recognitionFacet) : ''
    return (
      <div className='mt-3'>
        <Button type='button' variant='outline' size='sm' onClick={() => setSheetOpen(true)}>
          <Pencil className='mr-1 h-4 w-4' />
          {t`Skills`}
        </Button>
        <ResponsiveOverlay open={sheetOpen} onOpenChange={setSheetOpen}>
          <OverlayContent>
            <OverlayHeader>
              <OverlayTitle>{t`Skills for ${label}`}</OverlayTitle>
              <OverlayDescription className='sr-only'>{t`Choose what to study for this target.`}</OverlayDescription>
            </OverlayHeader>
            <div className='px-2 pb-3'>{rows}</div>
          </OverlayContent>
        </ResponsiveOverlay>
      </div>
    )
  }

  return <div className='mt-3 max-w-sm'>{rows}</div>
}

const SkillRows = ({
  chunk,
  facets,
  selectedTarget,
  onRemoved,
}: {
  chunk: StudyTargetsChunk
  facets: StudyFacetSummary[]
  selectedTarget: SelectedTarget
  onRemoved: () => void
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending: busy } = useSetFacetEnabled()

  if (selectedTarget.kind === 'citation') {
    const recognitionOn = facets.some((f) => f.skill === 'meaning_recognition' && f.targetForm === '' && f.enabled)
    const productionOn = chunk.isProductionEnabled
    const ipaAvailable = hasDisplayableIpa((chunk.grammar?.ipa ?? null) as IpaBagShape | null, chunk.targetLanguage)
    const pronunciationOn = facets.some((f) => f.skill === 'pronunciation' && f.targetForm === '' && f.enabled)

    return (
      <div className='flex flex-col gap-1'>
        <SkillRow
          id='citation-recognition'
          label={t`Recognition`}
          checked={recognitionOn}
          disabled={busy}
          onCheckedChange={(next) =>
            setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm: '', enabled: next })
          }
        />
        <SkillRow
          id='citation-production'
          label={t`Production`}
          checked={productionOn}
          disabled={busy}
          onCheckedChange={(next) =>
            setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_production', targetForm: '', enabled: next })
          }
        />
        <SkillRow
          id='citation-pronunciation'
          label={t`Pronunciation`}
          hint={ipaAvailable ? undefined : t`No pronunciation data yet`}
          checked={pronunciationOn}
          disabled={busy || !ipaAvailable}
          onCheckedChange={
            ipaAvailable
              ? (next) => setFacetEnabled({ chunkId: chunk.id, skill: 'pronunciation', targetForm: '', enabled: next })
              : undefined
          }
        />
      </div>
    )
  }

  const targetForm = selectedTarget.targetForm
  const recognitionFacet = facets.find((f) => f.skill === 'meaning_recognition' && f.targetForm === targetForm)
  const productionFacet = facets.find((f) => f.skill === 'meaning_production' && f.targetForm === targetForm)
  const recognitionOn = !!recognitionFacet?.enabled
  const productionOn = !!productionFacet?.enabled
  const form = recognitionFacet ? formDisplay(recognitionFacet) : targetForm
  const translation = recognitionFacet ? payloadString(recognitionFacet.payload, 'translation') : ''

  return (
    <div className='flex flex-col gap-1'>
      <SkillRow
        id={`form-recognition-${targetForm}`}
        label={t`Recognition`}
        checked={recognitionOn}
        disabled={busy}
        onCheckedChange={(next) =>
          setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm, enabled: next })
        }
      />
      <SkillRow
        id={`form-production-${targetForm}`}
        label={t`Production`}
        checked={productionOn}
        disabled={busy}
        onCheckedChange={(next) =>
          // Reuse the form's known {form, translation} so the production facet is
          // born ready (the translation key signals "data provided").
          setFacetEnabled({
            chunkId: chunk.id,
            skill: 'meaning_production',
            targetForm,
            enabled: next,
            payload: next ? { form, translation } : undefined,
          })
        }
      />
      {/* Per-form pronunciation needs per-form stress/IPA the lemma grammar.ipa
          doesn't carry — roadmap. The IPA field itself is editable below. */}
      <SkillRow
        id={`form-pronunciation-${targetForm}`}
        label={t`Pronunciation`}
        hint={t`Per-form pronunciation coming soon`}
        checked={false}
        disabled
      />
      <RemoveFormButton chunkId={chunk.id} facets={facets} targetForm={targetForm} onRemoved={onRemoved} />
    </div>
  )
}

// Hard-removes a whole form target: drops every facet sharing this target_form
// (recognition + production). The last delete's invalidation reconciles the
// chips; then the parent falls back to the citation editor. Reused by both the
// ready-form skills panel and the pending-form (un-filled) editor area.
const RemoveFormButton = ({
  chunkId,
  facets,
  targetForm,
  onRemoved,
}: {
  chunkId: string
  facets: StudyFacetSummary[]
  targetForm: string
  onRemoved: () => void
}) => {
  const { t } = useLingui()
  const { mutate: deleteFacet, isPending } = useDeleteFacet()

  const removeForm = () => {
    const targetFacets = facets.filter((f) => f.targetForm === targetForm)
    targetFacets.forEach((f, i) =>
      deleteFacet(
        { chunkId, skill: f.skill, targetForm },
        i === targetFacets.length - 1 ? { onSuccess: onRemoved } : undefined
      )
    )
  }

  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='text-destructive hover:text-destructive hover:bg-destructive/10 mt-1 self-start'
      disabled={isPending}
      onClick={removeForm}
    >
      <Trash2 className='mr-1 h-4 w-4' />
      {t`Remove form`}
    </Button>
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
