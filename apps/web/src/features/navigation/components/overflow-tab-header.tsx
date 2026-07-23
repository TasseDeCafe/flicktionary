import { useNavigate, type LinkProps } from '@tanstack/react-router'
import { type ReactNode } from 'react'
import { ModalScreenHeader } from './modal-screen'

// Mobile chrome for overflow tab views — destinations that keep a parent tab
// highlighted because the tab bar has no slot of their own (Stats under More,
// Sessions under Dashboard). Reuses the modal-screen header so both drill-in
// patterns look identical; the chevron points at the fixed parent tab, never
// history.back() (deep links have no history to pop). Desktop reaches these
// views through their own sidebar item, so the header is mobile-only and the
// view keeps its regular in-page h1 behind `hidden md:block`.
export const OverflowTabHeader = ({ backTo, title }: { backTo: LinkProps['to']; title: ReactNode }) => {
  const navigate = useNavigate()
  return (
    <ModalScreenHeader
      onClose={() => void navigate({ to: backTo })}
      closeIcon='chevron'
      title={title}
      className='sticky top-0 z-20 md:hidden'
    />
  )
}
