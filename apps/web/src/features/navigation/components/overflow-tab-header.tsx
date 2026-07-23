import { type LinkProps } from '@tanstack/react-router'
import { type ReactNode } from 'react'
import { useModalScreenClose } from '../hooks/use-modal-screen-close'
import { ModalScreenHeader } from './modal-screen'

// Mobile chrome for overflow tab views — destinations that keep a parent tab
// highlighted because the tab bar has no slot of their own (Stats under More,
// Sessions under Dashboard). Reuses the modal-screen header so both drill-in
// patterns look identical. The chevron returns to the actual opener (these
// views are linked from several tabs — e.g. the practice empty state links to
// Sessions) and falls back to the fixed parent tab on deep links. Desktop
// reaches these views through their own sidebar item, so the header is
// mobile-only and the view keeps its regular in-page h1 behind
// `hidden md:block`.
export const OverflowTabHeader = ({ backTo, title }: { backTo: LinkProps['to']; title: ReactNode }) => {
  const close = useModalScreenClose({ to: backTo })
  return <ModalScreenHeader onClose={close} closeIcon='chevron' title={title} className='sticky top-0 z-20 md:hidden' />
}
