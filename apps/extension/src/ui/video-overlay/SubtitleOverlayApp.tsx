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
  SavedHighlightDto,
  SaveWordParams,
  SaveWordSegmentInfo,
  SaveWordStudyIntent,
  deleteSavedHighlight,
  loadSavedHighlights,
  saveWord,
  setCefr,
  startFlicktionaryPairing,
} from '../../services/flicktionary/flicktionary-client'
import { getFlicktionaryAuth, onFlicktionaryAuthChange } from '../../services/flicktionary/auth-storage'
import { SubtitleLineModel, SubtitleStore } from './subtitle-store'
import { SAVED_SPAN_CLASS, SELECTION_SPAN_CLASS, Word } from './Word'
import { GlossContent, GlossTooltip, SavedGlossTooltip } from './GlossTooltip'
import { CefrPicker } from './CefrPicker'
import { toast } from 'sonner'
import { dispatchToast } from './toaster-host'
import { glossQueryClient } from './gloss-query-client'
import { glossQueryKey, useGloss } from './use-gloss'
import { createOverlayInteractionStore, SelectionState } from './overlay-interaction-store'
import { buildLineRanges, createSavedHighlightsStore, SavedLineRange } from './saved-highlights-store'

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

// Map a saved highlight back to the word-ordinal range it covers on a line
// (intersection, same drift tolerance as the paint). Used by the right-click
// remove to swap the saved-mode popover into the preview gloss for the SAME
// span. Null for cross-cue highlights (the chunk gloss is single-line) or when
// no word intersects.
const ordinalRangeForHighlight = (tl: TokenizedLine, h: SavedHighlightDto) => {
  if (h.startSegmentIndex !== tl.line.index || h.endSegmentIndex !== tl.line.index) return null
  const words = tl.wordTokens.filter((w) => w.charStart < h.endOffset && w.charEnd > h.startOffset)
  if (words.length === 0) return null
  return { minOrd: words[0].ordinal, maxOrd: words[words.length - 1].ordinal }
}

// What an explicit Save from the gloss popover should persist — captured when
// the gloss opens, since the hovered word is cleared by the time the pointer
// has moved onto the popover. The chunk range is SNAPSHOTTED (ordinals, not
// the live selection) so Save stays correct even if the selection is cleared
// independently of the gloss (play / cue change / a new mousedown).
type GlossSaveTarget =
  | { kind: 'single'; tl: TokenizedLine; token: LineToken }
  | { kind: 'chunk'; tl: TokenizedLine; minOrd: number; maxOrd: number }

// Where to re-open the popover after a Save from the gloss preview: the saved
// outcome swaps the preview into the saved-mode popover IN PLACE (web
// gloss-sheet parity — there Save morphs the open sheet into saved mode).
// `hover` sets the swapped-in popover's dismissal mode: the Save button swaps
// in STICKY (the pointer is inside the popover), while the right-click toggle
// swaps in hover-mode (the pointer is on the word; the popover yields on
// word-leave so rapid right-click saving isn't blocked by a sticky popover).
interface GlossSaveHandoff {
  lineIndex: number
  anchor: HTMLElement
  hover: boolean
}

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

// Which saved-mode popover is open. Stores the highlight ID (not the object):
// the live row is re-read from the saved-highlights store at render so a note
// patch shows on re-open and an elsewhere-deleted row closes the popover.
interface SavedPopoverState {
  lineIndex: number
  anchor: HTMLElement
  highlightId: string
  // True while the popover was opened by HOVERING the saved span (not a click)
  // and the pointer hasn't entered it yet: it then dismisses like the hover
  // gloss (the 150 ms grace timer on word-leave) and yields to hovering other
  // words. The pointer entering the popover — or a click open — makes it
  // sticky (hover: false): outside pointerdown / play / cue change dismiss it.
  hover: boolean
}

