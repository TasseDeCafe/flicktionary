import { JSX } from 'react'
import { TriangleAlert } from 'lucide-react'
import { MutablePageConfig, Page, PageConfig, PageSettings, YoutubePage } from '../settings'
import { Trans, useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@flicktionary/ui/components/dialog'
import SettingsField from './SettingsField'
import SettingsSwitchRow from './SettingsSwitchRow'
import { pageMetadata } from '../pages'
import ListField from './ListField'

const maxAdditionalHostsLength = 50
const youtubeTargetLanguageLimit = 3

const totalLength = (strings: string[]) => {
  let total = 0

  for (const str of strings) {
    total += str.length
  }

  return total
}

export interface PageSettingsFormProps {
  open: boolean
  pageKey: keyof PageSettings
  page: Page
  defaultPageConfig: PageConfig
  additionalControls?: JSX.Element
  hasModifications: boolean
  onClose: () => void
  onPageChanged: <K extends keyof PageSettings>(key: K, page: PageSettings[K]) => void
}

// NOTE: the upstream fork carried a commented-out "disable CSP" feature here
// (declarativeNetRequest dynamic rules gated behind a confirm dialog). It was
// dropped with the MUI rewrite — recover it from git history if it ever comes
// back: PageSettingsForm.tsx @ eb611898.

const PageSettingsForm = (props: PageSettingsFormProps) => {
  if (props.pageKey === 'youtube') {
    return <YoutubePageSettingsForm {...props} />
  }

  return <DefaultPageSettingsForm {...props} />
}

const YoutubePageSettingsForm = (props: PageSettingsFormProps) => {
  const { t } = useLingui()
  const { onPageChanged, page } = props
  const { targetLanguages } = page as YoutubePage

  return (
    <DefaultPageSettingsForm
      {...props}
      additionalControls={
        <ListField
          label={t`Target language codes for machine translation`}
          items={targetLanguages ?? []}
          onItemsChange={(newTargetLanguages) => {
            if (newTargetLanguages.length <= youtubeTargetLanguageLimit) {
              onPageChanged('youtube', { ...page, targetLanguages: newTargetLanguages })
            }
          }}
        />
      }
    />
  )
}

const DefaultPageSettingsForm = ({
  open,
  pageKey,
  page,
  defaultPageConfig,
  additionalControls,
  hasModifications,
  onClose,
  onPageChanged,
}: PageSettingsFormProps) => {
  const { t } = useLingui()
  const overrides = page.overrides
  const handleOverrideFieldChanged = <K extends keyof MutablePageConfig>(key: K, value: MutablePageConfig[K]) => {
    const newOverrides = { ...page.overrides, [key]: value }
    if (typeof newOverrides[key] === 'string' && newOverrides[key] === (defaultPageConfig[key] ?? '')) {
      delete newOverrides[key]
    } else if (typeof newOverrides[key] === 'boolean' && newOverrides[key] === (defaultPageConfig[key] ?? false)) {
      delete newOverrides[key]
    }
    const newOverridesAreEmpty = Object.keys(newOverrides).length === 0
    onPageChanged(pageKey, { ...page, overrides: newOverridesAreEmpty ? undefined : newOverrides })
  }
  return (
    <Dialog open={open} onOpenChange={(nowOpen) => !nowOpen && onClose()}>
      <DialogContent className='flex max-h-[calc(100dvh-64px)] flex-col' aria-describedby={undefined}>
        <DialogTitle>{pageMetadata[pageKey].title}</DialogTitle>
        <div className='flex min-h-0 flex-col gap-2 overflow-y-auto'>
          {hasModifications && (
            <div className='flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm'>
              <TriangleAlert className='size-4 shrink-0 text-yellow-500' />
              <span className='flex-1'>
                <Trans>These settings have been modified.</Trans>
              </span>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  onPageChanged(pageKey, {
                    ...page,
                    overrides: undefined,
                    additionalHosts: undefined,
                    targetLanguages: undefined,
                  })
                }
              >
                <Trans>Revert</Trans>
              </Button>
            </div>
          )}
          <SettingsField disabled label={t`Host regex`} value={defaultPageConfig.hostRegex} />
          <ListField
            label={t`Additional hosts`}
            items={page.additionalHosts ?? []}
            onItemsChange={(additionalHosts) => {
              if (totalLength(additionalHosts) > maxAdditionalHostsLength) {
                return
              }

              onPageChanged(pageKey, {
                ...page,
                additionalHosts: additionalHosts.length === 0 ? undefined : additionalHosts,
              })
            }}
          />
          <SettingsField
            label={t`Path regex for subtitle detection`}
            value={overrides?.syncAllowedAtPath ?? defaultPageConfig.syncAllowedAtPath ?? ''}
            onChange={(e) => handleOverrideFieldChanged('syncAllowedAtPath', e.target.value)}
          />
          <SettingsField
            label={t`Path hash regex for subtitle detection`}
            value={overrides?.syncAllowedAtHash ?? defaultPageConfig.syncAllowedAtHash ?? ''}
            onChange={(e) => handleOverrideFieldChanged('syncAllowedAtHash', e.target.value)}
          />
          {additionalControls}
          <SettingsSwitchRow
            label={t`Search shadow roots for video elements`}
            checked={
              overrides?.searchShadowRootsForVideoElements ??
              defaultPageConfig.searchShadowRootsForVideoElements ??
              false
            }
            onCheckedChange={(checked) => handleOverrideFieldChanged('searchShadowRootsForVideoElements', checked)}
          />
          <SettingsSwitchRow
            label={t`Allow video elements with blank src`}
            checked={
              overrides?.allowVideoElementsWithBlankSrc ?? defaultPageConfig.allowVideoElementsWithBlankSrc ?? false
            }
            onCheckedChange={(checked) => handleOverrideFieldChanged('allowVideoElementsWithBlankSrc', checked)}
          />
          <SettingsSwitchRow
            label={t`Allow auto-loading of detected subtitles`}
            checked={overrides?.autoSyncEnabled ?? defaultPageConfig.autoSyncEnabled ?? false}
            onCheckedChange={(checked) => handleOverrideFieldChanged('autoSyncEnabled', checked)}
          />
        </div>
        <DialogFooter>
          <Button type='button' variant='ghost' onClick={onClose}>
            <Trans>OK</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PageSettingsForm
