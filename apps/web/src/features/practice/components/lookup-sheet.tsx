import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { Bookmark, CircleCheck, Info } from 'lucide-react'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { Button } from '@flicktionary/ui/components/button'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import {
  StudyOptionsSection,
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
} from '@flicktionary/ui/components/study-options-section'
import { IpaDialectFlag } from '@/components/ipa-dialect-flag'
import { ipaDialectsFromPrefs } from '@flicktionary/core/utils/pick-ipa'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetFooter,
  FloatingSheetHeader,
  FloatingSheetTitle,
} from '@flicktionary/ui/components/floating-sheet'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { KnownLemmaChip } from '@/features/sessions/components/known-lemma-chip'
import { useGetUserPrefs, useSetCefrForLanguage, useStatelessGloss } from '@/features/sessions/api/sessions-hooks'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import type { PlainSelection } from './annotated-text'

type GlossState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready'
      gloss: string
      pos: string | null
      register: string | null
      ipaDisplay: string | null
      ipaLemma: string | null
      knownLemmaCandidates: string[]
    }
  | { kind: 'error' }

interface LookupSheetProps {
  open: boolean
  selection: PlainSelection | null
  // Surrounding text of the selection — sent (truncated) as the gloss context
  // line AND as the adhoc card's LLM context.
  contextText: string
  targetLanguage: string
  // Forwarded to FloatingSheet so pointerdowns on selectable word pieces swap
  // the sheet's content in place instead of dismissing it.
  ignoreOutsidePointerDownSelector?: string
  onClose: () => void
}

const CONTEXT_MAX = 2000

const selectionKeyOf = (selection: PlainSelection) => `${selection.charStart}:${selection.text}`

