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
  readonly tutorial?: boolean
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

export interface CurrentTabMessage extends Message {
  readonly command: 'current-tab'
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
}

export interface FlicktionaryGlossIpa {
  readonly ga?: string | null
  readonly rp?: string | null
  readonly untagged?: string | null
}

export interface FlicktionaryGlossResponse {
  readonly gloss?: string
  readonly pos?: string | null
  readonly register?: string | null
  readonly ipa?: FlicktionaryGlossIpa | null
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
//  - flicktionaryVideo: full video metadata + verbatim segments payload so the
//    background can fall back to a fresh `findOrCreateForYoutubeVideo` call
//    when its session cache is cold (e.g. the user saved before the
//    register-subtitles ping had time to land).
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
}

export interface SaveWordResponse {
  readonly success: boolean
  readonly error?: string
  // Backend error code (e.g. 'MISSING_CEFR') so the content script can offer a
  // recovery flow instead of just toasting the message.
  readonly code?: string
  // Detected target language for the save, surfaced on a 'MISSING_CEFR' failure
  // so the in-video CEFR picker knows which language to set a level for.
  readonly targetLanguage?: string
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

export interface RegisterFlicktionarySubtitlesMessage extends MessageWithId {
  readonly command: 'register-flicktionary-subtitles'
  // Ingestion flow for this video — see SaveWordFlicktionaryVideoContext.source.
  readonly source: 'youtube' | 'streaming'
  // Present only when source === 'youtube'.
  readonly youtubeVideoId?: string
  readonly videoTitle: string
  readonly videoUrl: string
  // BCP-47 language code of the selected YouTube caption track, when known.
  // Display-only: it is NOT sent to the backend (which detects the language
  // from the text). Used to name the language in the "unsupported" notice.
  readonly youtubeLanguageCode?: string
  readonly contentHash: string
  readonly segments: ReadonlyArray<{
    readonly index: number
    readonly text: string
    readonly startMs: number
    readonly endMs: number
  }>
}

export interface RegisterFlicktionarySubtitlesResponse {
  readonly success: boolean
  readonly sessionId?: string
  readonly error?: string
  // Backend error code (e.g. 'UNSUPPORTED_LANGUAGE', 'MISSING_CEFR') so the
  // binding can react at video-load time — show a notice and disable saving.
  readonly code?: string
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
