import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Loader2, Pencil, Plus, Sparkles, Star } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import type { StudyFacetSummary } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  useGenerateFacetData,
  useSetFacetEnabled,
  useSetFacetPayload,
  useStudyTargets,
} from '@/features/vocabulary/api/vocabulary-hooks'

// Minimal slice of a chunk this control needs. `isProductionEnabled` is the
// wire's DERIVED flag: true iff the citation meaning_production facet is enabled.
// `grammar`/`targetLanguage` gate the pronunciation row: that facet renders its
// back from grammar.ipa, so it's only offerable when an IPA is displayable.
type StudyTargetsChunk = {
  id: string
  headword: string
  isProductionEnabled: boolean
  grammar: Record<string, unknown>
  targetLanguage: string
}

type StudyTargetsSectionProps = {
  chunk: StudyTargetsChunk
}

const formOf = (facet: StudyFacetSummary): string =>
  typeof facet.payload.form === 'string' && facet.payload.form.trim().length > 0
    ? (facet.payload.form as string)
    : facet.targetForm

const translationOf = (facet: StudyFacetSummary): string | null =>
  typeof facet.payload.translation === 'string' ? (facet.payload.translation as string) : null

// The Study-targets control: one chip per study target. The citation chip drills
// the lemma (recognition/production/pronunciation); each per-form chip drills a
// specific inflection the learner added (Phase 4b). "+ Add a form" surfaces
// encountered surface forms on demand (Worked example 3).
export const StudyTargetsSection = ({ chunk }: StudyTargetsSectionProps) => {
  const { t } = useLingui()
  const { data } = useStudyTargets(chunk.id)
  const facets = data?.facets ?? []
  const candidateForms = data?.candidateForms ?? []

  // Per-form chips are keyed by the recognition facet (the base of a form
  // target); production is a sibling skill surfaced inside the same chip.
  const formRecognitionFacets = facets
    .filter((f) => f.skill === 'meaning_recognition' && f.targetForm !== '')
    .sort((a, b) => formOf(a).localeCompare(formOf(b)))

  return (
    <section>
      <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Study targets`}</h2>
      <div className='flex flex-wrap gap-2'>
        <CitationChip chunk={chunk} facets={facets} />
        {formRecognitionFacets.map((facet) => (
          <FormChip key={facet.targetForm} chunk={chunk} facet={facet} facets={facets} />
        ))}
        <AddFormControl chunk={chunk} candidateForms={candidateForms} />
      </div>
    </section>
  )
}

const CitationChip = ({ chunk, facets }: { chunk: StudyTargetsChunk; facets: StudyFacetSummary[] }) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending } = useSetFacetEnabled()
  const productionOn = chunk.isProductionEnabled
  const headword = chunk.headword

  // Pronunciation is a citation-only recognition facet (passive queue). It's
  // offerable only when the term has a displayable IPA — its card back is the
  // IPA, derived at render (Trap 12). Enabled state comes from the facet read.
  const ipaAvailable = hasDisplayableIpa((chunk.grammar?.ipa ?? null) as IpaBagShape | null, chunk.targetLanguage)
  const pronunciationOn = facets.some((f) => f.skill === 'pronunciation' && f.targetForm === '' && f.enabled)

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

// One inflected-form study target. The chip is born from its recognition facet;
// production is a sibling skill (same target_form) surfaced in the popover. A
// pending_data facet (no render data yet) shows a "needs data" block offering
// Opus generation or manual entry before it can be studied.
const FormChip = ({
  chunk,
  facet,
  facets,
}: {
  chunk: StudyTargetsChunk
  facet: StudyFacetSummary
  facets: StudyFacetSummary[]
}) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending: enabling } = useSetFacetEnabled()
  const { mutate: generateFacetData, isPending: generating } = useGenerateFacetData()
  const { mutate: setFacetPayload, isPending: savingPayload } = useSetFacetPayload()
  const busy = enabling || generating || savingPayload

  const form = formOf(facet)
  const translation = translationOf(facet)
  const targetForm = facet.targetForm
  const pending = facet.dataStatus === 'pending_data'
  const recognitionOn = facet.enabled

  const productionFacet = facets.find((f) => f.skill === 'meaning_production' && f.targetForm === targetForm)
  const productionOn = !!productionFacet?.enabled

  const [manualOpen, setManualOpen] = useState(false)
  const [manualTranslation, setManualTranslation] = useState(translation ?? '')

  const toggleRecognition = (next: boolean) => {
    setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm, enabled: next })
  }

  const toggleProduction = (next: boolean) => {
    // Reuse the form's known {form, translation} so the production facet is born
    // ready (the translation key signals "data provided" to the server).
    setFacetEnabled({
      chunkId: chunk.id,
      skill: 'meaning_production',
      targetForm,
      enabled: next,
      payload: next ? { form, translation } : undefined,
    })
  }

  const saveManual = () => {
    setFacetPayload(
      {
        chunkId: chunk.id,
        skill: 'meaning_recognition',
        targetForm,
        payload: { form, translation: manualTranslation.trim() || null },
      },
      { onSuccess: () => setManualOpen(false) }
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={t`Edit study target for the form ${form}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
            pending
              ? 'border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
              : recognitionOn
                ? 'border-input bg-background hover:bg-accent'
                : 'border-input bg-muted text-muted-foreground hover:bg-accent'
          )}
        >
          <span>{form}</span>
          {pending && <Sparkles className='h-3 w-3 opacity-70' />}
          <Pencil className='h-3 w-3 opacity-70' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-72 p-2'>
        <div className='mb-2 px-1'>
          <p className='text-sm font-semibold'>{form}</p>
          {!pending && translation && <p className='text-muted-foreground text-xs'>{translation}</p>}
        </div>

        {pending ? (
          <div className='flex flex-col gap-2 rounded-md border border-dashed border-amber-400 bg-amber-50 p-2'>
            <p className='text-xs text-amber-900'>{t`This form needs data before you can study it.`}</p>
            {manualOpen ? (
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>{t`Translation of this form`}</Label>
                <Input
                  value={manualTranslation}
                  onChange={(e) => setManualTranslation(e.target.value)}
                  placeholder={t`How this exact form reads in context.`}
                  autoFocus
                />
                <div className='flex gap-1.5'>
                  <Button type='button' size='sm' disabled={busy} onClick={saveManual}>
                    {t`Save`}
                  </Button>
                  <Button type='button' size='sm' variant='ghost' disabled={busy} onClick={() => setManualOpen(false)}>
                    {t`Cancel`}
                  </Button>
                </div>
              </div>
            ) : (
              <div className='flex gap-1.5'>
                <Button
                  type='button'
                  size='sm'
                  disabled={busy}
                  onClick={() => generateFacetData({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm })}
                >
                  {generating ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Sparkles className='h-3.5 w-3.5' />}
                  {t`Generate`}
                </Button>
                <Button type='button' size='sm' variant='outline' disabled={busy} onClick={() => setManualOpen(true)}>
                  {t`Enter manually`}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className='text-muted-foreground mb-1 px-1 text-xs font-semibold tracking-wide uppercase'>{t`Skills`}</p>
            <div className='flex flex-col gap-1'>
              <SkillRow
                id={`form-recognition-${targetForm}`}
                label={t`Recognition`}
                checked={recognitionOn}
                disabled={busy}
                onCheckedChange={toggleRecognition}
              />
              <SkillRow
                id={`form-production-${targetForm}`}
                label={t`Production`}
                checked={productionOn}
                disabled={busy}
                onCheckedChange={toggleProduction}
              />
              {/* Per-form pronunciation needs per-form stress/IPA that the
                  lemma-level grammar.ipa doesn't carry — roadmap (Worked
                  example 4). Greyed until that enrichment exists. */}
              <SkillRow
                id={`form-pronunciation-${targetForm}`}
                label={t`Pronunciation`}
                hint={t`Per-form pronunciation coming soon`}
                checked={false}
                disabled
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

// "+ Add a form": offers encountered surface forms (candidateForms) the learner
// hasn't yet turned into a study target. Enabling one creates a pending_data
// recognition facet seeded with the form's display string; data is generated /
// entered from the resulting form chip.
const AddFormControl = ({ chunk, candidateForms }: { chunk: StudyTargetsChunk; candidateForms: string[] }) => {
  const { t } = useLingui()
  const { mutate: setFacetEnabled, isPending } = useSetFacetEnabled()
  const [open, setOpen] = useState(false)

  if (candidateForms.length === 0) return null

  const addForm = (surfaceForm: string) => {
    setFacetEnabled(
      {
        chunkId: chunk.id,
        skill: 'meaning_recognition',
        // Key normalized client-side too (the server re-normalizes); payload
        // keeps the full display form (stress/case intact).
        targetForm: normalizeTargetForm(surfaceForm),
        enabled: true,
        payload: { form: surfaceForm },
      },
      { onSuccess: () => setOpen(false) }
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