// How many times (2s apart) the load effect re-polls for the binding's video
// context — it is set asynchronously after subtitles load, so the first load
// attempt can race it.
const SAVED_LOAD_CONTEXT_RETRIES = 3
const SAVED_LOAD_CONTEXT_RETRY_MS = 2000

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
  // Ref twin so the async save outcome can check whether the open gloss is
  // still the one the user saved from (it may have moved to another word).
  const glossRef = useRef<GlossState | null>(null)
  glossRef.current = gloss
  // A Save is in flight from the open gloss — renders the Save button as
  // "Saving…" until the outcome swaps the preview into the saved-mode popover.
  const [glossSaving, setGlossSaving] = useState(false)
  const [cefr, setCefrState] = useState<CefrState | null>(null)

  // Persistent saved-highlight spans, one store per overlay mount. Rendering
  // subscribes to `highlights`/`sessionId`; the imperative handlers read
  // getState(). `savedPopover` is the open saved-mode popover (sticky, unlike
  // the hover gloss); its ref twin lets stable callbacks check it without
  // re-subscribing.
  const [savedStore] = useState(() => createSavedHighlightsStore())
  const savedHighlights = useStore(savedStore, (s) => s.highlights)
  const savedSessionId = useStore(savedStore, (s) => s.sessionId)
  const [savedPopover, setSavedPopover] = useState<SavedPopoverState | null>(null)
  const savedPopoverRef = useRef<SavedPopoverState | null>(null)
  savedPopoverRef.current = savedPopover

  const queryClient = useQueryClient()
  // The open popover's content. Keyed by (word, sentence): successes cache
  // (re-hover is instant), errors throw and are NOT cached (re-hover
  // refetches — a "Sign in to translate" error must not survive sign-in).
  const glossQuery = useGloss(gloss?.word, gloss?.sentence, gloss !== null)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pending deferred hide of the gloss popover (the hover-bridge grace timer).
  const glossHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredKey = useRef<string | null>(null)
  // Once the pointer has ENTERED the gloss popover it is pinned: pointer-leave
  // no longer hides it (so picking study options can't be lost to a stray
  // mouse move), only outside pointerdown / play / cue change / a new hover
  // gloss replacing it. A hover that never enters the popover keeps the light
  // hover-out dismissal — the quick-lookup flow stays friction-free.
  const glossPinnedRef = useRef(false)

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
    glossPinnedRef.current = false
    setGlossSaving(false)
    setGloss(null)
  }, [cancelGlossHide])

  // Defer the hide so the pointer can cross the gap into the popover; entering
  // the popover calls cancelGlossHide, leaving it (or this firing) hides.
  // No-op while pinned — a pinned gloss only dismisses explicitly. Also sweeps
  // a HOVER-mode saved popover (it shares the hover gloss's dismissal until
  // the pointer enters it and flips it sticky).
  const scheduleGlossHide = useCallback(() => {
    if (glossPinnedRef.current) return
    cancelGlossHide()
    glossHideTimer.current = setTimeout(() => {
      glossHideTimer.current = null
      hideGloss()
      if (savedPopoverRef.current?.hover) setSavedPopover(null)
    }, GLOSS_HIDE_GRACE_MS)
  }, [cancelGlossHide, hideGloss])

  // Hover bridge + pin: entering the popover cancels any pending hide AND pins
  // the gloss (see glossPinnedRef).
  const onGlossPointerEnter = useCallback(() => {
    glossPinnedRef.current = true
    cancelGlossHide()
  }, [cancelGlossHide])

  // Outside pointerdown is the dismiss gesture for a PINNED gloss (same
  // gesture as the saved-mode popover). Unpinned glosses ignore it — their
  // pointer-leave dismissal already covers every exit, and hiding here would
  // flicker the popover on a click on the anchor word itself.
  const onGlossOutsidePointerDown = useCallback(() => {
    if (glossPinnedRef.current) hideGloss()
  }, [hideGloss])

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

  // ---- saved highlights load ---------------------------------------------------

  // The contentHash whose highlights are currently in the store — load gate so
  // cue-change re-runs are a string compare, and reset to null to force a
  // reload (sign-in, missing optimistic highlight after a save).
  const savedLoadedHashRef = useRef<string | null>(null)

  // Load (or reload) the saved highlights for the current video. One backend
  // call per (mount/sign-in/contentHash); a no-session video resolves to an
  // empty list and won't re-call until the hash changes or a save lands.
  const loadSaved = useCallback(() => {
    const ctx = closures.getFlicktionaryVideoContext()
    if (!ctx || savedLoadedHashRef.current === ctx.contentHash) return
    const hash = ctx.contentHash
    // Claim the hash before the await so concurrent triggers (cue change +
    // retry timer) don't double-load; reset on failure so a retry can re-claim.
    savedLoadedHashRef.current = hash
    void loadSavedHighlights({ source: ctx.source, youtubeVideoId: ctx.youtubeVideoId, contentHash: hash }).then(
      (res) => {
        if (savedLoadedHashRef.current !== hash) return
        if (!res.success) {
          savedLoadedHashRef.current = null
          return
        }
        if (!res.signedIn) {
          savedStore.getState().setAll(null, [])
          return
        }
        savedStore.getState().setAll(res.sessionId ?? null, res.highlights ?? [])
      }
    )
  }, [closures, savedStore])

  // Mount + sign-in trigger, with a short retry while the binding's video
  // context is still being set (it lands asynchronously after subtitles load).
  // Signing out clears the spans immediately.
  useEffect(() => {
    if (!signedIn) {
      savedStore.getState().reset()
      savedLoadedHashRef.current = null
      return
    }
    savedLoadedHashRef.current = null
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const tryLoad = () => {
      timer = null
      if (!closures.getFlicktionaryVideoContext() && attempts++ < SAVED_LOAD_CONTEXT_RETRIES) {
        timer = setTimeout(tryLoad, SAVED_LOAD_CONTEXT_RETRY_MS)
        return
      }
      loadSaved()
    }
    tryLoad()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [signedIn, closures, savedStore, loadSaved])

  // contentHash-change trigger: the subtitle track can be swapped mid-video
  // (new hash, new session). Cue changes re-run this; the hash compare inside
  // loadSaved makes it a no-op until the track actually changes.
  useEffect(() => {
    if (signedIn && snapshot.lines.length > 0) loadSaved()
  }, [signedIn, snapshot.lines, loadSaved])

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

  // The saved span a token sits on, if any. Intersection, not exact offsets —
  // tolerates tokenizer drift against web-created highlights (same rule as the
  // paint). Reads the live store so stable handlers can call it.
  const savedRangeForToken = useCallback(
    (tl: TokenizedLine, token: LineToken) => {
      const ranges = buildLineRanges(savedStore.getState().highlights, tl.line.index, tl.line.text.length)
      return ranges.find((r) => token.charStart < r.end && token.charEnd > r.start) ?? null
    },
    [savedStore]
  )

  // A saved highlight EXACTLY matching a word-ordinal chunk on one line — the
  // chunk twin of the single-word toggle check, so right-clicking a re-selected
  // identical chunk removes it instead of saving a duplicate.
  const findSavedChunkExact = useCallback(
    (tl: TokenizedLine, minOrd: number, maxOrd: number): SavedHighlightDto | null => {
      const words = tl.wordTokens.slice(minOrd, maxOrd + 1)
      if (words.length === 0) return null
      const start = words[0].charStart
      const end = words[words.length - 1].charEnd
      return (
        savedStore
          .getState()
          .highlights.find(
            (h) =>
              h.startSegmentIndex === tl.line.index &&
              h.endSegmentIndex === tl.line.index &&
              h.startOffset === start &&
              h.endOffset === end
          ) ?? null
      )
    },
    [savedStore]
  )

  // ---- save flow -------------------------------------------------------------

  // Segment-coordinate keys of saves currently in flight. Guards the unbuttoned
  // right-click path: a double right-click faster than the save roundtrip would
  // otherwise create two identical highlights (the toggle can only see a save
  // once it lands in the store).
  const pendingSavesRef = useRef<Set<string>>(new Set())

  const handleOutcome = useCallback(
    async (params: SaveWordParams, handoff?: GlossSaveHandoff) => {
      const si = params.segmentInfo
      const saveKey = si ? `${si.startSegmentIndex}:${si.startCharOffset}:${si.endCharOffset}` : null
      if (saveKey) {
        if (pendingSavesRef.current.has(saveKey)) return
        pendingSavesRef.current.add(saveKey)
      }
      const outcome = await saveWord(params).finally(() => {
        if (saveKey) pendingSavesRef.current.delete(saveKey)
      })
      // Close the "Saving…" preview the save came from — but never a DIFFERENT
      // word's gloss the user opened while the save was in flight (showGloss
      // already reset its saving state).
      const hideSaveSourceGloss = () => {
        const g = glossRef.current
        if (handoff && g && g.anchor === handoff.anchor) hideGloss()
      }
      switch (outcome.kind) {
        case 'saved': {
          clearSelection()
          // Paint the saved span immediately from the create response; a
          // response without the converted highlight (segment-map miss) falls
          // back to a full reload.
          if (outcome.highlight) {
            savedStore.getState().add(outcome.highlight, outcome.sessionId)
          } else {
            savedLoadedHashRef.current = null
            loadSaved()
          }
          // In-place handoff (web gloss-sheet parity): the preview the user
          // saved from becomes the saved-mode popover, so note/tags/Remove are
          // immediately reachable. When the swap can't anchor (segment-map
          // miss, video resumed, cue changed, or the user already hovered a
          // different word's gloss) the gloss just closes — no success toast;
          // the span turning yellow is the feedback, and a toast per word gets
          // noisy when the user saves dozens in a row (web parity).
          const sessionId = outcome.sessionId ?? savedStore.getState().sessionId
          const g = glossRef.current
          if (
            handoff &&
            outcome.highlight &&
            sessionId &&
            video.paused &&
            handoff.anchor.isConnected &&
            (g === null || g.anchor === handoff.anchor)
          ) {
            hideGloss()
            setSavedPopover({
              lineIndex: handoff.lineIndex,
              anchor: handoff.anchor,
              highlightId: outcome.highlight.id,
              hover: handoff.hover,
            })
          } else {
            hideSaveSourceGloss()
          }
          break
        }
        case 'disabled':
          // Video-context gate (e.g. off YouTube), not an auth issue — no Sign in.
          hideSaveSourceGloss()
          showToast(outcome.reason, true)
          clearSelection()
          break
        case 'error':
          // Surfaces the "Sign in to Flicktionary to save words." error when the
          // save is blocked on pairing — offer a Sign in action then, same flow
          // as the popup button.
          hideSaveSourceGloss()
          showToast(
            outcome.message,
            true,
            interaction.getState().signedIn ? undefined : { label: i18n._(msg`Sign in`), onClick: onSignIn }
          )
          clearSelection()
          break
        case 'missing-cefr':
          // pendingSave carries the full word/segment context for the retry.
          hideSaveSourceGloss()
          setCefrState({ targetLanguage: outcome.targetLanguage, pendingSave: params })
          break
      }
    },
    [showToast, clearSelection, onSignIn, interaction, savedStore, loadSaved, hideGloss, video]
  )

  const saveSingle = useCallback(
    (line: SubtitleLineModel, token: LineToken, studyIntent?: SaveWordStudyIntent, handoff?: GlossSaveHandoff) => {
      const translation = queryClient.getQueryData<GlossData>(glossQueryKey(token.text, line.text))?.gloss ?? ''
      const segmentInfo: SaveWordSegmentInfo = {
        startSegmentIndex: line.index,
        endSegmentIndex: undefined,
        startCharOffset: token.charStart,
        endCharOffset: token.charEnd,
      }
      void handleOutcome(
        { word: token.text, sentence: line.text, translation, segmentInfo, closures, studyIntent },
        handoff
      )
    },
    [closures, handleOutcome, queryClient]
  )

  // Save a multi-word chunk by its snapshotted word-ordinal range (see
  // GlossSaveTarget — the live selection is already cleared by save time).
  const saveChunk = useCallback(
    (
      tl: TokenizedLine,
      minOrd: number,
      maxOrd: number,
      studyIntent?: SaveWordStudyIntent,
      handoff?: GlossSaveHandoff
    ) => {
      const selectedWords = tl.wordTokens.slice(minOrd, maxOrd + 1)
      if (selectedWords.length === 0) return
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
      void handleOutcome(
        { word: words, sentence: tl.line.text, translation, segmentInfo, closures, studyIntent },
        handoff
      )
    },
    [closures, handleOutcome, queryClient]
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
      // A new gloss target starts unpinned (fresh hover semantics) and is not
      // mid-save.
      glossPinnedRef.current = false
      setGlossSaving(false)
      setGloss({ lineIndex, anchor, word, sentence, save })
    },
    []
  )

  // Open the chunk gloss for a snapshotted word range, BORN PINNED: a chunk is
  // an intentional drag gesture, so it dismisses like a pinned gloss (outside
  // pointerdown / play / cue change / hovering another word replaces it),
  // never on a stray hover-out — re-creating it would mean re-dragging.
  const openChunkGloss = useCallback(
    (tl: TokenizedLine, anchor: HTMLElement, minOrd: number, maxOrd: number) => {
      const words = tl.wordTokens
        .slice(minOrd, maxOrd + 1)
        .map((w) => w.text)
        .join(' ')
      showGloss(tl.line.index, anchor, words, tl.line.text, { kind: 'chunk', tl, minOrd, maxOrd })
      // showGloss arms the unpinned default; chunk glosses override it.
      glossPinnedRef.current = true
    },
    [showGloss]
  )

  // Arm the 300ms hover debounce for the word under the pointer. On fire it
  // opens the chunk gloss if that word is inside an active multi-word
  // selection, the saved-mode popover (hover variant) if the word sits on a
  // saved span, else the single-word gloss. Reads the live selection from the
  // store so it's correct when called from `mouseup` after a drag. Stable
  // identity (no selection dep).
  const scheduleHoverGloss = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement) => {
      const key = `${tl.line.index}:${token.ordinal}`
      hoveredKey.current = key
      clearHoverTimer()
      hoverTimer.current = setTimeout(() => {
        // Paused gate: only open while the video is (still) paused and the
        // pointer is (still) on this word. A STICKY saved-mode popover wins
        // over the hover preview (note editing may be in progress); a
        // hover-opened one yields — hovering another word replaces it.
        const sp = savedPopoverRef.current
        if (!video.paused || hoveredKey.current !== key || (sp && !sp.hover)) return

        const range = rangeFor(interaction.getState().selection, tl.line.index, tl.wordTokens)
        const overSelected = range && token.ordinal >= range.minOrd && token.ordinal <= range.maxOrd
        if (range && range.count > 1 && overSelected) {
          // Chunk gloss mid-drag (the pointer paused on a selected word): the
          // whole selected phrase, anchored at the pointer.
          if (sp) setSavedPopover(null)
          openChunkGloss(tl, element, range.minOrd, range.maxOrd)
          return
        }
        // A saved word shows its saved-mode popover (note/tags/Remove, no
        // second Save button), not the preview gloss — hovering and clicking
        // a saved span now agree. Hover semantics until the pointer enters it.
        const savedRange = savedRangeForToken(tl, token)
        if (savedRange) {
          hideGloss()
          setSavedPopover({
            lineIndex: tl.line.index,
            anchor: element,
            highlightId: savedRange.highlightId,
            hover: true,
          })
          return
        }
        if (sp) setSavedPopover(null)
        showGloss(tl.line.index, element, token.text, tl.line.text, { kind: 'single', tl, token })
      }, HOVER_DEBOUNCE_MS)
    },
    [video, showGloss, openChunkGloss, interaction, savedRangeForToken, hideGloss]
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

      // Over a multi-word selection (mid-drag or persisting post-release):
      // don't hide-schedule — the chunk gloss persists with its selection
      // (and is pinned besides).
      const range = rangeFor(state.selection, tl.line.index, tl.wordTokens)
      if (range && range.count > 1) return

      // Deferred so the pointer can reach the popover (to click Save) before it
      // hides — the popover's onMouseEnter cancels this.
      scheduleGlossHide()
    },
    [interaction, scheduleGlossHide]
  )

  // The right-click toggle's remove half. No success toast — the yellow wash
  // disappearing is the feedback (mirrors the silent save). The store update
  // waits for the server ack (same as the saved popover's Remove); failures
  // still toast. `swapCtx` (the right-clicked word) lets an open saved-mode
  // popover for the removed highlight swap into the PREVIEW gloss for the same
  // span instead of just vanishing — the visible counterpart of the save
  // direction's preview→saved swap. With no popover open the removal stays
  // silent.
  const removeHighlight = useCallback(
    (highlightId: string, swapCtx?: { tl: TokenizedLine; element: HTMLElement }) => {
      const sessionId = savedStore.getState().sessionId
      if (!sessionId) return
      // Captured before the delete: the offsets are gone from the store after.
      const highlight = savedStore.getState().highlights.find((h) => h.id === highlightId) ?? null
      clearSelection()
      void deleteSavedHighlight(sessionId, highlightId).then((ok) => {
        if (!ok) {
          showToast(i18n._(msg`Could not remove the highlight.`), true)
          return
        }
        savedStore.getState().remove(highlightId)
        if (savedPopoverRef.current?.highlightId !== highlightId) return
        setSavedPopover(null)
        // Swap to the preview gloss for the removed span (chunk gloss for a
        // multi-word highlight — born pinned, as chunk glosses are; plain
        // hover gloss for a single word). Skipped when the video resumed, the
        // cue changed (disconnected anchor), or the highlight was cross-cue
        // (no single-line chunk target exists).
        if (!swapCtx || !highlight || !video.paused || !swapCtx.element.isConnected) return
        const ords = ordinalRangeForHighlight(swapCtx.tl, highlight)
        if (!ords) return
        if (ords.maxOrd > ords.minOrd) {
          openChunkGloss(swapCtx.tl, swapCtx.element, ords.minOrd, ords.maxOrd)
        } else {
          const word = swapCtx.tl.wordTokens[ords.minOrd]
          if (!word) return
          showGloss(swapCtx.tl.line.index, swapCtx.element, word.text, swapCtx.tl.line.text, {
            kind: 'single',
            tl: swapCtx.tl,
            token: word,
          })
        }
      })
    },
    [savedStore, clearSelection, showToast, video, openChunkGloss, showGloss]
  )

  // Right-click is a TOGGLE: it saves the word/chunk under the pointer, or —
  // when that exact chunk / a span the word sits on is already saved — removes
  // it, so repeated right-clicks cycle save → remove instead of stacking
  // duplicates. An OPEN popover stays open and morphs through the toggle: a
  // save from an open gloss rides the in-place handoff (preview → saved-mode
  // popover, same as the Save button), and a remove swaps an open saved-mode
  // popover back into the preview gloss (see removeHighlight). With no popover
  // open the toggle stays silent — the wash is the feedback. The pending hover
  // debounce is cleared so it can't pop a stale preview over the result.
  const onWordContextMenu = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement) => {
      const g = glossRef.current
      clearHoverTimer()
      const toggleChunk = (chunkTl: TokenizedLine, minOrd: number, maxOrd: number, handoff?: GlossSaveHandoff) => {
        const exact = findSavedChunkExact(chunkTl, minOrd, maxOrd)
        if (exact) {
          // An open chunk gloss survives the remove untouched — it already IS
          // the preview state for this span (Save offers the re-save).
          removeHighlight(exact.id, { tl: chunkTl, element })
        } else {
          if (handoff) setGlossSaving(true)
          saveChunk(chunkTl, minOrd, maxOrd, undefined, handoff)
        }
      }
      // Right-click on a word inside an open chunk gloss acts on the chunk (the
      // live selection is already cleared once the gloss is open — the gloss
      // target is the selection's surviving representation). The open gloss is
      // the handoff anchor: it morphs into the saved-mode popover on save.
      if (
        g &&
        g.save.kind === 'chunk' &&
        g.save.tl.line.index === tl.line.index &&
        token.ordinal >= g.save.minOrd &&
        token.ordinal <= g.save.maxOrd
      ) {
        toggleChunk(g.save.tl, g.save.minOrd, g.save.maxOrd, { lineIndex: g.lineIndex, anchor: g.anchor, hover: true })
        return
      }
      // Mid-drag right-click: the live selection still exists (no popover yet).
      const range = rangeFor(interaction.getState().selection, tl.line.index, tl.wordTokens)
      if (range && range.count > 1) {
        toggleChunk(tl, range.minOrd, range.maxOrd)
        return
      }
      // Single word on a saved span (intersection — also any word of a saved
      // chunk): remove, swapping an open saved-mode popover into the preview.
      const savedRange = savedRangeForToken(tl, token)
      if (savedRange) {
        removeHighlight(savedRange.highlightId, { tl, element })
        return
      }
      // Single-word save. If this word's own gloss is open, ride the in-place
      // handoff (popover stays, shows "Saving…", morphs into saved mode).
      const glossIsForToken =
        g &&
        g.save.kind === 'single' &&
        g.save.tl.line.index === tl.line.index &&
        g.save.token.ordinal === token.ordinal
      if (glossIsForToken) {
        setGlossSaving(true)
        saveSingle(tl.line, token, undefined, { lineIndex: g.lineIndex, anchor: g.anchor, hover: true })
      } else {
        saveSingle(tl.line, token)
      }
    },
    [interaction, saveChunk, saveSingle, findSavedChunkExact, savedRangeForToken, removeHighlight]
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

  // ---- saved-mode popover ------------------------------------------------------

  // Open the saved-mode popover for a clicked token that intersects a saved
  // span. Reads the live store (not the memoized render ranges) so the stable
  // mouseup handler can call it without re-subscribing. Returns false when the
  // token isn't on a saved span.
  const openSavedPopover = useCallback(
    (tl: TokenizedLine, token: LineToken, element: HTMLElement): boolean => {
      const range = savedRangeForToken(tl, token)
      if (!range) return false
      clearHoverTimer()
      hideGloss()
      interaction.getState().clearSelection()
      // A click open is sticky from the start (unlike the hover-opened variant).
      setSavedPopover({ lineIndex: tl.line.index, anchor: element, highlightId: range.highlightId, hover: false })
      return true
    },
    [savedRangeForToken, interaction, hideGloss]
  )

  const closeSavedPopover = useCallback(() => setSavedPopover(null), [])

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

  // End drag selection on mouseup anywhere. The painted selection PERSISTS
  // after release (deliberate, and the web's painter was aligned to this):
  // the sky wash keeps showing what the open popover refers to, and clears on
  // save / play / cue change / saved-popover open / the next mousedown. A
  // multi-word drag opens the chunk gloss immediately (no hover debounce,
  // like the web sheet); a plain click on a saved span opens the saved-mode
  // popover; any other click re-arms the hover gloss for the word under the
  // pointer (mouseenter won't re-fire on the word the pointer already sits on).
  useEffect(() => {
    const onMouseUp = () => {
      const state = interaction.getState()
      if (!state.selecting) return
      state.setSelecting(false)
      const sel = state.selection
      const hovered = state.hovered
      const range =
        sel && hovered && hovered.tl.line.index === sel.lineIndex
          ? rangeFor(sel, hovered.tl.line.index, hovered.tl.wordTokens)
          : null
      if (!hovered) return
      if (range && range.count > 1) {
        // The pending hover debounce reads the (now cleared) live selection —
        // it would race this open with a single-word gloss.
        clearHoverTimer()
        if (video.paused && !savedPopoverRef.current) {
          openChunkGloss(hovered.tl, hovered.element, range.minOrd, range.maxOrd)
        }
        return
      }
      // Plain click (no drag: anchor == head) on a saved span opens the
      // saved-mode popover instead of the hover preview — saved wins.
      if (
        sel &&
        sel.anchorOrdinal === sel.headOrdinal &&
        hovered.tl.line.index === sel.lineIndex &&
        openSavedPopover(hovered.tl, hovered.token, hovered.element)
      ) {
        return
      }
      scheduleHoverGloss(hovered.tl, hovered.token, hovered.element)
    }
    window.addEventListener('mouseup', onMouseUp, true)
    return () => window.removeEventListener('mouseup', onMouseUp, true)
  }, [interaction, scheduleHoverGloss, openSavedPopover, openChunkGloss, video])

  // Resuming playback clears the hover gloss, the saved popover, and any
  // selection (legacy parity).
  useEffect(() => {
    const onPlaying = () => {
      clearHoverTimer()
      hideGloss()
      clearSelection()
      setSavedPopover(null)
    }
    video.addEventListener('playing', onPlaying)
    return () => video.removeEventListener('playing', onPlaying)
  }, [video, hideGloss, clearSelection])

  // Drop stale gloss/selection/saved-popover when their line is no longer
  // showing (the cue changed). React keys keep word elements stable while a
  // cue persists.
  useEffect(() => {
    const presentIndices = new Set(snapshot.lines.map((l) => l.index))
    if (gloss && !presentIndices.has(gloss.lineIndex)) hideGloss()
    if (selection && !presentIndices.has(selection.lineIndex)) clearSelection()
    if (savedPopover && !presentIndices.has(savedPopover.lineIndex)) setSavedPopover(null)
  }, [snapshot.lines, gloss, selection, savedPopover, hideGloss, clearSelection])

  // Hidden (display off / force-hide): tear down transient interaction UI.
  useEffect(() => {
    if (!snapshot.visible) {
      clearHoverTimer()
      hideGloss()
      clearSelection()
      setCefrState(null)
      setSavedPopover(null)
    }
  }, [snapshot.visible, hideGloss, clearSelection])

  // ---- render ----------------------------------------------------------------

  const lineStyleForOffset = snapshot.lines[0]?.style

  // Saved spans per visible line — recomputed when the highlights or the
  // visible cues change (both infrequent next to pointer churn).
  const savedRangesByLine = useMemo(() => {
    const byLine = new Map<number, SavedLineRange[]>()
    if (savedHighlights.length === 0) return byLine
    for (const tl of tokenized) {
      const ranges = buildLineRanges(savedHighlights, tl.line.index, tl.line.text.length)
      if (ranges.length > 0) byLine.set(tl.line.index, ranges)
    }
    return byLine
  }, [savedHighlights, tokenized])

  // The saved popover's live highlight row — re-read from the store so a note
  // patch shows on re-open; vanished (deleted elsewhere) closes the popover.
  const savedPopoverHighlight = savedPopover
    ? (savedHighlights.find((h) => h.id === savedPopover.highlightId) ?? null)
    : null

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
            const savedRanges = savedRangesByLine.get(tl.line.index)
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
                  // Saved-span paint: tokens INTERSECTING a saved range (not
                  // exact-offset matches) so web-created highlights whose
                  // offsets drift from this tokenizer still paint.
                  const savedRange = savedRanges?.find((r) => token.charStart < r.end && token.charEnd > r.start)
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
                        saved={!!savedRange}
                        savedRoundStart={!!savedRange && token.charStart <= savedRange.start}
                        savedRoundEnd={!!savedRange && token.charEnd >= savedRange.end}
                        onEnter={(el) => onWordEnter(tl, token, el)}
                        onLeave={() => onWordLeave(tl, token)}
                        onContextMenu={(el) => onWordContextMenu(tl, token, el)}
                        onMouseDown={() => onWordMouseDown(tl, token)}
                      />
                    )
                  }
                  // Whitespace/punctuation between selected/saved words: flat
                  // background, no rounding, so it fuses the adjacent words
                  // into one block (selection wins over saved).
                  const fillerSaved =
                    !inRange && savedRanges?.some((r) => token.charStart >= r.start && token.charEnd <= r.end)
                  return inRange ? (
                    <span key={i} className={SELECTION_SPAN_CLASS}>
                      {token.text}
                    </span>
                  ) : fillerSaved ? (
                    <span key={i} className={SAVED_SPAN_CLASS}>
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
          {/* Saved-mode popover (sticky; wins over the hover preview). Same
              anchor.isConnected guard as the hover gloss. */}
          {snapshot.visible &&
            savedPopover &&
            savedPopoverHighlight &&
            savedSessionId &&
            savedPopover.anchor.isConnected && (
              <SavedGlossTooltip
                anchor={savedPopover.anchor}
                sessionId={savedSessionId}
                highlight={savedPopoverHighlight}
                onRemoved={() => {
                  // No success toast — the yellow wash disappearing is the
                  // feedback (web parity; saves are equally silent).
                  savedStore.getState().remove(savedPopoverHighlight.id)
                  setSavedPopover(null)
                }}
                onNotePatched={(note, presetTags) =>
                  savedStore.getState().patchNote(savedPopoverHighlight.id, note, presetTags)
                }
                onClose={closeSavedPopover}
                onPointerEnter={() => {
                  // Hover bridge for a hover-opened popover: entering cancels
                  // the pending word-leave hide and pins it sticky.
                  cancelGlossHide()
                  setSavedPopover((sp) => (sp?.hover ? { ...sp, hover: false } : sp))
                }}
              />
            )}
          {/* anchor.isConnected: cached data could otherwise appear against a
              disconnected anchor after an element remount, before the
              cue-change effect has cleared the gloss. */}
          {snapshot.visible && !savedPopover && gloss && gloss.anchor.isConnected && (
            <GlossTooltip
              anchor={gloss.anchor}
              word={gloss.word}
              content={glossContent}
              saveDisabledReason={closures.getFlicktionarySaveDisabledReason()}
              signedIn={signedIn}
              onSignIn={onSignIn}
              saving={glossSaving}
              onSave={(studyIntent) => {
                // Keep the popover open ("Saving…") — the saved outcome swaps
                // it into the saved-mode popover in place (or toasts on the
                // fallback paths).
                setGlossSaving(true)
                // Sticky swap: the pointer is inside the popover (it clicked Save).
                const handoff: GlossSaveHandoff = { lineIndex: gloss.lineIndex, anchor: gloss.anchor, hover: false }
                if (gloss.save.kind === 'chunk')
                  saveChunk(gloss.save.tl, gloss.save.minOrd, gloss.save.maxOrd, studyIntent, handoff)
                else saveSingle(gloss.save.tl.line, gloss.save.token, studyIntent, handoff)
              }}
              onPointerEnter={onGlossPointerEnter}
              onPointerLeave={scheduleGlossHide}
              onOutsidePointerDown={onGlossOutsidePointerDown}
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
