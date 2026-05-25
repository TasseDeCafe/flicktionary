import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSetLlmHighlightsEnabled } from '@/features/sessions/api/sessions-hooks'

type Props = {
  enabled: boolean
}

export const LlmHighlightsToggle = ({ enabled }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useSetLlmHighlightsEnabled()

  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <Label htmlFor='llm-highlights-switch' className='text-sm font-medium'>
          {t`LLM-suggested terms`}
        </Label>
        <p className='text-muted-foreground text-xs'>
          {t`When on, the reader can underline suggested terms as you scroll. When off, only your own highlights become cards.`}
        </p>
      </div>
      <Switch
        id='llm-highlights-switch'
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => mutate({ enabled: checked })}
      />
    </div>
  )
}
