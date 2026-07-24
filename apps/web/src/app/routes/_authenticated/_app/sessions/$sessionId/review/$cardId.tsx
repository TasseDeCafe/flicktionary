import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FocusView } from '@/features/review/components/focus-view'

// `scope` is the card's editing scope, not a navigation origin (close returns
// to the actual opener via history; the fixed fallback only fires on deep
// links). Absent = 'session': the card renders as part of its session's
// vocabulary list (keep/reject toggles, position counter, prev/next paging).
// 'language' (set by the Vocabulary tab and practice surfaces) renders it as a
// language-wide entry: kept by definition, no session counter or paging.
// `source: 'available'` marks a language-wide entry whose source session still
// exists, so the session card list and context stay loadable.
const focusViewSearchSchema = z.object({
  scope: z.enum(['session', 'language']).optional(),
  source: z.enum(['available']).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  validateSearch: focusViewSearchSchema,
  component: FocusView,
  staticData: { hideAppChrome: true },
})
