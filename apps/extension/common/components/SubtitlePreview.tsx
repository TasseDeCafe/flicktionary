import { useMemo } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { SubtitleSettings, TextSubtitleSettings, textSubtitleSettingsForTrack } from '../settings'
import { computeStyles } from '../util'

interface Props {
  subtitleSettings: SubtitleSettings
  text: string
  track?: number
  onTextChanged: (text: string) => void
}

// Checkerboard backdrop so subtitle colors read against both light and dark
// content. The old MUI version used palette.action.disabledBackground; the
// foreground token at 12% matches it in both themes.
const checker = 'hsl(var(--foreground) / 0.12)'
const checkerStyle: React.CSSProperties = {
  backgroundImage: `linear-gradient(45deg, ${checker} 25%, transparent 25%), linear-gradient(-45deg, ${checker} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${checker} 75%), linear-gradient(-45deg, transparent 75%, ${checker} 75%)`,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
}

// Subtitle glyph styling comes from computeStyles() inline (exactly like the
// real overlay); blur stays a class so hover can momentarily lift it.
const inputClassName = (s: TextSubtitleSettings) =>
  cn('w-full border-none bg-transparent text-center outline-none', s.subtitleBlur && 'blur-[10px] hover:blur-none')

interface InputProps {
  text: string
  className: string
  onTextChanged: (text: string) => void
  textSubtitleSettings: TextSubtitleSettings
}

const SubtitlePreviewInput = ({ text, className, textSubtitleSettings, onTextChanged }: InputProps) => {
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
  } = textSubtitleSettings

  const subtitlePreviewStyles = useMemo(
    () =>
      computeStyles({
        subtitleColor,
        subtitleSize,
        subtitleThickness,
        subtitleOutlineThickness,
        subtitleOutlineColor,
        subtitleShadowThickness,
        subtitleShadowColor,
        subtitleBackgroundOpacity,
        subtitleBackgroundColor,
        subtitleFontFamily,
        subtitleCustomStyles,
        subtitleBlur,
        subtitleAlignment,
      }),
    [
      subtitleColor,
      subtitleSize,
      subtitleThickness,
      subtitleOutlineThickness,
      subtitleOutlineColor,
      subtitleShadowThickness,
      subtitleShadowColor,
      subtitleBackgroundOpacity,
      subtitleBackgroundColor,
      subtitleFontFamily,
      subtitleCustomStyles,
      subtitleBlur,
      subtitleAlignment,
    ]
  )

  return (
    <input
      value={text}
      className={className}
      onChange={(event) => onTextChanged(event.target.value)}
      style={subtitlePreviewStyles}
    />
  )
}

export default function SubtitlePreview({ subtitleSettings, text, track, onTextChanged }: Props) {
  const textSubtitleSettings = textSubtitleSettingsForTrack(subtitleSettings, track)
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
  } = textSubtitleSettings

  if (
    subtitleSize === undefined ||
    subtitleColor === undefined ||
    subtitleThickness === undefined ||
    subtitleOutlineThickness === undefined ||
    subtitleOutlineColor === undefined ||
    subtitleShadowThickness === undefined ||
    subtitleShadowColor === undefined ||
    subtitleBackgroundColor === undefined ||
    subtitleBackgroundOpacity === undefined ||
    subtitleFontFamily === undefined ||
    subtitleCustomStyles === undefined ||
    subtitleBlur === undefined
  ) {
    return (
      <div className='my-2 max-w-full p-[10px]' style={checkerStyle}>
        {[...Array(subtitleSettings.subtitleTracksV2.length + 1).keys()].map((track) => {
          const textSubtitleSettings = textSubtitleSettingsForTrack(subtitleSettings, track) as TextSubtitleSettings

          return (
            <SubtitlePreviewInput
              key={track}
              text={text}
              className={inputClassName(textSubtitleSettings)}
              textSubtitleSettings={textSubtitleSettings}
              onTextChanged={onTextChanged}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className='my-2 max-w-full p-[10px]' style={checkerStyle}>
      <SubtitlePreviewInput
        text={text}
        className={inputClassName(textSubtitleSettings as TextSubtitleSettings)}
        textSubtitleSettings={textSubtitleSettings as TextSubtitleSettings}
        onTextChanged={onTextChanged}
      />
    </div>
  )
}
