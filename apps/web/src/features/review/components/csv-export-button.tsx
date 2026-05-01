import { useLingui } from '@lingui/react/macro'
import { useIsMutating } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useExportSessionCsv } from '../api/review-hooks'

type Props = {
  sessionId: string
  keptCount: number
}

export const CsvExportButton = ({ sessionId, keptCount }: Props) => {
  const { t } = useLingui()
  const { mutate: exportCsv, isPending } = useExportSessionCsv()

  // Block export while any explore or chat mutation is in flight — those can
  // change card field state on the server, so we want them flushed first.
  const exploreMutations = useIsMutating({ mutationKey: orpcQuery.cards.explore.key() })
  const chatMutations = useIsMutating({ mutationKey: orpcQuery.cardChat.sendMessage.key() })
  const blocked = exploreMutations + chatMutations > 0

  const disabled = keptCount === 0 || isPending || blocked

  const handleClick = () => {
    if (disabled) return
    exportCsv(
      { sessionId },
      {
        onSuccess: (response) => {
          const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `${sessionId}.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
        },
      }
    )
  }

  return (
    <Button onClick={handleClick} disabled={disabled}>
      <Download className='mr-2 h-4 w-4' />
      {isPending ? t`Exporting…` : blocked ? t`Waiting…` : t`Export ${keptCount} kept cards`}
    </Button>
  )
}
