import type { MiscSettings, PageSettings, SettingsFormPageConfig, SubtitleSettings } from '../settings/settings'
import {
  RectModel,
  SubtitleModel,
  AudioTrackModel,
  ConfirmedVideoDataSubtitleTrack,
  PlayMode,
  VideoTabModel,
  RichSubtitleModel,
} from './model'
import { AsbPlayerToVideoCommandV2 } from './command'

export interface Message {
  readonly command: string
}

export interface MessageWithId extends Message {
  readonly messageId: string
}

export interface AsbplayerInstance {
  id: string
  tabId?: number
  timestamp: number
  videoPlayer: boolean
}

export interface AsbplayerHeartbeatMessage extends Message {
  readonly command: 'heartbeat'
  readonly id: string
  readonly receivedTabs?: VideoTabModel[]
  readonly videoPlayer: boolean
  readonly loadedSubtitles?: boolean
  readonly syncedVideoElement?: VideoTabModel
}

export interface AckTabsMessage extends Message {
  readonly command: 'ackTabs'
  readonly id: string
  readonly receivedTabs: VideoTabModel[]
  readonly videoPlayer: boolean
  readonly loadedSubtitles?: boolean
  readonly syncedVideoElement?: VideoTabModel
}

export interface TabsMessage extends Message {
  readonly command: 'tabs'
  readonly tabs: VideoTabModel[]
  readonly asbplayers: AsbplayerInstance[]
  readonly ackRequested: boolean
}

export interface VideoHeartbeatMessage extends Message {
  readonly command: 'heartbeat'
  readonly subscribed: boolean
  readonly synced: boolean
  readonly syncedTimestamp?: number
  readonly loadedSubtitles: boolean
}

export interface VideoDisappearedMessage extends Message {
  readonly command: 'video-disappeared'
}

export interface SettingsUpdatedMessage extends Message {
  readonly command: 'settings-updated'
}

export interface ImageCaptureParams {
  readonly maxWidth: number
  readonly maxHeight: number
  readonly rect: RectModel
  readonly frameId?: string
}

export interface TakeScreenshotMessage extends Message {
  readonly command: 'take-screenshot'
}

export interface ToggleRecordingMessage extends Message {
  readonly command: 'toggle-recording'
}

export interface SubtitleFile {
  base64: string
  name: string
}

export interface ToggleVideoSelectMessage extends Message {
  readonly command: 'toggle-video-select'
  readonly fromAsbplayerId?: string
  readonly subtitleFiles?: SubtitleFile[]
}

export interface SerializedSubtitleFile {
  name: string
  base64: string
}

export interface LegacyPlayerSyncMessage extends Message {
  readonly command: 'sync'
  readonly subtitles: SerializedSubtitleFile
}

export interface PlayerSyncMessage extends Message {
  readonly command: 'syncv2'
  readonly subtitles: SerializedSubtitleFile[]
  readonly flatten?: boolean
}

export interface ExtensionSyncMessage extends Message {
  readonly command: 'sync'
  readonly subtitles: SerializedSubtitleFile[]
  readonly flatten?: boolean
  readonly withSyncedAsbplayerOnly: boolean
  readonly withAsbplayerId?: string
}

export interface OffsetFromVideoMessage extends Message {
  readonly command: 'offset'
  readonly value: number
}

export interface OffsetToVideoMessage extends Message {
  readonly command: 'offset'
  readonly value: number
  readonly echo?: boolean
}

export interface PlaybackRateToVideoMessage extends Message {
  readonly command: 'playbackRate'
  readonly value: number
}

export interface ToggleSubtitlesMessage extends Message {
  readonly command: 'toggle-subtitles'
}

export interface ToggleSubtitlesInListFromVideoMessage extends Message {
  readonly command: 'toggleSubtitleTrackInList'
  readonly track: number
}

export interface ReadyStateFromVideoMessage extends Message {
  readonly command: 'readyState'
  readonly value: number
}

