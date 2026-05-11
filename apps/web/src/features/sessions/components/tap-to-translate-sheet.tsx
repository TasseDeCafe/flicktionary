import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useCreateHighlight, useFastGloss } from '../api/sessions-hooks'
import { useTapToTranslate } from '../hooks/use-tap-to-translate'
import type { SelectionResult } from '../hooks/use-text-selection'

type GlossState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; gloss: string; pos: string | null; register: string | null }
  | { kind: 'error' }

type Props = {
  open: boolean
  sessionId: string
  selection: SelectionResult | null
  onClose: () => void
}

export const TapToTranslateSheet = ({ open, sessionId, selection, onClose }: Props) => {
  const { t } = useLingui()
  const { findCachedHighlight } = useTapToTranslate(sessionId)
  const { mutateAsync: createHighlight } = useCreateHighlight(sessionId)
  const { mutateAsync: fetchGloss } = useFastGloss()

  const [state, setState] = useState<GlossState>({ kind: 'idle' })
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Reset on close so the next open is fresh.
  useEffect(() => {
    if (!open) {
      setState({ kind: 'idle' })
      setHighlightId(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !selection) return
    let cancelled = false

    const run = async () => {
      try {
        setState({ kind: 'loading' })
        const cached = findCachedHighlight(selection)
        let id = cached?.id ?? null
        if (cached?.fastGloss) {
          // The serialized format mirrors fast-gloss-pass output: gloss\n[POS]\n[register].
          const lines = cached.fastGloss.split(/\r?\n/)
          if (cancelled) return
          setHighlightId(cached.id)
          setState({
            kind: 'ready',
            gloss: lines[0] ?? '',
            pos: lines[1]?.trim() || null,
            register: lines[2]?.trim() || null,
          })
          return
        }
        if (!id) {
          const created = await createHighlight({
            sessionId,
            startSegmentId: selection.startSegmentId,
            endSegmentId: selection.endSegmentId,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            selectionText: selection.selectionText,
            note: null,
            presetTags: [],
          })
          if (cancelled) return
          id = created.data.id
        }
        setHighlightId(id)
        const result = await fetchGloss({ sessionId, highlightId: id })
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
  }, [open, selection?.selectionText, selection?.startSegmentId, selection?.endSegmentId])

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <OverlayContent className='max-w-md'>
        <OverlayHeader>
          <OverlayTitle>{t`Quick gloss`}</OverlayTitle>
        </OverlayHeader>
        {selection ? (
          <div className='flex flex-col gap-3 pb-2'>
            <div className='rounded-md border bg-yellow-50 p-3 text-sm'>“{selection.selectionText}”</div>
            {state.kind === 'loading' && <p className='text-muted-foreground text-sm'>{t`Glossing…`}</p>}
            {state.kind === 'error' && (
              <p className='text-destructive text-sm'>{t`Could not fetch a gloss. The highlight is still saved.`}</p>
            )}
            {state.kind === 'ready' && (
              <div className='flex flex-col gap-2 rounded-md border p-3'>
                <p className='text-base'>{state.gloss}</p>
                {(state.pos || state.register) && (
                  <div className='text-muted-foreground flex gap-2 text-xs'>
                    {state.pos && <span className='rounded border px-2 py-0.5'>{state.pos}</span>}
                    {state.register && <span className='rounded border px-2 py-0.5'>{state.register}</span>}
                  </div>
                )}
              </div>
            )}
            {highlightId && (
              <p className='text-muted-foreground text-xs'>{t`Highlight saved. Add a note or chips next time without tap-to-translate.`}</p>
            )}
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>{t`No text selected.`}</p>
        )}
        <OverlayFooter>
          <Button onClick={onClose}>{t`Done`}</Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
