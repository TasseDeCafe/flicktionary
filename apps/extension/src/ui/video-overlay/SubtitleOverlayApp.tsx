import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { I18nProvider } from '@lingui/react'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { msg } from '@lingui/core/macro'
import { i18n } from '../lingui'
import { tokenizeText } from '../../services/word-tokenizer'
import {
  FlicktionaryVideoClosures,
  GlossData,
  SaveWordParams,
  SaveWordSegmentInfo,
  SaveWordStudyIntent,
  saveWord,
  setCefr,
  startFlicktionaryPairing,
} from '../../services/flicktionary/flicktionary-client'
import { getFlicktionaryAuth, onFlicktionaryAuthChange } from '../../services/flicktionary/auth-storage'
import { SubtitleLineModel, SubtitleStore } from './subtitle-store'
import { Word } from './Word'
import { GlossContent, GlossTooltip } from './GlossTooltip'
import { CefrPicker } from './CefrPicker'
import { toast } from 'sonner'
import { dispatchToast } from './toaster-host'
import { glossQueryClient } from './gloss-query-client'
import { glossQueryKey, useGloss } from './use-gloss'
import { createOverlayInteractionStore, SelectionState } from './overlay-interaction-store'

const HOVER_DEBOUNCE_MS = 300
// Grace period after the pointer leaves a word before the gloss popover hides,
// so the user can cross the gap into the popover (to click Save) without it
// vanishing. Entering the popover cancels the hide.
const GLOSS_HIDE_GRACE_MS = 150

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

// The hovered-word shape held by the interaction store.
interface HoveredWord {
  tl: TokenizedLine
  token: LineToken
  element: HTMLElement
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

// Resolve a selection to the [min,max] word ordinals + the covered char range
// (for highlighting the spaces between selected words) for a given line. Pure
// and module-scoped so both the render path (subscribed state) and the
// imperative handlers (store.getState(), to dodge stale closures) can call it.
const rangeFor = (sel: SelectionState | null, lineIndex: number, wordTokens: LineToken[]) => {
  if (!sel || sel.lineIndex !== lineIndex) return null
  const minOrd = Math.min(sel.anchorOrdinal, sel.headOrdinal)
  const maxOrd = Math.max(sel.anchorOrdinal, sel.headOrdinal)
  const first = wordTokens[minOrd]
  const last = wordTokens[maxOrd]
  if (!first || !last) return null
  return { minOrd, maxOrd, startCharStart: first.charStart, endCharEnd: last.charEnd, count: maxOrd - minOrd + 1 }
}

// What an explicit Save from the gloss popover should persist — captured when
// the gloss opens, since the hovered word is cleared by the time the pointer
// has moved onto the popover.
type GlossSaveTarget = { kind: 'single'; tl: TokenizedLine; token: LineToken } | { kind: 'chunk'; tl: TokenizedLine }

// Which gloss popover is open (anchor + lookup identity). The gloss CONTENT
// is not stored here — it's the `useGloss` query for (word, sentence), so a
// stale response can never hit the wrong popover.
interface GlossState {
  lineIndex: number
  anchor: HTMLElement
  word: string
  sentence: string
  save: GlossSaveTarget
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
      <QueryClientProvider client={glossQueryClient}>
        <OverlayBody {...props} />
      </QueryClientProvider>
    </I18nProvider>
  )
}

