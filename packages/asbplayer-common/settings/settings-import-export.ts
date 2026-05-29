import { Validator } from 'jsonschema';
import { AsbplayerSettings } from './settings';
import { ensureConsistencyOnRead } from './settings-provider';
import { download, getCurrentTimeString } from '../util';

const keyBindSchema = {
    id: '/KeyBind',
    type: 'object',
    properties: {
        keys: {
            type: 'string',
        },
    },
    required: ['keys'],
};
const textSubtitleSettingsSchema = {
    id: '/TextSubtitleSettings',
    type: 'object',
    properties: {
        subtitleColor: {
            type: 'string',
        },
        subtitleSize: {
            type: 'number',
        },
        subtitleThickness: {
            type: 'number',
        },
        subtitleOutlineThickness: {
            type: 'number',
        },
        subtitleShadowColor: {
            type: 'string',
        },
        subtitleBackgroundOpacity: {
            type: 'number',
        },
        subtitleBackgroundColor: {
            type: 'string',
        },
        subtitleFontFamily: {
            type: 'string',
        },
        subtitleCustomStyles: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                    },
                    value: {
                        type: 'string',
                    },
                },
            },
        },
        subtitleBlur: {
            type: 'boolean',
        },
    },
    required: [
        'subtitleColor',
        'subtitleSize',
        'subtitleThickness',
        'subtitleOutlineThickness',
        'subtitleShadowColor',
        'subtitleBackgroundOpacity',
        'subtitleBackgroundColor',
        'subtitleFontFamily',
        'subtitleCustomStyles',
        'subtitleBlur',
    ],
};
const settingsSchema = {
    id: '/Settings',
    type: 'object',
    properties: {
        subtitleSize: {
            type: 'number',
        },
        subtitleColor: {
            type: 'string',
        },
        subtitleThickness: {
            type: 'number',
        },
        subtitleOutlineThickness: {
            type: 'number',
        },
        subtitleShadowThickness: {
            type: 'number',
        },
        subtitleShadowColor: {
            type: 'string',
        },
        subtitleOutlineColor: {
            type: 'string',
        },
        subtitleBackgroundColor: {
            type: 'string',
        },
        subtitleBackgroundOpacity: {
            type: 'number',
        },
        subtitleFontFamily: {
            type: 'string',
        },
        subtitleBlur: {
            type: 'boolean',
        },
        subtitlePreview: {
            type: 'string',
        },
        subtitlePositionOffset: {
            type: 'number',
        },
        topSubtitlePositionOffset: {
            type: 'number',
        },
        subtitleAlignment: {
            type: 'string',
        },
        subtitleTracksV2: {
            type: 'array',
            items: {
                $ref: '/TextSubtitleSettings',
            },
        },
        maxImageWidth: {
            type: 'number',
        },
        maxImageHeight: {
            type: 'number',
        },
        surroundingSubtitlesCountRadius: {
            type: 'number',
        },
        surroundingSubtitlesTimeRadius: {
            type: 'number',
        },
        autoPausePreference: {
            type: 'number',
        },
        subtitleHtml: {
            type: 'number',
        },
        seekDuration: {
            type: 'number',
        },
        speedChangeStep: {
            type: 'number',
        },
        fastForwardModePlaybackRate: {
            type: 'number',
        },
        keyBindSet: {
            type: 'object',
            properties: {
                togglePlay: { $ref: '/KeyBind' },
                toggleAutoPause: { $ref: '/KeyBind' },
                toggleCondensedPlayback: { $ref: '/KeyBind' },
                toggleFastForwardPlayback: { $ref: '/KeyBind' },
                toggleSubtitles: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack1: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack2: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack3: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack1: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack2: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack3: { $ref: '/KeyBind' },
                unblurAsbplayerTrack1: { $ref: '/KeyBind' },
                unblurAsbplayerTrack2: { $ref: '/KeyBind' },
                unblurAsbplayerTrack3: { $ref: '/KeyBind' },
                seekBackward: { $ref: '/KeyBind' },
                seekForward: { $ref: '/KeyBind' },
                seekToPreviousSubtitle: { $ref: '/KeyBind' },
                seekToNextSubtitle: { $ref: '/KeyBind' },
                seekToBeginningOfCurrentSubtitle: { $ref: '/KeyBind' },
                adjustOffsetToPreviousSubtitle: { $ref: '/KeyBind' },
                adjustOffsetToNextSubtitle: { $ref: '/KeyBind' },
                decreaseOffset: { $ref: '/KeyBind' },
                increaseOffset: { $ref: '/KeyBind' },
                resetOffset: { $ref: '/KeyBind' },
                decreasePlaybackRate: { $ref: '/KeyBind' },
                increasePlaybackRate: { $ref: '/KeyBind' },
                toggleRepeat: { $ref: '/KeyBind' },
                moveBottomSubtitlesUp: { $ref: '/KeyBind' },
                moveBottomSubtitlesDown: { $ref: '/KeyBind' },
                moveTopSubtitlesUp: { $ref: '/KeyBind' },
                moveTopSubtitlesDown: { $ref: '/KeyBind' },
            },
        },
        tabName: {
            type: 'string',
        },
        themeType: {
            type: 'string',
        },
        rememberSubtitleOffset: {
            type: 'boolean',
        },
        lastSubtitleOffset: {
            type: 'number',
        },
        autoCopyCurrentSubtitle: {
            type: 'boolean',
        },
        alwaysPlayOnSubtitleRepeat: {
            type: 'boolean',
        },
        subtitleRegexFilter: {
            type: 'string',
        },
        subtitleRegexFilterTextReplacement: {
            type: 'string',
        },
        convertNetflixRuby: {
            type: 'boolean',
        },
        language: {
            type: 'string',
        },
        imageBasedSubtitleScaleFactor: {
            type: 'number',
        },
        subtitleCustomStyles: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                    },
                    value: {
                        type: 'string',
                    },
                },
            },
        },
        subtitlesWidth: {
            type: 'number',
        },
        streamingAppUrl: {
            type: 'string',
        },
        streamingDisplaySubtitles: {
            type: 'boolean',
        },
        streamingSubsDragAndDrop: {
            type: 'boolean',
        },
        streamingAutoSync: {
            type: 'boolean',
        },
        streamingAutoSyncPromptOnFailure: {
            type: 'boolean',
        },
        streamingLastLanguagesSynced: {
            type: 'object',
            additionalProperties: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
        },
        streamingCondensedPlaybackMinimumSkipIntervalMs: {
            type: 'number',
        },
        streamingSubtitleListPreference: {
            type: 'string',
        },
        streamingEnableOverlay: {
            type: 'boolean',
        },
        pauseOnHoverMode: {
            type: 'number',
        },
        // Flicktionary-added live settings (WordInteractionSettings / TranscriptSettings).
        // Must be listed here or validateSettings throws 'Unknown key' on export/import.
        wordClickEnabled: {
            type: 'boolean',
        },
        transcriptServerUrl: {
            type: 'string',
        },
        transcriptApiKey: {
            type: 'string',
        },
        _schema: {
            type: 'number',
        },
    },
};

