import { expect, it } from 'vitest';
import { PauseOnHoverMode } from './settings';
import { validateSettings } from './settings-import-export';
import { defaultSettings } from './settings-provider';

it('validates the default settings', () => {
    validateSettings(defaultSettings);
});

it('fails validation when an unknown key is encountered', () => {
    expect(() => validateSettings({ ...defaultSettings, asdf: 'jkl;' })).toThrow("Unknown key 'asdf'");
});

it('fails validation when an unknown key bind key is encountered', () => {
    expect(() =>
        validateSettings({ ...defaultSettings, keyBindSet: { ...defaultSettings.keyBindSet, asdf: { keys: 'a' } } })
    ).toThrow("Unknown key 'keyBindSet.asdf'");
});

it('validates last languages synced', () => {
    validateSettings({ ...defaultSettings, streamingLastLanguagesSynced: { 'domain.com': ['en', 'ja'] } });
});

it('validates exported settings', () => {
    validateSettings({
        subtitleSize: 36,
        subtitleColor: '#ffffff',
        subtitleThickness: 700,
        subtitleOutlineThickness: 0,
        subtitleOutlineColor: '#000000',
        subtitleShadowThickness: 2,
        subtitleShadowColor: '#000000',
        subtitleBackgroundColor: '#000000',
        subtitleBackgroundOpacity: 0,
        subtitleFontFamily: 'ToppanBunkyuMidashiGothicStdN-ExtraBold',
        subtitleBlur: false,
        subtitleCustomStyles: [],
        subtitleTracksV2: [
            {
                subtitleSize: 36,
                subtitleColor: '#ffffff',
                subtitleThickness: 700,
                subtitleOutlineThickness: 0,
                subtitleOutlineColor: '#000000',
                subtitleShadowThickness: 2,
                subtitleShadowColor: '#000000',
                subtitleBackgroundColor: '#000000',
                subtitleBackgroundOpacity: 0,
                subtitleFontFamily: 'ToppanBunkyuMidashiGothicStdN-ExtraBold',
                subtitleBlur: true,
                subtitleAlignment: 'bottom',
                subtitleCustomStyles: [],
            },
        ],
        subtitlePreview: 'アあ安Aa',
        subtitlePositionOffset: 71,
        topSubtitlePositionOffset: 71,
        maxImageWidth: 480,
        maxImageHeight: 0,
        surroundingSubtitlesCountRadius: 2,
        surroundingSubtitlesTimeRadius: 10000,
        autoPausePreference: 2,
        seekDuration: 4,
        speedChangeStep: 0.2,
        fastForwardModePlaybackRate: 3,
        keyBindSet: {
            adjustOffsetToNextSubtitle: { keys: '⇧+right' },
            adjustOffsetToPreviousSubtitle: { keys: '⇧+left' },
            decreaseOffset: { keys: '⇧+⌃+right' },
            decreasePlaybackRate: { keys: '⇧+⌃+[' },
            increaseOffset: { keys: '⇧+⌃+left' },
            increasePlaybackRate: { keys: '⇧+⌃+]' },
            resetOffset: { keys: '⇧+⌃+down' },
            seekBackward: { keys: 'A' },
            seekForward: { keys: 'D' },
            seekToBeginningOfCurrentSubtitle: { keys: 'up' },
            seekToNextSubtitle: { keys: 'right' },
            seekToPreviousSubtitle: { keys: 'left' },
            toggleAsbplayerSubtitleTrack1: { keys: 'W+1' },
            toggleAsbplayerSubtitleTrack2: { keys: 'W+2' },
            unblurAsbplayerTrack1: { keys: 'B+1' },
            unblurAsbplayerTrack2: { keys: 'B+2' },
            toggleAutoPause: { keys: '⇧+P' },
            toggleCondensedPlayback: { keys: '⇧+O' },
            toggleFastForwardPlayback: { keys: '⇧+F' },
            togglePlay: { keys: 'space' },
            toggleRepeat: { keys: '⇧+R' },
            toggleSubtitles: { keys: 'down' },
            toggleVideoSubtitleTrack1: { keys: '1' },
            toggleVideoSubtitleTrack2: { keys: '2' },
        },
        tabName: 'asbplayer',
        themeType: 'dark',
        rememberSubtitleOffset: true,
        lastSubtitleOffset: 0,
        autoCopyCurrentSubtitle: false,
        alwaysPlayOnSubtitleRepeat: true,
        subtitleRegexFilter: '',
        subtitleRegexFilterTextReplacement: '',
        convertNetflixRuby: false,
        subtitleHtml: 1,
        language: 'en',
        imageBasedSubtitleScaleFactor: 1,
        streamingAppUrl: 'http://localhost:3000/asbplayer',
        streamingDisplaySubtitles: false,
        streamingSubsDragAndDrop: true,
        streamingAutoSync: true,
        streamingLastLanguagesSynced: { 'www.youtube.com': ['ja', '', ''] },
        streamingCondensedPlaybackMinimumSkipIntervalMs: 1000,
        streamingSubtitleListPreference: 'app',
        pauseOnHoverMode: PauseOnHoverMode.disabled,
    });
});
