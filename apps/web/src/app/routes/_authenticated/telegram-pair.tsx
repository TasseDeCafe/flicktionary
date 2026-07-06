import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TelegramPairView } from '@/features/telegram-pair/components/telegram-pair-view'

const telegramPairSearchSchema = z.object({
  nonce: z.string().uuid(),
})

export const Route = createFileRoute('/_authenticated/telegram-pair')({
  validateSearch: telegramPairSearchSchema,
  component: TelegramPairView,
})
