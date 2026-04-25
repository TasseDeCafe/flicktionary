import { createFileRoute } from '@tanstack/react-router'
import { AdminSettingsView } from '@/features/admin/components/admin-settings-view.tsx'

export const Route = createFileRoute('/_authenticated/admin-settings')({
  component: AdminSettingsView,
})
