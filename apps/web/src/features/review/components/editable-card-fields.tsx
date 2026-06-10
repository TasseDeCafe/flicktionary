import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Label } from '@flicktionary/ui/components/label'
import { Input } from '@flicktionary/ui/components/input'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { FieldProvenanceIndicator } from './field-provenance-indicator'
import type { FieldProvenance } from '../utils/field-provenance'

// How the translation/native-example inputs are presented:
// - 'editable': pref on — always shown, translation is the primary gloss.
// - 'on-demand': translations-off pref — not auto-generated, but the learner
//   can add one manually behind an "Add translation" disclosure.
// - 'hidden': native language == target language — translation is meaningless.
export type TranslationFieldsMode = 'editable' | 'on-demand' | 'hidden'

// The four debounced content fields. Maps 1:1 to user_lookups columns (citation
// adapter) AND to form-facet payload keys (form adapter) — the slots are the
// same, only the storage differs.
export type CardContentValues = {
  translation: string
  definition: string
  targetExample: string
  nativeExample: string
}

// Optional editable headword. Citation cards supply it (with a rename mutation
// that can 409 on a duplicate headword/sense). Form cards omit it — a form's
// `target_form` is its immutable identity, so the editor renders its display
// form as a read-only header instead (renaming = remove + re-add).
type HeadwordConfig = {
  value: string
  // mutate-shaped so the citation adapter can map status codes to messages.
  onRename: (headword: string, callbacks: { onSuccess: () => void; onError: (err: unknown) => void }) => void
}

type Props = {
  values: CardContentValues
  translationFieldsMode: TranslationFieldsMode
  // Debounced partial save of whatever content fields changed.
  onSaveContent: (patch: Partial<CardContentValues>) => void
  isPending: boolean
  headword?: HeadwordConfig
  // Per-field provenance for the indicator next to each label, computed from
  // the LIVE local value so the icon reacts as the user types (not after the
  // refetch). Only the form editor passes this — citation content is always
  // LLM-authored and stays indicator-free.
  provenanceFor?: (key: keyof CardContentValues, currentValue: string) => FieldProvenance
}

const SAVE_DEBOUNCE_MS = 600

