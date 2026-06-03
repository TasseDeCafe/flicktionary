import Button from '@mui/material/Button'
import LaunchIcon from '@mui/icons-material/Launch'
import { Trans } from '@lingui/react/macro'

interface Props {
  onOpenApp: () => void
}

// Shared top affordance for both popup variants: a single full-width button that
// opens the Flicktionary web app.
export const PopupHeader = ({ onOpenApp }: Props) => {
  return (
    <Button fullWidth variant='contained' color='primary' startIcon={<LaunchIcon />} onClick={onOpenApp}>
      <Trans>Open App</Trans>
    </Button>
  )
}