export interface ReadyFromVideoMessage extends Message {
  readonly command: 'ready'
  readonly duration: number
  readonly currentTime: number
  readonly paused: boolean
  readonly audioTracks?: AudioTrackModel[]
  readonly selectedAudioTrack?: string
  readonly playbackRate: number
}

export interface ReadyToVideoMessage extends Message {
  readonly command: 'ready'
  readonly duration: number
  readonly videoFileName?: string
}

export interface PlayFromVideoMessage extends Message {
  readonly command: 'play'
  readonly echo: boolean
}

export interface PauseFromVideoMessage extends Message {
  readonly command: 'pause'
  readonly echo: boolean
}

export interface CurrentTimeFromVideoMessage extends Message {
  readonly command: 'currentTime'
  readonly value: number
  readonly echo: boolean
}

export interface CurrentTimeToVideoMessage extends Message {
  readonly command: 'currentTime'
  readonly value: number
}

export interface PlaybackRateFromVideoMessage extends Message {
  readonly command: 'playbackRate'
  readonly value: number
  readonly echo: boolean
}

export interface AudioTrackSelectedFromVideoMessage extends Message {
  readonly command: 'audioTrackSelected'
  readonly id: string
}

export interface AudioTrackSelectedToVideoMessage extends Message {
  readonly command: 'audioTrackSelected'
  readonly id: string
}

export interface ToggleSubtitleTrackInListFromVideoMessage extends Message {
  readonly command: 'toggleSubtitleTrackInList'
  readonly track: number
}

export interface SubtitlesToVideoMessage extends Message {
  readonly command: 'subtitles'
  readonly value: SubtitleModel[]
  readonly name?: string
  readonly names: string[]
}

export interface SubtitlesUpdatedToVideoMessage extends Message {
  readonly command: 'subtitlesUpdated'
  readonly subtitles: RichSubtitleModel[]
}

export interface RequestCurrentSubtitleMessage extends Message {
  readonly command: 'request-current-subtitle'
}

export interface RequestSubtitlesMessage extends Message {
  readonly command: 'request-subtitles'
}

export interface SubtitlesUpdatedFromVideoMessage extends Message {
  readonly command: 'subtitlesUpdated'
  readonly updatedSubtitles: RichSubtitleModel[]
}

export interface RequestSubtitlesFromAppMessage extends MessageWithId {
  readonly command: 'request-subtitles'
}

export interface SubtitleSettingsToVideoMessage extends Message {
  readonly command: 'subtitleSettings'
  readonly value: SubtitleSettings
}

export interface PlayModeMessage extends Message {
  readonly command: 'playMode'
  readonly playMode: PlayMode
}

export interface HideSubtitlePlayerToggleToVideoMessage extends Message {
  readonly command: 'hideSubtitlePlayerToggle'
  readonly value: boolean
}

export interface AppBarToggleMessageToVideoMessage extends Message {
  readonly command: 'appBarToggle'
  readonly value: boolean
}

export interface FullscreenToggleMessageToVideoMessage extends Message {
  readonly command: 'fullscreenToggle'
  readonly value: boolean
}

export interface ActiveProfileMessage extends Message {
  readonly command: 'activeProfile'
  readonly profile?: string
}

export interface MiscSettingsToVideoMessage extends Message {
  readonly command: 'miscSettings'
  readonly value: MiscSettings
}

export interface VideoDataUiBridgeConfirmMessage extends Message {
  readonly command: 'confirm'
  readonly data: ConfirmedVideoDataSubtitleTrack[]
  readonly shouldRememberTrackChoices: boolean
  readonly syncWithAsbplayerId?: string
  // State of the translation toggles at confirm time — persisted to
  // settings.streamingTranslationMode so the choice survives dialog reopens.
  readonly translationMode?: 'off' | 'machine' | 'human'
}

export interface VideoDataUiBridgeOpenFileMessage extends Message {
  readonly command: 'openFile'
  readonly subtitles: SerializedSubtitleFile[]
}

export interface CropAndResizeMessage extends Message, ImageCaptureParams {
  readonly command: 'crop-and-resize'
  readonly dataUrl: string
}

