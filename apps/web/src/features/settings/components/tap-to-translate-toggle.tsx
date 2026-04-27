import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useSetTapToTranslateEnabled } from '@/features/sessions/api/sessions-hooks'

type Props = {
  enabled: boolean
}

export const TapToTranslateToggle = ({ enabled }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useSetTapToTranslateEnabled()

  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <Label className='text-sm font-medium'>{t`Tap-to-translate`}</Label>
        <p className='text-muted-foreground text-xs'>
          {t`When on, selecting text mid-watch fires a fast Haiku gloss in addition to creating the highlight.`}
        </p>
      </div>
      <Button
        variant={enabled ? 'default' : 'outline'}
        disabled={isPending}
        onClick={() => mutate({ enabled: !enabled })}
      >
        {enabled ? t`On` : t`Off`}
      </Button>
    </div>
  )
}
