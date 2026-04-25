import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'

interface RefreshButtonProps {
  disabled?: boolean
}

export const RefreshButton = ({ disabled }: RefreshButtonProps) => {
  const { t } = useLingui()

  const handleRefresh = () => {
    window.location.reload()
  }

  return (
    <Button variant='default' onClick={handleRefresh} disabled={disabled}>
      {t`Refresh`}
    </Button>
  )
}
