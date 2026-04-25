import { createFileRoute } from '@tanstack/react-router'
import { LoginEmailView } from '@/features/auth/components/login-email-view.tsx'

export const Route = createFileRoute('/login/email/')({
  component: LoginEmailView,
})
