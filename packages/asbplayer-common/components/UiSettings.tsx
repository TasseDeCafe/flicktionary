import FormControl from '@mui/material/FormControl'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import SettingsTextField from './SettingsTextField'
import LabelWithHoverEffect from './LabelWithHoverEffect'
import SettingsSection from './SettingsSection'
import { AsbplayerSettings } from '../settings'
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
const UiSettings: React.FC<Props> = ({ themeType, language, supportedLanguages, onSettingChanged }) => {
  const { t } = useLingui()
  return (
    <>
      <SettingsSection>
        <Trans>UI</Trans>
      </SettingsSection>
      <FormControl>
        <FormLabel>
          <Trans>Theme</Trans>
        </FormLabel>
        <RadioGroup row>
          <LabelWithHoverEffect
            control={
              <Radio
                checked={themeType === 'light'}
                value='light'
                onChange={(event) => event.target.checked && onSettingChanged('themeType', 'light')}
              />
            }
            label={t`Light`}
          />
          <LabelWithHoverEffect
            control={
              <Radio
                checked={themeType === 'dark'}
                value='dark'
                onChange={(event) => event.target.checked && onSettingChanged('themeType', 'dark')}
              />
            }
            label={t`Dark`}
          />
        </RadioGroup>
      </FormControl>
      <SettingsTextField
        select
        label={t`Language`}
        value={language}
        color='primary'
        onChange={(event) => onSettingChanged('language', event.target.value)}
      >
        {supportedLanguages.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </SettingsTextField>
    </>
  )
}

export default UiSettings
