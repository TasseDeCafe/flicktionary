import {
    ApplyStrategy,
    DictionaryTokenSource,
    getFullyKnownTokenStatus,
    TokenState,
    TokenStatus,
} from '@asbplayer-fork/common/settings';
import { HAS_LETTER_REGEX } from '@asbplayer-fork/common/util';
import Dexie from 'dexie';

/**
 * This gives a better user experience so they are free to switch between tracks long term
 * without any headaches. If in the future per track local tokens are desired as a new option,
 * then -1 would simply become the fallback and represent trackless tokens.
 */
const LOCAL_TOKEN_TRACK = -1; // null cannot be used in Dexie indexes

/**
 * Order in which token sources are preferred when resolving a token/lemma to a single result.
 * Flicktionary only writes LOCAL tokens; the ANKI_* sources are retained so that token records
 * left over in pre-existing databases (from the removed Anki integration) still surface their states.
 */
const TOKEN_SOURCE_PRIORITY = [
    DictionaryTokenSource.LOCAL,
    DictionaryTokenSource.ANKI_WORD,
    DictionaryTokenSource.ANKI_SENTENCE,
] as const;

type DictionaryMetaKey = [string, number];
interface DictionaryMetaRecord {
    profile: string;
    track: number;
    lastBuildStartedAt: number;
    lastBuildExpiresAt: number;
    buildId: string | null;
    settings: string | null;
}

export type DictionaryTokenKey = [string, DictionaryTokenSource, number, string];
export interface DictionaryTokenRecord {
    profile: string;
    track: number;
    source: DictionaryTokenSource;
    token: string;
    status: TokenStatus | null;
    lemmas: string[];
    states: TokenState[];
    cardIds: number[];
}
export interface DictionaryLocalTokenInput {
    token: string;
    status: TokenStatus | null;
    lemmas: string[];
    states: TokenState[];
}

class DictionaryDatabase extends Dexie {
    meta!: Dexie.Table<DictionaryMetaRecord, DictionaryMetaKey>;
    tokens!: Dexie.Table<DictionaryTokenRecord, DictionaryTokenKey>;

    constructor() {
        super('DictionaryDatabase');
        this.version(1).stores({
            meta: '[profile+track]',
            tokens: '[token+source+track+profile],[profile+token],*lemmas,*cardIds',
            ankiCards: '[cardId+track+profile],[profile+noteId]',
        });
        // version(2) drops the ankiCards table now that the Anki integration is removed.
        // Dexie deletes a table whose name maps to null in a later version's stores().
        this.version(2).stores({
            ankiCards: null,
        });
    }
}

export interface TokenResults {
    [token: string]: { source: DictionaryTokenSource; states: TokenState[] };
}

export interface LemmaResults {
    [lemma: string]: {
        token: string;
        source: DictionaryTokenSource;
        states: TokenState[];
    }[];
}

export interface DictionarySaveRecordLocalResult {
    savedTokens: DictionaryTokenKey[];
    deletedTokens: DictionaryTokenKey[];
}

export interface DictionaryImportRecordLocalResult {
    importedTokens: DictionaryTokenKey[];
}

export interface DictionaryExportRecordLocalResult {
    exportedRecords: Partial<DictionaryTokenRecord>[];
}

export interface DictionaryDeleteRecordLocalResult {
    deletedTokens: DictionaryTokenKey[];
}

export interface DictionaryDeleteProfileResult {
    deletedMetas: DictionaryMetaKey[];
    deletedTokens: DictionaryTokenKey[];
}

export class DictionaryDB {
    private readonly db: DictionaryDatabase;

    constructor() {
        this.db = new DictionaryDatabase();
    }

    private _getProfile(inputProfile: string | undefined): string {
        return inputProfile ?? 'Default';
    }

