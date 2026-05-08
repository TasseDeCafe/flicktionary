import { useEffect, useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import {
  getLanguageGrammarConfig,
  type GrammarFieldKey,
} from '@flicktionary/core/constants/language-grammar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  Card,
  Grammar,
  GrammarNotableForm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useUpdateChunkContent } from '../api/review-hooks'

type Props = {
  card: Card
  targetLanguage?: string
}

const SAVE_DEBOUNCE_MS = 600

// Native select reused for every enum dropdown. The codebase has no
// shadcn Select primitive — native is fine and accessible.
const SelectField = ({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder: string
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={cn(
      'border-input bg-background ring-offset-background focus-visible:ring-ring',
      'flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm',
      'focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
    )}
  >
    <option value=''>{placeholder}</option>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
)

const grammarFromCard = (card: Card): Grammar => (card.chunk.grammar ?? {}) as Grammar

const isMeaningful = (g: Grammar): boolean => {
  const keys = Object.keys(g)
  if (keys.length === 0) return false
  return keys.some((k) => {
    const v = (g as Record<string, unknown>)[k]
    if (v === null || v === undefined) return false
    if (typeof v === 'string') return v.trim().length > 0
    if (Array.isArray(v)) return v.length > 0
    return true
  })
}

// Simple value-equality so we can avoid no-op patches when the user clicks
// out without changing anything. JSON.stringify is fine — these objects are
// small and contain only primitives + plain arrays.
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// A grammar PATCH sends only the keys whose values differ from what's
// already on the server. Removed keys are sent as JSON null so the JSONB ||
// merge replaces them with a null (which the renderer treats as absent).
const buildGrammarPatch = (current: Grammar, lastSaved: Grammar): Record<string, unknown> | null => {
  const patch: Record<string, unknown> = {}
  const allKeys = new Set([...Object.keys(current), ...Object.keys(lastSaved)])
  for (const k of allKeys) {
    const curr = (current as Record<string, unknown>)[k]
    const prev = (lastSaved as Record<string, unknown>)[k]
    if (sameJson(curr, prev)) continue
    if (curr === undefined || curr === null || curr === '') {
      patch[k] = null
    } else {
      patch[k] = curr
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}

// Editable per-key editor. Sends a debounced PATCH on every change. Mirrors
// the lastSavedRef pattern from EditableCardFields so concurrent updates
// (chat tool, sibling tab) don't clobber in-flight edits.
export const EditableGrammarPanel = ({ card, targetLanguage }: Props) => {
  const { t } = useLingui()
  const updateChunkContent = useUpdateChunkContent(card.studySessionId)

  const config = useMemo(() => getLanguageGrammarConfig(targetLanguage), [targetLanguage])
  const has = (k: GrammarFieldKey) => config.fields.includes(k)
  const hint = (k: GrammarFieldKey) => config.hints?.[k]

  const initial = useMemo(() => grammarFromCard(card), [card])
  const startsOpen = isMeaningful(initial)
  const [open, setOpen] = useState(startsOpen)
  const [grammar, setGrammar] = useState<Grammar>(initial)
  const lastSavedRef = useRef<Grammar>(initial)

  // Sync from server when it diverges from what we last saved (chat tool
  // patched the row, another tab edited it, etc.). Don't clobber in-flight
  // typing by comparing to lastSaved, not to local state.
  useEffect(() => {
    const incoming = grammarFromCard(card)
    if (!sameJson(incoming, lastSavedRef.current)) {
      setGrammar(incoming)
      lastSavedRef.current = incoming
    }
  }, [card])

  useEffect(() => {
    const id = setTimeout(() => {
      const patch = buildGrammarPatch(grammar, lastSavedRef.current)
      if (!patch) return
      updateChunkContent.mutate({ chunkId: card.chunk.id, patch: { grammarPatch: patch } })
      lastSavedRef.current = grammar
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [grammar, card.chunk.id, updateChunkContent])

  const setKey = <K extends keyof Grammar>(key: K, value: Grammar[K] | undefined) => {
    setGrammar((prev) => {
      const next = { ...prev }
      if (value === undefined || value === '' || value === null) delete (next as Record<string, unknown>)[key as string]
      else (next as Record<string, unknown>)[key as string] = value
      return next as Grammar
    })
  }

  const setNotableFormAt = (i: number, patch: Partial<GrammarNotableForm>) => {
    setGrammar((prev) => {
      const list = ([...((prev.notable_forms as GrammarNotableForm[]) ?? [])] as GrammarNotableForm[]).map((f, idx) =>
        idx === i ? { ...f, ...patch } : f
      )
      return { ...prev, notable_forms: list }
    })
  }
  const addNotableForm = () => {
    setGrammar((prev) => {
      const list = [...((prev.notable_forms as GrammarNotableForm[]) ?? []), { label: '', form: '' }]
      return { ...prev, notable_forms: list }
    })
  }
  const removeNotableFormAt = (i: number) => {
    setGrammar((prev) => {
      const list = ((prev.notable_forms as GrammarNotableForm[]) ?? []).filter((_, idx) => idx !== i)
      return { ...prev, notable_forms: list.length === 0 ? undefined : list }
    })
  }

  const isPending = updateChunkContent.isPending

  return (
    <div className='border-t pt-3'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-semibold tracking-wide uppercase'
      >
        {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
        {t`Grammar`}
      </button>

      {open && (
        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {has('pos') && (
            <div>
              <Label className='text-xs'>{t`Part of speech`}</Label>
              <SelectField
                value={(grammar.pos as string | undefined) ?? ''}
                onChange={(v) => setKey('pos', v ? (v as Grammar['pos']) : undefined)}
                placeholder={t`(unset)`}
                options={[
                  { value: 'noun', label: t`Noun` },
                  { value: 'verb', label: t`Verb` },
                  { value: 'adjective', label: t`Adjective` },
                  { value: 'adverb', label: t`Adverb` },
                  { value: 'preposition', label: t`Preposition` },
                  { value: 'pronoun', label: t`Pronoun` },
                  { value: 'particle', label: t`Particle` },
                  { value: 'conjunction', label: t`Conjunction` },
                  { value: 'numeral', label: t`Numeral` },
                  { value: 'phrase', label: t`Phrase` },
                  { value: 'idiom', label: t`Idiom` },
                  { value: 'other', label: t`Other` },
                ]}
              />
            </div>
          )}

          {has('display_form') && (
            <div>
              <Label className='text-xs'>{hint('display_form')?.label ?? t`Display form (e.g. stress-marked)`}</Label>
              <Input
                value={(grammar.display_form as string | undefined) ?? ''}
                onChange={(e) => setKey('display_form', e.target.value || undefined)}
                placeholder={hint('display_form')?.placeholder ?? t`Optional`}
              />
            </div>
          )}

          {has('gender') && (
            <div>
              <Label className='text-xs'>{t`Gender`}</Label>
              <SelectField
                value={(grammar.gender as string | undefined) ?? ''}
                onChange={(v) => setKey('gender', v ? (v as Grammar['gender']) : undefined)}
                placeholder={t`(unset)`}
                options={[
                  { value: 'm', label: t`Masculine` },
                  { value: 'f', label: t`Feminine` },
                  { value: 'n', label: t`Neuter` },
                  { value: 'c', label: t`Common` },
                ]}
              />
            </div>
          )}

          {has('aspect') && (
            <div>
              <Label className='text-xs'>{t`Aspect`}</Label>
              <SelectField
                value={(grammar.aspect as string | undefined) ?? ''}
                onChange={(v) => setKey('aspect', v ? (v as Grammar['aspect']) : undefined)}
                placeholder={t`(unset)`}
                options={[
                  { value: 'impf', label: t`Imperfective` },
                  { value: 'perf', label: t`Perfective` },
                  { value: 'biaspectual', label: t`Biaspectual` },
                ]}
              />
            </div>
          )}

          {has('aspect_pair_headword') && (
            <div>
              <Label className='text-xs'>{t`Aspect pair (counterpart headword)`}</Label>
              <Input
                value={(grammar.aspect_pair_headword as string | undefined) ?? ''}
                onChange={(e) => setKey('aspect_pair_headword', e.target.value || undefined)}
                placeholder={hint('aspect_pair_headword')?.placeholder ?? t`e.g. увидеть`}
              />
            </div>
          )}

          {has('government') && (
            <div>
              <Label className='text-xs'>{t`Government / case requirement`}</Label>
              <Input
                value={(grammar.government as string | undefined) ?? ''}
                onChange={(e) => setKey('government', e.target.value || undefined)}
                placeholder={hint('government')?.placeholder ?? t`e.g. + acc, от + gen`}
              />
            </div>
          )}

          {has('number_only') && (
            <div>
              <Label className='text-xs'>{t`Number-only`}</Label>
              <SelectField
                value={(grammar.number_only as string | undefined) ?? ''}
                onChange={(v) => setKey('number_only', v ? (v as Grammar['number_only']) : undefined)}
                placeholder={t`(unset)`}
                options={[
                  { value: 'plurale_tantum', label: t`Plural-only` },
                  { value: 'singulare_tantum', label: t`Singular-only` },
                ]}
              />
            </div>
          )}

          {has('animacy') && (
            <div>
              <Label className='text-xs'>{t`Animacy`}</Label>
              <SelectField
                value={(grammar.animacy as string | undefined) ?? ''}
                onChange={(v) => setKey('animacy', v ? (v as Grammar['animacy']) : undefined)}
                placeholder={t`(unset)`}
                options={[
                  { value: 'animate', label: t`Animate` },
                  { value: 'inanimate', label: t`Inanimate` },
                ]}
              />
            </div>
          )}

          {has('is_indeclinable') && (
            <div className='flex items-center gap-2'>
              <input
                id={`indecl-${card.chunk.id}`}
                type='checkbox'
                checked={Boolean(grammar.is_indeclinable)}
                onChange={(e) => setKey('is_indeclinable', e.target.checked || undefined)}
                className='h-4 w-4'
              />
              <Label htmlFor={`indecl-${card.chunk.id}`} className='text-xs'>
                {t`Indeclinable`}
              </Label>
            </div>
          )}

          {has('is_reflexive') && (
            <div className='flex items-center gap-2'>
              <input
                id={`refl-${card.chunk.id}`}
                type='checkbox'
                checked={Boolean(grammar.is_reflexive)}
                onChange={(e) => setKey('is_reflexive', e.target.checked || undefined)}
                className='h-4 w-4'
              />
              <Label htmlFor={`refl-${card.chunk.id}`} className='text-xs'>
                {t`Reflexive`}
              </Label>
            </div>
          )}

          {has('notable_forms') && (
            <div className='sm:col-span-2'>
              <Label className='text-xs'>{t`Notable forms`}</Label>
              <div className='mt-1 flex flex-col gap-2'>
                {((grammar.notable_forms as GrammarNotableForm[]) ?? []).map((f, i) => (
                  <div key={i} className='flex items-center gap-2'>
                    <Input
                      value={f.label}
                      onChange={(e) => setNotableFormAt(i, { label: e.target.value })}
                      placeholder={t`Label (e.g. past.m)`}
                      className='flex-1'
                    />
                    <Input
                      value={f.form}
                      onChange={(e) => setNotableFormAt(i, { form: e.target.value })}
                      placeholder={t`Form (e.g. был)`}
                      className='flex-1'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      onClick={() => removeNotableFormAt(i)}
                      aria-label={t`Remove`}
                    >
                      <X className='h-4 w-4' />
                    </Button>
                  </div>
                ))}
                <Button type='button' variant='outline' size='sm' onClick={addNotableForm} className='self-start'>
                  <Plus className='mr-1 h-4 w-4' />
                  {t`Add form`}
                </Button>
              </div>
            </div>
          )}

          {has('notes') && (
            <div className='sm:col-span-2'>
              <Label className='text-xs'>{t`Grammar notes`}</Label>
              <Textarea
                value={(grammar.notes as string | undefined) ?? ''}
                onChange={(e) => setKey('notes', e.target.value || undefined)}
                rows={2}
                placeholder={t`Free-form notes that don't fit the structured fields above.`}
              />
            </div>
          )}

          {isPending && <p className='text-muted-foreground text-xs'>{t`Saving…`}</p>}
        </div>
      )}
    </div>
  )
}
