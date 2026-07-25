// The selected chip bolds its label; an invisible bold ghost reserves that
// width up front so toggling a chip never reflows a wrapped chip row.
export const FilterChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type='button'
    onClick={onClick}
    className={`grid shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors ${
      active ? 'bg-yellow-400 text-yellow-950' : 'bg-muted text-foreground hover:bg-accent active:bg-accent/80'
    }`}
  >
    <span aria-hidden className='invisible col-start-1 row-start-1 font-medium'>
      {children}
    </span>
    <span className={`col-start-1 row-start-1 ${active ? 'font-medium' : ''}`}>{children}</span>
  </button>
)
