import {
    DictionaryLocalTokenInput,
    DictionaryTokenRecord,
    DictionaryExportRecordLocalResult,
    DictionaryImportRecordLocalResult,
    LemmaResults,
    DictionarySaveRecordLocalResult,
    TokenResults,
    DictionaryDeleteRecordLocalResult,
    DictionaryDeleteProfileResult,
} from '@asbplayer-fork/common/dictionary-db';
import { ApplyStrategy } from '@asbplayer-fork/common/settings';
import { download, getCurrentTimeString } from '../util';

export interface DictionaryStorage {
    getBulk: (profile: string | undefined, track: number, tokens: string[]) => Promise<TokenResults>;
    getByLemmaBulk: (profile: string | undefined, track: number, lemmas: string[]) => Promise<LemmaResults>;
    saveRecordLocalBulk: (
        profile: string | undefined,
        localTokenInputs: DictionaryLocalTokenInput[],
        applyStates: ApplyStrategy
    ) => Promise<DictionarySaveRecordLocalResult>;
    deleteRecordLocalBulk: (
        profile: string | undefined,
        tokens: string[]
    ) => Promise<DictionaryDeleteRecordLocalResult>;
    deleteProfile: (profile: string) => Promise<DictionaryDeleteProfileResult>;
    exportRecordLocalBulk: () => Promise<DictionaryExportRecordLocalResult>;
    importRecordLocalBulk: (
        records: Partial<DictionaryTokenRecord>[],
        profiles: string[]
    ) => Promise<DictionaryImportRecordLocalResult>;
    ankiCardWasModified: () => void;
    onAnkiCardModified: (callback: () => void) => () => void;
    _removeCallback(callback: Function, callbacks: Function[]): void;
}

export class DictionaryProvider {
    private _storage: DictionaryStorage;

    constructor(storage: DictionaryStorage) {
        this._storage = storage;
    }

    getBulk(profile: string | undefined, track: number, tokens: string[]) {
        return this._storage.getBulk(profile, track, tokens);
    }

    getByLemmaBulk(profile: string | undefined, track: number, lemmas: string[]) {
        return this._storage.getByLemmaBulk(profile, track, lemmas);
    }

    saveRecordLocalBulk(
        profile: string | undefined,
        localTokenInputs: DictionaryLocalTokenInput[],
        applyStates: ApplyStrategy
    ) {
        return this._storage.saveRecordLocalBulk(profile, localTokenInputs, applyStates);
    }

    deleteRecordLocalBulk(profile: string | undefined, tokens: string[]) {
        return this._storage.deleteRecordLocalBulk(profile, tokens);
    }

    deleteProfile(profile: string) {
        return this._storage.deleteProfile(profile);
    }

    async exportRecordLocalBulk() {
        download(
            new Blob([JSON.stringify((await this._storage.exportRecordLocalBulk()).exportedRecords)], {
                type: 'application/json',
            }),
            `asbplayer-local-words-${getCurrentTimeString()}.json`
        );
    }

    importRecordLocalBulk(records: Partial<DictionaryTokenRecord>[], profiles: string[]) {
        return this._storage.importRecordLocalBulk(records, profiles);
    }

    ankiCardWasModified() {
        return this._storage.ankiCardWasModified();
    }

    onAnkiCardModified(callback: () => void) {
        return this._storage.onAnkiCardModified(callback);
    }
}
