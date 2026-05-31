import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { I18nProvider } from '@lingui/react'
import { i18n } from '../lingui'
import { tokenizeText } from '../../services/word-tokenizer'
import {
  FlicktionaryVideoClosures,
  GlossData,
  SaveWordParams,
  SaveWordSegmentInfo,
  requestGloss,
  saveWord,
  setCefr,
} from '../../services/flicktionary/flicktionary-client'
import { SubtitleLineModel, SubtitleStore } from './subtitle-store'
import { Word } from './Word'
import { GlossContent, GlossTooltip } from './GlossTooltip'
import { CefrPicker } from './CefrPicker'
import { SaveToast } from './SaveToast'

const HOVER_DEBOUNCE_MS = 300

// One token of a subtitle line: a word (clickable) or the punctuation/space
// between words. `charStart`/`charEnd` are offsets in the line text — they feed
// both the selection highlight and the SaveWordMessage segment coordinates.
interface LineToken {
  text: string
  isWord: boolean
  charStart: number
  charEnd: number
  ordinal: number // index among WORD tokens only; -1 for non-word
}

interface TokenizedLine {
  line: SubtitleLineModel
  tokens: LineToken[]
  wordTokens: LineToken[]
}

const tokenizeLine = (line: SubtitleLineModel): TokenizedLine => {
  const raw = tokenizeText(line.text)
  const tokens: LineToken[] = []
  const wordTokens: LineToken[] = []
  let cursor = 0
  let ordinal = 0
  for (const t of raw) {
    const charStart = cursor
    cursor += t.text.length
    const token: LineToken = {
      text: t.text,
      isWord: t.isWord,
      charStart,
      charEnd: cursor,
      ordinal: t.isWord ? ordinal : -1,
    }
    tokens.push(token)
    if (t.isWord) {
      wordTokens.push(token)
      ordinal++
    }
  }
  return { line, tokens, wordTokens }
}

// Active drag/click selection within a single line, by word ordinal.
interface SelectionState {
  lineIndex: number
  anchorOrdinal: number
  headOrdinal: number
}

interface GlossState {
  lineIndex: number
  anchor: HTMLElement
  word: string
  sentence: string
  content: GlossContent
}

interface ToastState {
  id: number
  text: string
  isError: boolean
}

interface CefrState {
  targetLanguage: string
  pendingSave: SaveWordParams
}

export interface SubtitleOverlayAppProps {
  store: SubtitleStore
  // Portal target inside the SEPARATE, non-transformed popover shadow root.
  popoverContainer: HTMLElement
  video: HTMLMediaElement
  closures: FlicktionaryVideoClosures
}

export function SubtitleOverlayApp(props: SubtitleOverlayAppProps) {
  return (
    <I18nProvider i18n={i18n}>
      <OverlayBody {...props} />
    </I18nProvider>
  )
}

