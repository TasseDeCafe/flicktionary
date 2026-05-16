import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { Bookmark, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { usePracticeFastGloss } from '../api/practice-hooks'
import type { PlainSelection } from './annotated-text'

type GlossState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; gloss: string; pos: string | null; register: string | null }
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
  const { mutateAsync: fetchGloss } = usePracticeFastGloss()
  const { mutate: createAdhoc, isPending: isCreating } = useCreateAdhocCard()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  const [state, setState] = useState<GlossState>({ kind: 'idle' })
  const [showCefrDialog, setShowCefrDialog] = useState(false)

  useEffect(() => {
    if (!open) {
      setState({ kind: 'idle' })
      setShowCefrDialog(false)
    }
  }, [open])

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

  return (
    <>
      <ResponsiveOverlay
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        {/* outline-none suppresses Safari's focus ring on the drawer content,
            which gets re-focused when Vaul re-measures after the loading→ready
            content-height jump. */}
        <OverlayContent className='outline-none focus-visible:outline-none'>
          <OverlayHeader>
            <div className='flex flex-col gap-1'>
              <OverlayTitle>{selection?.text ?? t`Lookup`}</OverlayTitle>
              {state.kind === 'ready' && <OverlayDescription>{state.gloss}</OverlayDescription>}
              {state.kind !== 'ready' && (
                <OverlayDescription className='sr-only'>{t`Translation lookup and save action for the selected text.`}</OverlayDescription>
              )}
            </div>
            {state.kind === 'ready' && (state.pos || state.register) && (
              <div className='mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start'>
                {state.pos && <Badge variant='outline'>{state.pos}</Badge>}
                {state.register && <Badge variant='secondary'>{state.register}</Badge>}
              </div>
            )}
          </OverlayHeader>
          {(state.kind === 'loading' || state.kind === 'error') && (
            <div className='flex flex-col gap-3 px-4 pb-2 text-sm'>
              {state.kind === 'loading' && (
                <p className='text-muted-foreground flex items-center gap-2'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  {t`Glossing…`}
                </p>
              )}
              {state.kind === 'error' && (
                <p className='text-destructive text-sm'>{t`Could not fetch a translation right now.`}</p>
              )}
            </div>
          )}
          <OverlayFooter>
            <Button type='button' variant='outline' size='xl' onClick={onClose} disabled={isCreating || isSettingCefr}>
              {t`Close`}
            </Button>
            <Button type='button' size='xl' onClick={handleSave} disabled={isCreating || isSettingCefr || !selection}>
              <Bookmark className='mr-1 h-4 w-4' />
              {isCreating || isSettingCefr ? t`Generating…` : t`Save to vocabulary`}
            </Button>
          </OverlayFooter>
        </OverlayContent>
      </ResponsiveOverlay>

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
