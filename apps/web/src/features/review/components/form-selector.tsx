import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import { stripStressMarks } from '@flicktionary/core/utils/strip-stress-marks'
import type { Chunk, StudyFacetSummary } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { useDeleteFacet, useSetFacetEnabled } from '@/features/vocabulary/api/vocabulary-hooks'
import {
  buildLiveSkillItems,
  enabledSkillCount,
  formDisplay,
  formTargetFacet,
  formTargets,
  type FormAutoSetup,
  type LiveSkillKey,
  type SelectedTarget,
} from './study-target-helpers'

type FormSelectorProps = {
  chunk: Chunk
  facets: StudyFacetSummary[]
  candidateForms: string[]
  selectedTarget: SelectedTarget
  // Whether the term is kept (count > 0). Gates the last-skill lock — a kept
  // term must keep ≥1 enabled skill per target (backend floor guard).
  isKept: boolean
  onSelect: (target: SelectedTarget) => void
  // Picked a form + chose how to fill it: the focus view selects the form and
  // its inline editor runs the action (so the data loads on the main view).
  onSetupForm: (targetForm: string, action: FormAutoSetup['action']) => void
}

const isSelected = (selected: SelectedTarget, target: SelectedTarget): boolean =>
  selected.kind === 'citation'
    ? target.kind === 'citation'
    : target.kind === 'form' && target.targetForm === selected.targetForm

