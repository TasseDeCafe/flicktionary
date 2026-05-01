import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
        <Label className='text-sm font-medium'>{t`LLM-suggested chunks`}</Label>
        <p className='text-muted-foreground text-xs'>
          {t`When on, processing a session lets the LLM scan the whole track and suggest chunks at your level. When off, only your manual highlights become cards.`}
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
