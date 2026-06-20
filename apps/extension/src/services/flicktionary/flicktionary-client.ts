import {
  TabToExtensionCommand,
  DeleteFlicktionaryHighlightMessage,
  DeleteFlicktionaryHighlightResponse,
  FlicktionaryGlossMessage,
  FlicktionaryGlossResponse,
  FlicktionarySavedGlossMessage,
  FlicktionarySavedGlossResponse,
  FlicktionaryStartPairingMessage,
  FlicktionaryStudyFacetDto,
  GetFlicktionaryStudyTargetsMessage,
  GetFlicktionaryStudyTargetsResponse,
  LoadFlicktionarySavedHighlightsMessage,
  LoadFlicktionarySavedHighlightsResponse,
  SavedHighlightDto,
  SaveWordMessage,
  SaveWordResponse,
  SaveWordFastGloss,
  SaveWordFlicktionaryVideoContext,
  SaveWordStudyIntent,
  SetFlicktionaryCefrMessage,
  SetFlicktionaryCefrResponse,
  UpdateFlicktionaryHighlightNoteMessage,
  UpdateFlicktionaryHighlightNoteResponse,
} from '@asbplayer-fork/common'
import { v4 as uuidv4 } from 'uuid'

// Re-exported so UI call sites get the intent type alongside SaveWordParams.
export type { SavedHighlightDto, SaveWordStudyIntent, FlicktionaryStudyFacetDto } from '@asbplayer-fork/common'

// The three studiable skills, as the saved-mode popover toggles them.
export type FlicktionaryFacetSkill = 'meaning_recognition' | 'meaning_production' | 'pronunciation'

// Framework-agnostic Flicktionary messaging used by the React subtitle overlay.
// These functions are pure async over `browser.runtime.sendMessage` — they NEVER
// touch the DOM or show UI. All presentation (tooltip / toast / CEFR picker)
// stays in the caller.

// Structured gloss for the hover tooltip — mirrors the web app's fast-gloss
// popover (selection + IPA + gloss + POS/register). `ipaDisplay` is the
// server-picked, dialect-correct display string (the backend resolves the
// user's english_ipa_dialect pref) — rendered verbatim.
export interface GlossData {
  gloss: string
  pos: string | null
  register: string | null
  ipaDisplay: string | null
}

// The (segment index, char offsets) trio that resolves a clicked occurrence to
// a real `text_segments` row. In the React path these come straight from the
// rendered word's props (no `data-*` DOM round-trip). `endSegmentIndex` is
// undefined for a single-segment selection (matching the legacy payload).
export interface SaveWordSegmentInfo {
  startSegmentIndex: number
  endSegmentIndex: number | undefined
  startCharOffset: number
  endCharOffset: number
}

// The per-video closures that flow in from Binding.
export interface FlicktionaryVideoClosures {
  getVideoTitle: () => string
  getVideoUrl: () => string
  getFlicktionaryVideoContext: () => SaveWordFlicktionaryVideoContext | undefined
  getFlicktionarySaveDisabledReason: () => string | undefined
}

// Discriminated result of a save attempt, for the UI to act on. `highlight` is
// the created row (index coordinates) for optimistic saved-span painting;
// undefined when the background couldn't convert it — reload instead.
// `sessionId`/`targetLanguage` let the overlay store learn the session (and
// the tokenizer locale) on a video's FIRST save (its load ran before the
// session existed).
export type SaveWordOutcome =
  | { kind: 'saved'; word: string; highlight?: SavedHighlightDto; sessionId?: string; targetLanguage?: string }
  | { kind: 'disabled'; reason: string }
  | { kind: 'missing-cefr'; targetLanguage: string }
  | { kind: 'error'; message: string }

export type SetCefrResult = { ok: true } | { ok: false; message: string }