function OverlayBody({ store, popoverContainer, video, closures }: SubtitleOverlayAppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const tokenized = useMemo(() => snapshot.lines.map(tokenizeLine), [snapshot.lines])

  // Pointer-interaction state, one store per overlay mount. Rendering
  // subscribes to `selection`/`signedIn` only; the imperative handlers read
  // getState() (always live), and `hovered`/`selecting` never cause renders.
  const [interaction] = useState(() => createOverlayInteractionStore<HoveredWord>())
  const selection = useStore(interaction, (s) => s.selection)
  // Flicktionary pairing ("sign in") state. Tracked from chrome.storage so the
  // gloss popover / toasts can offer a Sign in button when saving & glossing
  // are gated, and so they update live once pairing completes in the opened tab.
  const signedIn = useStore(interaction, (s) => s.signedIn)

  const [gloss, setGloss] = useState<GlossState | null>(null)
  const [cefr, setCefrState] = useState<CefrState | null>(null)

  const queryClient = useQueryClient()
  // The open popover's content. Keyed by (word, sentence): successes cache
  // (re-hover is instant), errors throw and are NOT cached (re-hover
  // refetches — a "Sign in to translate" error must not survive sign-in).
  const glossQuery = useGloss(gloss?.word, gloss?.sentence, gloss !== null)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pending deferred hide of the gloss popover (the hover-bridge grace timer).
  const glossHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredKey = useRef<string | null>(null)

  // ---- helpers ---------------------------------------------------------------

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  const cancelGlossHide = useCallback(() => {
    if (glossHideTimer.current) {
      clearTimeout(glossHideTimer.current)
      glossHideTimer.current = null
    }
  }, [])

  const hideGloss = useCallback(() => {
    cancelGlossHide()
    setGloss(null)
  }, [cancelGlossHide])

  // Defer the hide so the pointer can cross the gap into the popover; entering
  // the popover calls cancelGlossHide, leaving it (or this firing) hides.
  const scheduleGlossHide = useCallback(() => {
    cancelGlossHide()
    glossHideTimer.current = setTimeout(() => {
      glossHideTimer.current = null
      hideGloss()
    }, GLOSS_HIDE_GRACE_MS)
  }, [cancelGlossHide, hideGloss])

  const clearSelection = useCallback(() => {
    interaction.getState().clearSelection()
  }, [interaction])

  // Mirror the Flicktionary auth state into the interaction store. The read and
  // the change listener both hit chrome.storage.local (available in the content
  // script), so pairing done in the opened tab flips this live.
  useEffect(() => {
    const apply = (auth: unknown) => interaction.getState().setSignedIn(auth !== null)
    void getFlicktionaryAuth().then(apply)
    return onFlicktionaryAuthChange(apply)
  }, [interaction])

  // Kick off pairing (mirrors the popup's "Sign in with Flicktionary" button).
  const onSignIn = useCallback(() => {
    void startFlicktionaryPairing()
  }, [])

  // Route through the page-global sonner toaster (viewport bottom-right);
  // dispatchToast stands the singleton host up lazily and queues the call until
  // the Toaster is subscribed (a bare toast() right after host creation is
  // dropped). When `action` is given, sonner renders it as a button (used to
  // offer Sign in on gated saves).
  const showToast = useCallback((text: string, isError: boolean, action?: { label: string; onClick: () => void }) => {
    const options = action ? { action } : undefined
    dispatchToast(() => {
      if (isError) toast.error(text, options)
      else toast.success(text, options)
    })
  }, [])

  // Render-path range (reads the subscribed `selection` so highlights re-render).
  const selectionForLine = (lineIndex: number, wordTokens: LineToken[]) => rangeFor(selection, lineIndex, wordTokens)

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
          // Video-context gate (e.g. off YouTube), not an auth issue — no Sign in.
          showToast(outcome.reason, true)
          clearSelection()
          break
        case 'error':
          // Surfaces the "Sign in to Flicktionary to save words." error when the
          // save is blocked on pairing — offer a Sign in action then, same flow
          // as the popup button.
          showToast(
            outcome.message,
            true,
            interaction.getState().signedIn ? undefined : { label: i18n._(msg`Sign in`), onClick: onSignIn }
          )
          clearSelection()
          break
        case 'missing-cefr':
          // Keep the selection so the retry has the same word in context.
          setCefrState({ targetLanguage: outcome.targetLanguage, pendingSave: params })
          break
      }
    },
    [showToast, clearSelection, onSignIn, interaction]
  )

  const saveSingle = useCallback(
    (line: SubtitleLineModel, token: LineToken, studyIntent?: SaveWordStudyIntent) => {
      const translation = queryClient.getQueryData<GlossData>(glossQueryKey(token.text, line.text))?.gloss ?? ''
      const segmentInfo: SaveWordSegmentInfo = {
        startSegmentIndex: line.index,
        endSegmentIndex: undefined,
        startCharOffset: token.charStart,
        endCharOffset: token.charEnd,
      }
      void handleOutcome({ word: token.text, sentence: line.text, translation, segmentInfo, closures, studyIntent })
    },
    [closures, handleOutcome, queryClient]
  )

  const saveSelection = useCallback(
    (tl: TokenizedLine, studyIntent?: SaveWordStudyIntent) => {
      const range = rangeFor(interaction.getState().selection, tl.line.index, tl.wordTokens)
      if (!range) return
      const selectedWords = tl.wordTokens.slice(range.minOrd, range.maxOrd + 1)
      const words = selectedWords.map((w) => w.text).join(' ')
      const first = selectedWords[0]
      const last = selectedWords[selectedWords.length - 1]
      const translation = queryClient.getQueryData<GlossData>(glossQueryKey(words, tl.line.text))?.gloss ?? ''
      // Single line → start and end segment are the same cue, so endSegmentIndex
      // is undefined (matches the legacy readSegmentRange payload).
      const segmentInfo: SaveWordSegmentInfo = {
        startSegmentIndex: tl.line.index,
        endSegmentIndex: undefined,
        startCharOffset: first.charStart,
        endCharOffset: last.charEnd,
      }
      void handleOutcome({ word: words, sentence: tl.line.text, translation, segmentInfo, closures, studyIntent })
    },
    [closures, handleOutcome, queryClient, interaction]
  )

  // ---- gloss (hover) flow ----------------------------------------------------

  // Opening a gloss is now a pure state set: the content arrives via the
  // `useGloss` query for (word, sentence). The old in-flight guards map as
  // follows — the seq counter is structural (data is keyed, a stale response
  // can't hit the wrong popover); the !video.paused gate is covered by the
  // entry check in scheduleHoverGloss plus the `playing` listener clearing the
  // gloss; anchor.isConnected is a render-time guard below.
  const showGloss = useCallback(
    (lineIndex: number, anchor: HTMLElement, word: string, sentence: string, save: GlossSaveTarget) => {
      setGloss({ lineIndex, anchor, word, sentence, save })
    },
    []
  )

  // Arm the 300ms hover debounce for the word under the pointer. On fire it
  // opens the chunk gloss if that word is inside an active multi-word selection,
  // else the single-word gloss. Reads the live selection from the store so it's
  // correct when called from `mouseup` after a drag. Stable identity (no
  // selection dep).
  const scheduleHoverGloss = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement) => {
      const key = `${tl.line.index}:${token.ordinal}`
      hoveredKey.current = key
      clearHoverTimer()
      hoverTimer.current = setTimeout(() => {
        // Paused gate: only open while the video is (still) paused and the
        // pointer is (still) on this word.
        if (!video.paused || hoveredKey.current !== key) return

        const range = rangeFor(interaction.getState().selection, tl.line.index, tl.wordTokens)
        const overSelected = range && token.ordinal >= range.minOrd && token.ordinal <= range.maxOrd
        if (range && range.count > 1 && overSelected) {
          // Chunk gloss: the whole selected phrase, anchored at the pointer.
          const words = tl.wordTokens
            .slice(range.minOrd, range.maxOrd + 1)
            .map((w) => w.text)
            .join(' ')
          showGloss(tl.line.index, element, words, tl.line.text, { kind: 'chunk', tl })
        } else {
          showGloss(tl.line.index, element, token.text, tl.line.text, { kind: 'single', tl, token })
        }
      }, HOVER_DEBOUNCE_MS)
    },
    [video, showGloss, interaction]
  )

  const onWordEnter = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement) => {
      // A fresh hover supersedes any pending deferred hide from a prior word.
      cancelGlossHide()
      const state = interaction.getState()
      state.setHovered({ tl, token, element })

      // Drag-select: extend the active selection.
      if (state.selecting && state.selection && state.selection.lineIndex === tl.line.index) {
        state.setSelection({ ...state.selection, headOrdinal: token.ordinal })
      }

      // Always (re)arm the debounce for the word under the pointer. During a
      // drag this is the word that, on release, becomes the chunk anchor — its
      // pending timer is what opens the chunk gloss without a re-hover.
      scheduleHoverGloss(tl, token, element)
    },
    [interaction, scheduleHoverGloss, cancelGlossHide]
  )

  const onWordLeave = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      const key = `${tl.line.index}:${token.ordinal}`
      clearHoverTimer()
      if (hoveredKey.current === key) hoveredKey.current = null
      const state = interaction.getState()
      if (state.hovered?.token === token) state.setHovered(null)

      // For an active multi-word selection, let the chunk gloss persist (it
      // clears on selection change / play / subtitle change) — mirrors legacy.
      const range = rangeFor(state.selection, tl.line.index, tl.wordTokens)
      if (range && range.count > 1) return

      // Deferred so the pointer can reach the popover (to click Save) before it
      // hides — the popover's onMouseEnter cancels this.
      scheduleGlossHide()
    },
    [interaction, scheduleGlossHide]
  )

  const onWordContextMenu = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      const range = rangeFor(interaction.getState().selection, tl.line.index, tl.wordTokens)
      if (range) {
        saveSelection(tl)
      } else {
        saveSingle(tl.line, token)
      }
    },
    [interaction, saveSelection, saveSingle]
  )

  const onWordMouseDown = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      // Suppress the single-word gloss while starting a (possible) drag; the
      // mouseup handler re-arms the gloss for whatever ends up under the pointer.
      clearHoverTimer()
      const state = interaction.getState()
      state.setSelecting(true)
      state.setSelection({ lineIndex: tl.line.index, anchorOrdinal: token.ordinal, headOrdinal: token.ordinal })
    },
    [interaction]
  )

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

  // End drag selection on mouseup anywhere. If we were selecting and released
  // over a word, re-arm the gloss for it — mouseenter won't re-fire on the word
  // the pointer already sits on, so without this the chunk gloss never opens
  // after a multi-word drag (you'd have to leave and re-enter a selected word).
  useEffect(() => {
    const onMouseUp = () => {
      const state = interaction.getState()
      if (!state.selecting) return
      state.setSelecting(false)
      if (state.hovered) {
        scheduleHoverGloss(state.hovered.tl, state.hovered.token, state.hovered.element)
      }
    }
    window.addEventListener('mouseup', onMouseUp, true)
    return () => window.removeEventListener('mouseup', onMouseUp, true)
  }, [interaction, scheduleHoverGloss])

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

  // ---- render ----------------------------------------------------------------

  const lineStyleForOffset = snapshot.lines[0]?.style

  // The open popover's content, derived from the query (cached successes render
  // ready immediately; a disabled/idle query renders as loading, but the
  // tooltip only mounts while `gloss` is set).
  const glossContent: GlossContent = glossQuery.data
    ? { status: 'ready', data: glossQuery.data }
    : glossQuery.isError
      ? { status: 'error', message: glossQuery.error.message }
      : { status: 'loading' }

  return (
    <>
      {snapshot.visible && (
        <div data-asb-subtitles className='text-center'>
          {tokenized.map((tl) => {
            const range = selectionForLine(tl.line.index, tl.wordTokens)
            return (
              <div
                key={tl.line.index}
                data-track={tl.line.track}
                style={tl.line.style}
                className={`px-2.5 py-0.5 leading-normal whitespace-pre-wrap${
                  tl.line.blurred ? ' blur-[10px] hover:blur-none' : ''
                }`}
              >
                {tl.tokens.map((token, i) => {
                  const inRange =
                    range !== null && token.charStart >= range.startCharStart && token.charEnd <= range.endCharEnd
                  if (token.isWord) {
                    // Round only the run's outer corners so a multi-word selection
                    // reads as one continuous block (the flat backgrounds of the
                    // interior words/spaces merge), while keeping each word a direct
                    // child of the line — wrapping the run in a span would remount
                    // the words and detach the gloss anchor.
                    return (
                      <Word
                        key={i}
                        word={token.text}
                        sentence={tl.line.text}
                        selected={inRange}
                        roundStart={inRange && range !== null && token.charStart === range.startCharStart}
                        roundEnd={inRange && range !== null && token.charEnd === range.endCharEnd}
                        onEnter={(el) => onWordEnter(tl, token, el)}
                        onLeave={() => onWordLeave(tl, token)}
                        onContextMenu={() => onWordContextMenu(tl, token)}
                        onMouseDown={() => onWordMouseDown(tl, token)}
                      />
                    )
                  }
                  // Whitespace/punctuation between selected words: flat background,
                  // no rounding, so it fuses the adjacent words into one block.
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
          {/* anchor.isConnected: cached data could otherwise appear against a
              disconnected anchor after an element remount, before the
              cue-change effect has cleared the gloss. */}
          {snapshot.visible && gloss && gloss.anchor.isConnected && (
            <GlossTooltip
              anchor={gloss.anchor}
              word={gloss.word}
              content={glossContent}
              saveDisabledReason={closures.getFlicktionarySaveDisabledReason()}
              signedIn={signedIn}
              onSignIn={onSignIn}
              onSave={(studyIntent) => {
                if (gloss.save.kind === 'chunk') saveSelection(gloss.save.tl, studyIntent)
                else saveSingle(gloss.save.tl.line, gloss.save.token, studyIntent)
                hideGloss()
              }}
              onPointerEnter={cancelGlossHide}
              onPointerLeave={scheduleGlossHide}
            />
          )}
          {cefr && (
            <CefrPicker languageCode={cefr.targetLanguage} video={video} onPick={onCefrPick} onCancel={onCefrCancel} />
          )}
        </>,
        popoverContainer
      )}
    </>
  )
}
