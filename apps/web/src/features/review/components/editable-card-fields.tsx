import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Plus } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Input } from '@flicktionary/ui/components/input'
import { Textarea } from '@flicktionary/ui/components/textarea'
import type { Chunk } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useRenameChunk, useUpdateChunkContent } from '../api/review-hooks'

// How the translation/native-example inputs are presented:
// - 'editable': pref on — always shown, translation is the primary gloss.
// - 'on-demand': translations-off pref — not auto-generated, but the learner
//   can add one manually behind an "Add translation" disclosure.
// - 'hidden': native language == target language — translation is meaningless.
export type TranslationFieldsMode = 'editable' | 'on-demand' | 'hidden'

type Props = {
  chunk: Chunk
  translationFieldsMode: TranslationFieldsMode
  sourceSessionId?: string
}

const SAVE_DEBOUNCE_MS = 600

// Each field gets a small controlled input that debounces a partial PATCH to
// the canonical chunk (user_lookups). Editing here mutates ONE row that may be
// referenced by many cards across sessions — sibling cards re-fetch and pick
// up the change via cache invalidation.
export const EditableCardFields = ({ chunk, translationFieldsMode, sourceSessionId }: Props) => {
  const { t } = useLingui()
  const updateChunkContent = useUpdateChunkContent(sourceSessionId)
  const renameChunk = useRenameChunk(sourceSessionId)
  const isPending = updateChunkContent.isPending || renameChunk.isPending
  const [renameError, setRenameError] = useState<string | null>(null)

  // 'on-demand' disclosure: starts open when a manual translation already
  // exists (mirrors the grammar panel's startsOpen). The focus view remounts
  // the component per save (keyed on card.updatedAt), so server-side
  // additions re-open it there; the practice edit sheet stays mounted and
  // keeps the user's disclosure state instead.
  const [translationOpen, setTranslationOpen] = useState(
    !!(chunk.translation ?? '').trim() || !!(chunk.nativeExample ?? '').trim()
  )

  const [headword, setHeadword] = useState(chunk.headword)
  const [translation, setTranslation] = useState(chunk.translation ?? '')
  const [definition, setDefinition] = useState(chunk.definition ?? '')
  const [targetExample, setTargetExample] = useState(chunk.targetExample ?? '')
  const [nativeExample, setNativeExample] = useState(chunk.nativeExample ?? '')

  // Per-form study ("study посмотрим, not посмотреть") moved out of this sheet
  // in Phase 4b: it's now a first-class study facet edited from the
  // Study-targets control (StudyTargetsSection), not a grammar-bag toggle here.

  // Track the last value sent to the server so we avoid sending no-ops on
  // every keystroke pause and avoid clobbering server-side updates (e.g. from
  // the chat tool) with our local stale state.
  const lastSavedRef = useRef({
    headword: chunk.headword,
    translation: chunk.translation ?? '',
    definition: chunk.definition ?? '',
    targetExample: chunk.targetExample ?? '',
    nativeExample: chunk.nativeExample ?? '',
  })

  // Sync local state when the server value diverges from what we last saved
  // — happens when something else mutates the chunk (chat tool, another tab,
  // a sibling card's focus view). We compare server-vs-lastSaved (not
  // server-vs-local-state) so the user's in-flight typing isn't clobbered by
  // routine refetches that return the value we just sent.
  useEffect(() => {
    const serverHeadword = chunk.headword
    const serverTranslation = chunk.translation ?? ''
    const serverDefinition = chunk.definition ?? ''
    const serverTargetExample = chunk.targetExample ?? ''
    const serverNativeExample = chunk.nativeExample ?? ''
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
  }, [chunk.headword, chunk.translation, chunk.definition, chunk.targetExample, chunk.nativeExample])

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
        updateChunkContent.mutate({ chunkId: chunk.id, patch: contentPatch })
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
          { chunkId: chunk.id, headword: trimmedHeadword, sense: chunk.sense ?? '' },
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
    chunk.id,
    chunk.sense,
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