export async function requestGloss(
  word: string,
  sentence: string,
  // The video's detected subtitle language; undefined while unknown (the
  // background then falls back to the user's primary target language).
  targetLanguage?: string
): Promise<FlicktionaryGlossResponse> {
  const message: TabToExtensionCommand<FlicktionaryGlossMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'flicktionary-gloss',
      messageId: uuidv4(),
      selectionText: word,
      contextLine: sentence,
      targetLanguage,
    },
  }

  return await browser.runtime.sendMessage(message)
}

// Starts the Flicktionary pairing ("sign in") flow from the in-video overlay.
// The overlay can't open a tab itself, so it asks the background to mint a nonce
// and open the web pairing tab — same flow as the popup's sign-in button.
export async function startFlicktionaryPairing(): Promise<void> {
  const message: TabToExtensionCommand<FlicktionaryStartPairingMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'flicktionary-start-pairing',
      messageId: uuidv4(),
    },
  }

  await browser.runtime.sendMessage(message)
}

export interface SaveWordParams {
  word: string
  sentence: string
  translation: string
  segmentInfo?: SaveWordSegmentInfo
  closures: FlicktionaryVideoClosures
  // Study options from the gloss tooltip (full-set semantics; undefined =
  // backend default). Lives on the params so the CEFR-retry round-trip
  // (pendingSave) keeps the configured options for free.
  studyIntent?: SaveWordStudyIntent
  fastGloss?: SaveWordFastGloss
  // Set when this save is the automatic retry after the user picked a CEFR
  // level. Suppresses the missing-cefr outcome (don't re-show the picker) and
  // surfaces the message instead if the save still fails.
  isCefrRetry?: boolean
}

export async function saveWord({
  word,
  sentence,
  translation,
  segmentInfo,
  closures,
  studyIntent,
  fastGloss,
  isCefrRetry = false,
}: SaveWordParams): Promise<SaveWordOutcome> {
  const saveDisabledReason = closures.getFlicktionarySaveDisabledReason()
  if (saveDisabledReason) {
    return { kind: 'disabled', reason: saveDisabledReason }
  }

  const message: TabToExtensionCommand<SaveWordMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'save-word',
      messageId: uuidv4(),
      word,
      sentence,
      translation,
      videoTitle: closures.getVideoTitle(),
      videoUrl: closures.getVideoUrl(),
      segmentIndex: segmentInfo?.startSegmentIndex,
      endSegmentIndex: segmentInfo?.endSegmentIndex,
      startCharOffset: segmentInfo?.startCharOffset,
      endCharOffset: segmentInfo?.endCharOffset,
      flicktionaryVideo: closures.getFlicktionaryVideoContext(),
      studyIntent,
      ...(fastGloss ? { fastGloss } : {}),
    },
  }

  const response: SaveWordResponse = await browser.runtime.sendMessage(message)

  if (response.success) {
    return {
      kind: 'saved',
      word,
      highlight: response.highlight,
      sessionId: response.sessionId,
      targetLanguage: response.targetLanguage,
    }
  }

  // No CEFR level set for this language yet — let the caller offer an inline
  // picker, then retry the save (unless this already was the retry).
  if (response.code === 'MISSING_CEFR' && response.targetLanguage && !isCefrRetry) {
    return { kind: 'missing-cefr', targetLanguage: response.targetLanguage }
  }

  console.error('Failed to save word:', response.error)
  return { kind: 'error', message: response.error || 'Could not save to Flicktionary.' }
}

export async function setCefr(targetLanguage: string, cefrLevel: string): Promise<SetCefrResult> {
  const message: TabToExtensionCommand<SetFlicktionaryCefrMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'set-flicktionary-cefr',
      messageId: uuidv4(),
      targetLanguage,
      cefrLevel,
    },
  }

  // `response` is undefined if no background handler answered (e.g. the service
  // worker was mid-reload). Treat that as a failure rather than crashing.
  const response: SetFlicktionaryCefrResponse | undefined = await browser.runtime.sendMessage(message)
  if (!response?.success) {
    return { ok: false, message: response?.error || 'Could not set your level.' }
  }
  return { ok: true }
}

