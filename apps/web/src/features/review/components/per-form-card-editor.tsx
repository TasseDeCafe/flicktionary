import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type {
  Chunk,
  FacetSkill,
  Grammar,
  StudyFacetSource,
  StudyFacetSummary,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useTextSegmentsWindow, useRenameChunk, useUpdateChunkContent } from '../api/review-hooks'
import { useGenerateFacetData, useSetFacetPayload } from '@/features/vocabulary/api/vocabulary-hooks'
import { EditableCardFields, type TranslationFieldsMode } from './editable-card-fields'
import { EditableGrammarPanel } from './editable-grammar-panel'
import {
  formDisplay,
  formTargetFacet,
  payloadGrammar,
  payloadString,
  type FormAutoSetup,
  type SelectedTarget,
} from './study-target-helpers'
import { citationGrammarFieldProvenance, generatedFieldProvenance } from '../utils/field-provenance'

type Props = {
  chunk: Chunk
  // The opened card's version — keys the citation field editor's remount so a
  // server-side chunk change (chat tool, sibling tab) reloads its useState. Form
  // edits don't bump it, so the form editor keys on facet identity instead.
  cardUpdatedAt: string
  selectedTarget: SelectedTarget
  facets: StudyFacetSummary[]
  translationFieldsMode: TranslationFieldsMode
  // Session scope for the citation content mutations' cache invalidation (the
  // sibling-card refetch). Undefined for language-wide entries.
  sourceSessionId?: string
  fromVocabulary: boolean
  // One-shot: a form just added via the "Add a form" sheet, with the chosen fill
  // action to run here (so its loading shows on the main view). Cleared once run.
  autoSetup?: FormAutoSetup | null
  onAutoSetupConsumed?: () => void
}

// The unified per-target card editor: edits the lemma's canonical content when
// Citation is selected, or one form facet's payload when a form is selected.
// Both reuse EditableCardFields / EditableGrammarPanel through injected save
// adapters (citation → user_lookups columns; form → setFacetPayload). It also
// owns the per-target Context block, driven by the selected facet's source.
export const PerFormCardEditor = ({
  chunk,
  cardUpdatedAt,
  selectedTarget,
  facets,
  translationFieldsMode,
  sourceSessionId,
  fromVocabulary,
  autoSetup,
  onAutoSetupConsumed,
}: Props) => {
  // All mutation hooks are unconditional (render branches below pick which to use).
  const updateChunkContent = useUpdateChunkContent(sourceSessionId)
  const renameChunk = useRenameChunk(sourceSessionId)
  const setFacetPayload = useSetFacetPayload()
  const generateFacetData = useGenerateFacetData()

  if (selectedTarget.kind === 'citation') {
    const citationFacet = facets.find((f) => f.targetForm === '')
    return (
      <div className='flex flex-col gap-4'>
        <EditableCardFields
          key={`citation:${chunk.id}:${cardUpdatedAt}`}
          values={{
            translation: chunk.translation ?? '',
            definition: chunk.definition ?? '',
            targetExample: chunk.targetExample ?? '',
            nativeExample: chunk.nativeExample ?? '',
          }}
          translationFieldsMode={translationFieldsMode}
          isPending={updateChunkContent.isPending || renameChunk.isPending}
          headword={{
            value: chunk.headword,
            onRename: (headword, cbs) =>
              renameChunk.mutate({ chunkId: chunk.id, headword, sense: chunk.sense ?? '' }, cbs),
          }}
          onSaveContent={(patch) => updateChunkContent.mutate({ chunkId: chunk.id, patch })}
        />
        <EditableGrammarPanel
          key={`citation-grammar:${chunk.id}:${cardUpdatedAt}`}
          grammar={(chunk.grammar ?? {}) as Grammar}
          targetLanguage={chunk.targetLanguage}
          isPending={updateChunkContent.isPending}
          onSave={(patch) => updateChunkContent.mutate({ chunkId: chunk.id, patch: { grammarPatch: patch } })}
          provenanceFor={(key, currentValue) =>
            citationGrammarFieldProvenance({
              key,
              currentValue,
              groundingPatch: chunk.groundingPatch,
              groundedAt: chunk.groundedAt,
              targetLanguage: chunk.targetLanguage,
            })
          }
        />
        <SourceContextBlock source={citationFacet?.source ?? null} fromVocabulary={fromVocabulary} />
      </div>
    )
  }

  return (
    <FormEditor
      chunk={chunk}
      targetForm={selectedTarget.targetForm}
      facets={facets}
      translationFieldsMode={translationFieldsMode}
      fromVocabulary={fromVocabulary}
      setFacetPayload={setFacetPayload}
      generateFacetData={generateFacetData}
      autoSetup={autoSetup}
      onAutoSetupConsumed={onAutoSetupConsumed}
    />
  )
}

