import { createFileRoute } from '@tanstack/react-router'
import { MoreTabView } from '@/features/more/components/more-tab-view'

export const Route = createFileRoute('/_authenticated/_app/more/')({
  component: MoreTabView,
})
