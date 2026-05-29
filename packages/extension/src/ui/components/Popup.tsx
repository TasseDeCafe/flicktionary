import Grid from '@mui/material/Grid';
import { AsbplayerSettings, Profile, chromeCommandBindsToKeyBinds } from '@asbplayer-fork/common/settings';
import SettingsForm from '@asbplayer-fork/common/components/SettingsForm';
import LaunchIcon from '@mui/icons-material/Launch';
import { useCallback } from 'react';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import { useTranslation } from 'react-i18next';
import { useLocalFontFamilies } from '@asbplayer-fork/common/hooks';
import { useSupportedLanguages } from '../hooks/use-supported-languages';
import { useI18n } from '../hooks/use-i18n';
import { isMobile } from 'react-device-detect';
import { isFirefoxBuild } from '../../services/build-flags';
import { useTheme } from '@mui/material/styles';
import SettingsProfileSelectMenu from '@asbplayer-fork/common/components/SettingsProfileSelectMenu';
import { settingsPageConfigs } from '@/services/pages';
import { FlicktionaryPairSection } from './FlicktionaryPairSection';
import Stack from '@mui/material/Stack';
import TutorialIcon from '@asbplayer-fork/common/components/TutorialIcon';
import Paper from '@mui/material/Paper';

interface Props {
    settings: AsbplayerSettings;
    commands: any;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onOpenApp: () => void;
    onOpenExtensionShortcuts: () => void;
    onOpenUserGuide: () => void;
    profiles: Profile[];
    activeProfile?: string;
    onNewProfile: (name: string) => void;
    onRemoveProfile: (name: string) => void;
    onSetActiveProfile: (name: string | undefined) => void;
}

const Popup = ({
    settings,
    commands,
    onOpenApp,
    onSettingsChanged,
    onOpenExtensionShortcuts,
    onOpenUserGuide,
    ...profilesContext
}: Props) => {
    const { t } = useTranslation();
    const { initialized: i18nInitialized } = useI18n({ language: settings.language });
    const handleUnlockLocalFonts = useCallback(() => {
        browser.tabs.create({
            url: `${browser.runtime.getURL('/options.html')}#subtitle-appearance`,
            active: true,
        });
    }, []);
    const { supportedLanguages } = useSupportedLanguages();
    const { localFontsAvailable, localFontsPermission, localFontFamilies } = useLocalFontFamilies();
    const theme = useTheme();

    if (!i18nInitialized) {
        return null;
    }

    return (
        <Paper>
            <Stack direction="column" spacing={1.5} sx={{ padding: theme.spacing(1.5) }}>
                <ButtonGroup fullWidth variant="contained" color="primary" orientation="horizontal">
                    <Button variant="contained" color="primary" startIcon={<LaunchIcon />} onClick={onOpenApp}>
                        {t('action.openApp')}
                    </Button>
                    <Button variant="contained" color="primary" startIcon={<TutorialIcon />} onClick={onOpenUserGuide}>
                        {t('action.userGuide')}
                    </Button>
                </ButtonGroup>
                <FlicktionaryPairSection />
                <Grid
                    item
                    style={{
                        height: isMobile ? 'auto' : 390,
                    }}
                >
                    <SettingsForm
                        heightConstrained
                        extensionInstalled
                        extensionVersion={browser.runtime.getManifest().version}
                        extensionSupportsOverlay
                        extensionSupportsSidePanel={!isFirefoxBuild}
                        extensionSupportsTrackSpecificSettings
                        extensionSupportsSubtitlesWidthSetting
                        extensionSupportsPauseOnHover
                        extensionSupportsExportCardBind
                        extensionSupportsPageSettings
                        forceVerticalTabs={false}
                        chromeKeyBinds={chromeCommandBindsToKeyBinds(commands)}
                        settings={settings}
                        profiles={profilesContext.profiles}
                        activeProfile={profilesContext.activeProfile}
                        pageConfigs={settingsPageConfigs}
                        localFontsAvailable={localFontsAvailable}
                        localFontsPermission={localFontsPermission}
                        localFontFamilies={localFontFamilies}
                        supportedLanguages={supportedLanguages}
                        onSettingsChanged={onSettingsChanged}
                        onOpenChromeExtensionShortcuts={onOpenExtensionShortcuts}
                        onUnlockLocalFonts={handleUnlockLocalFonts}
                    />
                </Grid>
                <Grid item>
                    <SettingsProfileSelectMenu {...profilesContext} />
                </Grid>
            </Stack>
        </Paper>
    );
};

export default Popup;
