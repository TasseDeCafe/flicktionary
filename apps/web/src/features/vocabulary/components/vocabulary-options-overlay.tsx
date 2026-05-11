import { useLingui } from '@lingui/react/macro'
import { Download, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ResponsiveOverlay, OverlayContent, OverlayHeader, OverlayTitle } from '@/components/ui/responsive-overlay'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useExportVocabularyCsv } from '../api/vocabulary-hooks'

interface VocabularyOptionsOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetLanguage: string | null
}

const ActionRow = ({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  description?: string
  onClick: () => void
  disabled?: boolean
}) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-4 rounded-lg px-4 py-4 text-left transition-colors',
      'hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
    )}
  >
    <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-900'>
      <Icon className='h-5 w-5' />
    </span>
    <span className='flex min-w-0 flex-col'>
      <span className='text-base font-medium'>{label}</span>
      {description && <span className='text-muted-foreground text-sm'>{description}</span>}
    </span>
  </button>
)

export const VocabularyOptionsOverlay = ({ open, onOpenChange, targetLanguage }: VocabularyOptionsOverlayProps) => {
  const { t } = useLingui()
  const { mutate: exportCsv, isPending } = useExportVocabularyCsv()

  const handleExport = () => {
    if (!targetLanguage) return
    exportCsv(
      { targetLanguage },
      {
        onSuccess: (response) => {
          const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `flicktionary-vocabulary-${targetLanguage}.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
          const chunkCount = response.data.chunkCount
          toast.success(t`Exported ${chunkCount} term(s)`)
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Vocabulary options`}</OverlayTitle>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <ActionRow
            icon={Download}
            label={isPending ? t`Exporting…` : t`Export vocabulary`}
            description={(() => {
              if (!targetLanguage) return t`Pick a language first`
              const languageName = getLanguageName(targetLanguage)
              return t`Download all kept terms for ${languageName} as CSV (Anki-compatible)`
            })()}
            disabled={isPending || !targetLanguage}
            onClick={handleExport}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
