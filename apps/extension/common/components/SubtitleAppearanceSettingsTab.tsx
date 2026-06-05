import React, { useCallback, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Lock, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Slider } from '@flicktionary/ui/components/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@flicktionary/ui/components/tooltip'
import {
  AsbplayerSettings,
  TextSubtitleSettings,
  changeForTextSubtitleSetting,
  textSubtitleSettingsAreDirty,
  textSubtitleSettingsForTrack,
} from '@asbplayer-fork/common/settings'
import { isNumeric } from '@asbplayer-fork/common/util'
import { CustomStyle } from '@asbplayer-fork/common/settings'
import SubtitleAppearanceTrackSelector from './SubtitleAppearanceTrackSelector'
import SubtitlePreview from './SubtitlePreview'
import SettingsColorField from './SettingsColorField'
import SettingsField from './SettingsField'
import SettingsSelectField from './SettingsSelectField'
import SettingsSwitchRow from './SettingsSwitchRow'
import SettingsRadioGroupField from './SettingsRadioGroupField'
import SettingsSection from './SettingsSection'

// Build the list of camelCase CSS property names. Chrome exposes them as own
// enumerable props of the style declaration (Object.keys would do), but
// Firefox defines them on the prototype where only for..in finds them — so
// walk the chain and keep string-valued keys, skipping the indexed entries
// ('0', '1', ... for set properties) and non-property members (methods,
// length, cssText).
const bodyStyle = document.body.style as unknown as Record<string, unknown>
const cssStyles: string[] = []
for (const key in bodyStyle) {
  if (!isNumeric(key) && key !== 'cssText' && typeof bodyStyle[key] === 'string') {
    cssStyles.push(key)
  }
}

// Compact icon button for input endAdornments (28px fits inside the h-9 input).
const adornmentButtonClasses = 'size-7 md:size-7'

interface AddCustomStyleProps {
  styleKey: string
  onStyleKey: (styleKey: string) => void
  onAddCustomStyle: (styleKey: string) => void
}

// The MUI original was an Autocomplete; downgraded to a (typeahead-searchable)
// select per the migration plan — cmdk is not in the catalog.
function AddCustomStyle({ styleKey, onStyleKey, onAddCustomStyle }: AddCustomStyleProps) {
  const { t } = useLingui()
  return (
    <div className='flex items-end gap-2'>
      <SettingsSelectField
        label={t`Add Custom CSS`}
        value={styleKey}
        options={cssStyles.map((s) => ({ value: s }))}
        onValueChange={onStyleKey}
      />
      <Button
        type='button'
        variant='outline'
        size='icon'
        className='shrink-0'
        disabled={cssStyles.find((s) => s === styleKey) === undefined}
        onClick={() => {
          onAddCustomStyle(styleKey)
          onStyleKey(cssStyles[0])
        }}
      >
        <Plus />
      </Button>
    </div>
  )
}

interface CustomStyleSettingProps {
  customStyle: CustomStyle
  onCustomStyle: (style: CustomStyle) => void
  onDelete: () => void
}

function CustomStyleSetting({ customStyle, onCustomStyle, onDelete }: CustomStyleSettingProps) {
  const { t } = useLingui()

  return (
    <SettingsField
      label={t`CSS: ${customStyle.key}`}
      placeholder={t`Style Value`}
      value={customStyle.value}
      onChange={(e) => onCustomStyle({ key: customStyle.key, value: e.target.value })}
      endAdornment={
        <Button type='button' variant='ghost' size='icon-sm' className={adornmentButtonClasses} onClick={onDelete}>
          <Trash2 className='size-4' />
        </Button>
      }
    />
  )
}

interface Props {
  settings: AsbplayerSettings
  onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>
  onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void
  extensionInstalled?: boolean
  extensionSupportsTrackSpecificSettings?: boolean
  extensionSupportsSubtitlesWidthSetting?: boolean
  localFontsAvailable: boolean
  localFontsPermission?: PermissionState
  localFontFamilies: string[]
  onUnlockLocalFonts: () => void
}

