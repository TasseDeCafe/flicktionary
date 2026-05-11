import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
        <Label htmlFor='tap-to-translate-switch' className='text-sm font-medium'>
          {t`Tap-to-translate`}
        </Label>
        <p className='text-muted-foreground text-xs'>
          {t`When on, selecting text mid-watch fires a fast Haiku gloss in addition to creating the highlight.`}
        </p>
      </div>
      <Switch
        id='tap-to-translate-switch'
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => mutate({ enabled: checked })}
      />
    </div>
  )
}
