import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtualElement } from '@floating-ui/dom'
import type { SavedHighlightDto, SaveWordStudyIntent } from '@asbplayer-fork/common'
import { GlossTooltip, SavedGlossTooltip, type GlossContent } from '../video-overlay/GlossTooltip'
import { ArticleHighlightBanner, type ArticleBannerStatus } from './ArticleHighlightBanner'
import { extractArticle } from '@/services/flicktionary/extract-article'
import { ensureArticleSession, saveArticleHighlight } from '@/services/flicktionary/article-highlight-client'
import { requestGloss, startFlicktionaryPairing } from '@/services/flicktionary/flicktionary-client'
import { createHighlightPainter, type HighlightPainter } from '@/services/article-highlight/highlight-painter'
import {
  buildDomRange,
  buildSegmentDomMap,
  domPointToSegmentOffset,
  findMappedBlock,
  snapRangeToWords,
  type ArticleSegment,
  type SegmentDomMap,
} from '@/services/article-highlight/segment-dom-map'
import { ARTICLE_BLOCK_SELECTOR } from '@/services/flicktionary/extract-article'
import { ARTICLE_HOST_ATTR } from '@/services/article-highlight/constants'

// Immutable session context, resolved once after import.
interface SessionContext {
  sessionId: string
  targetLanguage: string
  map: SegmentDomMap
  segmentByIndex: Map<number, ArticleSegment>
  segmentIdByIndex: Readonly<Record<string, string>>
}

type PopoverState =
  | {
      mode: 'preview'
      virtual: VirtualElement
      word: string
      segmentId: string
      startOffset: number
      endOffset: number
      startSegmentIndex: number
    }
  | { mode: 'saved'; virtual: VirtualElement; highlightId: string }

const isInsideHost = (event: Event): boolean =>
  event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute(ARTICLE_HOST_ATTR))

const virtualFromRange = (range: Range): VirtualElement => ({
  getBoundingClientRect: () => range.getBoundingClientRect(),
})

// Whether a viewport point falls within a Range's painted glyph boxes. Tight
// horizontally (the margin-click case is horizontal); a little vertical slack
// for line boxes taller than the text rect.
const pointWithinRange = (range: Range, x: number, y: number): boolean =>
  Array.from(range.getClientRects()).some(
    (rect) => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 6 && y <= rect.bottom + 6
  )

export interface ArticleHighlightAppProps {
  // Turn highlighting off (× / Switch / popup re-toggle): the controller
  // unmounts the host and clears the paint.
  onClose: () => void
}

