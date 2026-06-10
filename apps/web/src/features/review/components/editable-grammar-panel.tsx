import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight, Loader2, Plus, X } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import {
  getEffectiveGrammarFields,
  getLanguageGrammarConfig,
  type GrammarFieldKey,
} from '@flicktionary/core/constants/language-grammar'
import { Button } from '@flicktionary/ui/components/button'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import type {
  Grammar,
  GrammarIpaBag,
  GrammarNotableForm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FieldProvenanceIndicator } from './field-provenance-indicator'
import type { FieldProvenance } from '../utils/field-provenance'

type Props = {
  grammar: Grammar
  targetLanguage?: string
  // Debounced save. `patch` carries only the changed keys (cleared keys as
  // null), `fullGrammar` is the complete current bag. The citation adapter
  // sends `patch` (shallow-merged into the user_lookups grammar column); the
  // form adapter sends `fullGrammar` (the form-facet payload merge replaces the
  // whole `grammar` sub-object, so a partial patch would clobber it).
  onSave: (patch: Record<string, unknown>, fullGrammar: Grammar) => void
  isPending: boolean
  // Per-field provenance for the indicator next to each label. Called with the
  // panel's LIVE local value (for ipa: the whole bag, not the displayed
  // bucket), so the icon flips to "edited" as the user types instead of after
  // the refetch lands.
  provenanceFor?: (key: GrammarFieldKey, currentValue: unknown) => FieldProvenance
}

