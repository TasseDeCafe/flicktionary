import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NewAdhocCardWizard } from '@/features/vocabulary/components/new-adhoc-card-wizard'
import { CaptureView } from '@/features/vocab-chat/components/capture-view'
import { getIsAnonymous, useAuthStore } from '@/stores/auth-store'

// Signed-in users get "Translate & add" (input in any language, plus the
// vocabulary chat); guests keep the target-language-only form, since both
// LLM lanes require an account.
const AddWordRoute = () => {
  const isAnonymous = useAuthStore(getIsAnonymous)
  const { q, lang, ctx } = Route.useSearch()
  return isAnonymous ? <NewAdhocCardWizard /> : <CaptureView q={q} lang={lang} ctx={ctx} />
}

// "Translate & add" search state: the submitted query, the target language,
// and the optional context, so returning from an added card restores the
// results.
const addWordSearchSchema = z.object({
  q: z.string().max(500).optional().catch(undefined),
  lang: z.string().optional().catch(undefined),
  ctx: z.string().max(2000).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/vocabulary/new-word')({
  validateSearch: addWordSearchSchema,
  component: AddWordRoute,
  staticData: { hideAppChrome: true },
})