export const LookupSheet = ({
  open,
  selection,
  contextText,
  targetLanguage,
  ignoreOutsidePointerDownSelector,
  onClose,
}: LookupSheetProps) => {
  const { t } = useLingui()
  const { data: userPrefs } = useGetUserPrefs()
  const { mutateAsync: fetchGloss } = useStatelessGloss()
  const { mutateAsync: createAdhoc } = useCreateAdhocCard()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  const [state, setState] = useState<GlossState>({ kind: 'idle' })
  const [showCefrDialog, setShowCefrDialog] = useState(false)
  // The "Study options" draft. Untouched → no studyIntent on Save (the backend
  // keep-time default applies); touched → the FULL SET of checked skills.
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)
  // Save is fire-and-forget: the button morphs to Saved optimistically while
  // createAdhoc (a seconds-long LLM call) runs in the background. Late results
  // are reconciled against this key so an error for an OLD selection never
  // clobbers the state of the one currently on screen.
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const currentSelectionKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!open || !selection) return
    currentSelectionKeyRef.current = selectionKeyOf(selection)
    setState({ kind: 'loading' })
    setSaveState('idle')
    setShowCefrDialog(false)
    setStudyDraft(defaultStudyIntentDraft)
  }, [open, selection])

  useEffect(() => {
    if (!open || !selection) return
    let cancelled = false
    const run = async () => {
      try {
        setState({ kind: 'loading' })
        const result = await fetchGloss({
          selectionText: selection.text,
          contextLine: contextText.slice(0, CONTEXT_MAX),
          targetLanguage,
        })
        if (cancelled) return
        setState({
          kind: 'ready',
          gloss: result.data.gloss,
          pos: result.data.pos,
          register: result.data.register,
          ipaDisplay: result.data.ipaDisplay,
          ipaLemma: result.data.ipaLemma,
          knownLemmaCandidates: result.data.knownLemmaCandidates,
        })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, selection?.text, contextText, targetLanguage, fetchGloss, selection])

  const submitAdhoc = (lang: string) => {
    if (!selection) return
    const key = selectionKeyOf(selection)
    setSaveState('saved')
    // Handle the result on the promise chain, NOT via mutate() observer
    // callbacks: those stop firing once this component unmounts or a newer
    // mutation supersedes the observer, which would make a late failure
    // completely silent. The chain always settles, so error toasts survive
    // navigating away mid-save.
    createAdhoc({
      targetLanguage: lang,
      headword: selection.text,
      // Send the surrounding text as the LLM's context window. Truncated
      // defensively even though our generated texts are well under 2k chars.
      context: contextText.slice(0, CONTEXT_MAX),
      // Touched study options ride the save (applied inline, before the keep
      // transition). Untouched → undefined → backend default. Read live so
      // the CEFR-retry path keeps the configured draft.
      studyIntent: draftToStudyIntent(studyDraft),
    }).catch((err: unknown) => {
      const stillCurrent = currentSelectionKeyRef.current === key
      const code =
        (err as { data?: { errors?: Array<{ code?: string; message?: string }> } })?.data?.errors?.[0]?.code ?? ''
      if (stillCurrent) setSaveState('idle')
      if (code === 'cefr_not_set') {
        // The CEFR prompt only makes sense for the selection still on screen;
        // if the user has moved on, the save is dropped (fire-and-forget).
        if (stillCurrent) setShowCefrDialog(true)
        return
      }
      if (code === 'native_language_not_set') {
        toast.error(t`Set your native language first.`)
        return
      }
      toast.error(t`Failed to save term`)
    })
  }

  const handleSave = () => {
    submitAdhoc(targetLanguage)
  }

  const handleCefrSubmit = (level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') => {
    setCefr(
      { targetLanguage, cefrLevel: level },
      {
        onSuccess: () => {
          setShowCefrDialog(false)
          submitAdhoc(targetLanguage)
        },
      }
    )
  }

  const displayedIpa = state.kind === 'ready' ? state.ipaDisplay : null
  // Only label the IPA with its lemma when there's an actual IPA to label.
  const displayedIpaLemma = state.kind === 'ready' && displayedIpa ? state.ipaLemma : null
  const hasWiktionaryData = KAIKKI_LANGUAGES.has(targetLanguage)
  const ipaLabel = state.kind === 'ready' ? (displayedIpa ?? (hasWiktionaryData ? t`No Wiktionary IPA` : null)) : null
  const showIpaFlag = !!displayedIpa && targetLanguage === 'en'
  const ipaDialects = ipaDialectsFromPrefs(userPrefs)

  return (
    <>
      <FloatingSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        anchor={selection?.rect ?? null}
        modal={false}
        closeOnScroll
        ignoreOutsidePointerDownSelector={ignoreOutsidePointerDownSelector}
      >
        <FloatingSheetContent>
          <FloatingSheetHeader>
            <FloatingSheetTitle>{selection?.text ?? t`Lookup`}</FloatingSheetTitle>
            <GlossCardBody
              loading={state.kind === 'loading'}
              gloss={state.kind === 'ready' ? state.gloss : null}
              pos={state.kind === 'ready' ? state.pos : null}
              register={state.kind === 'ready' ? state.register : null}
              ipaLabel={ipaLabel}
              ipaLemma={displayedIpaLemma}
              ipaPrefix={
                showIpaFlag ? <IpaDialectFlag targetLanguage={targetLanguage} ipaDialects={ipaDialects} /> : undefined
              }
              srDescription={t`Translation lookup and save action for the selected text.`}
            />
            {state.kind === 'ready' && state.knownLemmaCandidates.length > 0 && (
              <div className='mt-1'>
                <KnownLemmaChip
                  targetLanguage={targetLanguage}
                  lemmas={state.knownLemmaCandidates}
                  onRemoved={() =>
                    setState((prev) => (prev.kind === 'ready' ? { ...prev, knownLemmaCandidates: [] } : prev))
                  }
                />
              </div>
            )}
          </FloatingSheetHeader>
          {state.kind === 'error' && (
            <FloatingSheetBody>
              <p className='text-destructive text-sm'>{t`Could not fetch a translation right now.`}</p>
            </FloatingSheetBody>
          )}
          {selection && (
            <FloatingSheetBody>
              <StudyOptionsSection
                // Remount per selection so the draft re-arms from the reset above.
                key={selectionKeyOf(selection)}
                value={studyDraft}
                onChange={setStudyDraft}
                surfaceForm={selection.text}
                disabled={saveState === 'saved' || isSettingCefr}
              />
            </FloatingSheetBody>
          )}
          <FloatingSheetFooter>
            {saveState === 'saved' ? (
              <div className='flex items-center gap-2'>
                <Button type='button' size='xl' variant='outline' className='flex-1' disabled>
                  <CircleCheck className='mr-1 h-4 w-4 text-emerald-600' />
                  <span role='status'>{t`Saved`}</span>
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type='button' size='xl' variant='ghost' aria-label={t`About saved terms`}>
                      <Info className='h-4 w-4' />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side='top' align='end' className='w-60 p-3'>
                    <p className='text-sm font-medium'>{t`Saved to your vocabulary`}</p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {t`Review it any time from the Vocabulary tab — newest terms are listed first.`}
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            ) : (
              <Button type='button' size='xl' onClick={handleSave} disabled={isSettingCefr || !selection}>
                <Bookmark className='mr-1 h-4 w-4' />
                {t`Save to vocabulary`}
              </Button>
            )}
          </FloatingSheetFooter>
        </FloatingSheetContent>
      </FloatingSheet>

      {showCefrDialog && (
        <CefrPromptDialog
          open={showCefrDialog}
          targetLanguage={targetLanguage}
          onSubmit={handleCefrSubmit}
          onCancel={() => setShowCefrDialog(false)}
        />
      )}
    </>
  )
}