const SubtitleAppearanceSettingsTab: React.FC<Props> = ({
  settings,
  onSettingChanged,
  onSettingsChanged,
  extensionInstalled,
  extensionSupportsTrackSpecificSettings,
  extensionSupportsSubtitlesWidthSetting,
  localFontsAvailable,
  localFontsPermission,
  localFontFamilies,
  onUnlockLocalFonts,
}) => {
  const { t } = useLingui()
  const { subtitlePreview, subtitlePositionOffset, topSubtitlePositionOffset, subtitlesWidth } = settings
  const [currentStyleKey, setCurrentStyleKey] = useState<string>(cssStyles[0])
  const [selectedSubtitleAppearanceTrack, setSelectedSubtitleAppearanceTrack] = useState<number>()
  const {
    subtitleSize,
    subtitleColor,
    subtitleThickness,
    subtitleOutlineThickness,
    subtitleOutlineColor,
    subtitleShadowThickness,
    subtitleShadowColor,
    subtitleBackgroundColor,
    subtitleBackgroundOpacity,
    subtitleFontFamily,
    subtitleCustomStyles,
    subtitleBlur,
    subtitleAlignment,
  } = textSubtitleSettingsForTrack(settings, selectedSubtitleAppearanceTrack)
  const handleSubtitleTextSettingChanged = useCallback(
    <K extends keyof TextSubtitleSettings>(key: K, value: TextSubtitleSettings[K]) => {
      // See settings.ts for more info about how/why subtitle settings are interpreted
      const diff = changeForTextSubtitleSetting({ [key]: value }, settings, selectedSubtitleAppearanceTrack)
      onSettingsChanged(diff)
    },
    [selectedSubtitleAppearanceTrack, settings, onSettingsChanged]
  )

  const handleResetSubtitleTrack = useCallback(() => {
    const diff = changeForTextSubtitleSetting(
      textSubtitleSettingsForTrack(settings, 0),
      settings,
      selectedSubtitleAppearanceTrack
    )
    onSettingsChanged(diff)
  }, [settings, selectedSubtitleAppearanceTrack, onSettingsChanged])

  const selectedSubtitleAppearanceTrackIsDirty =
    selectedSubtitleAppearanceTrack !== undefined &&
    textSubtitleSettingsAreDirty(settings, selectedSubtitleAppearanceTrack)
  return (
    <div className='flex flex-col gap-2'>
      {(!extensionInstalled || extensionSupportsTrackSpecificSettings) && (
        <>
          <SubtitleAppearanceTrackSelector
            track={selectedSubtitleAppearanceTrack === undefined ? 'all' : selectedSubtitleAppearanceTrack}
            onTrackSelected={(t) => setSelectedSubtitleAppearanceTrack(t === 'all' ? undefined : t)}
          />
          {selectedSubtitleAppearanceTrack !== undefined && (
            <Button
              type='button'
              variant='outline'
              disabled={!selectedSubtitleAppearanceTrackIsDirty}
              onClick={handleResetSubtitleTrack}
            >
              <Undo2 />
              <Trans>Reset</Trans>
            </Button>
          )}
        </>
      )}
      <SubtitlePreview
        subtitleSettings={settings}
        text={subtitlePreview}
        onTextChanged={(text) => onSettingChanged('subtitlePreview', text)}
      />
      <SettingsSection>
        <Trans>Styling</Trans>
      </SettingsSection>
      {subtitleColor !== undefined && (
        <SettingsColorField
          label={t`Subtitle Color`}
          value={subtitleColor}
          onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleColor', value)}
        />
      )}
      {subtitleSize !== undefined && (
        <SettingsField
          type='number'
          label={t`Subtitle Size`}
          value={subtitleSize}
          min={1}
          step={1}
          onChange={(event) => handleSubtitleTextSettingChanged('subtitleSize', Number(event.target.value))}
        />
      )}
      {subtitleThickness !== undefined && (
        <div className='flex flex-col gap-2'>
          <Label>
            <Trans>Subtitle Font Thickness</Trans>
            <span className='text-muted-foreground font-normal'>{subtitleThickness}</span>
          </Label>
          <Slider
            value={[subtitleThickness]}
            onValueChange={([value]) => handleSubtitleTextSettingChanged('subtitleThickness', value)}
            min={100}
            max={900}
            step={100}
            className='py-2'
          />
        </div>
      )}
      {subtitleOutlineColor !== undefined && (
        <SettingsColorField
          label={t`Subtitle Outline Color`}
          value={subtitleOutlineColor}
          onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleOutlineColor', value)}
        />
      )}
      {subtitleOutlineThickness !== undefined && (
        <SettingsField
          type='number'
          label={t`Subtitle Outline Thickness`}
          helperText={t`Adds an outline around subtitle text. If this causes overlapping lines, try using a different font.`}
          value={subtitleOutlineThickness}
          min={0}
          step={0.1}
          onChange={(event) => handleSubtitleTextSettingChanged('subtitleOutlineThickness', Number(event.target.value))}
        />
      )}
      {subtitleShadowColor !== undefined && (
        <SettingsColorField
          label={t`Subtitle Shadow Color`}
          value={subtitleShadowColor}
          onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleShadowColor', value)}
        />
      )}
      {subtitleShadowThickness !== undefined && (
        <SettingsField
          type='number'
          label={t`Subtitle Shadow Thickness`}
          value={subtitleShadowThickness}
          min={0}
          step={0.1}
          onChange={(event) => handleSubtitleTextSettingChanged('subtitleShadowThickness', Number(event.target.value))}
        />
      )}
      {subtitleBackgroundColor !== undefined && (
        <SettingsColorField
          label={t`Subtitle Background Color`}
          value={subtitleBackgroundColor}
          onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleBackgroundColor', value)}
        />
      )}
      {subtitleBackgroundOpacity !== undefined && (
        <SettingsField
          type='number'
          label={t`Subtitle Background Opacity`}
          min={0}
          max={1}
          step={0.1}
          value={subtitleBackgroundOpacity}
          onChange={(event) =>
            handleSubtitleTextSettingChanged('subtitleBackgroundOpacity', Number(event.target.value))
          }
        />
      )}
      {subtitleFontFamily !== undefined &&
        (localFontFamilies.length > 0 ? (
          <SettingsSelectField
            label={<Trans>Subtitle Font Family</Trans>}
            value={subtitleFontFamily}
            options={localFontFamilies.map((f) => ({ value: f }))}
            onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleFontFamily', value)}
          />
        ) : (
          <SettingsField
            type='text'
            label={<Trans>Subtitle Font Family</Trans>}
            value={subtitleFontFamily}
            onChange={(event) => handleSubtitleTextSettingChanged('subtitleFontFamily', event.target.value)}
            endAdornment={
              localFontsAvailable && localFontsPermission === 'prompt' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className={adornmentButtonClasses}
                      onClick={onUnlockLocalFonts}
                    >
                      <Lock className='size-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t`Click to unlock font menu`}</TooltipContent>
                </Tooltip>
              ) : undefined
            }
          />
        ))}

      {subtitleCustomStyles !== undefined && (
        <>
          {subtitleCustomStyles.map((customStyle, index) => {
            return (
              <CustomStyleSetting
                key={index}
                customStyle={customStyle}
                onCustomStyle={(newCustomStyle: CustomStyle) => {
                  const newValue = [...settings.subtitleCustomStyles]
                  newValue[index] = { ...newCustomStyle }
                  handleSubtitleTextSettingChanged('subtitleCustomStyles', newValue)
                }}
                onDelete={() => {
                  const newValue: CustomStyle[] = []
                  for (let j = 0; j < settings.subtitleCustomStyles.length; ++j) {
                    if (j !== index) {
                      newValue.push(settings.subtitleCustomStyles[j])
                    }
                  }
                  handleSubtitleTextSettingChanged('subtitleCustomStyles', newValue)
                }}
              />
            )
          })}
          <AddCustomStyle
            styleKey={currentStyleKey}
            onStyleKey={setCurrentStyleKey}
            onAddCustomStyle={(styleKey) =>
              handleSubtitleTextSettingChanged('subtitleCustomStyles', [
                ...settings.subtitleCustomStyles,
                { key: styleKey, value: '' },
              ])
            }
          />
        </>
      )}

      {subtitleBlur !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <SettingsSwitchRow
                label={t`Subtitle blur`}
                checked={subtitleBlur}
                onCheckedChange={(checked) => handleSubtitleTextSettingChanged('subtitleBlur', checked)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side='bottom' align='end'>
            {t`Hides selected subtitle tracks by blurring them. Can be un-blurred on mouse hover.`}
          </TooltipContent>
        </Tooltip>
      )}

      <SettingsSection>
        <Trans>Layout</Trans>
      </SettingsSection>
      {subtitleAlignment !== undefined && (
        <SettingsRadioGroupField
          row
          label={<Trans>Subtitle Alignment</Trans>}
          value={subtitleAlignment}
          options={[
            { value: 'bottom', label: t`Bottom` },
            { value: 'top', label: t`Top` },
          ]}
          onValueChange={(value) => handleSubtitleTextSettingChanged('subtitleAlignment', value)}
        />
      )}

      {selectedSubtitleAppearanceTrack === undefined && (
        <>
          <SettingsField
            type='number'
            label={t`Subtitle position offset from bottom`}
            value={subtitlePositionOffset}
            min={0}
            step={1}
            onChange={(e) => onSettingChanged('subtitlePositionOffset', Number(e.target.value))}
          />
          <SettingsField
            type='number'
            label={t`Subtitle position offset from top`}
            value={topSubtitlePositionOffset}
            min={0}
            step={1}
            onChange={(e) => onSettingChanged('topSubtitlePositionOffset', Number(e.target.value))}
          />
          {(!extensionInstalled || extensionSupportsSubtitlesWidthSetting) && (
            <SettingsField
              label={t`Subtitles Width`}
              disabled={subtitlesWidth === -1}
              value={subtitlesWidth === -1 ? 'auto' : subtitlesWidth}
              onChange={(e) => {
                const numberValue = Number(e.target.value)

                if (!Number.isNaN(numberValue) && numberValue >= 0 && numberValue <= 100) {
                  onSettingChanged('subtitlesWidth', numberValue)
                }
              }}
              suffix={subtitlesWidth === -1 ? undefined : '%'}
              endAdornment={
                subtitlesWidth === -1 ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    className={adornmentButtonClasses}
                    onClick={() => onSettingChanged('subtitlesWidth', 100)}
                  >
                    <Pencil className='size-4' />
                  </Button>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    className={adornmentButtonClasses}
                    onClick={() => onSettingChanged('subtitlesWidth', -1)}
                  >
                    <X className='size-4' />
                  </Button>
                )
              }
            />
          )}
        </>
      )}
    </div>
  )
}

export default SubtitleAppearanceSettingsTab