// The study-target picker: a row of chips (Citation + one per form + "Add a
// form") that selects which target the editor below edits, plus the selected
// target's skills (shown as a card with the enabled-skill chips, edited through
// a sheet). Chip selection is local navigation only — the editor reacts to the
// `selectedTarget` the parent owns.
export const FormSelector = ({
  chunk,
  facets,
  candidateForms,
  selectedTarget,
  isKept,
  onSelect,
  onSetupForm,
}: FormSelectorProps) => {
  const { t } = useLingui()
  const formFacets = formTargets(facets)
  // Derived from the facets (not chunk.isProductionEnabled) so the citation star
  // tracks the same source the skills card reads — and updates optimistically.
  const citationProductionOn = facets.some((f) => f.skill === 'meaning_production' && f.targetForm === '' && f.enabled)

  return (
    <section>
      <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Study targets`}</h2>
      <div className='flex flex-wrap gap-2'>
        <SelectorChip
          label={chunk.headword}
          selected={isSelected(selectedTarget, { kind: 'citation' })}
          dormant={enabledSkillCount(facets, '') === 0}
          showStar={citationProductionOn}
          onClick={() => onSelect({ kind: 'citation' })}
        />
        {formFacets.map((facet) => (
          <SelectorChip
            key={facet.targetForm}
            // Chips drop the Russian stress mark (the lemma chip is unstressed
            // too); the stressed form still shows in the FORM heading + editor.
            label={stripStressMarks(formDisplay(facet))}
            selected={isSelected(selectedTarget, { kind: 'form', targetForm: facet.targetForm })}
            dormant={enabledSkillCount(facets, facet.targetForm) === 0}
            pending={facet.dataStatus === 'pending_data'}
            showStar={facets.some(
              (f) => f.skill === 'meaning_production' && f.targetForm === facet.targetForm && f.enabled
            )}
            onClick={() => onSelect({ kind: 'form', targetForm: facet.targetForm })}
          />
        ))}
        <AddFormControl chunk={chunk} candidateForms={candidateForms} onSetupForm={onSetupForm} />
      </div>

      <SkillsCard
        chunk={chunk}
        facets={facets}
        selectedTarget={selectedTarget}
        isKept={isKept}
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

// "+ Add a form": full-width on mobile, an inline dashed chip on desktop. Opens
// a sheet that lists the surface forms you've encountered; picking one advances
// to a "Set up form" choice (Generate / Enter manually). The facet is created
// only when a choice is made — at which point the sheet closes, the new form
// becomes the active target, and the inline editor runs the chosen action so the
// data loads on the main view. Closing before choosing adds nothing.
const AddFormControl = ({
  chunk,
  candidateForms,
  onSetupForm,
}: {
  chunk: Chunk
  candidateForms: string[]
  onSetupForm: (targetForm: string, action: FormAutoSetup['action']) => void
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled } = useSetFacetEnabled()
  const [open, setOpen] = useState(false)
  // null while picking; the picked surface form once we're on the choice step.
  // No facet exists yet — it's created on the Generate / Enter-manually choice.
  const [setupForm, setSetupForm] = useState<string | null>(null)

  // Hide the trigger when there's nothing left to add — but keep the overlay
  // mounted while it's open (completing a setup empties candidateForms on
  // refetch, and returning null mid-flow would yank the open sheet out).
  if (candidateForms.length === 0 && !open) return null

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setSetupForm(null)
  }

  const choose = (action: FormAutoSetup['action']) => {
    if (!setupForm) return
    const targetForm = normalizeTargetForm(setupForm)
    // Create the recognition facet FIRST; only once it's persisted do we select
    // the form and hand the action to the focus view (which runs generate/manual
    // in the inline editor). Otherwise the follow-up mutation races the create
    // and hits a not-yet-existing facet, leaving the skeleton stuck forever.
    setFacetEnabled(
      {
        chunkId: chunk.id,
        skill: 'meaning_recognition',
        // Key normalized client-side too (the server re-normalizes); payload
        // keeps the full display form (stress/case intact).
        targetForm,
        enabled: true,
        payload: { form: setupForm },
      },
      { onSuccess: () => onSetupForm(targetForm, action) }
    )
    setOpen(false)
    setSetupForm(null)
  }

  return (
    <>
      <button
        type='button'
        aria-label={t`Add a form to study`}
        onClick={() => setOpen(true)}
        className='border-input bg-background hover:bg-accent inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm font-medium transition-colors sm:w-auto sm:justify-start sm:rounded-full sm:py-1'
      >
        <Plus className='h-3.5 w-3.5' />
        <span>{t`Add a form`}</span>
      </button>

      <ResponsiveOverlay open={open} onOpenChange={handleOpenChange}>
        <OverlayContent className='sm:max-w-md'>
          {setupForm ? (
            <>
              {/* pt-2 tightens the gap under the drawer grabber on mobile; the
                  desktop dialog header has no own padding (md:pt-0 keeps that). */}
              <OverlayHeader className='pt-2 md:pt-0'>
                <OverlayTitle className='flex items-center gap-2'>
                  {/* Negative margins keep the 44px tap target from inflating
                      the title row. */}
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t`Back to forms`}
                    onClick={() => setSetupForm(null)}
                    className='-my-2 -ml-2 shrink-0'
                  >
                    <ChevronLeft className='size-6 md:size-5' />
                  </Button>
                  {t`Set up form`}
                </OverlayTitle>
                <OverlayDescription className='sr-only'>{t`Choose how to fill this form's data.`}</OverlayDescription>
              </OverlayHeader>
              <div className='flex flex-col gap-4 px-4 pb-4'>
                <p className='text-lg font-semibold'>{setupForm}</p>
                <p className='text-muted-foreground text-sm'>{t`This form needs data before you can study it.`}</p>
                <div className='flex gap-2'>
                  <Button type='button' size='xl' className='flex-1' onClick={() => choose('generate')}>
                    <Sparkles className='mr-1 h-4 w-4' />
                    {t`Generate`}
                  </Button>
                  <Button type='button' size='xl' variant='outline' className='flex-1' onClick={() => choose('manual')}>
                    {t`Enter manually`}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <OverlayHeader className='pt-2 md:pt-0'>
                <OverlayTitle>{t`Add a form`}</OverlayTitle>
                <OverlayDescription>{t`Forms you've encountered`}</OverlayDescription>
              </OverlayHeader>
              <div className='flex flex-col gap-2 px-4 pb-4'>
                {candidateForms.map((form) => (
                  <OptionCard key={form} variant='navigation' title={form} onSelect={() => setSetupForm(form)} />
                ))}
              </div>
            </>
          )}
        </OverlayContent>
      </ResponsiveOverlay>
    </>
  )
}

type SkillItem = {
  key: string
  label: string
  hint?: string
  enabled: boolean
  available: boolean
  // The last enabled skill of a kept term — locked on (backend floor guard).
  locked: boolean
  toggle: () => void
}