    async getBulk(inputProfile: string | undefined, track: number, tokens: string[]): Promise<TokenResults> {
        if (!tokens.length) return {};
        const profile = this._getProfile(inputProfile);

        return this.db.transaction('r', this.db.tokens, async () => {
            return this.db.tokens
                .where('[profile+token]')
                .anyOf(tokens.map((token) => [profile, token]))
                .filter((r) => r.track === track || r.track === LOCAL_TOKEN_TRACK)
                .toArray()
                .then((records) => {
                    if (!records.length) return {};
                    const tokenRecordMap = new Map<string, DictionaryTokenRecord[]>();
                    for (const record of records) {
                        const val = tokenRecordMap.get(record.token);
                        if (val) val.push(record);
                        else tokenRecordMap.set(record.token, [record]);
                    }
                    const tokenResults: TokenResults = {};

                    // Prioritize local tokens, then word cards, then sentence cards
                    for (const [token, tokenRecords] of tokenRecordMap.entries()) {
                        for (const source of TOKEN_SOURCE_PRIORITY) {
                            const record = tokenRecords.find((r) => r.source === source);
                            if (!record) continue;
                            tokenResults[token] = { source: record.source, states: record.states };
                            break;
                        }
                    }
                    return tokenResults;
                });
        });
    }

    async getByLemmaBulk(inputProfile: string | undefined, track: number, lemmas: string[]): Promise<LemmaResults> {
        if (!lemmas.length) return {};
        const lemmasSet = new Set(lemmas);
        const profile = this._getProfile(inputProfile);

        return this.db.transaction('r', this.db.tokens, async () => {
            return this.db.tokens
                .where('lemmas')
                .anyOf(lemmas)
                .distinct()
                .filter((r) => (r.track === track || r.track === LOCAL_TOKEN_TRACK) && r.profile === profile)
                .toArray()
                .then((records) => {
                    if (!records.length) return {};
                    const lemmaRecordMap = new Map<string, DictionaryTokenRecord[]>();
                    for (const record of records) {
                        for (const lemma of record.lemmas) {
                            if (!lemmasSet.has(lemma)) continue;
                            const val = lemmaRecordMap.get(lemma);
                            if (val) val.push(record);
                            else lemmaRecordMap.set(lemma, [record]);
                        }
                    }
                    const lemmaResults: LemmaResults = {};

                    // Prioritize local tokens, then word cards, then sentence cards. A lemma is
                    // resolved by the first source that has any matching records.
                    for (const source of TOKEN_SOURCE_PRIORITY) {
                        for (const [lemma, lemmaRecords] of lemmaRecordMap.entries()) {
                            let matched = false;
                            for (const record of lemmaRecords) {
                                if (record.source !== source) continue;
                                let arr = lemmaResults[lemma];
                                if (!arr) {
                                    arr = [];
                                    lemmaResults[lemma] = arr;
                                }
                                arr.push({ token: record.token, source: record.source, states: record.states });
                                matched = true;
                            }
                            if (matched) lemmaRecordMap.delete(lemma);
                        }
                        if (!lemmaRecordMap.size) break;
                    }
                    return lemmaResults;
                });
        });
    }

