import SettingsSection from './SettingsSection'
import SettingsSelectField from './SettingsSelectField'
import SettingsRadioGroupField from './SettingsRadioGroupField'
import { AsbplayerSettings } from '../settings'
import { findSupportedLanguage } from '@flicktionary/core/constants/supported-languages'
import { Trans, useLingui } from '@lingui/react/macro'

interface Props {
  themeType: AsbplayerSettings['themeType']
  language: string
  supportedLanguages: string[]
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => void
}

// The non-subtitle "UI" settings block (theme + language). Shared between the
// Misc tab of the full SettingsForm and the simpler import popup, which exposes
// these as its only settings.
const UiSettings = ({ themeType, language, supportedLanguages, onSettingChanged }: Props) => {
  const { t } = useLingui()
  return (
    <>
      <SettingsSection>
        <Trans>UI</Trans>
      </SettingsSection>
      <SettingsRadioGroupField
        row
        label={<Trans>Theme</Trans>}
        value={themeType}
        options={[
          { value: 'system', label: t`System` },
          { value: 'light', label: t`Light` },
          { value: 'dark', label: t`Dark` },
        ]}
        onValueChange={(value) => onSettingChanged('themeType', value)}
      />
      <SettingsSelectField
        label={t`Language`}
        value={language}
        options={[
          { value: 'system', label: t`System` },
          ...supportedLanguages.map((code) => ({
            value: code,
            label: findSupportedLanguage(code)?.nativeName ?? code,
          })),
        ]}
        onValueChange={(value) => onSettingChanged('language', value)}
      />
    </>
  )
}

export default UiSettings
