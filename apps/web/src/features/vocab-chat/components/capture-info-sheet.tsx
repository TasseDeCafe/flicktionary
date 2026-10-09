import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Info } from 'lucide-react'
import type { CaptureFacetStatus } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetHeader,
  FloatingSheetTitle,
} from '@flicktionary/ui/components/floating-sheet'
import type { TestedSkill } from '../utils/capture-row-state'

// The "what will happen / what happened" detail of a capture row, one tap away
// instead of always on screen. FloatingSheet: anchored popover on desktop,
// bottom drawer on mobile — the same surface as tapping a word in a session.
export const CaptureInfoButton = ({ headword, children }: { headword: string; children: ReactNode }) => {
  const { t } = useLingui()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type='button'
        aria-label={t`What does this mean?`}
        onClick={(event) => setAnchor(event.currentTarget)}
        className='text-muted-foreground hover:text-foreground active:text-foreground -m-1 shrink-0 p-1 transition-colors'
      >
        <Info className='size-3.5' />
      </button>
      <FloatingSheet
        open={anchor !== null}
        onOpenChange={(next) => {
          if (!next) setAnchor(null)
        }}
        anchor={anchor}
        modal={false}
      >
        <FloatingSheetContent desktopWidthClassName='w-80'>
          <FloatingSheetHeader>
            <FloatingSheetTitle>{headword}</FloatingSheetTitle>
          </FloatingSheetHeader>
          <FloatingSheetBody className='flex flex-col gap-2 text-sm leading-6 whitespace-normal'>
            {children}
          </FloatingSheetBody>
        </FloatingSheetContent>
      </FloatingSheet>
    </>
  )
}

const useSkillLabel = () => {
  const { t } = useLingui()
  return (skill: CaptureFacetStatus['skill']) =>
    skill === 'meaning_production' ? t`Production` : skill === 'meaning_recognition' ? t`Recognition` : t`Pronunciation`
}

// "today" / "tomorrow" / "in N days", for the card list.
const useDueWhen = () => {
  const { t } = useLingui()
  return (dueInDays: number) => {
    if (dueInDays <= 0) return t`today`
    if (dueInDays === 1) return t`tomorrow`
    const dayCount = dueInDays
    return t`in ${dayCount} days`
  }
}

// Every card the term has, with the one this search tested marked. The row's
// status only ever names that one, so more card types (pronunciation, forms)
// only lengthen this list, never the row. Form cards are grouped.
export const CaptureFacetList = ({
  facets,
  testedSkill,
}: {
  facets: CaptureFacetStatus[]
  testedSkill: TestedSkill
}) => {
  const { t } = useLingui()
  const skillLabel = useSkillLabel()
  const dueWhen = useDueWhen()

  const describe = (facet: CaptureFacetStatus) => {
    if (!facet.enabled) return facet.hasHistory ? t`paused` : t`not practiced`
    if (facet.parked) return t`in rehab`
    if (facet.srsState === null || facet.dueInDays === null) return t`not started`
    return dueWhen(facet.dueInDays)
  }

  const citation = facets.filter((facet) => facet.targetForm === '')
  const tested = citation.find((facet) => facet.skill === testedSkill)
  const rows: Array<{ key: string; label: string; due: string; tested: boolean }> = [
    // A missing tested card still gets its line: it's what this search was about.
    ...(tested ? [] : [{ key: testedSkill, label: skillLabel(testedSkill), due: t`not practiced`, tested: true }]),
    ...citation.map((facet) => ({
      key: facet.skill,
      label: skillLabel(facet.skill),
      due: describe(facet),
      tested: facet.skill === testedSkill,
    })),
  ]

  const forms = facets.filter((facet) => facet.targetForm !== '' && facet.enabled)
  if (forms.length > 0) {
    const formCount = forms.length
    const scheduled = forms.flatMap((facet) =>
      facet.dueInDays !== null && facet.srsState !== null ? [facet.dueInDays] : []
    )
    const nextDue = scheduled.length > 0 ? dueWhen(Math.min(...scheduled)) : t`not started`
    rows.push({ key: 'forms', label: t`Forms: ${formCount} cards`, due: nextDue, tested: false })
  }

  return (
    <ul className='flex flex-col gap-1'>
      {rows.map((row) => (
        <li key={row.key} className='flex justify-between gap-4'>
          <span className={row.tested ? 'font-medium' : 'text-muted-foreground'}>
            {row.label}
            {row.tested && <span className='text-muted-foreground font-normal'> · {t`this search`}</span>}
          </span>
          <span className='text-muted-foreground text-right'>{row.due}</span>
        </li>
      ))}
    </ul>
  )
}
