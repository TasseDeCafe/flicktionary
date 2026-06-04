import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'

interface RefreshButtonProps {
  disabled?: boolean
}

export const RefreshButton = ({ disabled }: RefreshButtonProps) => {
  const { t } = useLingui()

  const handleRefresh = () => {
    window.location.reload()
  }

  return (
    <Button size='xl' variant='default' onClick={handleRefresh} disabled={disabled}>
      {t`Refresh`}
    </Button>
  )
}