function OverlayBody({ store, popoverContainer, video, closures }: SubtitleOverlayAppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const tokenized = useMemo(() => snapshot.lines.map(tokenizeLine), [snapshot.lines])

  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [gloss, setGloss] = useState<GlossState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [cefr, setCefrState] = useState<CefrState | null>(null)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredKey = useRef<string | null>(null)
  const selectingRef = useRef(false)
  const glossSeq = useRef(0)
  const glossCache = useRef<Map<string, GlossData>>(new Map())
  const toastSeq = useRef(0)

  // ---- helpers ---------------------------------------------------------------

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  const hideGloss = useCallback(() => {
    glossSeq.current += 1
    setGloss(null)
  }, [])

  const clearSelection = useCallback(() => {
    selectingRef.current = false
    setSelection(null)
  }, [])

  const showToast = useCallback((text: string, isError: boolean) => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, text, isError })
  }, [])

  // Resolve the [min,max] selected word ordinals for a given line, plus the
  // covered char range (for highlighting the spaces between selected words).
  const selectionForLine = (lineIndex: number, wordTokens: LineToken[]) => {
    if (!selection || selection.lineIndex !== lineIndex) return null
    const minOrd = Math.min(selection.anchorOrdinal, selection.headOrdinal)
    const maxOrd = Math.max(selection.anchorOrdinal, selection.headOrdinal)
    const first = wordTokens[minOrd]
    const last = wordTokens[maxOrd]
    if (!first || !last) return null
    return { minOrd, maxOrd, startCharStart: first.charStart, endCharEnd: last.charEnd, count: maxOrd - minOrd + 1 }
  }

  // ---- save flow -------------------------------------------------------------

  const handleOutcome = useCallback(
    async (params: SaveWordParams) => {
      const outcome = await saveWord(params)
      switch (outcome.kind) {
        case 'saved':
          showToast(`Saved: ${outcome.word}`, false)
          clearSelection()
          break
        case 'disabled':
          showToast(outcome.reason, true)
          clearSelection()
          break
        case 'error':
          showToast(outcome.message, true)
          clearSelection()
          break
        case 'missing-cefr':
          // Keep the selection so the retry has the same word in context.
          setCefrState({ targetLanguage: outcome.targetLanguage, pendingSave: params })
          break
      }
    },
    [showToast, clearSelection]
  )

  const saveSingle = useCallback(
    (line: SubtitleLineModel, token: LineToken) => {
      const translation = glossCache.current.get(`${token.text}::${line.text}`)?.gloss ?? ''
      const segmentInfo: SaveWordSegmentInfo = {
        startSegmentIndex: line.index,
        endSegmentIndex: undefined,
        startCharOffset: token.charStart,
        endCharOffset: token.charEnd,
      }
      void handleOutcome({ word: token.text, sentence: line.text, translation, segmentInfo, closures })
    },
    [closures, handleOutcome]
  )

  const saveSelection = useCallback(
    (tl: TokenizedLine) => {
      const range = selectionForLine(tl.line.index, tl.wordTokens)
      if (!range) return
      const selectedWords = tl.wordTokens.slice(range.minOrd, range.maxOrd + 1)
      const words = selectedWords.map((w) => w.text).join(' ')
      const first = selectedWords[0]
      const last = selectedWords[selectedWords.length - 1]
      const translation = glossCache.current.get(`${words}::${tl.line.text}`)?.gloss ?? ''
      // Single line → start and end segment are the same cue, so endSegmentIndex
      // is undefined (matches the legacy readSegmentRange payload).
      const segmentInfo: SaveWordSegmentInfo = {
        startSegmentIndex: tl.line.index,
        endSegmentIndex: undefined,
        startCharOffset: first.charStart,
        endCharOffset: last.charEnd,
      }
      void handleOutcome({ word: words, sentence: tl.line.text, translation, segmentInfo, closures })
    },
    [selection, closures, handleOutcome]
  )

  // ---- gloss (hover) flow ----------------------------------------------------

  const showGloss = useCallback(
    (lineIndex: number, anchor: HTMLElement, word: string, sentence: string) => {
      const cacheKey = `${word}::${sentence}`
      const cached = glossCache.current.get(cacheKey)
      const seq = ++glossSeq.current

      if (cached) {
        setGloss({ lineIndex, anchor, word, sentence, content: { status: 'ready', data: cached } })
        return
      }

      setGloss({ lineIndex, anchor, word, sentence, content: { status: 'loading' } })
      ;(async () => {
        let response
        try {
          response = await requestGloss(word, sentence)
        } catch {
          response = { error: 'Could not fetch a translation.' } as Awaited<ReturnType<typeof requestGloss>>
        }

        // Bail if the user moved on while fetching: a newer gloss superseded
        // this one, or the video resumed (paused gate).
        if (seq !== glossSeq.current || !video.paused || !anchor.isConnected) return

        if (response.gloss !== undefined) {
          const data: GlossData = {
            gloss: response.gloss,
            pos: response.pos ?? null,
            register: response.register ?? null,
            ipa: response.ipa ?? null,
          }
          glossCache.current.set(cacheKey, data)
          setGloss({ lineIndex, anchor, word, sentence, content: { status: 'ready', data } })
        } else {
          setGloss({
            lineIndex,
            anchor,
            word,
            sentence,
            content: { status: 'error', message: response.error || 'No translation available' },
          })
        }
      })()
    },
    [video]
  )

  const onWordEnter = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement) => {
      const key = `${tl.line.index}:${token.ordinal}`

      // Drag-select: extend the active selection instead of glossing.
      if (selectingRef.current && selection && selection.lineIndex === tl.line.index) {
        setSelection({ ...selection, headOrdinal: token.ordinal })
        return
      }

      hoveredKey.current = key
      clearHoverTimer()
      hoverTimer.current = setTimeout(() => {
        // Paused gate: only open while the video is (still) paused and the
        // pointer is (still) on this word.
        if (!video.paused || hoveredKey.current !== key) return

        const range = selectionForLine(tl.line.index, tl.wordTokens)
        const overSelected = range && token.ordinal >= range.minOrd && token.ordinal <= range.maxOrd
        if (range && range.count > 1 && overSelected) {
          // Chunk gloss: the whole selected phrase.
          const words = tl.wordTokens
            .slice(range.minOrd, range.maxOrd + 1)
            .map((w) => w.text)
            .join(' ')
          showGloss(tl.line.index, element, words, tl.line.text)
        } else {
          showGloss(tl.line.index, element, token.text, tl.line.text)
        }
      }, HOVER_DEBOUNCE_MS)
    },
    [video, selection, showGloss]
  )

  const onWordLeave = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      const key = `${tl.line.index}:${token.ordinal}`
      clearHoverTimer()
      if (hoveredKey.current === key) hoveredKey.current = null

      // For an active multi-word selection, let the chunk gloss persist (it
      // clears on selection change / play / subtitle change) — mirrors legacy.
      const range = selectionForLine(tl.line.index, tl.wordTokens)
      if (range && range.count > 1) return

      hideGloss()
    },
    [selection, hideGloss]
  )

  const onWordContextMenu = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      const range = selectionForLine(tl.line.index, tl.wordTokens)
      if (range) {
        saveSelection(tl)
      } else {
        saveSingle(tl.line, token)
      }
    },
    [selection, saveSelection, saveSingle]
  )

  const onWordMouseDown = useCallback((tl: TokenizedLine, token: LineToken) => {
    clearHoverTimer()
    selectingRef.current = true
    setSelection({ lineIndex: tl.line.index, anchorOrdinal: token.ordinal, headOrdinal: token.ordinal })
  }, [])

  // ---- CEFR retry ------------------------------------------------------------

  const onCefrPick = useCallback(
    (level: string) => {
      const current = cefr
      setCefrState(null)
      if (!current) return
      void (async () => {
        const res = await setCefr(current.targetLanguage, level)
        if (!res.ok) {
          showToast(res.message, true)
          clearSelection()
          return
        }
        await handleOutcome({ ...current.pendingSave, isCefrRetry: true })
      })()
    },
    [cefr, showToast, clearSelection, handleOutcome]
  )

  const onCefrCancel = useCallback(() => {
    setCefrState(null)
    clearSelection()
  }, [clearSelection])

  // ---- lifecycle effects -----------------------------------------------------

  // End drag selection on mouseup anywhere.
  useEffect(() => {
    const onMouseUp = () => {
      selectingRef.current = false
    }
    window.addEventListener('mouseup', onMouseUp, true)
    return () => window.removeEventListener('mouseup', onMouseUp, true)
  }, [])

  // Resuming playback clears the hover gloss and any selection (legacy parity).
  useEffect(() => {
    const onPlaying = () => {
      clearHoverTimer()
      hideGloss()
      clearSelection()
    }
    video.addEventListener('playing', onPlaying)
    return () => video.removeEventListener('playing', onPlaying)
  }, [video, hideGloss, clearSelection])

  // Drop stale gloss/selection when their line is no longer showing (the cue
  // changed). React keys keep word elements stable while a cue persists.
  useEffect(() => {
    const presentIndices = new Set(snapshot.lines.map((l) => l.index))
    if (gloss && !presentIndices.has(gloss.lineIndex)) hideGloss()
    if (selection && !presentIndices.has(selection.lineIndex)) clearSelection()
  }, [snapshot.lines, gloss, selection, hideGloss, clearSelection])

  // Hidden (display off / force-hide): tear down transient interaction UI.
  useEffect(() => {
    if (!snapshot.visible) {
      clearHoverTimer()
      hideGloss()
      clearSelection()
      setCefrState(null)
    }
  }, [snapshot.visible, hideGloss, clearSelection])

  // Auto-dismiss the toast after its animation (1.5s success / 3.5s error).
  useEffect(() => {
    if (!toast) return
    const duration = toast.isError ? 3500 : 1500
    const id = setTimeout(() => setToast((t) => (t && t.id === toast.id ? null : t)), duration)
    return () => clearTimeout(id)
  }, [toast])

  // ---- render ----------------------------------------------------------------

  const lineStyleForOffset = snapshot.lines[0]?.style

  return (
    <>
      {snapshot.visible && (
        <div className='text-center'>
          {tokenized.map((tl) => {
            const range = selectionForLine(tl.line.index, tl.wordTokens)
            return (
              <div
                key={tl.line.index}
                data-track={tl.line.track}
                style={tl.line.style}
                className='px-2.5 leading-normal whitespace-pre-wrap'
              >
                {tl.tokens.map((token, i) => {
                  const inRange =
                    range !== null && token.charStart >= range.startCharStart && token.charEnd <= range.endCharEnd
                  if (token.isWord) {
                    return (
                      <Word
                        key={i}
                        word={token.text}
                        sentence={tl.line.text}
                        selected={inRange}
                        onEnter={(el) => onWordEnter(tl, token, el)}
                        onLeave={() => onWordLeave(tl, token)}
                        onContextMenu={() => onWordContextMenu(tl, token)}
                        onMouseDown={() => onWordMouseDown(tl, token)}
                      />
                    )
                  }
                  return inRange ? (
                    <span key={i} className='bg-[rgba(255,255,0,0.35)]'>
                      {token.text}
                    </span>
                  ) : (
                    <span key={i}>{token.text}</span>
                  )
                })}
              </div>
            )
          })}

          {snapshot.offsetText !== null && (
            <div style={lineStyleForOffset} className='px-2.5 leading-normal whitespace-pre-wrap'>
              {snapshot.offsetText}
            </div>
          )}
        </div>
      )}

      {createPortal(
        <>
          {snapshot.visible && gloss && (
            <GlossTooltip anchor={gloss.anchor} word={gloss.word} content={gloss.content} />
          )}
          {cefr && (
            <CefrPicker languageCode={cefr.targetLanguage} video={video} onPick={onCefrPick} onCancel={onCefrCancel} />
          )}
          {toast && <SaveToast key={toast.id} text={toast.text} isError={toast.isError} video={video} />}
        </>,
        popoverContainer
      )}
    </>
  )
}
