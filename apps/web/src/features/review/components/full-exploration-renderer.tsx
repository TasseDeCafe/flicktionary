import { useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

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
  card: Card
}

export const FullExplorationRenderer = ({ card }: Props) => {
  const { t } = useLingui()
  const extras = card.explorationExtras ?? {}

  const definition = asString(card.definition)
  const translation = asString(card.translation)
  const targetExample = asString(card.targetExample)
  const nativeExample = asString(card.nativeExample)

  const ipa = asString(extras.ipa)
  const frequency = asString(extras.frequency)
  const moreFrequentSynonym = asString(extras.more_frequent_synonym)
  const regionalism = asString(extras.regionalism)
  const register = asString(extras.register)
  const registerAlternatives = extras.register_alternatives as
    | { more_formal?: string | null; less_formal?: string | null }
    | undefined
  const collocationsNode = renderInlineList(extras.collocations)
  const etymology = asString(extras.etymology)
  const l1Notes = asString(extras.l1_notes)
  const notes = asString(extras.notes)

  return (
    <div className='flex flex-col'>
      {definition && <Section label={t`Definition`}>{definition}</Section>}
      {translation && <Section label={t`Translation`}>{translation}</Section>}
      {(targetExample || nativeExample) && (
        <Section label={t`Example`}>
          {targetExample && <p>{targetExample}</p>}
          {nativeExample && <p className='text-muted-foreground'>{nativeExample}</p>}
        </Section>
      )}
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
