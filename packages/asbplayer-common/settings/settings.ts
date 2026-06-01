import { AutoPausePreference, SubtitleHtml } from '../src/model'

export enum PauseOnHoverMode {
  disabled = 0,
  inAndOut = 1,
  inNotOut = 2,
}

export interface MiscSettings {
  readonly themeType: 'dark' | 'light'
  readonly autoPausePreference: AutoPausePreference
  readonly seekDuration: number
  readonly speedChangeStep: number
  readonly fastForwardModePlaybackRate: number
  readonly keyBindSet: KeyBindSet
  readonly rememberSubtitleOffset: boolean
  readonly autoCopyCurrentSubtitle: boolean
  readonly alwaysPlayOnSubtitleRepeat: boolean
  readonly subtitleHtml: SubtitleHtml
  readonly subtitleRegexFilter: string
  readonly subtitleRegexFilterTextReplacement: string
  readonly convertNetflixRuby: boolean
  readonly language: string
  readonly lastSubtitleOffset: number
  readonly tabName: string
  readonly pauseOnHoverMode: PauseOnHoverMode
}

export enum DictionaryTokenSource {
  LOCAL = 0,
  ANKI_WORD = 1,
  ANKI_SENTENCE = 2,
}

export enum TokenStatus {
  UNCOLLECTED = 0,
  UNKNOWN = 1,
  LEARNING = 2,
  GRADUATED = 3,
  YOUNG = 4,
  MATURE = 5, // If ever adding more statuses, they should go last and getFullyKnownTokenStatus should be updated
}

export function getFullyKnownTokenStatus(): TokenStatus {
  return TokenStatus.MATURE // If future statuses are optional, this logic may need to change
}

export enum TokenState {
  IGNORED = 0, // If ever adding more states, they should go last (if adding colors for states, use a separate array from tokenStatusColors indexed by TokenState)
}

export enum ApplyStrategy {
  ADD = 'ADD',
  REMOVE = 'REMOVE',
  REPLACE = 'REPLACE',
  TOGGLE = 'TOGGLE',
}

// Image-capture + surrounding-subtitle geometry. These survived the Anki/mining
// teardown because they feed live features: maxImageWidth/maxImageHeight drive
// screenshot cropping (binding.ts) and surroundingSubtitles*Radius bound the
// subtitle context gathered on save/highlight (binding.ts + subtitle-controller.ts).
export interface CaptureSettings {
  readonly maxImageWidth: number
  readonly maxImageHeight: number
  readonly surroundingSubtitlesCountRadius: number
  readonly surroundingSubtitlesTimeRadius: number
}

const textSubtitleSettingsKeysObject: { [key in keyof TextSubtitleSettings]: boolean } = {
  subtitleColor: true,
  subtitleSize: true,
  subtitleThickness: true,
  subtitleOutlineThickness: true,
  subtitleOutlineColor: true,
  subtitleShadowThickness: true,
  subtitleShadowColor: true,
  subtitleBackgroundOpacity: true,
  subtitleBackgroundColor: true,
  subtitleFontFamily: true,
  subtitleCustomStyles: true,
  subtitleBlur: true,
  subtitleAlignment: true,
}

export const textSubtitleSettingsKeys: (keyof TextSubtitleSettings)[] = Object.keys(
  textSubtitleSettingsKeysObject
) as (keyof TextSubtitleSettings)[]

const subtitleSettingsKeysObject: { [key in keyof SubtitleSettings]: boolean } = {
  subtitleColor: true,
  subtitleSize: true,
  subtitleThickness: true,
  subtitleOutlineThickness: true,
  subtitleOutlineColor: true,
  subtitleShadowThickness: true,
  subtitleShadowColor: true,
  subtitleBackgroundOpacity: true,
  subtitleBackgroundColor: true,
  subtitleFontFamily: true,
  subtitleCustomStyles: true,
  subtitleBlur: true,
  subtitlePositionOffset: true, // bottom offset; name kept for backwards compatibility
  topSubtitlePositionOffset: true,
  subtitleAlignment: true,
  subtitleTracksV2: true,
  subtitlesWidth: true,
}

export const subtitleSettingsKeys: (keyof SubtitleSettings)[] = Object.keys(
  subtitleSettingsKeysObject
) as (keyof SubtitleSettings)[]

export interface CustomStyle {
  readonly key: string
  readonly value: string
}

export interface TextSubtitleSettings {
  readonly subtitleColor: string
  readonly subtitleSize: number
  readonly subtitleThickness: number
  readonly subtitleOutlineThickness: number
  readonly subtitleOutlineColor: string
  readonly subtitleShadowThickness: number
  readonly subtitleShadowColor: string
  readonly subtitleBackgroundOpacity: number
  readonly subtitleBackgroundColor: string
  readonly subtitleFontFamily: string
  readonly subtitleCustomStyles: CustomStyle[]
  readonly subtitleBlur: boolean
  readonly subtitleAlignment: SubtitleAlignment
}

export interface SubtitleSettings extends TextSubtitleSettings {
  readonly subtitlePositionOffset: number
  readonly topSubtitlePositionOffset: number

