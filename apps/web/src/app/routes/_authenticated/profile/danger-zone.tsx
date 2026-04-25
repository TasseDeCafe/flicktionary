import { createFileRoute } from '@tanstack/react-router'
import { DangerZoneView } from '@/features/profile/components/danger-zone-view'

export const Route = createFileRoute('/_authenticated/profile/danger-zone')({
  component: DangerZoneView,
})
