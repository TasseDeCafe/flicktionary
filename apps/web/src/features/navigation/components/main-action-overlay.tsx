import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, FileText, Sparkles, type LucideIcon } from 'lucide-react'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'

type ActionRow = {
  icon: LucideIcon
  label: string
  description?: string
  onSelect: () => void
}

const ActionRowButton = ({ row }: { row: ActionRow }) => {
  const closeOverlay = useCloseOverlay()
  const Icon = row.icon
  const handleClick = () => {
    row.onSelect()
    closeOverlay()
  }
  return (
    <button
      type='button'
      onClick={handleClick}
      className='flex w-full items-center gap-4 rounded-lg px-4 py-4 text-left hover:bg-gray-50 active:bg-gray-100'
    >
      <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-900'>
        <Icon className='h-5 w-5' />
      </span>
      <span className='flex min-w-0 flex-col'>
        <span className='text-base font-medium'>{row.label}</span>
        {row.description && <span className='text-muted-foreground text-sm'>{row.description}</span>}
      </span>
    </button>
  )
}

const ActionList = ({ rows }: { rows: ActionRow[] }) => (
  <div className='flex flex-col gap-1 px-2 pb-4'>
    {rows.map((row) => (
      <ActionRowButton key={row.label} row={row} />
    ))}
  </div>
)

interface MainActionOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const MainActionOverlay = ({ open, onOpenChange }: MainActionOverlayProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const rows: ActionRow[] = [
    {
      icon: Clapperboard,
      label: t`Start a movie session`,
      description: t`Pick a movie and load its subtitles`,
      onSelect: () => {
        void navigate({ to: '/sessions/new' })
      },
    },
    {
      icon: FileText,
      label: t`Practice with a text`,
      description: t`Paste an article, comment, or post`,
      onSelect: () => {
        void navigate({ to: '/sessions/new-text' })
      },
    },
    {
      icon: Sparkles,
      label: t`Add a word`,
      description: t`Save a chunk you heard or saw, no source needed`,
      onSelect: () => {
        void navigate({ to: '/vocabulary/new-word' })
      },
    },
  ]

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Start something new`}</OverlayTitle>
        </OverlayHeader>
        <ActionList rows={rows} />
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
