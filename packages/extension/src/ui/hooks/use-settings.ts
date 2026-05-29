import { Command, SettingsUpdatedMessage } from '@asbplayer-fork/common';
import { AsbplayerSettings, SettingsProvider } from '@asbplayer-fork/common/settings';
import { ExtensionSettingsStorage } from '../../services/extension-settings-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsProfileContext } from '@asbplayer-fork/common/hooks/use-settings-profile-context';
import { DictionaryProvider } from '@asbplayer-fork/common/dictionary-db';
import { ExtensionDictionaryStorage } from '@/services/extension-dictionary-storage';

export const useSettings = () => {
    const dictionaryProvider = useMemo<DictionaryProvider>(
        () => new DictionaryProvider(new ExtensionDictionaryStorage()),
        []
    );
    const settingsProvider = useMemo<SettingsProvider>(() => new SettingsProvider(new ExtensionSettingsStorage()), []);
    const [settings, setSettings] = useState<AsbplayerSettings>();
    const refreshSettings = useCallback(() => settingsProvider.getAll().then(setSettings), [settingsProvider]);

    useEffect(() => {
        refreshSettings();
    }, [refreshSettings]);

    useEffect(() => {
        browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.message?.command === 'settings-updated') {
                settingsProvider.getAll().then(setSettings);
            }
        });
    }, [settingsProvider]);

    const notifySettingsUpdated = useCallback(() => {
        const command: Command<SettingsUpdatedMessage> = {
            sender: 'asbplayer-settings',
            message: {
                command: 'settings-updated',
            },
        };
        browser.runtime.sendMessage(command);
    }, []);

    const onSettingsChanged = useCallback(
        (settings: Partial<AsbplayerSettings>) => {
            setSettings((s) => ({ ...s!, ...settings }));
            settingsProvider.set(settings).then(() => notifySettingsUpdated());
        },
        [settingsProvider, notifySettingsUpdated]
    );

    const handleProfileChanged = useCallback(() => {
        refreshSettings();
        notifySettingsUpdated();
    }, [refreshSettings, notifySettingsUpdated]);

    const profileContext = useSettingsProfileContext({
        dictionaryProvider,
        settingsProvider,
        onProfileChanged: handleProfileChanged,
    });

    return { dictionaryProvider, settings, onSettingsChanged, profileContext };
};
