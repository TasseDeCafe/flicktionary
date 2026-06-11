import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Checkbox } from './checkbox'
import { Switch } from './switch'

// Structurally identical to the contract's StudyIntentSchema — re-declared so
// this package stays decoupled from @flicktionary/api-client (the IpaBagShape /
// ChunkRow convention).
export type StudyIntentSkill = 'meaning_recognition' | 'meaning_production' | 'pronunciation'
export type StudyIntentValue = {
  skills: StudyIntentSkill[]
  formScope: 'lemma' | 'both'
}

// The popover's draft of a study intent. `touched` tracks whether the user
// changed ANY control since the last reset: an untouched draft converts to
// `undefined` (no studyIntent sent — the backend's keep-time default applies),
// while a touched draft is the FULL SET (recognition only if still checked).
export type StudyIntentDraft = {
  recognition: boolean
  production: boolean
  pronunciation: boolean
  exactForm: boolean
  touched: boolean
}

export const defaultStudyIntentDraft: StudyIntentDraft = {
  recognition: true,
  production: false,
  pronunciation: false,
  exactForm: false,
  touched: false,
}

export const draftToStudyIntent = (draft: StudyIntentDraft): StudyIntentValue | undefined => {
  if (!draft.touched) return undefined
  const skills: StudyIntentSkill[] = [
    ...(draft.recognition ? (['meaning_recognition'] as const) : []),
    ...(draft.production ? (['meaning_production'] as const) : []),
    ...(draft.pronunciation ? (['pronunciation'] as const) : []),
  ]
  // The UI locks the last checked skill, so this is unreachable in practice —
  // but an empty set must never go on the wire (the contract rejects it).
  if (skills.length === 0) return undefined
  return { skills, formScope: draft.exactForm ? 'both' : 'lemma' }
}

type StudyOptionsSectionProps = {
  value: StudyIntentDraft
  onChange: (next: StudyIntentDraft) => void
  // The highlighted surface form, labelling the "Study this exact form" row.
  surfaceForm: string
  // Whether the gloss has a displayable IPA — pronunciation is a recognition
  // card whose back IS the transcription, so without one it's unofferable.
  pronunciationAvailable: boolean
  disabled?: boolean
}

// Collapsed-by-default "Study options" disclosure for the gloss-save popovers:
// three skill checkboxes (recognition pre-checked) + a "study this exact form"
// switch. FULL-SET semantics — touching anything means the checked set is
// exactly what gets studied; the last checked skill is locked so the set can
// never go empty. The exact-form switch applies to the checked MEANING skills
// (pronunciation never gets a form facet), so it locks when only pronunciation
// is checked. Expansion state is internal: pass a fresh `key` when the
// selection changes so the section re-collapses with the draft reset.
export const StudyOptionsSection = ({
  value,
  onChange,
  surfaceForm,
  pronunciationAvailable,
  disabled,
}: StudyOptionsSectionProps) => {
  const { t } = useLingui()
  const [expandedOptions, setExpandedOptions] = useState(false)

  const checkedSkillCount = [value.recognition, value.production, value.pronunciation].filter(Boolean).length
  const isLastCheckedSkill = (checked: boolean) => checked && checkedSkillCount === 1
  const hasMeaningSkill = value.recognition || value.production

  const patch = (partial: Partial<StudyIntentDraft>) => onChange({ ...value, ...partial, touched: true })

  const skillRows: Array<{
    key: 'recognition' | 'production' | 'pronunciation'
    label: string
    checked: boolean
    rowDisabled: boolean
    hint?: string
  }> = [
    {
      key: 'recognition',
      label: t`Recognition`,
      checked: value.recognition,
      rowDisabled: !!disabled || isLastCheckedSkill(value.recognition),
    },
    {
      key: 'production',
      label: t`Production`,
      checked: value.production,
      rowDisabled: !!disabled || isLastCheckedSkill(value.production),
    },
    {
      key: 'pronunciation',
      label: t`Pronunciation`,
      checked: value.pronunciation,
      rowDisabled: !!disabled || isLastCheckedSkill(value.pronunciation) || !pronunciationAvailable,
      hint: pronunciationAvailable ? undefined : t`Needs a known transcription`,
    },
  ]

  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        onClick={() => setExpandedOptions((prev) => !prev)}
        aria-expanded={expandedOptions}
        className='text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs font-medium transition-colors'
      >
        {expandedOptions ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}
        {t`Study options`}
      </button>
      {expandedOptions && (
        <div className='flex flex-col gap-2 pt-1'>
          {skillRows.map((row) => (
            <label
              key={row.key}
              className={cn(
                'flex items-center gap-2 text-sm',
                row.rowDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              )}
            >
              <Checkbox
                checked={row.checked}
                disabled={row.rowDisabled}
                onCheckedChange={(checked) => patch({ [row.key]: checked === true })}
              />
              <span>{row.label}</span>
              {row.hint && <span className='text-muted-foreground text-xs'>{row.hint}</span>}
            </label>
          ))}
          <label
            className={cn(
              'flex items-center gap-2 text-sm',
              disabled || !hasMeaningSkill ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
          >
            <Switch
              checked={value.exactForm}
              disabled={disabled || !hasMeaningSkill}
              onCheckedChange={(checked) => patch({ exactForm: checked })}
            />
            <span className='min-w-0'>
              {t`Study this exact form`} <span className='text-muted-foreground'>(&ldquo;{surfaceForm}&rdquo;)</span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
