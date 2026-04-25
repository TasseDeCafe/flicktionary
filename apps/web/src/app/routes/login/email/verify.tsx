import { createFileRoute } from '@tanstack/react-router'
import { LoginEmailVerifyView } from '@/features/auth/components/login-email-verify-view.tsx'

export const Route = createFileRoute('/login/email/verify')({
  component: LoginEmailVerifyView,
})
