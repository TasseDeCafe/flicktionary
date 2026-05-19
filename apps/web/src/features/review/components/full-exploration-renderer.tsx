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
  // True when the focus view already rendered a Wiktionary-grounded IPA above
  // the grammar chips. Suppresses the extras.ipa section so we don't show
  // pronunciation twice on the same card.
  hideExtrasIpa?: boolean
  // True when same-language or the user has the show-translations pref off.
  // Suppresses translation, native_example, and l1_notes sections.
  hideNativeFields?: boolean
}

export const FullExplorationRenderer = ({ card, hideExtrasIpa = false, hideNativeFields = false }: Props) => {
  const { t } = useLingui()
  const extras = card.chunk.explorationExtras ?? {}

  const definition = asString(card.chunk.definition)
  const translation = hideNativeFields ? null : asString(card.chunk.translation)
  const targetExample = asString(card.chunk.targetExample)
  const nativeExample = hideNativeFields ? null : asString(card.chunk.nativeExample)

  const ipa = hideExtrasIpa ? null : asString(extras.ipa)
  const frequency = asString(extras.frequency)
  const moreFrequentSynonym = asString(extras.more_frequent_synonym)
  const regionalism = asString(extras.regionalism)
  const register = asString(extras.register)
  const registerAlternatives = extras.register_alternatives as
    | { more_formal?: string | null; less_formal?: string | null }
    | undefined
  const collocationsNode = renderInlineList(extras.collocations)
  const etymology = asString(extras.etymology)
  const l1Notes = hideNativeFields ? null : asString(extras.l1_notes)
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
