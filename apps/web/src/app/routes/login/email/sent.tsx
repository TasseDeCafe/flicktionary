import { createFileRoute } from '@tanstack/react-router'
import { LoginEmailSentView } from '@/features/auth/components/login-email-sent-view.tsx'
import { z } from 'zod'

const emailSentSearchSchema = z.object({
  email: z.email().optional(),
})

export const Route = createFileRoute('/login/email/sent')({
  validateSearch: emailSentSearchSchema,
  component: LoginEmailSentView,
})
