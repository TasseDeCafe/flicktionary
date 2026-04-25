import { createFileRoute } from '@tanstack/react-router'
import { TabsLayout } from '@/features/navigation/components/tabs-layout'

export const Route = createFileRoute('/_authenticated/_tabs')({
  component: TabsLayout,
})
