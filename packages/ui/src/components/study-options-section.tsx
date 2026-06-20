import { useLingui } from '@lingui/react/macro'
import { Eye, Mic, Pencil } from 'lucide-react'
import { StudySkillCards, type StudySkillCardItem } from './study-skill-cards'

// Structurally identical to the contract's StudyIntentSchema — re-declared so
// this package stays decoupled from @flicktionary/api-client (the IpaBagShape /
// ChunkRow convention).
export type StudyIntentSkill = 'meaning_recognition' | 'meaning_production' | 'pronunciation'
export type StudyIntentValue = {
  skills: StudyIntentSkill[]
  formScope: 'lemma' | 'form'
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
  recognition: false,
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
  // An empty set must never go on the wire (the contract rejects it). When the
  // user clears every skill the intent becomes `undefined` — a pending triage
  // card with no facet pre-configured.
  if (skills.length === 0) return undefined
  return { skills, formScope: draft.exactForm ? 'form' : 'lemma' }
}

type StudyOptionsSectionProps = {
  value: StudyIntentDraft
  onChange: (next: StudyIntentDraft) => void
  // The highlighted surface form, labelling the "Exact form" segmented option.
  surfaceForm: string
  disabled?: boolean
}

// Study-target picker for the gloss-save popovers: three always-visible skill
// icon-cards (recognition / production / pronunciation) + a "Base form | Exact
// form" segmented control. FULL-SET semantics — touching anything means the
// checked set is exactly what gets studied. The popover allows 0 selected (a
// pending triage card with no pre-configured facet); the keep-time default then
// enables recognition. The exact-form scope applies to the checked MEANING
// skills (pronunciation never gets a form facet), so it locks when no meaning
// skill is selected. Pronunciation is always offerable: the preview's IPA (a
// Wiktionary-only lookup) says nothing about studiability — enrichment generates
// IPA for every saved selection, and a pronunciation facet without one stays
// pending until the generated IPA lands (readiness guards in apply-study-intent).
export const StudyOptionsSection = ({ value, onChange, surfaceForm, disabled }: StudyOptionsSectionProps) => {
  const { t } = useLingui()

  // Exact form needs ≥1 skill to apply to (it creates a per-form facet of the
  // listed skills — pronunciation included). With zero skills selected, Save
  // sends no intent, so the toggle would do nothing — keep it locked until then.
  const hasAnySkill = value.recognition || value.production || value.pronunciation

  const patch = (partial: Partial<StudyIntentDraft>) => onChange({ ...value, ...partial, touched: true })

  const cards: StudySkillCardItem[] = [
    {
      key: 'recognition',
      icon: <Eye className='h-5 w-5' />,
      label: t`Recognition`,
      selected: value.recognition,
      disabled,
      tooltip: t`Understand it when you read or hear it`,
      onToggle: () => patch({ recognition: !value.recognition }),
    },
    {
      key: 'production',
      icon: <Pencil className='h-5 w-5' />,
      label: t`Production`,
      selected: value.production,
      disabled,
      tooltip: t`Recall and produce it yourself`,
      onToggle: () => patch({ production: !value.production }),
    },
    {
      key: 'pronunciation',
      icon: <Mic className='h-5 w-5' />,
      label: t`Pronunciation`,
      selected: value.pronunciation,
      disabled,
      tooltip: t`Practise saying it`,
      onToggle: () => patch({ pronunciation: !value.pronunciation }),
    },
  ]

  return (
    <StudySkillCards
      cards={cards}
      formScope={value.exactForm ? 'form' : 'lemma'}
      surfaceForm={surfaceForm}
      onFormScopeChange={(scope) => patch({ exactForm: scope === 'form' })}
      formScopeDisabled={disabled || !hasAnySkill}
    />
  )
}
