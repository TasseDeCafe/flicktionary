import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { detectBrowserLanguage } from '@/utils/browser-language-utils'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrPromptDialog } from '@/features/sessions/components/cefr-prompt-dialog'
import { useAddSharedEntryToLibrary } from '../api/explore-hooks'
import type { ExploreEntry } from './explore-card'

// The one-tap add flow shared by the Explore page and the dashboard section:
// ensure a CEFR pref exists for the entry's language (dialog on first contact
// with a language — this doubles as the guest's lightweight onboarding), add,
// and land in the reader. Render `cefrDialog` next to the cards.
export const useAddSharedEntry = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: addToLibrary } = useAddSharedEntryToLibrary()
  const [cefrTarget, setCefrTarget] = useState<ExploreEntry | null>(null)
  const [addingEntryId, setAddingEntryId] = useState<string | null>(null)

  const runAdd = (entry: ExploreEntry) => {
    setAddingEntryId(entry.id)
    addToLibrary(
      { entryId: entry.id, nativeLanguage: prefs?.nativeLanguage ?? detectBrowserLanguage() },
      {
        onSuccess: (response) => {
          if (response.alreadyExisted) {
            toast.info(t`You already had a session for this — picking up where you left off.`)
          }
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.id } })
        },
        onSettled: () => setAddingEntryId(null),
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

  return { addEntry, addingEntryId, cefrDialog }
}
