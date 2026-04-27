import { useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

type Exploration = Record<string, unknown>

const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className='border-b py-3'>
    <div className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{label}</div>
    <div className='mt-1 text-sm'>{children}</div>
  </div>
)

const renderInlineList = (items: unknown): ReactNode | null => {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <ul className='list-disc pl-5'>
      {items.map((it, i) => (
        <li key={i}>{String(it)}</li>
      ))}
    </ul>
  )
}

const asString = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim().length > 0) return v
  return null
}

type Props = {
  exploration: Exploration
}

export const FullExplorationRenderer = ({ exploration }: Props) => {
  const { t } = useLingui()
  const definition = asString(exploration.definition)
  const examplesNode = renderInlineList(exploration.examples)
  const ipa = asString(exploration.ipa)
  const frequency = asString(exploration.frequency)
  const moreFrequentSynonym = asString(exploration.more_frequent_synonym)
  const regionalism = asString(exploration.regionalism)
  const register = asString(exploration.register)
  const registerAlternatives = exploration.register_alternatives as
    | { more_formal?: string | null; less_formal?: string | null }
    | undefined
  const collocationsNode = renderInlineList(exploration.collocations)
  const etymology = asString(exploration.etymology)
  const l1Notes = asString(exploration.l1_notes)
  const notes = asString(exploration.notes)
  const translation = asString(exploration.translation)
  const contextSegment = asString(exploration.context_segment)

  return (
    <div className='flex flex-col'>
      {contextSegment && (
        <Section label={t`Context`}>
          <p className='italic'>{contextSegment}</p>
        </Section>
      )}
      {definition && <Section label={t`Definition`}>{definition}</Section>}
      {translation && <Section label={t`Translation`}>{translation}</Section>}
      {examplesNode && <Section label={t`Examples`}>{examplesNode}</Section>}
      {ipa && <Section label={t`IPA`}>{ipa}</Section>}
      {frequency && <Section label={t`Frequency`}>{frequency}</Section>}
      {register && <Section label={t`Register`}>{register}</Section>}
      {registerAlternatives && (registerAlternatives.more_formal || registerAlternatives.less_formal) && (
        <Section label={t`Register alternatives`}>
          {registerAlternatives.more_formal && (
            <div>
              <span className='text-muted-foreground'>{t`More formal:`}</span> {registerAlternatives.more_formal}
            </div>
          )}
          {registerAlternatives.less_formal && (
            <div>
              <span className='text-muted-foreground'>{t`Less formal:`}</span> {registerAlternatives.less_formal}
            </div>
          )}
        </Section>
      )}
      {moreFrequentSynonym && <Section label={t`More frequent synonym`}>{moreFrequentSynonym}</Section>}
      {regionalism && <Section label={t`Regionalism`}>{regionalism}</Section>}
      {collocationsNode && <Section label={t`Collocations`}>{collocationsNode}</Section>}
      {etymology && <Section label={t`Etymology`}>{etymology}</Section>}
      {l1Notes && <Section label={t`L1 notes`}>{l1Notes}</Section>}
      {notes && <Section label={t`Notes`}>{notes}</Section>}
    </div>
  )
}