    async saveRecordLocalBulk(
        inputProfile: string | undefined,
        localTokenInputs: DictionaryLocalTokenInput[],
        applyStates: ApplyStrategy
    ): Promise<DictionarySaveRecordLocalResult> {
        if (!localTokenInputs.length) return { savedTokens: [], deletedTokens: [] };
        const profile = this._getProfile(inputProfile);
        return this.db.transaction('rw', this.db.tokens, async () => {
            const tokenRecordMap = await this._getFromSourceBulk(
                profile,
                LOCAL_TOKEN_TRACK,
                DictionaryTokenSource.LOCAL,
                localTokenInputs.map((l) => l.token)
            );

            const recordsToAdd: DictionaryTokenRecord[] = [];
            const tokensToDelete: string[] = [];
            for (const localTokenInput of localTokenInputs) {
                if (!HAS_LETTER_REGEX.test(localTokenInput.token)) {
                    console.error(`Cannot save local token with invalid token: "${localTokenInput.token}"`);
                    return { savedTokens: [], deletedTokens: [] };
                }
                const existingRecord = tokenRecordMap.get(localTokenInput.token);
                if (existingRecord) {
                    if (localTokenInput.status == null) localTokenInput.status = existingRecord.status;
                    for (const existingLemma of existingRecord.lemmas) {
                        if (!localTokenInput.lemmas.includes(existingLemma)) localTokenInput.lemmas.push(existingLemma);
                    }
                    switch (applyStates) {
                        case ApplyStrategy.ADD:
                            for (const state of existingRecord.states) {
                                if (!localTokenInput.states.includes(state)) localTokenInput.states.push(state);
                            }
                            break;
                        case ApplyStrategy.REMOVE:
                            localTokenInput.states = existingRecord.states.filter(
                                (existingState) => !localTokenInput.states.includes(existingState)
                            );
                            break;
                        case ApplyStrategy.REPLACE:
                            break;
                        case ApplyStrategy.TOGGLE:
                            for (const existingState of existingRecord.states) {
                                const idx = localTokenInput.states.indexOf(existingState);
                                if (idx !== -1) {
                                    localTokenInput.states.splice(idx, 1);
                                } else {
                                    localTokenInput.states.push(existingState);
                                }
                            }
                            break;
                        default:
                            console.error(`Unsupported applyStates value: "${applyStates}"`);
                            return { savedTokens: [], deletedTokens: [] };
                    }
                } else if (localTokenInput.status == null) {
                    localTokenInput.status = TokenStatus.UNCOLLECTED;
                }
                localTokenInput.lemmas = localTokenInput.lemmas.filter((lemma) => HAS_LETTER_REGEX.test(lemma));
                if (!localTokenInput.lemmas.length) {
                    console.error(`Cannot save local token with no lemmas: "${localTokenInput.token}"`);
                    return { savedTokens: [], deletedTokens: [] };
                }
                if (localTokenInput.status === TokenStatus.UNCOLLECTED && !localTokenInput.states.length) {
                    if (existingRecord) {
                        tokensToDelete.push(localTokenInput.token);
                        continue;
                    } else {
                        console.error(
                            `Cannot save local token with uncollected status and no states: "${localTokenInput.token}"`
                        );
                        return { savedTokens: [], deletedTokens: [] };
                    }
                }
                recordsToAdd.push({
                    profile,
                    track: LOCAL_TOKEN_TRACK,
                    source: DictionaryTokenSource.LOCAL,
                    token: localTokenInput.token,
                    status: localTokenInput.status,
                    lemmas: localTokenInput.lemmas,
                    states: localTokenInput.states,
                    cardIds: [],
                });
            }
            const res = await Promise.all([
                this._saveRecordBulk(recordsToAdd),
                this.deleteRecordLocalBulk(inputProfile, tokensToDelete),
            ]);
            return { savedTokens: res[0], deletedTokens: res[1].deletedTokens };
        });
    }

    async deleteRecordLocalBulk(
        inputProfile: string | undefined,
        tokens: string[]
    ): Promise<DictionaryDeleteRecordLocalResult> {
        if (!tokens.length) return { deletedTokens: [] };
        const profile = this._getProfile(inputProfile);
        return this.db.transaction('rw', this.db.tokens, async () => {
            const deletedTokens = await this.db.tokens
                .where('[token+source+track+profile]')
                .anyOf(tokens.map((token) => [token, DictionaryTokenSource.LOCAL, LOCAL_TOKEN_TRACK, profile]))
                .primaryKeys();
            await this.db.tokens.bulkDelete(deletedTokens);
            return { deletedTokens };
        });
    }

    /**
     * The only records we need to export are local tokens. Since our needs are simple, we can
     * avoid using the dexie-export-import package.
     */
    async exportRecordLocalBulk(): Promise<DictionaryExportRecordLocalResult> {
        return this.db.tokens
            .filter((record) => record.source === DictionaryTokenSource.LOCAL)
            .toArray()
            .then((records) => ({
                exportedRecords: records.map((r) => ({
                    profile: r.profile,
                    token: r.token,
                    status: r.status,
                    lemmas: r.lemmas.length ? r.lemmas : undefined,
                    states: r.states.length ? r.states : undefined,
                })),
            }));
    }