// Top-level keys stripped before validation.
const ignoreKeys: string[] = [
    'streamingPages', // Ignored due to security risk (e.g. disable CSP)
];

const withIgnoredKeysRemoved = (settings: any) => {
    const copy = { ...settings };
    for (const ignoreKey of ignoreKeys) {
        delete copy[ignoreKey];
    }
    return copy;
};

export const exportSettings = (settings: AsbplayerSettings) => {
    download(
        new Blob([JSON.stringify(withIgnoredKeysRemoved(settings))], { type: 'application/json' }),
        `asbplayer-settings-${getCurrentTimeString()}.json`
    );
};

export const validateSettings = (settings: any) => {
    const copy = withIgnoredKeysRemoved(settings);
    const validator = new Validator();
    validator.addSchema(keyBindSchema);
    validator.addSchema(textSubtitleSettingsSchema);
    const result = validator.validate(copy, settingsSchema);
    validateAllKnownKeys(copy, []);

    if (!result.valid) {
        throw new Error('Settings validation failed: ' + JSON.stringify(result.errors));
    }

    return ensureConsistencyOnRead(copy as AsbplayerSettings);
};

const validateAllKnownKeys = (object: any, path: string[]) => {
    for (const key of Object.keys(object)) {
        const schema = schemaAtPath(settingsSchema, path);

        // Empty string is sentinel value for 'additional properties' which can have any key
        if (schema === undefined || (schema !== '' && !(key in schema))) {
            throw new Error(`Unknown key '${[...path, key].join('.')}'`);
        }

        const value = object[key];

        if (typeof value === 'object' && !Array.isArray(value)) {
            validateAllKnownKeys(value, [...path, key]);
        }
    }
};

const schemaAtPath = (schema: any, path: string[]) => {
    let value = schema['properties'];

    for (const key of path) {
        if (typeof value[key] === 'object' && 'additionalProperties' in value[key]) {
            return '';
        }

        value = value[key]?.['properties'] ?? schemaForRef(value[key]?.['$ref'])?.['properties'];

        if (value === undefined) {
            return undefined;
        }
    }

    return value;
};

const schemaForRef = (ref: string) => {
    if (ref === '/KeyBind') {
        return keyBindSchema;
    }

    if (ref === '/TextSubtitleSettings') {
        return textSubtitleSettingsSchema;
    }

    return undefined;
};