export interface EditKeyboardShortcutsMessage extends Message {
  readonly command: 'edit-keyboard-shortcuts'
}

export interface OpenAsbplayerSettingsMessage extends Message {
  readonly command: 'open-asbplayer-settings'
}

export interface ExtensionVersionMessage extends Message {
  readonly command: 'version'
  version: string
  extensionCommands?: { [key: string]: string | undefined }
  pageConfig?: { [K in keyof PageSettings]: SettingsFormPageConfig }
}

export interface AlertMessage extends Message {
  readonly command: 'alert'
  readonly severity: string
  readonly message: string
}

export interface VideoSelectModeConfirmMessage extends Message {
  readonly command: 'confirm'
  readonly selectedVideoElementSrc: string
}

export interface VideoSelectModeCancelMessage extends Message {
  readonly command: 'cancel'
}

export interface CaptureVisibleTabMessage extends Message {
  readonly command: 'capture-visible-tab'
}

export interface CopyToClipboardMessage extends Message {
  readonly command: 'copy-to-clipboard'
  readonly dataUrl: string
}

export interface LoadSubtitlesMessage extends Message {
  readonly command: 'load-subtitles'
  readonly fromAsbplayerId?: string
}

export interface RequestActiveTabPermissionMessage extends Message {
  readonly command: 'request-active-tab-permission'
}

export interface RequestingActiveTabPermsisionMessage extends Message {
  readonly command: 'requesting-active-tab-permission'
  readonly requesting: boolean
}

export interface GrantedActiveTabPermissionMessage extends Message {
  readonly command: 'granted-active-tab-permission'
}

export interface ForwardCommandMessage extends Message {
  readonly command: 'forward-command'
  readonly commandToForward: AsbPlayerToVideoCommandV2<Message>
}

export interface AckMessage extends MessageWithId {
  readonly command: 'ack-message'
}

export interface RequestSubtitlesResponse {
  subtitles: RichSubtitleModel[]
  subtitleFileNames: string[]
}

export interface RequestCurrentSubtitleResponse {
  readonly currentSubtitle: SubtitleModel | null
  readonly currentSubtitleIndex: number | null
}

export interface JumpToSubtitleMessage extends Message {
  readonly command: 'jump-to-subtitle'
  readonly subtitle: SubtitleModel
  readonly subtitleFileName: string
}

export interface NotifyErrorMessage extends Message {
  readonly command: 'notify-error'
  readonly message: string
}

export interface NotificationDialogMessage extends Message {
  readonly command: 'notification-dialog'
  readonly titleLocKey: string
  readonly messageLocKey: string
}

export interface HiddenMessage extends Message {
  readonly command: 'hidden'
}

// Flicktionary hover-gloss messages. The content script asks the background to
// fetch a fast gloss for a hovered subtitle selection; the background calls the
// authed `glosses.fastGloss` endpoint. IPA is mirrored from the backend's
// GrammarIpaBag shape (kept inline so this package needn't depend on api-client).
export interface FlicktionaryGlossMessage extends MessageWithId {
  readonly command: 'flicktionary-gloss'
  readonly selectionText: string
  readonly contextLine: string
  // The video's server-detected subtitle language (from the session cache,
  // via the overlay's saved-highlights store). Absent while the overlay
  // doesn't know it yet (load still in flight) — the background then falls
  // back to the user's primary target language, the historical behavior.
  readonly targetLanguage?: string
}

// Asks the background to begin the Flicktionary pairing ("sign in") flow:
// generate a nonce and open the web pairing tab. Sent from surfaces that can't
// call `browser.tabs.create` themselves (the in-video overlay content script).
export interface FlicktionaryStartPairingMessage extends MessageWithId {
  readonly command: 'flicktionary-start-pairing'
}

export interface FlicktionaryStartPairingResponse {
  readonly success: boolean
  readonly error?: string
}