// The selected target's skills, shown as a card with grey chips of what's
// enabled and a pencil that opens a sheet to edit them. A pending_data form has
// no skills to toggle yet (it isn't queued until its data is filled), so the
// card collapses to just a remove control.
const SkillsCard = ({
  chunk,
  facets,
  selectedTarget,
  isKept,
  onRemoved,
}: {
  chunk: Chunk
  facets: StudyFacetSummary[]
  selectedTarget: SelectedTarget
  isKept: boolean
  onRemoved: () => void
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending: busy } = useSetFacetEnabled()
  const [sheetOpen, setSheetOpen] = useState(false)

  const targetForm = selectedTarget.kind === 'form' ? selectedTarget.targetForm : ''
  // The form's content anchor (any skill — a form may lack a recognition facet).
  const repFacet = selectedTarget.kind === 'form' ? formTargetFacet(facets, targetForm) : null

  // A pending form has no skills until its data is filled (done in the editor
  // body / Add-a-form sheet), but it can still be removed.
  if (selectedTarget.kind === 'form' && repFacet?.dataStatus === 'pending_data') {
    return (
      <div className='mt-3'>
        <RemoveFormButton chunkId={chunk.id} facets={facets} targetForm={targetForm} onRemoved={onRemoved} />
      </div>
    )
  }

  const skillLabels: Record<LiveSkillKey, string> = {
    recognition: t`Recognition`,
    production: t`Production`,
    pronunciation: t`Pronunciation`,
  }
  const items: SkillItem[] = buildLiveSkillItems({
    chunk,
    facets,
    selectedTarget,
    isKept,
    setFacetEnabled,
    noIpaHint: t`No pronunciation data yet`,
  }).map((live) => ({
    key: live.key,
    label: skillLabels[live.key],
    hint: live.locked ? t`Keep at least one skill` : live.unavailableHint,
    enabled: live.enabled,
    available: live.available,
    locked: live.locked,
    toggle: live.toggle,
  }))

  const label = selectedTarget.kind === 'citation' ? chunk.headword : repFacet ? formDisplay(repFacet) : ''
  const enabledLabels = items.filter((i) => i.enabled).map((i) => i.label)

  return (
    <div className='mt-3 max-w-md'>
      <button
        type='button'
        onClick={() => setSheetOpen(true)}
        className={cn(
          'bg-card flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
          'border-border hover:border-foreground/40 hover:bg-accent/40 active:bg-accent/60'
        )}
      >
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t`Skills`}</span>
          {enabledLabels.length > 0 ? (
            <div className='-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {enabledLabels.map((skill) => (
                <span
                  key={skill}
                  className='bg-muted text-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs whitespace-nowrap'
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <span className='text-muted-foreground text-sm'>{t`No skills selected`}</span>
          )}
        </div>
        <div className='bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full'>
          <Pencil className='h-4 w-4' />
        </div>
      </button>

      <ResponsiveOverlay open={sheetOpen} onOpenChange={setSheetOpen}>
        <OverlayContent className='sm:max-w-md'>
          <OverlayHeader>
            <OverlayTitle>{t`Skills for ${label}`}</OverlayTitle>
            <OverlayDescription className='sr-only'>{t`Choose what to study for this target.`}</OverlayDescription>
          </OverlayHeader>
          <div className='flex flex-col gap-2 px-4 pb-4'>
            {items.map((item) => (
              <OptionCard
                key={item.key}
                indicator='checkbox'
                title={item.label}
                description={item.hint}
                selected={item.enabled}
                disabled={busy || !item.available || item.locked}
                onSelect={item.toggle}
              />
            ))}
          </div>
        </OverlayContent>
      </ResponsiveOverlay>

      {selectedTarget.kind === 'form' && (
        <div className='mt-2'>
          <RemoveFormButton chunkId={chunk.id} facets={facets} targetForm={targetForm} onRemoved={onRemoved} />
        </div>
      )}
    </div>
  )
}

// Hard-removes a whole form target: drops every facet sharing this target_form
// (recognition + production). The last delete's invalidation reconciles the
// chips; then the parent falls back to the citation editor. Rendered inline
// below the skills card whenever a form target is selected (ready or pending).
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
      className='text-destructive hover:text-destructive hover:bg-destructive/10 self-start'
      disabled={isPending}
      onClick={removeForm}
    >
      <Trash2 className='mr-1 h-4 w-4' />
      {t`Remove form`}
    </Button>
  )
}