export const ArticleHighlightApp = ({ onClose }: ArticleHighlightAppProps) => {
  const [phase, setPhase] = useState<'importing' | 'active' | 'error'>('importing')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(true)
  const [savedCount, setSavedCount] = useState(0)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [gloss, setGloss] = useState<GlossContent>({ status: 'loading' })
  const [saving, setSaving] = useState(false)

  const ctxRef = useRef<SessionContext | null>(null)
  const painterRef = useRef<HighlightPainter | null>(null)
  // The authoritative saved set (server-backed) + the live Range painted for each.
  const savedRef = useRef<Map<string, SavedHighlightDto>>(new Map())
  const savedRangesRef = useRef<Map<string, Range>>(new Map())
  const glossReqRef = useRef(0)

  // Build the live DOM Range for one saved record, or null if its block is gone.
  const rangeForRecord = useCallback((record: SavedHighlightDto): Range | null => {
    const ctx = ctxRef.current
    if (!ctx) return null
    const block = ctx.map.blockBySegmentIndex.get(record.startSegmentIndex)
    const segment = ctx.segmentByIndex.get(record.startSegmentIndex)
    if (!block || !segment) return null
    return buildDomRange(block, segment.text, record.startOffset, record.endOffset)
  }, [])

  // Recompute every saved Range and hand them to the painter.
  const repaintSaved = useCallback(() => {
    const painter = painterRef.current
    if (!painter) return
    const entries: { id: string; range: Range }[] = []
    savedRangesRef.current.clear()
    for (const record of savedRef.current.values()) {
      const range = rangeForRecord(record)
      if (!range) continue
      savedRangesRef.current.set(record.id, range)
      entries.push({ id: record.id, range })
    }
    painter.setSaved(entries)
    setSavedCount(savedRef.current.size)
  }, [rangeForRecord])

  // ---- mount: paint setup + import + map build ------------------------------
  useEffect(() => {
    painterRef.current = createHighlightPainter(document)
    let cancelled = false

    void (async () => {
      const extracted = await extractArticle()
      if (cancelled) return
      if (!extracted.ok) {
        setPhase('error')
        setErrorMessage('Could not read this page.')
        return
      }

      const response = await ensureArticleSession({
        title: extracted.title,
        text: extracted.text,
        sourceUrl: location.href,
      })
      if (cancelled) return

      if (!response.success || !response.sessionId || !response.segments || !response.segmentIdByIndex) {
        if (!response.signedIn) {
          setSignedIn(false)
          setPhase('error')
          setErrorMessage('Sign in to Flicktionary to highlight on this page.')
          return
        }
        setPhase('error')
        setErrorMessage(response.error ?? 'Could not prepare this article for highlighting.')
        return
      }

      // Match the live blocks (same selector the extractor fed the backend) to
      // the canonical segment strings.
      const blocks = Array.from(document.querySelectorAll<HTMLElement>(ARTICLE_BLOCK_SELECTOR))
      const segments: ArticleSegment[] = response.segments.map((s) => ({ index: s.index, text: s.text }))
      const map = buildSegmentDomMap(segments, blocks)
      const segmentByIndex = new Map(segments.map((s) => [s.index, s]))

      ctxRef.current = {
        sessionId: response.sessionId,
        targetLanguage: response.targetLanguage ?? '',
        map,
        segmentByIndex,
        segmentIdByIndex: response.segmentIdByIndex,
      }

      // Repaint the session's existing highlights (single-segment, mappable).
      savedRef.current = new Map((response.highlights ?? []).map((h) => [h.id, h]))
      repaintSaved()

      setSignedIn(true)
      setPhase('active')
    })()

    return () => {
      cancelled = true
      painterRef.current?.destroy()
      painterRef.current = null
    }
  }, [repaintSaved])

  // ---- close the preview popover --------------------------------------------
  const closePopover = useCallback(() => {
    setPopover(null)
    painterRef.current?.setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  // ---- open the saved-mode popover for a saved span -------------------------
  const openSaved = useCallback((highlightId: string) => {
    const range = savedRangesRef.current.get(highlightId)
    if (!range) return
    painterRef.current?.setSelection(null)
    window.getSelection()?.removeAllRanges()
    setPopover({ mode: 'saved', virtual: virtualFromRange(range), highlightId })
  }, [])

  // ---- selection → word snap → preview popover ------------------------------
  const onMouseUp = useCallback(
    (event: MouseEvent) => {
      if (event.button !== 0) return
      const ctx = ctxRef.current
      const painter = painterRef.current
      if (!ctx || !painter) return
      if (isInsideHost(event)) return

      const selection = window.getSelection()
      const wasCollapsed = !selection || selection.isCollapsed

      // A collapsed click might be reopening a saved span.
      if (wasCollapsed) {
        const savedId = painter.hitTest(event.clientX, event.clientY)
        if (savedId) {
          openSaved(savedId)
          return
        }
      }
      if (!selection || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)
      const block = findMappedBlock(range.startContainer, ctx.map)
      // v1: single-segment only — reject selections that cross a block boundary
      // or land outside a mapped block.
      if (!block || findMappedBlock(range.endContainer, ctx.map) !== block) return
      const segment = ctx.map.segmentByBlock.get(block)
      if (!segment) return

      const rawStart = domPointToSegmentOffset(block, segment.text, range.startContainer, range.startOffset)
      const rawEnd = domPointToSegmentOffset(block, segment.text, range.endContainer, range.endOffset)
      const snapped = snapRangeToWords(segment.text, rawStart, rawEnd, ctx.targetLanguage)
      if (!snapped) return
      const [start, end] = snapped

      const segmentId = ctx.segmentIdByIndex[String(segment.index)]
      if (!segmentId) return
      const domRange = buildDomRange(block, segment.text, start, end)
      if (!domRange) return

      // A bare click in the margin snaps the browser caret to the nearest line's
      // start, which would otherwise select that line's first word. Require the
      // pointer to actually fall within the snapped word's geometry (a drag is
      // deliberate, so it skips this guard).
      if (wasCollapsed && !pointWithinRange(domRange, event.clientX, event.clientY)) return

      // Clear the native selection and paint our own sky wash so the on-page
      // look matches the web reader exactly (snapped to whole words).
      selection.removeAllRanges()
      painter.setSelection(domRange.cloneRange())

      const word = segment.text.slice(start, end)
      setPopover({
        mode: 'preview',
        virtual: virtualFromRange(domRange),
        word,
        segmentId,
        startOffset: start,
        endOffset: end,
        startSegmentIndex: segment.index,
      })

      const reqId = ++glossReqRef.current
      setGloss({ status: 'loading' })
      void requestGloss(word, segment.text, ctx.targetLanguage).then((response) => {
        if (reqId !== glossReqRef.current) return
        if (response.error) {
          setGloss({ status: 'error', message: response.error })
        } else {
          setGloss({
            status: 'ready',
            gloss: response.gloss ?? '',
            pos: response.pos ?? null,
            register: response.register ?? null,
            ipaDisplay: response.ipaDisplay ?? null,
          })
        }
      })
    },
    [openSaved]
  )

  useEffect(() => {
    if (phase !== 'active') return
    document.addEventListener('mouseup', onMouseUp, { capture: true })
    return () => document.removeEventListener('mouseup', onMouseUp, { capture: true })
  }, [phase, onMouseUp])

  // ---- save the preview selection -------------------------------------------
  const handleSave = useCallback(
    (studyIntent?: SaveWordStudyIntent) => {
      const ctx = ctxRef.current
      if (!ctx || popover?.mode !== 'preview') return
      const { segmentId, startOffset, endOffset, word, startSegmentIndex } = popover
      setSaving(true)
      void saveArticleHighlight({
        sessionId: ctx.sessionId,
        segmentId,
        startOffset,
        endOffset,
        selectionText: word,
        studyIntent,
      }).then((response) => {
        setSaving(false)
        if (!response.success || !response.id) {
          if (response.code === 'MISSING_CEFR') {
            setErrorMessage('Set your level for this language in the Flicktionary web app, then try again.')
          } else if (response.error) {
            setErrorMessage(response.error)
          }
          return
        }
        setErrorMessage(null)
        const record: SavedHighlightDto = {
          id: response.id,
          startSegmentIndex,
          endSegmentIndex: startSegmentIndex,
          startOffset,
          endOffset,
          selectionText: word,
          note: null,
          presetTags: [],
          fastGloss: response.fastGloss ?? null,
        }
        savedRef.current.set(record.id, record)
        painterRef.current?.setSelection(null)
        repaintSaved()
        // Morph the popover in place into saved mode on the just-painted span.
        const range = savedRangesRef.current.get(record.id)
        if (range) setPopover({ mode: 'saved', virtual: virtualFromRange(range), highlightId: record.id })
        else closePopover()
      })
    },
    [popover, repaintSaved, closePopover]
  )

  const onSignIn = useCallback(() => void startFlicktionaryPairing(), [])

  // ---- saved-mode popover callbacks -----------------------------------------
  const handleRemoved = useCallback(
    (highlightId: string) => {
      savedRef.current.delete(highlightId)
      savedRangesRef.current.delete(highlightId)
      repaintSaved()
      setPopover(null)
    },
    [repaintSaved]
  )

  const handleNotePatched = useCallback((highlightId: string, note: string | null, presetTags: string[]) => {
    const record = savedRef.current.get(highlightId)
    if (record) savedRef.current.set(highlightId, { ...record, note, presetTags })
  }, [])

  // ---- render ---------------------------------------------------------------
  const bannerStatus: ArticleBannerStatus =
    phase === 'importing'
      ? { kind: 'importing' }
      : errorMessage
        ? { kind: 'error', message: errorMessage }
        : { kind: 'active' }

  const ctx = ctxRef.current
  const savedHighlight = popover?.mode === 'saved' ? (savedRef.current.get(popover.highlightId) ?? null) : null

  return (
    <>
      <ArticleHighlightBanner
        status={bannerStatus}
        signedIn={signedIn}
        savedCount={savedCount}
        onToggleOff={onClose}
        onSignIn={onSignIn}
      />

      {popover?.mode === 'preview' && (
        <GlossTooltip
          anchor={popover.virtual}
          theme='light'
          word={popover.word}
          content={gloss}
          signedIn={signedIn}
          saving={saving}
          onSave={(studyIntent) => handleSave(studyIntent)}
          onSignIn={onSignIn}
          onPointerEnter={() => {}}
          onPointerLeave={() => {}}
          onOutsidePointerDown={closePopover}
        />
      )}

      {popover?.mode === 'saved' && savedHighlight && ctx && (
        <SavedGlossTooltip
          anchor={popover.virtual}
          theme='light'
          sessionId={ctx.sessionId}
          highlight={savedHighlight}
          onRemoved={() => handleRemoved(savedHighlight.id)}
          onNotePatched={(note, presetTags) => handleNotePatched(savedHighlight.id, note, presetTags)}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  )
}
