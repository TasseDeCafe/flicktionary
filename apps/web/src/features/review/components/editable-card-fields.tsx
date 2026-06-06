import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Plus } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Input } from '@flicktionary/ui/components/input'
import { Switch } from '@flicktionary/ui/components/switch'
import { Textarea } from '@flicktionary/ui/components/textarea'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useRenameChunk, useUpdateChunkContent } from '../api/review-hooks'

// How the translation/native-example inputs are presented:
// - 'editable': pref on — always shown, translation is the primary gloss.
// - 'on-demand': translations-off pref — not auto-generated, but the learner
//   can add one manually behind an "Add translation" disclosure.
// - 'hidden': native language == target language — translation is meaningless.
export type TranslationFieldsMode = 'editable' | 'on-demand' | 'hidden'

type Props = {
  card: Card
  translationFieldsMode: TranslationFieldsMode
  sourceSessionId?: string
}

const SAVE_DEBOUNCE_MS = 600

// Each field gets a small controlled input that debounces a partial PATCH to
// the canonical chunk (user_lookups). Editing here mutates ONE row that may be
// referenced by many cards across sessions — sibling cards re-fetch and pick
// up the change via cache invalidation.
export const EditableCardFields = ({ card, translationFieldsMode, sourceSessionId }: Props) => {
  const { t } = useLingui()
  const updateChunkContent = useUpdateChunkContent(sourceSessionId)
  const renameChunk = useRenameChunk(sourceSessionId)
  const isPending = updateChunkContent.isPending || renameChunk.isPending
  const [renameError, setRenameError] = useState<string | null>(null)

  // 'on-demand' disclosure: starts open when a manual translation already
  // exists (mirrors the grammar panel's startsOpen). The component remounts on
  // card.updatedAt (keyed in focus-view), so server-side additions re-open it.
  const [translationOpen, setTranslationOpen] = useState(
    !!(card.chunk.translation ?? '').trim() || !!(card.chunk.nativeExample ?? '').trim()
  )

  const [headword, setHeadword] = useState(card.chunk.headword)
  const [translation, setTranslation] = useState(card.chunk.translation ?? '')
  const [definition, setDefinition] = useState(card.chunk.definition ?? '')
  const [targetExample, setTargetExample] = useState(card.chunk.targetExample ?? '')
  const [nativeExample, setNativeExample] = useState(card.chunk.nativeExample ?? '')

  // "Study this exact form": when the card's surface form is an inflection of
  // the headword, the learner can flip the review front to drill the form
  // itself (e.g. посмотрим instead of посмотреть). Both the form+translation
  // pair and the toggle live in the chunk's grammar bag (studied_form /
  // study_form_enabled) so they follow the canonical row into the review
  // queue. Old chunks may predate the LLM-generated studied_form — toggling
  // on then seeds it from the card's surface form with an empty translation.
  const storedStudiedForm = card.chunk.grammar?.studied_form ?? null
  const studyFormValue = (storedStudiedForm?.form ?? card.surfaceForm ?? '').trim()
  const studyFormAvailable = !!studyFormValue && studyFormValue !== card.chunk.headword.trim()
  const [studyFormEnabled, setStudyFormEnabled] = useState(!!card.chunk.grammar?.study_form_enabled)
  const [formTranslation, setFormTranslation] = useState(storedStudiedForm?.translation ?? '')
  const lastSavedStudyFormRef = useRef({
    enabled: !!card.chunk.grammar?.study_form_enabled,
    translation: storedStudiedForm?.translation ?? '',
  })

  // Track the last value sent to the server so we avoid sending no-ops on
  // every keystroke pause and avoid clobbering server-side updates (e.g. from
  // the chat tool) with our local stale state.
  const lastSavedRef = useRef({
    headword: card.chunk.headword,
    translation: card.chunk.translation ?? '',
    definition: card.chunk.definition ?? '',
    targetExample: card.chunk.targetExample ?? '',
    nativeExample: card.chunk.nativeExample ?? '',
  })

  // Sync local state when the server value diverges from what we last saved
  // — happens when something else mutates the chunk (chat tool, another tab,
  // a sibling card's focus view). We compare server-vs-lastSaved (not
  // server-vs-local-state) so the user's in-flight typing isn't clobbered by
  // routine refetches that return the value we just sent.
  useEffect(() => {
    const serverHeadword = card.chunk.headword
    const serverTranslation = card.chunk.translation ?? ''
    const serverDefinition = card.chunk.definition ?? ''
    const serverTargetExample = card.chunk.targetExample ?? ''
    const serverNativeExample = card.chunk.nativeExample ?? ''
    if (serverHeadword !== lastSavedRef.current.headword) {
      setHeadword(serverHeadword)
      lastSavedRef.current.headword = serverHeadword
    }
    if (serverTranslation !== lastSavedRef.current.translation) {
      setTranslation(serverTranslation)
      lastSavedRef.current.translation = serverTranslation
    }
    if (serverDefinition !== lastSavedRef.current.definition) {
      setDefinition(serverDefinition)
      lastSavedRef.current.definition = serverDefinition
    }
    if (serverTargetExample !== lastSavedRef.current.targetExample) {
      setTargetExample(serverTargetExample)
      lastSavedRef.current.targetExample = serverTargetExample
    }
    if (serverNativeExample !== lastSavedRef.current.nativeExample) {
      setNativeExample(serverNativeExample)
      lastSavedRef.current.nativeExample = serverNativeExample
    }
  }, [
    card.chunk.headword,
    card.chunk.translation,
    card.chunk.definition,
    card.chunk.targetExample,
    card.chunk.nativeExample,
  ])

  // Same server-sync rule for the study-form fields.
  useEffect(() => {
    const serverEnabled = !!card.chunk.grammar?.study_form_enabled
    const serverFormTranslation = card.chunk.grammar?.studied_form?.translation ?? ''
    if (serverEnabled !== lastSavedStudyFormRef.current.enabled) {
      setStudyFormEnabled(serverEnabled)
      lastSavedStudyFormRef.current.enabled = serverEnabled
    }
    if (serverFormTranslation !== lastSavedStudyFormRef.current.translation) {
      setFormTranslation(serverFormTranslation)
      lastSavedStudyFormRef.current.translation = serverFormTranslation
    }
  }, [card.chunk.grammar])

  const handleStudyFormToggle = (next: boolean) => {
    setStudyFormEnabled(next)
    lastSavedStudyFormRef.current.enabled = next
    // Write the full {form, translation} pair so a toggle on an old chunk
    // (no LLM-generated studied_form) seeds it from the card's surface form.
    updateChunkContent.mutate({
      chunkId: card.chunk.id,
      patch: {
        grammarPatch: {
          study_form_enabled: next,
          studied_form: { form: studyFormValue, translation: formTranslation.trim() || null },
        },
      },
    })
  }

  // Debounced save for the form translation, mirroring the content fields.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!studyFormEnabled) return
      if (formTranslation === lastSavedStudyFormRef.current.translation) return
      updateChunkContent.mutate({
        chunkId: card.chunk.id,
        patch: {
          grammarPatch: {
            studied_form: { form: studyFormValue, translation: formTranslation.trim() || null },
          },
        },
      })
      lastSavedStudyFormRef.current.translation = formTranslation
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [formTranslation, studyFormEnabled, studyFormValue, card.chunk.id, updateChunkContent])

  useEffect(() => {
    const id = setTimeout(() => {
      const contentPatch: {
        translation?: string
        definition?: string
        targetExample?: string
        nativeExample?: string
      } = {}
      let contentDirty = false
      if (translation !== lastSavedRef.current.translation) {
        contentPatch.translation = translation
        contentDirty = true
      }
      if (definition !== lastSavedRef.current.definition) {
        contentPatch.definition = definition
        contentDirty = true
      }
      if (targetExample !== lastSavedRef.current.targetExample) {
        contentPatch.targetExample = targetExample
        contentDirty = true
      }
      if (nativeExample !== lastSavedRef.current.nativeExample) {
        contentPatch.nativeExample = nativeExample
        contentDirty = true
      }
      if (contentDirty) {
        updateChunkContent.mutate({ chunkId: card.chunk.id, patch: contentPatch })
        lastSavedRef.current = {
          ...lastSavedRef.current,
          translation,
          definition,
          targetExample,
          nativeExample,
        }
      }

      const trimmedHeadword = headword.trim()
      if (trimmedHeadword.length > 0 && trimmedHeadword !== lastSavedRef.current.headword) {
        renameChunk.mutate(
          { chunkId: card.chunk.id, headword: trimmedHeadword, sense: card.chunk.sense ?? '' },
          {
            onSuccess: () => {
              lastSavedRef.current = { ...lastSavedRef.current, headword: trimmedHeadword }
              setRenameError(null)
            },
            onError: (err) => {
              const status = (err as { status?: number; data?: { code?: string } }).status
              if (status === 409) {
                setRenameError(t`Another term already exists with that headword and sense.`)
              } else {
                setRenameError(t`Could not rename — please try again.`)
              }
            },
          }
        )
      }
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [
    headword,
    translation,
    definition,
    targetExample,
    nativeExample,
    card.chunk.id,
    card.chunk.sense,
    updateChunkContent,
    renameChunk,
    t,
  ])

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-xs'>{t`Headword`}</Label>
        <Input value={headword} onChange={(e) => setHeadword(e.target.value)} />
        {renameError && <p className='text-destructive mt-1 text-xs'>{renameError}</p>}
      </div>

      {studyFormAvailable && (
        <div className='flex flex-col gap-2 rounded-md border px-3 py-2'>
          <div className='flex items-center justify-between gap-2'>
            <div>
              <Label className='text-xs'>{t`Study this exact form`}</Label>
              <p className='text-sm font-medium'>{studyFormValue}</p>
            </div>
            <Switch checked={studyFormEnabled} onCheckedChange={handleStudyFormToggle} />
          </div>
          {studyFormEnabled && translationFieldsMode !== 'hidden' && (
            <div>
              <Label className='text-xs'>{t`Form translation`}</Label>
              <Input
                value={formTranslation}
                onChange={(e) => setFormTranslation(e.target.value)}
                placeholder={t`Translation of this exact form in context.`}
              />
            </div>
          )}
        </div>
      )}

      <div>
        <Label className='text-xs'>{t`Target example`}</Label>
        <Textarea
          value={targetExample}
          onChange={(e) => setTargetExample(e.target.value)}
          rows={2}
          placeholder={t`A sentence using this term in its natural setting.`}
        />
      </div>

      {translationFieldsMode === 'editable' ? (
        <>
          <div>
            <Label className='text-xs'>{t`Translation`}</Label>
            <Input
              value={translation}
              onChange={(e) => setTranslation(e.target.value)}
              placeholder={t`Translation in your native language.`}
            />
          </div>
          <div>
            <Label className='text-xs'>{t`Native example`}</Label>
            <Textarea
              value={nativeExample}
              onChange={(e) => setNativeExample(e.target.value)}
              rows={2}
              placeholder={t`A natural translation of the target example.`}
            />
          </div>
          <div>
            <Label className='text-xs'>{t`Definition (optional)`}</Label>
            <Textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={2}
              placeholder={t`Optional contextual paraphrase in the target language.`}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label className='text-xs'>{t`Definition`}</Label>
            <Textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={2}
              placeholder={t`Short paraphrase in the target language.`}
            />
          </div>
          {translationFieldsMode === 'on-demand' &&
            (translationOpen ? (
              <>
                <div>
                  <Label className='text-xs'>{t`Translation`}</Label>
                  <Input
                    value={translation}
                    onChange={(e) => setTranslation(e.target.value)}
                    placeholder={t`Translation in your native language.`}
                  />
                </div>
                <div>
                  <Label className='text-xs'>{t`Native example`}</Label>
                  <Textarea
                    value={nativeExample}
                    onChange={(e) => setNativeExample(e.target.value)}
                    rows={2}
                    placeholder={t`A natural translation of the target example.`}
                  />
                </div>
              </>
            ) : (
              <div>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='text-muted-foreground -ml-2'
                  onClick={() => setTranslationOpen(true)}
                >
                  <Plus className='mr-1 h-4 w-4' />
                  {t`Add translation`}
                </Button>
              </div>
            ))}
        </>
      )}

      {isPending && <p className='text-muted-foreground text-xs'>{t`Saving…`}</p>}
    </div>
  )
}
