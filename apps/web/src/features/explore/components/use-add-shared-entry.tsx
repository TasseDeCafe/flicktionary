import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ORPCError } from '@orpc/contract'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { detectBrowserLanguage } from '@/utils/browser-language-utils'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { useAddSharedEntryToLibrary } from '../api/explore-hooks'
import type { ExploreEntry } from './explore-card'

// The detail screen's add flow: ensure a CEFR pref exists for the entry's
// language (dialog on first contact with a language — this doubles as the
// guest's lightweight onboarding), add, and land in the reader. Render
// `cefrDialog` next to the CTA.
export const useAddSharedEntry = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: addToLibrary } = useAddSharedEntryToLibrary()
  const [cefrTarget, setCefrTarget] = useState<ExploreEntry | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const runAdd = (entry: ExploreEntry) => {
    setIsAdding(true)
    addToLibrary(
      { entryId: entry.id, nativeLanguage: prefs?.nativeLanguage ?? detectBrowserLanguage() },
      {
        onSuccess: (response) => {
          if (response.alreadyExisted) {
            toast.info(t`You already had a session for this — picking up where you left off.`)
          }
          // Flow completion: replacing the detail screen's history entry means
          // back from the reader returns to the catalog, not to a screen whose
          // CTA was just consumed.
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id }, replace: true })
        },
        onError: (error) => {
          // The entry can die between the detail fetch and the tap (owner
          // unshared, admin removed). The global handler swallows NOT_FOUND
          // silently, so refetch the detail — its 404 flips the view to the
          // "no longer shared" state instead of a CTA that does nothing.
          if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
            void queryClient.invalidateQueries({
              queryKey: orpcQuery.sharedContent.get.key({ input: { entryId: entry.id } }),
            })
          }
        },
        onSettled: () => setIsAdding(false),
      }
    )
  }

  const addEntry = (entry: ExploreEntry) => {
    const hasCefr = prefs?.targetLanguagePrefs.some((pref) => pref.targetLanguage === entry.language && pref.cefrLevel)
    if (!hasCefr) {
      setCefrTarget(entry)
      return
    }
    runAdd(entry)
  }

  const cefrDialog = (
    <CefrPromptDialog
      open={cefrTarget !== null}
      targetLanguage={cefrTarget?.language ?? ''}
      isSubmitting={isSettingCefr}
      onCancel={() => setCefrTarget(null)}
      onSubmit={(level) => {
        const entry = cefrTarget
        if (!entry) return
        setCefr(
          { targetLanguage: entry.language, cefrLevel: level },
          {
            onSuccess: () => {
              setCefrTarget(null)
              runAdd(entry)
            },
          }
        )
      }}
    />
  )

  return { addEntry, isAdding, cefrDialog }
}