export interface FlicktionaryGlossResponse {
  readonly gloss?: string
  readonly pos?: string | null
  readonly register?: string | null
  // Server-picked, dialect-correct IPA display string (the backend resolves
  // the user's english_ipa_dialect pref) — render verbatim, no bag picking.
  readonly ipaDisplay?: string | null
  // Lemma the IPA was sourced from on form-of fallback (the surface form has no
  // pronunciation of its own) — labeled next to the IPA. Null/absent otherwise.
  readonly ipaLemma?: string | null
  readonly error?: string
}

// Saved Words Messages
//
// Flicktionary fields (all optional, attached by the YouTube content script):
//  - segmentIndex / endSegmentIndex: subtitle.index values from
//    subtitleController.subtitles[] for the start and end token. Single-segment
//    selections leave endSegmentIndex absent.
//  - startCharOffset / endCharOffset: char positions in each segment's
//    canonical text (matching what the tokenizer rendered).
//  - flicktionaryVideo: full video metadata + verbatim segments payload. The
//    background's session cache is cold until a video's first save — that save
//    creates the session via `findOrCreateForYoutubeVideo` from this payload
//    (sessions are never created by merely loading subtitles).
export interface SaveWordFlicktionaryVideoContext {
  // Which ingestion flow this video uses: 'youtube' (keyed by youtubeVideoId)
  // or 'streaming' (Netflix/Prime/…, keyed by the subtitle contentHash). The
  // background routes the cold-start findOrCreate call accordingly.
  readonly source: 'youtube' | 'streaming'
  // Present only when source === 'youtube'.
  readonly youtubeVideoId?: string
  readonly videoTitle: string
  readonly videoUrl: string
  // No language fields: the backend detects the subtitle language from the
  // segment text and uses it as both the content and target language.
  readonly contentHash: string
  readonly segments: ReadonlyArray<{
    readonly index: number
    readonly text: string
    readonly startMs: number
    readonly endMs: number
  }>
}

// Structurally identical to the backend contract's StudyIntentSchema —
// re-declared (mutable arrays included, so it assigns to the oRPC input type)
// because this common module stays dependency-free. FULL-SET semantics: when
// present, exactly the listed skills get study facets; absent = the backend's
// keep-time default (citation recognition).
export interface SaveWordStudyIntent {
  readonly skills: Array<'meaning_recognition' | 'meaning_production' | 'pronunciation'>
  readonly formScope: 'lemma' | 'form'
}

export interface SaveWordFastGloss {
  readonly gloss: string
  readonly pos: string | null
  readonly register: string | null
}

export interface SaveWordMessage extends MessageWithId {
  readonly command: 'save-word'
  readonly word: string
  readonly sentence: string
  readonly translation: string
  readonly videoTitle?: string
  readonly videoUrl?: string
  readonly segmentIndex?: number
  readonly endSegmentIndex?: number
  readonly startCharOffset?: number
  readonly endCharOffset?: number
  readonly flicktionaryVideo?: SaveWordFlicktionaryVideoContext
  // Study options picked in the gloss tooltip; forwarded verbatim to
  // highlights.create and applied by the backend enrichment job. Ignored in the
  // note-only lane (no enrichment runs).
  readonly studyIntent?: SaveWordStudyIntent
  // Preview gloss already shown before Save. Persisted with the highlight so
  // saved-mode display does not have to generate a second first gloss.
  readonly fastGloss?: SaveWordFastGloss
  // Note-only lane ("ask a question, don't make a card"): when true the backend
  // creates an empty stub card + seeds the chat from chatSeedPrompt, with NO
  // basic-data pass / grounding / study facets.
  readonly noteOnly?: boolean
  // A free-text note + preset tags typed in the tooltip before saving.
  readonly note?: string | null
  readonly presetTags?: readonly string[]
  // The localized, frontend-composed chat-seed question (presets + note).
  // Forwarded to highlights.create; the backend seeds the card chat from it.
  readonly chatSeedPrompt?: string | null
}

