import type { Browser } from 'wxt/browser';
import type { Command, Message, SaveWordMessage, SaveWordResponse } from '@asbplayer-fork/common';
import { IndexedDBSavedWordsRepository } from '@asbplayer-fork/common/saved-words';
import { SettingsProvider } from '@asbplayer-fork/common/settings';
import { ExtensionSettingsStorage } from '../../services/extension-settings-storage';
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage';
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client';
import {
    lookupFlicktionarySession,
    storeFlicktionarySession,
} from '../../services/flicktionary/youtube-session-cache';
import { getFlicktionaryTargetLanguage } from '../../services/flicktionary/flicktionary-target-language';

// Routes the save-word command to either:
//   - the Flicktionary highlights API (when paired AND flicktionarySaveEnabled
//     AND a video context is available), or
//   - the local IndexedDB store (asbplayer's original behavior).
//
// Falling back to IndexedDB on failure rather than dropping the save keeps the
// user's data intact while they fix the connection / auth.
export default class SaveWordHandler {
    private readonly _repository = new IndexedDBSavedWordsRepository();
    private readonly _settings = new SettingsProvider(new ExtensionSettingsStorage());

    get sender() {
        return ['asbplayer-video-tab', 'asbplayerv2'];
    }

    get command() {
        return 'save-word';
    }

    handle(command: Command<Message>, _sender: Browser.runtime.MessageSender, sendResponse: (r?: SaveWordResponse) => void) {
        const message = command.message as SaveWordMessage;

        void (async () => {
            try {
                const handled = await this._tryFlicktionarySaveWithFallback(message);
                if (handled.handled) {
                    sendResponse({ success: true });
                    return;
                }

                await this._repository.save({
                    word: message.word,
                    sentence: message.sentence,
                    translation: message.translation,
                    videoTitle: message.videoTitle,
                    videoUrl: message.videoUrl,
                });
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        })();

        return true;
    }

    private async _tryFlicktionarySaveWithFallback(message: SaveWordMessage): Promise<{ handled: boolean }> {
        try {
            return await this._tryFlicktionarySave(message);
        } catch (error) {
            console.warn('[flicktionary] save failed; falling back to local IndexedDB save', error);
            return { handled: false };
        }
    }

    private async _tryFlicktionarySave(message: SaveWordMessage): Promise<{ handled: boolean }> {
        const { flicktionarySaveEnabled } = await this._settings.get(['flicktionarySaveEnabled']);
        if (!flicktionarySaveEnabled) return { handled: false };

        const auth = await getFlicktionaryAuth();
        if (!auth) return { handled: false };

        const videoCtx = message.flicktionaryVideo;
        if (!videoCtx) {
            // Save originated outside a YouTube binding (e.g. asbplayerv2 web
            // app save). No video context, no session — fall back.
            return { handled: false };
        }
        if (message.segmentIndex === undefined || message.startCharOffset === undefined || message.endCharOffset === undefined) {
            return { handled: false };
        }

        const client = getFlicktionaryApiClient();
        let cached = await lookupFlicktionarySession(videoCtx.youtubeVideoId, videoCtx.contentHash);

        if (!cached) {
            const targetLanguage = await getFlicktionaryTargetLanguage();
            if (!targetLanguage) {
                console.warn('[flicktionary] save dropped to local: no target language');
                return { handled: false };
            }
            const { data } = await client.studySessions.findOrCreateForYoutubeVideo({
                youtubeVideoId: videoCtx.youtubeVideoId,
                videoTitle: videoCtx.videoTitle,
                videoUrl: videoCtx.videoUrl,
                videoAudioLanguage: videoCtx.videoAudioLanguage,
                targetLanguage,
                subtitles: {
                    language: videoCtx.subtitleLanguage,
                    contentHash: videoCtx.contentHash,
                    segments: videoCtx.segments.map((s) => ({ ...s })),
                },
            });
            const segmentIdByIndex: Record<string, string> = {};
            for (const segment of data.segments) {
                segmentIdByIndex[String(segment.index)] = segment.id;
            }
            cached = {
                sessionId: data.sessionId,
                textTrackId: data.textTrackId,
                contentSourceId: data.contentSourceId,
                segmentIdByIndex,
            };
            await storeFlicktionarySession(videoCtx.youtubeVideoId, videoCtx.contentHash, cached);
        }

        const startSegmentId = cached.segmentIdByIndex[String(message.segmentIndex)];
        const endSegmentIdRaw =
            message.endSegmentIndex !== undefined
                ? cached.segmentIdByIndex[String(message.endSegmentIndex)]
                : startSegmentId;
        if (!startSegmentId || !endSegmentIdRaw) {
            console.warn('[flicktionary] missing segment id mapping; falling back to local save');
            return { handled: false };
        }

        await client.highlights.create({
            sessionId: cached.sessionId,
            startSegmentId,
            endSegmentId: endSegmentIdRaw,
            startOffset: message.startCharOffset,
            endOffset: message.endCharOffset,
            selectionText: message.word,
        });

        return { handled: true };
    }
}