  // Settings for (0-based) tracks 1, 2,...
  // We don't configure track 0 here to avoid having to migrate old settings into this new data structure.
  // Track 0 continues to be configured from the top-level settings object.
  readonly subtitleTracksV2: TextSubtitleSettings[]

  // Percentage of containing video width; -1 means 'auto'
  readonly subtitlesWidth: number
}

export interface KeyBind {
  readonly keys: string
}

export interface KeyBindSet {
  readonly togglePlay: KeyBind
  readonly toggleAutoPause: KeyBind
  readonly toggleCondensedPlayback: KeyBind
  readonly toggleFastForwardPlayback: KeyBind
  readonly toggleSubtitles: KeyBind
  readonly toggleVideoSubtitleTrack1: KeyBind
  readonly toggleVideoSubtitleTrack2: KeyBind
  readonly toggleVideoSubtitleTrack3: KeyBind
  readonly toggleAsbplayerSubtitleTrack1: KeyBind
  readonly toggleAsbplayerSubtitleTrack2: KeyBind
  readonly toggleAsbplayerSubtitleTrack3: KeyBind
  readonly unblurAsbplayerTrack1: KeyBind
  readonly unblurAsbplayerTrack2: KeyBind
  readonly unblurAsbplayerTrack3: KeyBind
  readonly seekBackward: KeyBind
  readonly seekForward: KeyBind
  readonly seekToPreviousSubtitle: KeyBind
  readonly seekToNextSubtitle: KeyBind
  readonly seekToBeginningOfCurrentSubtitle: KeyBind
  readonly adjustOffsetToPreviousSubtitle: KeyBind
  readonly adjustOffsetToNextSubtitle: KeyBind
  readonly decreaseOffset: KeyBind
  readonly increaseOffset: KeyBind
  readonly resetOffset: KeyBind
  readonly decreasePlaybackRate: KeyBind
  readonly increasePlaybackRate: KeyBind
  readonly toggleRepeat: KeyBind
  readonly moveBottomSubtitlesUp: KeyBind
  readonly moveBottomSubtitlesDown: KeyBind
  readonly moveTopSubtitlesUp: KeyBind
  readonly moveTopSubtitlesDown: KeyBind
}

export interface TranscriptSettings {
  readonly transcriptServerUrl: string
  readonly transcriptApiKey: string
}

export type SubtitleAlignment = 'top' | 'bottom'
export enum SubtitleListPreference {
  noSubtitleList = 'noSubtitleList',
  app = 'app',
}

export interface PageConfig {
  hostRegex: string
  syncAllowedAtPath?: string
  syncAllowedAtHash?: string
  searchShadowRootsForVideoElements?: boolean
  allowVideoElementsWithBlankSrc?: boolean
  autoSyncEnabled?: boolean
  autoSyncVideoSrc?: string
  autoSyncElementId?: string
  ignoreVideoElementsClass?: string
}

export interface SettingsFormPageConfig extends PageConfig {
  faviconUrl: string
}

export type MutablePageConfig = Omit<PageConfig, 'hostRegex'>

export interface Page {
  overrides?: Partial<MutablePageConfig>
  additionalHosts?: string[]
}

export interface YoutubePage extends Page {
  targetLanguages?: string[]
}

export interface PageSettings {
  netflix: Page
  youtube: YoutubePage
  tver: Page
  bandaiChannel: Page
  amazonPrime: Page
  hulu: Page
  disneyPlus: Page
  appsDisneyPlus: Page
  unext: Page
  viki: Page
  embyJellyfin: Page
  twitch: Page
  osnPlus: Page
  bilibili: Page
  nrktv: Page
  plex: Page
  yleAreena: Page
  hboMax: Page
  stremio: Page
  cijapanese: Page
  iwanttfc: Page
}

export interface StreamingVideoSettings {
  readonly streamingAppUrl: string
  readonly streamingDisplaySubtitles: boolean
  readonly streamingSubsDragAndDrop: boolean
  readonly streamingAutoSync: boolean
  readonly streamingAutoSyncPromptOnFailure: boolean
  // Last language selected in subtitle track selector, keyed by domain
  // Used to auto-selecting a language in subtitle track selector, if it's available
  readonly streamingLastLanguagesSynced: { [key: string]: string[] }
  readonly streamingCondensedPlaybackMinimumSkipIntervalMs: number
  readonly streamingSubtitleListPreference: SubtitleListPreference
  readonly streamingEnableOverlay: boolean
  readonly streamingPages: PageSettings
}

export type KeyBindName = keyof KeyBindSet

export interface AsbplayerSettings
  extends
    MiscSettings,
    CaptureSettings,
    SubtitleSettings,
    StreamingVideoSettings,
    TranscriptSettings {
  readonly subtitlePreview: string
}

const keyBindNameMap: any = {
  'toggle-video-select': 'selectSubtitleTrack',
}

export function chromeCommandBindsToKeyBinds(chromeCommands: { [key: string]: string | undefined }) {
  const keyBinds: { [key: string]: string | undefined } = {}

  for (const commandName of Object.keys(chromeCommands)) {
    keyBinds[keyBindNameMap[commandName]] = chromeCommands[commandName]
  }

  return keyBinds
}