export interface SaveWordResponse {
  readonly success: boolean
  readonly error?: string
  // Backend error code (e.g. 'MISSING_CEFR') so the content script can offer a
  // recovery flow instead of just toasting the message.
  readonly code?: string
  // Detected target language. On a 'MISSING_CEFR' failure it tells the
  // in-video CEFR picker which language to set a level for; on SUCCESS it
  // backfills the overlay's tokenizer locale when the saved-highlights load
  // ran before the video's first save created the session.
  readonly targetLanguage?: string
  // The created highlight (indexes, not segment ids — converted in the
  // background via the cached segment map) so the overlay can paint the saved
  // span optimistically without a full reload. Absent on conversion misses /
  // legacy paths: the overlay falls back to a full saved-highlights reload.
  readonly highlight?: SavedHighlightDto
  // Session the highlight was created in. On the FIRST save of a video the
  // overlay's saved-highlights store has no session yet (it loaded before the
  // session existed) — without this the saved-mode popover can't open on the
  // just-saved span until a reload.
  readonly sessionId?: string
}

// One saved highlight as the subtitle overlay consumes it: SEGMENT INDEXES
// (subtitle.index coordinates), mapped from the backend's segment ids in the
// background via the session cache's segmentIdByIndex map. Offsets are char
// positions in the segment's canonical text — the same coordinate space the
// save path writes, so painting is symmetric with saving.
export interface SavedHighlightDto {
  readonly id: string
  readonly startSegmentIndex: number
  readonly endSegmentIndex: number
  readonly startOffset: number
  readonly endOffset: number
  readonly selectionText: string
  readonly note: string | null
  readonly presetTags: ReadonlyArray<string>
  readonly fastGloss: string | null
  // The stored study intent before the enrich job applies it. Null once cleared,
  // or never set. The saved popover edits this directly while pre-enrich.
  readonly studyIntent: SaveWordStudyIntent | null
  // The materialized term id (null pre-enrich). When set, the saved popover edits
  // live facets instead of the stored intent.
  readonly chunkId: string | null
  // True while the WORD is not saved as a study card (note-only stub: the card
  // only hosts the note/chat). The saved popover renders "Note saved" with an
  // editable study picker and offers the save-flicktionary-word upgrade.
  readonly noteOnly: boolean
}

// Load the saved highlights for the current video so the overlay can paint
// persistent spans. The background resolves the session from its cache, or —
// cache cold (fresh install, another device, cleared storage) — via the
// lookup-only `studySessions.lookupForVideo` endpoint (never creates rows).
export interface LoadFlicktionarySavedHighlightsMessage extends MessageWithId {
  readonly command: 'load-flicktionary-saved-highlights'
  readonly source: 'youtube' | 'streaming'
  // Present only when source === 'youtube'.
  readonly youtubeVideoId?: string
  readonly contentHash: string
}

export interface LoadFlicktionarySavedHighlightsResponse {
  readonly success: boolean
  // False when the user isn't paired — the overlay paints nothing and skips
  // all saved-highlight calls (signed-out is a normal state, not an error).
  readonly signedIn: boolean
  readonly sessionId?: string
  // The server-detected subtitle language — threaded into the overlay's
  // Intl.Segmenter so word boundaries match the web reader's. Absent when no
  // session exists yet or the cache entry predates the field.
  readonly targetLanguage?: string
  // Empty when no session exists for this video yet (the never-saved state).
  readonly highlights?: ReadonlyArray<SavedHighlightDto>
  readonly error?: string
}

export interface DeleteFlicktionaryHighlightMessage extends MessageWithId {
  readonly command: 'delete-flicktionary-highlight'
  readonly sessionId: string
  readonly highlightId: string
}

export interface DeleteFlicktionaryHighlightResponse {
  readonly success: boolean
  readonly error?: string
}

// Upgrade a note-only stub into a full study card — wraps highlights.saveWord
// (persists the chosen study intent + runs the normal enrichment; the stub's
// card fills in place, so the note and its seeded chat survive).
export interface SaveFlicktionaryWordMessage extends MessageWithId {
  readonly command: 'save-flicktionary-word'
  readonly sessionId: string
  readonly highlightId: string
  // Untouched study options → null → the backend keep-time default applies.
  readonly studyIntent: SaveWordStudyIntent | null
}

