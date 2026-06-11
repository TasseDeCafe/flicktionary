import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
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
  enabledSkillCount,
  formDisplay,
  formRecognitionFacets,
  payloadString,
  type FormAutoSetup,
  type SelectedTarget,
} from './study-target-helpers'

type FormSelectorProps = {
  chunk: Chunk
  facets: StudyFacetSummary[]
  candidateForms: string[]
  selectedTarget: SelectedTarget
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
  onSelect,
  onSetupForm,
}: FormSelectorProps) => {
  const { t } = useLingui()
  const formFacets = formRecognitionFacets(facets)
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
        <AddFormControl chunk={chunk} candidateForms={candidateForms} onSetupForm={onSetupForm} />
      </div>

      <SkillsCard
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
              <OverlayHeader>
                <OverlayTitle className='flex items-center gap-2'>
                  <button
                    type='button'
                    aria-label={t`Back to forms`}
                    onClick={() => setSetupForm(null)}
                    className='hover:bg-accent -ml-1 rounded-md p-1 transition-colors'
                  >
                    <ChevronLeft className='h-5 w-5' />
                  </button>
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
              <OverlayHeader>
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
  onRemoved,
}: {
  chunk: Chunk
  facets: StudyFacetSummary[]
  selectedTarget: SelectedTarget
  onRemoved: () => void
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending: busy } = useSetFacetEnabled()
  const [sheetOpen, setSheetOpen] = useState(false)

  const targetForm = selectedTarget.kind === 'form' ? selectedTarget.targetForm : ''
  const recognitionFacet = facets.find((f) => f.skill === 'meaning_recognition' && f.targetForm === targetForm)

  // A pending form has no skills until its data is filled (done in the editor
  // body / Add-a-form sheet), but it can still be removed.
  if (selectedTarget.kind === 'form' && recognitionFacet?.dataStatus === 'pending_data') {
    return (
      <div className='mt-3'>
        <RemoveFormButton chunkId={chunk.id} facets={facets} targetForm={targetForm} onRemoved={onRemoved} />
      </div>
    )
  }

  let items: SkillItem[]
  if (selectedTarget.kind === 'citation') {
    const ipaAvailable = hasDisplayableIpa((chunk.grammar?.ipa ?? null) as IpaBagShape | null, chunk.targetLanguage)
    items = [
      {
        key: 'recognition',
        label: t`Recognition`,
        enabled: facets.some((f) => f.skill === 'meaning_recognition' && f.targetForm === '' && f.enabled),
        available: true,
        toggle: () => {},
      },
      {
        key: 'production',
        label: t`Production`,
        enabled: facets.some((f) => f.skill === 'meaning_production' && f.targetForm === '' && f.enabled),
        available: true,
        toggle: () => {},
      },
      {
        key: 'pronunciation',
        label: t`Pronunciation`,
        hint: ipaAvailable ? undefined : t`No pronunciation data yet`,
        enabled: facets.some((f) => f.skill === 'pronunciation' && f.targetForm === '' && f.enabled),
        available: ipaAvailable,
        toggle: () => {},
      },
    ]
    items[0]!.toggle = () =>
      setFacetEnabled({
        chunkId: chunk.id,
        skill: 'meaning_recognition',
        targetForm: '',
        enabled: !items[0]!.enabled,
      })
    items[1]!.toggle = () =>
      setFacetEnabled({
        chunkId: chunk.id,
        skill: 'meaning_production',
        targetForm: '',
        enabled: !items[1]!.enabled,
      })
    items[2]!.toggle = () =>
      setFacetEnabled({
        chunkId: chunk.id,
        skill: 'pronunciation',
        targetForm: '',
        enabled: !items[2]!.enabled,
      })
  } else {
    const productionFacet = facets.find((f) => f.skill === 'meaning_production' && f.targetForm === targetForm)
    const pronunciationFacet = facets.find((f) => f.skill === 'pronunciation' && f.targetForm === targetForm)
    const recognitionOn = !!recognitionFacet?.enabled
    const productionOn = !!productionFacet?.enabled
    const pronunciationOn = !!pronunciationFacet?.enabled
    const form = recognitionFacet ? formDisplay(recognitionFacet) : targetForm
    const translation = recognitionFacet ? payloadString(recognitionFacet.payload, 'translation') : ''
    // A sibling facet whose payload already carries the form's own IPA: enabling
    // pronunciation with that payload makes the facet born ready (no
    // regeneration). Without one, send only {form} so it's born pending_data and
    // the existing generate/retry chip fills it.
    const ipaSibling = [recognitionFacet, productionFacet].find((f) => {
      const grammar = f?.payload.grammar
      const ipa =
        grammar && typeof grammar === 'object'
          ? (((grammar as Record<string, unknown>).ipa ?? null) as IpaBagShape | null)
          : null
      return hasDisplayableIpa(ipa, chunk.targetLanguage)
    })
    items = [
      {
        key: 'recognition',
        label: t`Recognition`,
        enabled: recognitionOn,
        available: true,
        toggle: () =>
          setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm, enabled: !recognitionOn }),
      },
      {
        key: 'production',
        label: t`Production`,
        enabled: productionOn,
        available: true,
        toggle: () =>
          // Reuse the form's known {form, translation} so the production facet is
          // born ready (the translation key signals "data provided").
          setFacetEnabled({
            chunkId: chunk.id,
            skill: 'meaning_production',
            targetForm,
            enabled: !productionOn,
            payload: !productionOn ? { form, translation } : undefined,
          }),
      },
      {
        key: 'pronunciation',
        label: t`Pronunciation`,
        enabled: pronunciationOn,
        available: true,
        toggle: () =>
          setFacetEnabled({
            chunkId: chunk.id,
            skill: 'pronunciation',
            targetForm,
            enabled: !pronunciationOn,
            payload: !pronunciationOn ? (ipaSibling ? ipaSibling.payload : { form }) : undefined,
          }),
      },
    ]
  }

  const label =
    selectedTarget.kind === 'citation' ? chunk.headword : recognitionFacet ? formDisplay(recognitionFacet) : ''
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
                disabled={busy || !item.available}
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
