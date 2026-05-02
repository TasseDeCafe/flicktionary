import { type ReactNode } from 'react'

interface MoreListSectionProps {
  title: string
  children: ReactNode
}

export const MoreListSection = ({ title, children }: MoreListSectionProps) => (
  <section className='flex flex-col gap-2'>
    <h2 className='text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase'>{title}</h2>
    <div className='divide-y divide-gray-100 overflow-hidden rounded-xl border bg-white'>{children}</div>
  </section>
)
