import {
  TabToExtensionCommand,
  FlicktionaryGlossMessage,
  FlicktionaryGlossResponse,
  FlicktionaryGlossIpa,
  FlicktionaryStartPairingMessage,
  SaveWordMessage,
  SaveWordResponse,
  SaveWordFlicktionaryVideoContext,
  SaveWordStudyIntent,
  SetFlicktionaryCefrMessage,
  SetFlicktionaryCefrResponse,
} from '@asbplayer-fork/common'
import { v4 as uuidv4 } from 'uuid'

// Re-exported so UI call sites get the intent type alongside SaveWordParams.
export type { SaveWordStudyIntent } from '@asbplayer-fork/common'

// Framework-agnostic Flicktionary messaging used by the React subtitle overlay.
// These functions are pure async over `browser.runtime.sendMessage` — they NEVER
// touch the DOM or show UI. All presentation (tooltip / toast / CEFR picker)
// stays in the caller.

// Structured gloss for the hover tooltip — mirrors the web app's fast-gloss
// popover (selection + IPA + gloss + POS/register).
export interface GlossData {
  gloss: string
  pos: string | null
  register: string | null
  ipa: FlicktionaryGlossIpa | null
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

// Discriminated result of a save attempt, for the UI to act on.
export type SaveWordOutcome =
  | { kind: 'saved'; word: string }
  | { kind: 'disabled'; reason: string }
  | { kind: 'missing-cefr'; targetLanguage: string }
  | { kind: 'error'; message: string }

export type SetCefrResult = { ok: true } | { ok: false; message: string }

export async function requestGloss(word: string, sentence: string): Promise<FlicktionaryGlossResponse> {
  const message: TabToExtensionCommand<FlicktionaryGlossMessage> = {
    sender: 'asbplayer-video-tab',
    message: {
      command: 'flicktionary-gloss',
      messageId: uuidv4(),
      selectionText: word,
      contextLine: sentence,
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

// Prefer General American, then Received Pronunciation, then an untagged entry
// — matching the fields the backend's GrammarIpaBag exposes.
export function pickIpa(ipa: FlicktionaryGlossIpa | null): string | null {
  if (!ipa) return null
  return ipa.ga ?? ipa.rp ?? ipa.untagged ?? null
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
    },
  }

  const response: SaveWordResponse = await browser.runtime.sendMessage(message)

  if (response.success) {
    return { kind: 'saved', word }
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
