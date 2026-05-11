import { createFileRoute } from '@tanstack/react-router'
import { LanguagesPage } from '@/features/more/components/languages-page'

export const Route = createFileRoute('/_authenticated/_app/more/languages')({
  component: LanguagesPage,
  staticData: { hideAppChrome: true },
})