    async importRecordLocalBulk(
        items: Partial<DictionaryTokenRecord>[],
        profiles: string[]
    ): Promise<DictionaryImportRecordLocalResult> {
        const defaultProfile = this._getProfile(undefined);
        if (!profiles.includes(defaultProfile)) profiles.unshift(defaultProfile);
        const fullyKnownStatus = getFullyKnownTokenStatus();

        return this.db.transaction('rw', this.db.tokens, async () => {
            const existingProfileTokens = new Map<string, Map<string, DictionaryLocalTokenInput>>();
            await this.db.tokens
                .filter((record) => record.source === DictionaryTokenSource.LOCAL)
                .each((record) => {
                    let existingTokens = existingProfileTokens.get(record.profile);
                    if (!existingTokens) {
                        existingTokens = new Map();
                        existingProfileTokens.set(record.profile, existingTokens);
                    }
                    existingTokens.set(record.token, {
                        token: record.token,
                        status: record.status,
                        lemmas: record.lemmas,
                        states: record.states,
                    });
                });

            const records: DictionaryTokenRecord[] = [];
            for (const item of items) {
                if (!item.token || !HAS_LETTER_REGEX.test(item.token)) continue;
                if (!item.profile || !profiles.includes(item.profile)) continue;
                if (!item.lemmas) item.lemmas = [];
                if (!item.states) item.states = [];
                const existingToken = existingProfileTokens.get(item.profile)?.get(item.token);
                if (existingToken) {
                    item.status = Math.max(item.status ?? TokenStatus.UNCOLLECTED, existingToken.status!); // Keep the highest for imports
                    for (const existingLemma of existingToken.lemmas) {
                        if (!item.lemmas.includes(existingLemma)) item.lemmas.push(existingLemma);
                    }
                    item.states = existingToken.states; // Treat the existing states as authoritative, TODO: expose ApplyStrategy for imports?
                }
                item.lemmas = item.lemmas.filter((lemma) => HAS_LETTER_REGEX.test(lemma));
                if (!item.lemmas.length) continue; // Cannot import tokens with no lemmas, require a different method where a tokenizer is available
                let status = item.status;
                if (item.status == null || item.status < TokenStatus.UNKNOWN) {
                    if (!item.states.length) continue; // Status cannot be uncollected unless there is a state
                    if (status == null) status = TokenStatus.UNCOLLECTED;
                } else if (item.status > fullyKnownStatus) {
                    status = fullyKnownStatus;
                }
                records.push({
                    profile: item.profile,
                    track: LOCAL_TOKEN_TRACK,
                    source: DictionaryTokenSource.LOCAL,
                    token: item.token,
                    status: status!,
                    lemmas: item.lemmas,
                    states: item.states,
                    cardIds: [],
                });
            }
            return { importedTokens: await this._saveRecordBulk(records) };
        });
    }

    async deleteProfile(profile: string): Promise<DictionaryDeleteProfileResult> {
        return this.db.transaction('rw', this.db.meta, this.db.tokens, async () => {
            const deletedMetas = await this.db.meta.where('profile').equals(profile).primaryKeys();
            const deletedTokens = await this.db.tokens.where('profile').equals(profile).primaryKeys();
            await Promise.all([this.db.meta.bulkDelete(deletedMetas), this.db.tokens.bulkDelete(deletedTokens)]);
            return { deletedMetas, deletedTokens };
        });
    }

    private async _getFromSourceBulk(
        profile: string,
        track: number,
        source: DictionaryTokenSource,
        tokens: string[]
    ): Promise<Map<string, DictionaryTokenRecord>> {
        if (!tokens.length) return new Map();
        return this.db.tokens
            .where('[token+source+track+profile]')
            .anyOf(tokens.map((token) => [token, source, track, profile]))
            .toArray()
            .then((records) => {
                if (!records.length) return new Map();
                const tokenRecordMap = new Map<string, DictionaryTokenRecord>();
                for (const record of records) tokenRecordMap.set(record.token, record);
                return tokenRecordMap;
            });
    }

    private async _saveRecordBulk(records: DictionaryTokenRecord[]): Promise<DictionaryTokenKey[]> {
        if (!records.length) return [];
        return this.db.tokens.bulkPut(records, { allKeys: true });
    }
}