// CEFR levels offered by the in-video picker, ascending. Mirrors the web app's
// CEFR_LEVELS; kept local so the content script doesn't pull in web/core.
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

// ---- saved highlights (persistent spans + saved-mode popover) ----------------

export async function loadSavedHighlights(params: {
  source: 'youtube' | 'streaming'
  youtubeVideoId?: string
  contentHash: string
}): Promise<LoadFlicktionarySavedHighlightsResponse> {
  const message: TabToExtensionCommand<LoadFlicktionarySavedHighlightsMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'load-flicktionary-saved-highlights',
      messageId: uuidv4(),
      source: params.source,
      youtubeVideoId: params.youtubeVideoId,
      contentHash: params.contentHash,
    },
  }
  // Undefined if no background handler answered (service worker mid-reload) —
  // treat as a failed load; the caller leaves the store unloaded.
  const response: LoadFlicktionarySavedHighlightsResponse | undefined = await browser.runtime.sendMessage(message)
  return response ?? { success: false, signedIn: true, error: 'No response from background' }
}

export async function deleteSavedHighlight(sessionId: string, highlightId: string): Promise<boolean> {
  const message: TabToExtensionCommand<DeleteFlicktionaryHighlightMessage> = {
    sender: 'asbplayer-video-tab',
    message: { command: 'delete-flicktionary-highlight', messageId: uuidv4(), sessionId, highlightId },
  }
  const response: DeleteFlicktionaryHighlightResponse | undefined = await browser.runtime.sendMessage(message)
  return response?.success ?? false
}

export async function updateSavedHighlightNote(params: {
  sessionId: string
  highlightId: string
  note: string | null
  presetTags: string[]
  chatSeedPrompt: string | null
}): Promise<boolean> {
  const message: TabToExtensionCommand<UpdateFlicktionaryHighlightNoteMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'update-flicktionary-highlight-note',
      messageId: uuidv4(),
      sessionId: params.sessionId,
      highlightId: params.highlightId,
      note: params.note,
      presetTags: params.presetTags,
      chatSeedPrompt: params.chatSeedPrompt,
    },
  }
  const response: UpdateFlicktionaryHighlightNoteResponse | undefined = await browser.runtime.sendMessage(message)
  return response?.success ?? false
}

// Gloss for an existing highlight (saved-mode popover): server-cached, also
// refreshes older rows with Wiktionary IPA. Returns null on failure — the
// caller keeps whatever the cached fastGloss parse produced.
export async function fetchSavedGloss(sessionId: string, highlightId: string): Promise<GlossData | null> {
  const message: TabToExtensionCommand<FlicktionarySavedGlossMessage> = {
    sender: 'asbplayer-video-tab',
    message: { command: 'flicktionary-saved-gloss', messageId: uuidv4(), sessionId, highlightId },
  }
  const response: FlicktionarySavedGlossResponse | undefined = await browser.runtime.sendMessage(message)
  if (!response || response.error || response.gloss === undefined) return null
  return {
    gloss: response.gloss,
    pos: response.pos ?? null,
    register: response.register ?? null,
    ipaDisplay: response.ipaDisplay ?? null,
  }
}

// Reads a materialized term's live facets (post-enrich saved popover). Returns
// null on failure.
export async function fetchStudyTargets(chunkId: string): Promise<ReadonlyArray<FlicktionaryStudyFacetDto> | null> {
  const message: TabToExtensionCommand<GetFlicktionaryStudyTargetsMessage> = {
    sender: 'asbplayer-video-tab',
    message: { command: 'get-flicktionary-study-targets', messageId: uuidv4(), chunkId },
  }
  const response: GetFlicktionaryStudyTargetsResponse | undefined = await browser.runtime.sendMessage(message)
  if (!response?.success || !response.facets) return null
  return response.facets
}