export interface SaveFlicktionaryWordResponse {
  readonly success: boolean
  readonly error?: string
}

export interface UpdateFlicktionaryHighlightNoteMessage extends MessageWithId {
  readonly command: 'update-flicktionary-highlight-note'
  readonly sessionId: string
  readonly highlightId: string
  readonly note: string | null
  readonly presetTags: ReadonlyArray<string>
  // Localized, frontend-composed chat question (selected presets rendered in
  // the UI locale + the verbatim note); null when there is nothing to ask.
  // Mirrors the web gloss sheet's composeChatSeedPrompt contract.
  readonly chatSeedPrompt: string | null
}

export interface UpdateFlicktionaryHighlightNoteResponse {
  readonly success: boolean
  readonly error?: string
}

// Saved-mode gloss: wraps `highlights.fastGloss` for an EXISTING highlight
// (cached server-side on the row), unlike `flicktionary-gloss` which is the
// stateless hover-preview pass.
export interface FlicktionarySavedGlossMessage extends MessageWithId {
  readonly command: 'flicktionary-saved-gloss'
  readonly sessionId: string
  readonly highlightId: string
}

export interface FlicktionarySavedGlossResponse {
  readonly gloss?: string
  readonly pos?: string | null
  readonly register?: string | null
  // Server-picked display string — same convention as FlicktionaryGlossResponse.
  readonly ipaDisplay?: string | null
  // Lemma the IPA was sourced from on form-of fallback — same convention.
  readonly ipaLemma?: string | null
  readonly error?: string
}

// One live study facet (skill x target_form) as the saved popover consumes it.
export interface FlicktionaryStudyFacetDto {
  readonly skill: 'meaning_recognition' | 'meaning_production' | 'pronunciation'
  readonly targetForm: string
  readonly enabled: boolean
}

// Read a materialized term's live facets so the saved popover can render the
// citation skill cards post-enrich. Wraps chunks.getStudyTargets.
export interface GetFlicktionaryStudyTargetsMessage extends MessageWithId {
  readonly command: 'get-flicktionary-study-targets'
  readonly chunkId: string
}

export interface GetFlicktionaryStudyTargetsResponse {
  readonly success: boolean
  readonly facets?: ReadonlyArray<FlicktionaryStudyFacetDto>
  readonly error?: string
}

// Sets the user's CEFR level for a language from the content script. Backed by
// the same `userPrefs.setCefrForLanguage` endpoint the web app's wizards use;
// the content script can't reach the authed oRPC client directly, so it routes
// through the background handler.
export interface SetFlicktionaryCefrMessage extends MessageWithId {
  readonly command: 'set-flicktionary-cefr'
  readonly targetLanguage: string
  readonly cefrLevel: string
}

export interface SetFlicktionaryCefrResponse {
  readonly success: boolean
  readonly error?: string
}

// Supadata Subtitle Generation Messages
export interface SupadataGenerateMessage extends MessageWithId {
  readonly command: 'supadata-generate'
  readonly videoUrl: string
}

export interface SupadataGenerateResponse {
  readonly subtitles?: string
  readonly error?: string
}

// Cached Transcript Messages
export interface GetCachedTranscriptMessage extends MessageWithId {
  readonly command: 'get-cached-transcript'
  readonly videoUrl: string
}

export interface GetCachedTranscriptResponse {
  readonly subtitles?: string
}

export interface ExportTranscriptCacheMessage extends MessageWithId {
  readonly command: 'export-transcript-cache'
}

export interface ExportTranscriptCacheResponse {
  readonly json: string
  readonly count: number
}

export interface ClearTranscriptCacheMessage extends MessageWithId {
  readonly command: 'clear-transcript-cache'
}

export interface ClearTranscriptCacheResponse {
  readonly success: boolean
}
