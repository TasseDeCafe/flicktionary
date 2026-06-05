import { Download, Trash2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import SettingsField from './SettingsField'
import SettingsSwitchRow from './SettingsSwitchRow'
import SettingsRadioGroupField from './SettingsRadioGroupField'
import { AsbplayerSettings, exportSettings, PauseOnHoverMode, validateSettings } from '../settings'
import { Trans, useLingui } from '@lingui/react/macro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SubtitleHtml } from '..'
import SettingsSection from './SettingsSection'
import UiSettings from './UiSettings'

function regexIsValid(regex: string) {
  try {
    new RegExp(regex.trim())
    return true
  } catch (e) {
    return false
  }
}

interface Props {
  settings: AsbplayerSettings
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  supportedLanguages: string[]
  insideApp?: boolean
  extensionInstalled?: boolean
  extensionSupportsPauseOnHover?: boolean
}

const MiscSettingTab: React.FC<Props> = ({
  settings,
  onSettingChanged,
  onSettingsChanged,
  supportedLanguages,
  insideApp,
  extensionInstalled,
  extensionSupportsPauseOnHover,
}) => {
  const { t } = useLingui()
  const {
    themeType,
    language,
    rememberSubtitleOffset,
    autoCopyCurrentSubtitle,
    subtitleRegexFilter,
    tabName,
    subtitleRegexFilterTextReplacement,
    subtitleHtml,
    convertNetflixRuby,
    pauseOnHoverMode,
    transcriptServerUrl,
    transcriptApiKey,
  } = settings
  const validRegex = useMemo(() => regexIsValid(subtitleRegexFilter), [subtitleRegexFilter])

  const settingsFileInputRef = useRef<HTMLInputElement>(null)
  const handleSettingsFileInputChange = useCallback(async () => {
    try {
      const file = settingsFileInputRef.current?.files?.[0]

      if (file === undefined) {
        return
      }

      const importedSettings = JSON.parse(await file.text())
      const validatedSettings = validateSettings(importedSettings)
      onSettingsChanged(validatedSettings)
    } catch (e) {
      console.error(e)
    }
  }, [onSettingsChanged])

  const handleImportSettings = useCallback(() => {
    settingsFileInputRef.current?.click()
  }, [])
  const handleExportSettings = useCallback(() => {
    exportSettings(settings)
  }, [settings])

  // Transcript cache management (extension only)
  const [transcriptCacheCount, setTranscriptCacheCount] = useState<number>(0)

  const refreshTranscriptCacheCount = useCallback(async () => {
    if (insideApp) return
    try {
      const response = await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'get-transcript-cache-count', messageId: Date.now().toString() },
      })
      setTranscriptCacheCount(response?.count ?? 0)
    } catch (e) {
      console.error('Failed to get transcript cache count:', e)
    }
  }, [insideApp])

  useEffect(() => {
    refreshTranscriptCacheCount()
  }, [refreshTranscriptCacheCount])

  const handleExportTranscriptCache = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'export-transcript-cache', messageId: Date.now().toString() },
      })
      if (response?.json) {
        const blob = new Blob([response.json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `transcript-cache-backup-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Failed to export transcript cache:', e)
    }
  }, [])

  const handleClearTranscriptCache = useCallback(async () => {
    if (!window.confirm('Are you sure you want to clear all cached transcripts? This cannot be undone.')) {
      return
    }
    try {
      await chrome.runtime.sendMessage({
        sender: 'asbplayer-popup',
        message: { command: 'clear-transcript-cache', messageId: Date.now().toString() },
      })
      setTranscriptCacheCount(0)
    } catch (e) {
      console.error('Failed to clear transcript cache:', e)
    }
  }, [])

  return (
    <>
      <div className='flex flex-col gap-2'>
        <UiSettings
          themeType={themeType}
          language={language}
          supportedLanguages={supportedLanguages}
          onSettingChanged={onSettingChanged}
        />
        <SettingsSection>
          <Trans>Subtitles</Trans>
        </SettingsSection>
        <SettingsSwitchRow
          label={t`Remember subtitle offset`}
          checked={rememberSubtitleOffset}
          onCheckedChange={(checked) => onSettingChanged('rememberSubtitleOffset', checked)}
        />
        <SettingsSwitchRow
          label={t`Auto-copy current subtitle to clipboard`}
          checked={autoCopyCurrentSubtitle}
          onCheckedChange={(checked) => onSettingChanged('autoCopyCurrentSubtitle', checked)}
        />
        <SettingsField
          label={t`Subtitle regex filter`}
          value={subtitleRegexFilter}
          errorText={validRegex ? undefined : 'Invalid regular expression'}
          onChange={(event) => onSettingChanged('subtitleRegexFilter', event.target.value)}
        />
        <SettingsField
          label={t`Subtitle regex filter text replacement`}
          value={subtitleRegexFilterTextReplacement}
          onChange={(event) => onSettingChanged('subtitleRegexFilterTextReplacement', event.target.value)}
        />
        <SettingsRadioGroupField
          row
          label={<Trans>Subtitle HTML</Trans>}
          value={subtitleHtml === SubtitleHtml.remove ? 'remove' : 'render'}
          options={[
            { value: 'remove', label: t`Remove` },
            { value: 'render', label: t`Render` },
          ]}
          onValueChange={(value) =>
            onSettingChanged('subtitleHtml', value === 'remove' ? SubtitleHtml.remove : SubtitleHtml.render)
          }
        />
        <SettingsSwitchRow
          label={t`Detect and Display Ruby`}
          checked={convertNetflixRuby}
          onCheckedChange={(checked) => onSettingChanged('convertNetflixRuby', checked)}
        />
        {(!extensionInstalled || extensionSupportsPauseOnHover) && (
          <SettingsRadioGroupField
            label={<Trans>Auto-pause when mousing over subtitles</Trans>}
            value={
              pauseOnHoverMode === PauseOnHoverMode.disabled
                ? 'disabled'
                : pauseOnHoverMode === PauseOnHoverMode.inAndOut
                  ? 'inAndOut'
                  : 'inNotOut'
            }
            options={[
              { value: 'disabled', label: t`Disabled` },
              { value: 'inAndOut', label: t`Enabled with auto-resume` },
              { value: 'inNotOut', label: t`Enabled` },
            ]}
            onValueChange={(value) =>
              onSettingChanged(
                'pauseOnHoverMode',
                value === 'disabled'
                  ? PauseOnHoverMode.disabled
                  : value === 'inAndOut'
                    ? PauseOnHoverMode.inAndOut
                    : PauseOnHoverMode.inNotOut
              )
            }
          />
        )}
        {insideApp && (
          <SettingsField
            label={t`Name of the tab`}
            value={tabName}
            onChange={(event) => onSettingChanged('tabName', event.target.value)}
          />
        )}
        <SettingsSection>
          <Trans>Subtitle Generation</Trans>
        </SettingsSection>
        <SettingsField
          label={t`Transcript Server URL`}
          value={transcriptServerUrl}
          onChange={(event) => onSettingChanged('transcriptServerUrl', event.target.value)}
        />
        <SettingsField
          label={t`Transcript Server API Key (optional)`}
          type='password'
          value={transcriptApiKey}
          onChange={(event) => onSettingChanged('transcriptApiKey', event.target.value)}
        />
        {!insideApp && (
          <div className='flex flex-col gap-2'>
            <p className='text-sm'>Cached Transcripts: {transcriptCacheCount}</p>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='flex-1'
                onClick={handleExportTranscriptCache}
                disabled={transcriptCacheCount === 0}
              >
                <Download />
                Export
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='text-destructive flex-1'
                onClick={handleClearTranscriptCache}
                disabled={transcriptCacheCount === 0}
              >
                <Trash2 />
                Clear
              </Button>
            </div>
          </div>
        )}
        <SettingsSection>
          <Trans>Settings</Trans>
        </SettingsSection>
        <div className='flex gap-2'>
          <Button type='button' className='flex-1' onClick={handleImportSettings}>
            <Trans>Import Settings</Trans>
          </Button>
          <Button type='button' className='flex-1' onClick={handleExportSettings}>
            <Trans>Export Settings</Trans>
          </Button>
        </div>
      </div>
      <input
        ref={settingsFileInputRef}
        onChange={handleSettingsFileInputChange}
        type='file'
        accept='.json'
        multiple
        hidden
      />
    </>
  )
}

export default MiscSettingTab
