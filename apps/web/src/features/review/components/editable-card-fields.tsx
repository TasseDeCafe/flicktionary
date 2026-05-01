import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useUpdateCardFields } from '../api/review-hooks'

type Props = {
  card: Card
  sameLanguage: boolean
}

const SAVE_DEBOUNCE_MS = 600

// Each field gets a small controlled input that debounces a partial PATCH
// to cards.updateFields. The card data on disk is the only source of truth;
// editing here mutates the basic columns directly.
export const EditableCardFields = ({ card, sameLanguage }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useUpdateCardFields()

  const [headword, setHeadword] = useState(card.headword)
  const [translation, setTranslation] = useState(card.translation ?? '')
  const [definition, setDefinition] = useState(card.definition ?? '')
  const [targetExample, setTargetExample] = useState(card.targetExample ?? '')
  const [nativeExample, setNativeExample] = useState(card.nativeExample ?? '')

  // Track the last value sent to the server so we can avoid sending no-ops on
  // every keystroke pause and avoid clobbering server-side updates (e.g. from
  // the chat tool) with our local stale state.
  const lastSavedRef = useRef({
    headword: card.headword,
    translation: card.translation ?? '',
    definition: card.definition ?? '',
    targetExample: card.targetExample ?? '',
    nativeExample: card.nativeExample ?? '',
  })

  useEffect(() => {
    const id = setTimeout(() => {
      const patch: {
        headword?: string
        translation?: string
        definition?: string
        targetExample?: string
        nativeExample?: string
      } = {}
      let dirty = false
      if (headword !== lastSavedRef.current.headword) {
        patch.headword = headword
        dirty = true
      }
      if (translation !== lastSavedRef.current.translation) {
        patch.translation = translation
        dirty = true
      }
      if (definition !== lastSavedRef.current.definition) {
        patch.definition = definition
        dirty = true
      }
      if (targetExample !== lastSavedRef.current.targetExample) {
        patch.targetExample = targetExample
        dirty = true
      }
      if (nativeExample !== lastSavedRef.current.nativeExample) {
        patch.nativeExample = nativeExample
        dirty = true
      }
      if (!dirty) return
      mutate({ cardId: card.id, patch })
      lastSavedRef.current = { headword, translation, definition, targetExample, nativeExample }
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [headword, translation, definition, targetExample, nativeExample, card.id, mutate])

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-xs'>{t`Headword`}</Label>
        <Input value={headword} onChange={(e) => setHeadword(e.target.value)} />
      </div>

      <div>
        <Label className='text-xs'>{t`Target example`}</Label>
        <Textarea
          value={targetExample}
          onChange={(e) => setTargetExample(e.target.value)}
          rows={2}
          placeholder={t`A sentence using this chunk in its natural setting.`}
        />
      </div>

      {sameLanguage ? (
        <div>
          <Label className='text-xs'>{t`Definition`}</Label>
          <Textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            rows={2}
            placeholder={t`Short paraphrase in the target language.`}
          />
        </div>
      ) : (
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
      )}

      {isPending && <p className='text-muted-foreground text-xs'>{t`Saving…`}</p>}
    </div>
  )
}
