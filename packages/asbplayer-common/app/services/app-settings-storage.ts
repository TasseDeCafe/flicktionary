import { SettingsStorage } from '@asbplayer-fork/common/settings';

export interface AppSettingsStorage extends SettingsStorage {
    onSettingsUpdated(callback: () => void): () => void;
}
