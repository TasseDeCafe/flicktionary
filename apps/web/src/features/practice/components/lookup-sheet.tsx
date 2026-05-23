import { useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { Bookmark } from 'lucide-react'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { GrammarIpaBag } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetDescription,
  FloatingSheetFooter,
  FloatingSheetHeader,
  FloatingSheetTitle,
} from '@/components/ui/floating-sheet'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { usePracticeFastGloss } from '../api/practice-hooks'
import type { PlainSelection } from './annotated-text'

type GlossState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; gloss: string; pos: string | null; register: string | null; ipa: GrammarIpaBag | null }
  | { kind: 'error' }

interface LookupSheetProps {
  open: boolean
  selection: PlainSelection | null
  practiceTextId: string | null
  practiceSessionId: string
  practiceTextBody: string
  targetLanguage: string
  onClose: () => void
}

const CONTEXT_MAX = 2000

export const LookupSheet = ({
  open,
  selection,
  practiceTextId,
  practiceSessionId,
  practiceTextBody,
  targetLanguage,
  onClose,
}: LookupSheetProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: userPrefs } = useGetUserPrefs()
  const { mutateAsync: fetchGloss } = usePracticeFastGloss()
  const { mutate: createAdhoc, isPending: isCreating } = useCreateAdhocCard()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  const [state, setState] = useState<GlossState>({ kind: 'idle' })
  const [showCefrDialog, setShowCefrDialog] = useState(false)

  useLayoutEffect(() => {
    if (!open || !selection || !practiceTextId) return
    setState({ kind: 'loading' })
    setShowCefrDialog(false)
  }, [open, practiceTextId, selection])

  useEffect(() => {
    if (!open || !selection || !practiceTextId) return
    let cancelled = false
    const run = async () => {
      try {
        setState({ kind: 'loading' })
        const result = await fetchGloss({ practiceTextId, selectionText: selection.text })
        if (cancelled) return
        setState({
          kind: 'ready',
          gloss: result.data.gloss,
          pos: result.data.pos,
          register: result.data.register,
          ipa: result.data.ipa,
        })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, practiceTextId, selection?.text, fetchGloss, selection])

  const navigateToCard = (sessionId: string, cardId: string) => {
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId, cardId },
      search: { from: 'practice' as const, practiceSessionId },
    })
  }

  const submitAdhoc = (lang: string) => {
    if (!selection) return
    createAdhoc(
      {
        targetLanguage: lang,
        headword: selection.text,
        // Send the practice text body as the LLM's context window. Truncated
        // defensively even though our generated texts are well under 2k chars.
        context: practiceTextBody.slice(0, CONTEXT_MAX),
      },
      {
        onSuccess: (response) => {
          onClose()
          navigateToCard(response.data.sessionId, response.data.cardId)
        },
        onError: (err) => {
          const code =
            (err as { data?: { errors?: Array<{ code?: string; message?: string }> } })?.data?.errors?.[0]?.code ?? ''
          if (code === 'cefr_not_set') {
            setShowCefrDialog(true)
            return
          }
          if (code === 'native_language_not_set') {
            toast.error(t`Set your native language first.`)
            return
          }
          toast.error(t`Failed to save term`)
        },
      }
    )
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

  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'
  const displayedIpa = state.kind === 'ready' ? (pickIpa(state.ipa, targetLanguage, englishIpaDialect) ?? null) : null
  const hasWiktionaryData = KAIKKI_LANGUAGES.has(targetLanguage)
  const ipaLabel = state.kind === 'ready' ? (displayedIpa ?? (hasWiktionaryData ? t`No Wiktionary IPA` : null)) : null
  const showIpaFlag = !!displayedIpa && targetLanguage === 'en'

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
      >
        <FloatingSheetContent>
          <FloatingSheetHeader>
            <FloatingSheetTitle>{selection?.text ?? t`Lookup`}</FloatingSheetTitle>
            {state.kind === 'loading' ? (
              <>
                <Skeleton className='h-5 w-20' />
                <Skeleton className='h-4 w-11/12' />
                <Skeleton className='h-4 w-3/4' />
                <div className='mt-2 flex flex-wrap gap-1.5'>
                  <Skeleton className='h-5 w-12 rounded-md' />
                  <Skeleton className='h-5 w-16 rounded-md' />
                </div>
                <FloatingSheetDescription className='sr-only'>
                  {t`Translation lookup and save action for the selected text.`}
                </FloatingSheetDescription>
              </>
            ) : (
              <>
                {ipaLabel && (
                  <p className='text-muted-foreground flex items-center gap-1.5 text-base leading-snug font-medium'>
                    {showIpaFlag && (
                      <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                    )}
                    <span>{ipaLabel}</span>
                  </p>
                )}
                {state.kind === 'ready' ? (
                  <FloatingSheetDescription>{state.gloss}</FloatingSheetDescription>
                ) : (
                  <FloatingSheetDescription className='sr-only'>
                    {t`Translation lookup and save action for the selected text.`}
                  </FloatingSheetDescription>
                )}
                {state.kind === 'ready' && (state.pos || state.register) && (
                  <div className='mt-2 flex flex-wrap gap-1.5'>
                    {state.pos && <Badge variant='outline'>{state.pos}</Badge>}
                    {state.register && <Badge variant='secondary'>{state.register}</Badge>}
                  </div>
                )}
              </>
            )}
          </FloatingSheetHeader>
          {state.kind === 'error' && (
            <FloatingSheetBody>
              <p className='text-destructive text-sm'>{t`Could not fetch a translation right now.`}</p>
            </FloatingSheetBody>
          )}
          <FloatingSheetFooter>
            <Button type='button' size='xl' onClick={handleSave} disabled={isCreating || isSettingCefr || !selection}>
              <Bookmark className='mr-1 h-4 w-4' />
              {isCreating || isSettingCefr ? t`Generating…` : t`Save to vocabulary`}
            </Button>
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
