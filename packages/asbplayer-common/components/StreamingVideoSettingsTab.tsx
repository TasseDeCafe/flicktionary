import { SlidersHorizontal } from 'lucide-react'
import SettingsField from './SettingsField'
import SettingsSwitchRow from './SettingsSwitchRow'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsbplayerSettings, Page, PageSettings, YoutubePage } from '../settings'
import { pageMetadata } from '../pages'
import { PageConfigMap } from './SettingsForm'
import { useState } from 'react'
import PageSettingsForm from './PageSettingsForm'
import SettingsSection from './SettingsSection'

const pageSettingsHasModifications = (page: Page) => {
  return (
    page.overrides !== undefined ||
    page.additionalHosts !== undefined ||
    (page as YoutubePage).targetLanguages !== undefined
  )
}

interface Props {
  settings: AsbplayerSettings
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  insideApp?: boolean
  extensionSupportsOverlay?: boolean
  extensionSupportsPageSettings?: boolean
  pageConfigs?: PageConfigMap
}

const StreamingVideoSettingsTab: React.FC<Props> = ({
  settings,
  onSettingChanged,
  onSettingsChanged,
  extensionSupportsOverlay,
  extensionSupportsPageSettings,
  pageConfigs,
}) => {
  const { t } = useLingui()
  const {
    streamingEnableOverlay,
    streamingDisplaySubtitles,
    streamingSubsDragAndDrop,
    streamingAutoSync,
    streamingAutoSyncPromptOnFailure,
    streamingCondensedPlaybackMinimumSkipIntervalMs,
    streamingPages,
  } = settings
  const [pageSettingsFormKey, setPageSettingsFormKey] = useState<keyof PageSettings>('netflix')
  const [pageSettingsFormOpen, setPageSettingsFormOpen] = useState<boolean>(false)
  return (
    <>
      {extensionSupportsPageSettings && pageConfigs && pageSettingsFormKey && (
        <PageSettingsForm
          open={pageSettingsFormOpen}
          pageKey={pageSettingsFormKey}
          page={settings.streamingPages[pageSettingsFormKey]}
          hasModifications={pageSettingsHasModifications(settings.streamingPages[pageSettingsFormKey])}
          defaultPageConfig={pageConfigs[pageSettingsFormKey]}
          onClose={() => setPageSettingsFormOpen(false)}
          onPageChanged={(key, page) => onSettingsChanged({ streamingPages: { ...streamingPages, [key]: page } })}
        />
      )}
      <div className='flex flex-col gap-2'>
        <SettingsSection>
          <Trans>UI</Trans>
        </SettingsSection>
        {extensionSupportsOverlay && (
          <SettingsSwitchRow
            label={t`Enable controls overlay`}
            checked={streamingEnableOverlay}
            onCheckedChange={(checked) => onSettingChanged('streamingEnableOverlay', checked)}
          />
        )}
        <SettingsSwitchRow
          label={t`Display subtitles`}
          checked={streamingDisplaySubtitles}
          onCheckedChange={(checked) => onSettingChanged('streamingDisplaySubtitles', checked)}
        />
        <SettingsSection>
          <Trans>Subtitles</Trans>
        </SettingsSection>
        <SettingsSwitchRow
          label={t`Allow subtitle file drag-and-drop`}
          checked={streamingSubsDragAndDrop}
          onCheckedChange={(checked) => onSettingChanged('streamingSubsDragAndDrop', checked)}
        />
        <SettingsSwitchRow
          label={t`Auto-load detected subtitles`}
          checked={streamingAutoSync}
          onCheckedChange={(checked) => onSettingChanged('streamingAutoSync', checked)}
        />
        <SettingsSwitchRow
          label={t`Prompt on failure to auto-load subtitles`}
          checked={streamingAutoSyncPromptOnFailure}
          onCheckedChange={(checked) => onSettingChanged('streamingAutoSyncPromptOnFailure', checked)}
        />
        <SettingsSection>
          <Trans>Misc</Trans>
        </SettingsSection>
        <SettingsField
          type='number'
          min={0}
          step={1}
          suffix='ms'
          label={t`Condensed playback minimum skip interval`}
          value={streamingCondensedPlaybackMinimumSkipIntervalMs}
          onChange={(e) => onSettingChanged('streamingCondensedPlaybackMinimumSkipIntervalMs', Number(e.target.value))}
        />
        {pageConfigs && (
          <>
            <SettingsSection>
              <Trans>Pages</Trans>
            </SettingsSection>
            <div className='overflow-hidden rounded-lg border'>
              {Object.keys(pageConfigs).map((key) => {
                const pageKey = key as keyof PageSettings
                const metadata = pageMetadata[pageKey]
                const page = settings.streamingPages[pageKey]

                return (
                  <button
                    key={key}
                    type='button'
                    className='hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0'
                    onClick={() => {
                      setPageSettingsFormKey(pageKey)
                      setPageSettingsFormOpen(true)
                    }}
                  >
                    <img src={pageConfigs[pageKey].faviconUrl} alt='' className='size-6 shrink-0' />
                    <span className='flex-1 text-left text-sm'>{metadata.title}</span>
                    <span className='relative inline-flex'>
                      <SlidersHorizontal className='text-muted-foreground size-4' />
                      {pageSettingsHasModifications(page) && (
                        <span className='absolute -top-1 -right-1 size-2 rounded-full bg-yellow-500' />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}

export default StreamingVideoSettingsTab