export const FormEditor = ({
  chunk,
  targetForm,
  facets,
  translationFieldsMode,
  fromVocabulary,
  setFacetPayload,
  generateFacetData,
  autoSetup,
  onAutoSetupConsumed,
}: {
  chunk: Chunk
  targetForm: string
  facets: StudyFacetSummary[]
  translationFieldsMode: TranslationFieldsMode
  fromVocabulary: boolean
  setFacetPayload: ReturnType<typeof useSetFacetPayload>
  generateFacetData: ReturnType<typeof useGenerateFacetData>
  autoSetup?: FormAutoSetup | null
  onAutoSetupConsumed?: () => void
}) => {
  const { t } = useLingui()
  // Sticky while a generate / first-save is in flight or its refetch hasn't yet
  // flipped the facet to ready — keeps the skeleton up instead of flashing the
  // Generate affordance back.
  const [awaiting, setAwaiting] = useState(false)
  const autoRanRef = useRef(false)

  // The form's content anchor — any skill, since a form may have no recognition
  // facet (e.g. a production-only exact-form save). Generate / manual / payload
  // edits all target this facet's skill so the content lands where the editor
  // reads it.
  const facet = formTargetFacet(facets, targetForm)
  const editSkill: FacetSkill = facet?.skill ?? 'meaning_recognition'
  const form = facet ? formDisplay(facet) : targetForm
  const source = facet?.source ?? null
  const pending = facet?.dataStatus === 'pending_data'
  const busy = generateFacetData.isPending || setFacetPayload.isPending

  // The two ways to fill a pending form, shared by the inline choice buttons and
  // the auto-run below. Both set `awaiting` (owned here) so the skeleton stays up
  // through the mutation and its refetch. Manual seeds the example from the
  // encountered sentence when one is known.
  const runGenerate = () => {
    setAwaiting(true)
    generateFacetData.mutate({ chunkId: chunk.id, skill: editSkill, targetForm })
  }
  const runManual = () => {
    setAwaiting(true)
    setFacetPayload.mutate({
      chunkId: chunk.id,
      skill: editSkill,
      targetForm,
      payload: { form, ...(source?.sentence ? { targetExample: source.sentence } : {}) },
    })
  }

  // A form just added via the "Add a form" sheet hands us its chosen action. Run
  // it once this form's (optimistically inserted) pending facet is present — the
  // loading then shows here on the main view, not in the now-closed sheet. Layout
  // effect so `awaiting` flips before paint and the choice prompt never flashes.
  useLayoutEffect(() => {
    if (!autoSetup) {
      autoRanRef.current = false
      return
    }
    if (autoSetup.targetForm !== targetForm || !pending || autoRanRef.current) return
    autoRanRef.current = true
    if (autoSetup.action === 'generate') runGenerate()
    else runManual()
    onAutoSetupConsumed?.()
    // Gate on the signal + facet readiness; runGenerate/runManual read live values at call time.
  }, [autoSetup, targetForm, pending])

  // The form vanished (removed elsewhere) — nothing to edit.
  if (!facet) return null

  const onSavePayload = (patch: Record<string, unknown>) =>
    setFacetPayload.mutate({ chunkId: chunk.id, skill: editSkill, targetForm, payload: { form, ...patch } })

  const header = (
    <div>
      <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Form`}</p>
      <p className='text-lg font-semibold'>{form}</p>
    </div>
  )

  // Pending + nothing in flight: offer Generate / Enter-manually. Either one
  // fills the payload and flips the facet to ready, after which the editable
  // fields render. Manual entry seeds the example from the encountered sentence.
  if (pending && !(busy || awaiting)) {
    return (
      <div className='flex flex-col gap-4'>
        {header}
        <div className='flex flex-col gap-2 rounded-md border border-dashed border-amber-400 bg-amber-50 p-3'>
          <p className='text-sm text-amber-900'>{t`This form needs data before you can study it.`}</p>
          <div className='flex gap-2'>
            <Button type='button' size='xl' className='flex-1' onClick={runGenerate}>
              <Sparkles className='mr-1 h-4 w-4' />
              {t`Generate`}
            </Button>
            <Button type='button' size='xl' variant='outline' className='flex-1' onClick={runManual}>
              {t`Enter manually`}
            </Button>
          </div>
        </div>
        <SourceContextBlock source={source} fromVocabulary={fromVocabulary} />
      </div>
    )
  }

  // Generation / first-save in flight (or its refetch pending): skeleton shaped
  // like the fields about to appear.
  if (pending && (busy || awaiting)) {
    return (
      <div className='flex flex-col gap-4'>
        {header}
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2 className='h-4 w-4 animate-spin' />
          {t`Preparing this form…`}
        </div>
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-9 w-full' />
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-9 w-2/3' />
        </div>
      </div>
    )
  }

  // The generated snapshot to compare fields against. When the snapshot exists
  // but omitted a key (e.g. generation produced no grammar), compare against
  // the empty record so user-added values still read as "edited"; a null
  // snapshot (manual / legacy facet) disables provenance claims entirely.
  const generatedSnapshot = facet.generatedPayload
  const generatedGrammar = generatedSnapshot
    ? ((generatedSnapshot.grammar as Record<string, unknown> | undefined) ?? {})
    : null

  // Ready: full editable field set, backed by the form facet's payload.
  return (
    <div className='flex flex-col gap-4'>
      {header}
      <EditableCardFields
        key={`form:${targetForm}`}
        values={{
          translation: payloadString(facet.payload, 'translation'),
          definition: payloadString(facet.payload, 'definition'),
          targetExample: payloadString(facet.payload, 'targetExample'),
          nativeExample: payloadString(facet.payload, 'nativeExample'),
        }}
        translationFieldsMode={translationFieldsMode}
        isPending={setFacetPayload.isPending}
        onSaveContent={(patch) => onSavePayload(patch)}
        provenanceFor={(key, currentValue) =>
          generatedFieldProvenance({ key, currentValue, generated: generatedSnapshot })
        }
      />
      <EditableGrammarPanel
        key={`form-grammar:${targetForm}`}
        grammar={payloadGrammar(facet.payload)}
        targetLanguage={chunk.targetLanguage}
        isPending={setFacetPayload.isPending}
        // The shallow payload merge replaces the whole `grammar` sub-object, so
        // always write the COMPLETE bag (not the partial patch).
        onSave={(_patch, fullGrammar) => onSavePayload({ grammar: fullGrammar })}
        provenanceFor={(key, currentValue) =>
          generatedFieldProvenance({ key, currentValue, generated: generatedGrammar })
        }
      />
      <SourceContextBlock source={source} fromVocabulary={fromVocabulary} />
    </div>
  )
}

// The encountered-context block for the selected target, driven by its facet
// source (the most-recent kept occurrence). Renders nothing when the target has
// no source (no kept occurrence, adhoc session, or no text track).
const SourceContextBlock = ({
  source,
  fromVocabulary,
}: {
  source: StudyFacetSource | null
  fromVocabulary: boolean
}) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const { data } = useTextSegmentsWindow(
    source ? { textTrackId: source.textTrackId, segmentId: source.segmentId, radius: 2 } : null
  )

  if (!source) return null

  return (
    <div>
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-semibold tracking-wide uppercase'
        >
          {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
          {t`Context`}
        </button>
        <Button variant='outline' size='sm' asChild>
          <Link
            to='/sessions/$sessionId'
            params={{ sessionId: source.sessionId }}
            search={{ segment: source.segmentId, ...(fromVocabulary ? { from: 'vocabulary' as const } : {}) }}
          >
            <ExternalLink className='mr-1 h-4 w-4' />
            {t`Open source`}
          </Link>
        </Button>
      </div>
      {open && data && (
        <div className='border-muted bg-muted/30 mt-2 rounded-md border px-3 py-2 text-sm'>
          {data.data.map((seg) => {
            const isFocus = seg.id === data.centerSegmentId
            return (
              <div key={seg.id} className={isFocus ? 'font-medium' : 'text-muted-foreground'}>
                {isFocus ? `> ${seg.text}` : seg.text}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
