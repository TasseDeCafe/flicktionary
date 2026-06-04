import { Trans, useLingui } from '@lingui/react/macro'
import SettingsSelectField from './SettingsSelectField'

const maxTracks = 3

interface Props {
  track: Track
  onTrackSelected: (track: Track) => void
}

type Track = number | 'all'

export default function SubtitleAppearanceTrackSelector({ track, onTrackSelected }: Props) {
  const { t } = useLingui()

  return (
    <SettingsSelectField
      label={t`Subtitle Track`}
      value={String(track)}
      helperText={
        track === 'all'
          ? t`Changes settings for ALL tracks. Settings that already have track-specific values are hidden.`
          : undefined
      }
      options={[
        { value: 'all', label: <Trans>All</Trans> },
        ...[...Array(maxTracks).keys()].map((i) => ({
          value: String(i),
          label: <Trans>Track {i + 1}</Trans>,
        })),
      ]}
      onValueChange={(value) => (value === 'all' ? onTrackSelected('all') : onTrackSelected(Number(value) as Track))}
    />
  )
}