// Source-agnostic field editor: it owns the debounce + lastSavedRef server-sync
// machinery and renders the gloss/example inputs, but delegates persistence to
// the injected `onSaveContent` / `headword.onRename` adapters. The citation
// adapter writes the canonical user_lookups columns (edits propagate to every
// card that references the chunk); the form adapter writes a single form facet's
// payload. We compare server-vs-lastSaved (not server-vs-local) so the user's
// in-flight typing isn't clobbered by a refetch that returns the value we just
// sent.
export const EditableCardFields = ({
  values,
  translationFieldsMode,
  onSaveContent,
  isPending,
  headword,
  provenanceFor,
}: Props) => {
  const { t } = useLingui()
  const [renameError, setRenameError] = useState<string | null>(null)

  // 'on-demand' disclosure: starts open when a manual translation already
  // exists (mirrors the grammar panel's startsOpen). The caller remounts this
  // component (keyed on the card's identity/version) when server-side
  // additions arrive, so the disclosure re-opens there; a long-lived mount
  // keeps the user's disclosure state instead.
  const [translationOpen, setTranslationOpen] = useState(
    !!(values.translation ?? '').trim() || !!(values.nativeExample ?? '').trim()
  )

  const [headwordValue, setHeadwordValue] = useState(headword?.value ?? '')
  const [translation, setTranslation] = useState(values.translation)
  const [definition, setDefinition] = useState(values.definition)
  const [targetExample, setTargetExample] = useState(values.targetExample)
  const [nativeExample, setNativeExample] = useState(values.nativeExample)

  // Track the last value sent to the server so we avoid no-op saves on every
  // keystroke pause and avoid clobbering server-side updates (chat tool, another
  // tab) with our local stale state.
  const lastSavedRef = useRef({
    headword: headword?.value ?? '',
    translation: values.translation,
    definition: values.definition,
    targetExample: values.targetExample,
    nativeExample: values.nativeExample,
  })

  // Sync local state when the server value diverges from what we last saved.
  useEffect(() => {
    const serverHeadword = headword?.value ?? ''
    if (serverHeadword !== lastSavedRef.current.headword) {
      setHeadwordValue(serverHeadword)
      lastSavedRef.current.headword = serverHeadword
    }
    if (values.translation !== lastSavedRef.current.translation) {
      setTranslation(values.translation)
      lastSavedRef.current.translation = values.translation
    }
    if (values.definition !== lastSavedRef.current.definition) {
      setDefinition(values.definition)
      lastSavedRef.current.definition = values.definition
    }
    if (values.targetExample !== lastSavedRef.current.targetExample) {
      setTargetExample(values.targetExample)
      lastSavedRef.current.targetExample = values.targetExample
    }
    if (values.nativeExample !== lastSavedRef.current.nativeExample) {
      setNativeExample(values.nativeExample)
      lastSavedRef.current.nativeExample = values.nativeExample
    }
  }, [headword?.value, values.translation, values.definition, values.targetExample, values.nativeExample])

  useEffect(() => {
    const id = setTimeout(() => {
      const contentPatch: Partial<CardContentValues> = {}
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
        onSaveContent(contentPatch)
        lastSavedRef.current = {
          ...lastSavedRef.current,
          translation,
          definition,
          targetExample,
          nativeExample,
        }
      }

      if (headword) {
        const trimmedHeadword = headwordValue.trim()
        if (trimmedHeadword.length > 0 && trimmedHeadword !== lastSavedRef.current.headword) {
          headword.onRename(trimmedHeadword, {
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
          })
        }
      }
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [headwordValue, translation, definition, targetExample, nativeExample, onSaveContent, headword, t])

  const revertSetters: Record<keyof CardContentValues, (v: string) => void> = {
    translation: setTranslation,
    definition: setDefinition,
    targetExample: setTargetExample,
    nativeExample: setNativeExample,
  }
  const currentValues: Record<keyof CardContentValues, string> = {
    translation,
    definition,
    targetExample,
    nativeExample,
  }

  const labelWithProvenance = (key: keyof CardContentValues, label: string) => (
    <div className='flex items-center gap-1'>
      <Label className='text-xs'>{label}</Label>
      {provenanceFor && (
        <FieldProvenanceIndicator
          provenance={provenanceFor(key, currentValues[key])}
          fieldLabel={label}
          // Revert is "programmatic typing": set local state and let the
          // debounced save persist it. A direct mutation here would race the
          // debounce timer, which could re-save the pre-revert value.
          onRevert={(sourceValue) => revertSetters[key](typeof sourceValue === 'string' ? sourceValue : '')}
        />
      )}
    </div>
  )

  return (
    <div className='flex flex-col gap-3'>
      {headword && (
        <div>
          <Label className='text-xs'>{t`Headword`}</Label>
          <Input value={headwordValue} onChange={(e) => setHeadwordValue(e.target.value)} />
          {renameError && <p className='text-destructive mt-1 text-xs'>{renameError}</p>}
        </div>
      )}

      <div>
        {labelWithProvenance('targetExample', t`Target example`)}
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
            {labelWithProvenance('translation', t`Translation`)}
            <Input
              value={translation}
              onChange={(e) => setTranslation(e.target.value)}
              placeholder={t`Translation in your native language.`}
            />
          </div>
          <div>
            {labelWithProvenance('nativeExample', t`Native example`)}
            <Textarea
              value={nativeExample}
              onChange={(e) => setNativeExample(e.target.value)}
              rows={2}
              placeholder={t`A natural translation of the target example.`}
            />
          </div>
          <div>
            {labelWithProvenance('definition', t`Definition (optional)`)}
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
            {labelWithProvenance('definition', t`Definition`)}
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
                  {labelWithProvenance('translation', t`Translation`)}
                  <Input
                    value={translation}
                    onChange={(e) => setTranslation(e.target.value)}
                    placeholder={t`Translation in your native language.`}
                  />
                </div>
                <div>
                  {labelWithProvenance('nativeExample', t`Native example`)}
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

      {/* Fixed-height status slot: the saving feedback fades in instead of
          inserting a row, so the content never shifts while a save is in
          flight. */}
      <div aria-live='polite' className='text-muted-foreground flex h-4 items-center gap-1 text-xs'>
        {isPending && (
          <>
            <Loader2 className='h-3 w-3 animate-spin' />
            {t`Saving…`}
          </>
        )}
      </div>
    </div>
  )
}
