import {
    CardExportedDialogMessage,
    CardUpdatedDialogMessage,
    DictionaryDBCommand,
    DictionaryDeleteProfileMessage,
    DictionaryDeleteRecordLocalBulkMessage,
    DictionaryExportRecordLocalBulkMessage,
    DictionaryGetBulkMessage,
    DictionaryGetByLemmaBulkMessage,
    DictionaryImportRecordLocalBulkMessage,
    DictionarySaveRecordLocalBulkMessage,
} from '@asbplayer-fork/common';
import { DictionaryLocalTokenInput, DictionaryStorage, DictionaryTokenRecord } from '@asbplayer-fork/common/dictionary-db';
import { ApplyStrategy } from '@asbplayer-fork/common/settings';
import { v4 as uuidv4 } from 'uuid';

export class ExtensionDictionaryStorage implements DictionaryStorage {
    private ankiCardModifiedCallbacks: (() => void)[];
    private ankiCardModified?: (
        message: DictionaryDBCommand<CardUpdatedDialogMessage | CardExportedDialogMessage>
    ) => void;

    constructor() {
        this.ankiCardModifiedCallbacks = [];
    }

    getBulk(profile: string | undefined, track: number, tokens: string[]) {
        const message: DictionaryDBCommand<DictionaryGetBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: {
                command: 'dictionary-get-bulk',
                profile,
                track,
                tokens,
                messageId: uuidv4(),
            },
        };
        return browser.runtime.sendMessage(message);
    }

    getByLemmaBulk(profile: string | undefined, track: number, lemmas: string[]) {
        const message: DictionaryDBCommand<DictionaryGetByLemmaBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: {
                command: 'dictionary-get-by-lemma-bulk',
                profile,
                track,
                lemmas,
                messageId: uuidv4(),
            },
        };
        return browser.runtime.sendMessage(message);
    }

    saveRecordLocalBulk(
        profile: string | undefined,
        localTokenInputs: DictionaryLocalTokenInput[],
        applyStates: ApplyStrategy
    ) {
        const message: DictionaryDBCommand<DictionarySaveRecordLocalBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: {
                command: 'dictionary-save-record-local-bulk',
                profile,
                localTokenInputs,
                applyStates,
                messageId: uuidv4(),
            },
        };
        return browser.runtime.sendMessage(message);
    }

    deleteRecordLocalBulk(profile: string | undefined, tokens: string[]) {
        const message: DictionaryDBCommand<DictionaryDeleteRecordLocalBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: {
                command: 'dictionary-delete-record-local-bulk',
                profile,
                tokens,
                messageId: uuidv4(),
            },
        };
        return browser.runtime.sendMessage(message);
    }

    deleteProfile(profile: string) {
        const message: DictionaryDBCommand<DictionaryDeleteProfileMessage> = {
            sender: 'asbplayer-dictionary',
            message: {
                command: 'dictionary-delete-profile',
                profile,
                messageId: uuidv4(),
            },
        };
        return browser.runtime.sendMessage(message);
    }

    exportRecordLocalBulk() {
        const message: DictionaryDBCommand<DictionaryExportRecordLocalBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: { command: 'dictionary-export-record-local-bulk', messageId: uuidv4() },
        };
        return browser.runtime.sendMessage(message);
    }

    importRecordLocalBulk(records: Partial<DictionaryTokenRecord>[], profiles: string[]) {
        const message: DictionaryDBCommand<DictionaryImportRecordLocalBulkMessage> = {
            sender: 'asbplayer-dictionary',
            message: { command: 'dictionary-import-record-local-bulk', messageId: uuidv4(), records, profiles },
        };
        return browser.runtime.sendMessage(message);
    }

    ankiCardWasModified() {
        browser.runtime.sendMessage({
            sender: 'asbplayer-dictionary',
            message: { command: 'card-updated-dialog' },
        } as DictionaryDBCommand<CardUpdatedDialogMessage>);
    }

    onAnkiCardModified(callback: () => void) {
        this.ankiCardModifiedCallbacks.push(callback);
        if (!this.ankiCardModified) {
            this.ankiCardModified = (
                message: DictionaryDBCommand<CardUpdatedDialogMessage | CardExportedDialogMessage>
            ) => {
                if (message.sender !== 'asbplayer-dictionary') return;
                if (
                    message.message.command !== 'card-updated-dialog' &&
                    message.message.command !== 'card-exported-dialog'
                )
                    return;
                this.ankiCardModifiedCallbacks.forEach((c) => c());
            };
            browser.runtime.onMessage.addListener(this.ankiCardModified);
        }
        return () => {
            this._removeCallback(callback, this.ankiCardModifiedCallbacks);
            if (!this.ankiCardModifiedCallbacks.length && this.ankiCardModified) {
                browser.runtime.onMessage.removeListener(this.ankiCardModified);
                this.ankiCardModified = undefined;
            }
        };
    }

    _removeCallback(callback: Function, callbacks: Function[]) {
        for (let i = callbacks.length - 1; i >= 0; --i) {
            if (callback === callbacks[i]) {
                callbacks.splice(i, 1);
                break;
            }
        }
    }
}
