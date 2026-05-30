import MenuItem from '@mui/material/MenuItem'
import { Trans, useLingui } from '@lingui/react/macro'
import SettingsTextField from './SettingsTextField'

const maxTracks = 3

interface Props {
  track: Track
  onTrackSelected: (track: Track) => void
}

type Track = number | 'all'

export default function SubtitleAppearanceTrackSelector({ track, onTrackSelected }: Props) {
  const { t } = useLingui()

  return (
    <>
      <SettingsTextField
        select
        fullWidth
        color='primary'
        variant='outlined'
        size='small'
        label={t`Subtitle Track`}
        helperText={
          track === 'all'
            ? t`Changes settings for ALL tracks. Settings that already have track-specific values are hidden.`
            : undefined
        }
        value={track}
        onChange={(e) =>
          e.target.value === 'all' ? onTrackSelected('all') : onTrackSelected(Number(e.target.value) as Track)
        }
      >
        <MenuItem value={'all'}>
          <Trans>All</Trans>
        </MenuItem>
        {[...Array(maxTracks).keys()].map((i) => {
          return (
            <MenuItem key={i} value={i}>
              <Trans>Track {i + 1}</Trans>
            </MenuItem>
          )
        })}
      </SettingsTextField>
    </>
  )
}