// English edits the GA / RP bucket driven by the user's dialect preference,
// but display falls back to a shared Wiktionary `untagged` IPA when the
// selected dialect bucket is empty.
const ipaBucketKey = (lang: string | undefined, dialect: 'ga' | 'rp'): 'ga' | 'rp' | 'untagged' =>
  lang === 'en' ? dialect : 'untagged'

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
export const EditableGrammarPanel = ({
  grammar: incomingGrammar,
  targetLanguage,
  onSave,
  isPending,
  provenanceFor,
}: Props) => {
  const { t } = useLingui()
  const { data: userPrefs } = useGetUserPrefs()
  const englishIpaDialect: 'ga' | 'rp' = userPrefs?.englishIpaDialect ?? 'ga'

  const config = useMemo(() => getLanguageGrammarConfig(targetLanguage), [targetLanguage])
  // Stable unique ids for the boolean-field label/checkbox pairs (used to be
  // keyed off chunk.id; the panel no longer takes a chunk).
  const fieldId = useId()

  const initial = useMemo(() => incomingGrammar ?? {}, [incomingGrammar])
  const startsOpen = isMeaningful(initial)
  const [open, setOpen] = useState(startsOpen)
  const [grammar, setGrammar] = useState<Grammar>(initial)
  const lastSavedRef = useRef<Grammar>(initial)

  // Narrow the language allowlist further by the current POS so adjectives
  // don't show aspect/reflexive/gender editors etc. Reacts to live POS
  // changes via the local `grammar` state.
  const editableFields = useMemo<readonly GrammarFieldKey[]>(() => {
    const pos = typeof grammar.pos === 'string' ? grammar.pos : null
    return getEffectiveGrammarFields(targetLanguage, pos)
  }, [targetLanguage, grammar.pos])
  const has = (k: GrammarFieldKey) => editableFields.includes(k)
  const hint = (k: GrammarFieldKey) => config.hints?.[k]

  // IPA is bucketed (`ga` / `rp` / `untagged`); user-facing edit writes to
  // the bucket matching the current language + dialect preference. When the
  // bag becomes empty, drop the `ipa` key entirely so the renderer doesn't
  // display a stale empty object.
  const ipaBucket = ipaBucketKey(targetLanguage, englishIpaDialect)
  const displayedIpa = useMemo<string>(() => {
    return pickIpa(grammar.ipa, targetLanguage ?? '', englishIpaDialect) ?? ''
  }, [grammar.ipa, targetLanguage, englishIpaDialect])
  const setIpa = (value: string) => {
    setGrammar((prev) => {
      const prevBag = (prev.ipa ?? {}) as Record<string, string | null | undefined>
      const nextBag: Record<string, string> = {}
      for (const [k, v] of Object.entries(prevBag)) {
        if (typeof v === 'string' && v.trim().length > 0) nextBag[k] = v
      }
      const trimmed = value.trim()
      const bucketToEdit = targetLanguage === 'en' && !nextBag[ipaBucket] && nextBag.untagged ? 'untagged' : ipaBucket
      if (trimmed.length === 0) delete nextBag[bucketToEdit]
      else nextBag[ipaBucket] = value
      const next: Grammar = { ...prev }
      if (Object.keys(nextBag).length === 0) {
        delete (next as Record<string, unknown>).ipa
      } else {
        ;(next as Record<string, unknown>).ipa = nextBag as GrammarIpaBag
      }
      return next
    })
  }

  // Sync from server when it diverges from what we last saved (chat tool
  // patched the row, another tab edited it, etc.). Don't clobber in-flight
  // typing by comparing to lastSaved, not to local state.
  useEffect(() => {
    const incoming = incomingGrammar ?? {}
    if (!sameJson(incoming, lastSavedRef.current)) {
      setGrammar(incoming)
      lastSavedRef.current = incoming
    }
  }, [incomingGrammar])

  useEffect(() => {
    const id = setTimeout(() => {
      const patch = buildGrammarPatch(grammar, lastSavedRef.current)
      if (!patch) return
      onSave(patch, grammar)
      lastSavedRef.current = grammar
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [grammar, onSave])

  const setKey = <K extends keyof Grammar>(key: K, value: Grammar[K] | undefined) => {
    setGrammar((prev) => {
      const next = { ...prev }
      if (value === undefined || value === '' || value === null) delete (next as Record<string, unknown>)[key as string]
      else (next as Record<string, unknown>)[key as string] = value
      return next as Grammar
    })
  }

  // Revert = programmatic typing: write the source value into local state and
  // let the debounced save persist it through the normal onSave path (a direct
  // mutation would race the debounce timer). `ipa` restores the WHOLE bag —
  // never go through setIpa, which edits a single dialect bucket and would
  // leave a hybrid bag that compares as "edited" forever.
  const revertKey = (key: GrammarFieldKey, sourceValue: unknown) => {
    if (key === 'ipa') {
      setGrammar((prev) => {
        const next = { ...prev } as Record<string, unknown>
        if (sourceValue === null || sourceValue === undefined) delete next.ipa
        else next.ipa = sourceValue
        return next as Grammar
      })
      return
    }
    setKey(key as keyof Grammar, sourceValue as Grammar[keyof Grammar] | undefined)
  }

  const provenanceIndicator = (key: GrammarFieldKey, label: string) =>
    provenanceFor ? (
      <FieldProvenanceIndicator
        provenance={provenanceFor(key, (grammar as Record<string, unknown>)[key])}
        fieldLabel={label}
        onRevert={(sourceValue) => revertKey(key, sourceValue)}
      />
    ) : null

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
          {has('ipa') && (
            <div>
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>
                  {hint('ipa')?.label ?? t`IPA`}
                  {targetLanguage === 'en' && (
                    <span className='text-muted-foreground ml-1 inline-flex items-center gap-1 font-normal'>
                      <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />(
                      {englishIpaDialect === 'ga' ? t`GA` : t`RP`})
                    </span>
                  )}
                </Label>
                {provenanceIndicator('ipa', hint('ipa')?.label ?? t`IPA`)}
              </div>
              <Input
                value={displayedIpa}
                onChange={(e) => setIpa(e.target.value)}
                placeholder={hint('ipa')?.placeholder ?? t`e.g. /ˈkæt/`}
                className='font-mono'
              />
            </div>
          )}

          {has('pos') && (
            <div>
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Part of speech`}</Label>
                {provenanceIndicator('pos', t`Part of speech`)}
              </div>
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
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{hint('display_form')?.label ?? t`Display form (e.g. stress-marked)`}</Label>
                {provenanceIndicator('display_form', hint('display_form')?.label ?? t`Display form`)}
              </div>
              <Input
                value={(grammar.display_form as string | undefined) ?? ''}
                onChange={(e) => setKey('display_form', e.target.value || undefined)}
                placeholder={hint('display_form')?.placeholder ?? t`Optional`}
              />
            </div>
          )}

          {has('gender') && (
            <div>
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Gender`}</Label>
                {provenanceIndicator('gender', t`Gender`)}
              </div>
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
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Aspect`}</Label>
                {provenanceIndicator('aspect', t`Aspect`)}
              </div>
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
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Aspect pair (counterpart headword)`}</Label>
                {provenanceIndicator('aspect_pair_headword', t`Aspect pair`)}
              </div>
              <Input
                value={(grammar.aspect_pair_headword as string | undefined) ?? ''}
                onChange={(e) => setKey('aspect_pair_headword', e.target.value || undefined)}
                placeholder={hint('aspect_pair_headword')?.placeholder ?? t`e.g. увидеть`}
              />
            </div>
          )}

          {has('government') && (
            <div>
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Government / case requirement`}</Label>
                {provenanceIndicator('government', t`Government`)}
              </div>
              <Input
                value={(grammar.government as string | undefined) ?? ''}
                onChange={(e) => setKey('government', e.target.value || undefined)}
                placeholder={hint('government')?.placeholder ?? t`e.g. + acc, от + gen`}
              />
            </div>
          )}

          {has('number_only') && (
            <div>
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Number-only`}</Label>
                {provenanceIndicator('number_only', t`Number-only`)}
              </div>
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
              <div className='flex items-center gap-1'>
                <Label className='text-xs'>{t`Animacy`}</Label>
                {provenanceIndicator('animacy', t`Animacy`)}
              </div>
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
                id={`indecl-${fieldId}`}
                type='checkbox'
                checked={Boolean(grammar.is_indeclinable)}
                onChange={(e) => setKey('is_indeclinable', e.target.checked || undefined)}
                className='h-4 w-4'
              />
              <Label htmlFor={`indecl-${fieldId}`} className='text-xs'>
                {t`Indeclinable`}
              </Label>
              {provenanceIndicator('is_indeclinable', t`Indeclinable`)}
            </div>
          )}

          {has('is_reflexive') && (
            <div className='flex items-center gap-2'>
              <input
                id={`refl-${fieldId}`}
                type='checkbox'
                checked={Boolean(grammar.is_reflexive)}
                onChange={(e) => setKey('is_reflexive', e.target.checked || undefined)}
                className='h-4 w-4'
              />
              <Label htmlFor={`refl-${fieldId}`} className='text-xs'>
                {t`Reflexive`}
              </Label>
              {provenanceIndicator('is_reflexive', t`Reflexive`)}
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

        </div>
      )}
      {/* Fixed-height status slot (rendered open or collapsed — a debounced
          save can still be in flight after collapsing): the saving feedback
          fades in instead of inserting a grid row, so fields never shift. */}
      <div aria-live='polite' className='text-muted-foreground mt-2 flex h-4 items-center gap-1 text-xs'>
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
