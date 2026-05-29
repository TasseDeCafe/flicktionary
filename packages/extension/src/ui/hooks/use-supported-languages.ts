import React, { useEffect, useState } from 'react';
import { supportedLanguages as defaultSupportedLanguages } from '@asbplayer-fork/common/settings';
import { fetchSupportedLanguages } from '../../services/localization-fetcher';

export const useSupportedLanguages = () => {
    const [supportedLanguages, setSupportedLanguages] = useState<string[]>(defaultSupportedLanguages);

    useEffect(() => {
        fetchSupportedLanguages().then(setSupportedLanguages);
    }, []);

    return { supportedLanguages };
};
