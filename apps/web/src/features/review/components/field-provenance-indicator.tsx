import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { BadgeCheck, Pencil, TriangleAlert, Undo2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import type { FieldProvenance } from '../utils/field-provenance'

type Props = {
  provenance: FieldProvenance
  // Field name for the accessible label ("IPA", "Translation", …).
  fieldLabel: string
  // Override for source-value rendering (e.g. the IPA bag joiner).
  formatValue?: (v: unknown) => string
  // Receives the snapshot's value for this field; the caller writes it back
  // through the SAME local-state path as typing (never a direct mutation —
  // that would race the editors' debounced save).
  onRevert?: (sourceValue: unknown) => void
}

const defaultFormatValue = (v: unknown): string => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(defaultFormatValue).join(', ')
  // Object bags (notably IPA's {ga, rp, untagged}): join present buckets.
  return Object.entries(v as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => (key === 'untagged' ? String(value) : `${key.toUpperCase()} ${String(value)}`))
    .join(' · ')
}

// Per-field provenance indicator: a small icon next to the field label, opening
// an anchored popover on desktop and a bottom sheet on mobile (popovers near
// the keyboard-focused inputs are cramped on touch; the responsive-overlay
// component isn't reused because its desktop arm is a modal Dialog — too heavy
// for a tooltip-grade surface). Renders nothing for the 'llm' default state.
export const FieldProvenanceIndicator = ({ provenance, fieldLabel, formatValue, onRevert }: Props) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (provenance.state === 'llm') return null
  // Same hydration guard as ResponsiveOverlay: don't pick a primitive until
  // the screen size is known.
  if (isMobile === undefined) return null

  const format = formatValue ?? defaultFormatValue

  let icon: ReactNode
  let title: string
  let description: string
  if (provenance.state === 'wiktionary') {
    icon = <BadgeCheck className='h-3.5 w-3.5 text-sky-600' />
    title = t`Verified by Wiktionary`
    description = t`This value was taken from Wiktionary's dictionary data during processing.`
  } else if (provenance.state === 'unverified') {
    icon = <TriangleAlert className='h-3.5 w-3.5 text-amber-500' />
    title = t`Unverified`
    description = t`AI-generated and not verified against a dictionary — double-check before drilling it.`
  } else {
    icon = <Pencil className='text-muted-foreground h-3.5 w-3.5' />
    title = t`Edited`
    description =
      provenance.sourceKind === 'wiktionary'
        ? t`This value differs from what Wiktionary provided.`
        : t`This value differs from what was originally generated.`
  }

  const sourceValue = provenance.state === 'edited' ? provenance.sourceValue : undefined
  const formattedSource = provenance.state === 'edited' ? format(sourceValue) : ''
  const revertLabel =
    provenance.state === 'edited' && provenance.sourceKind === 'wiktionary'
      ? t`Restore Wiktionary value`
      : t`Restore generated value`
  const showRevert = provenance.state === 'edited' && onRevert !== undefined

  const handleRevert = () => {
    onRevert?.(sourceValue)
    setOpen(false)
  }

  const sourceValueBlock =
    provenance.state === 'edited' ? (
      <p className='bg-muted text-foreground rounded-md px-2 py-1.5 text-sm break-words'>
        {formattedSource === '' ? <span className='text-muted-foreground italic'>{t`(empty)`}</span> : formattedSource}
      </p>
    ) : null

  const trigger = (
    <button
      type='button'
      aria-label={t`${fieldLabel}: ${title}`}
      // Tight visual footprint next to the label, padded hit area for touch.
      className='-m-1 inline-flex shrink-0 cursor-pointer p-1 align-middle'
    >
      {icon}
    </button>
  )

  if (isMobile) {
    return (
      <>
        <span onClick={() => setOpen(true)}>{trigger}</span>
        <Drawer open={open} repositionInputs={false} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{description}</DrawerDescription>
            </DrawerHeader>
            {sourceValueBlock && <div className='px-4'>{sourceValueBlock}</div>}
            {showRevert && (
              <DrawerFooter>
                <Button variant='outline' onClick={handleRevert}>
                  <Undo2 className='mr-1 h-4 w-4' />
                  {revertLabel}
                </Button>
              </DrawerFooter>
            )}
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className='w-72 p-3'>
        <div className='flex flex-col gap-2'>
          <p className='text-sm font-medium'>{title}</p>
          <p className='text-muted-foreground text-xs'>{description}</p>
          {sourceValueBlock}
          {showRevert && (
            <Button variant='outline' size='sm' onClick={handleRevert} className='self-start'>
              <Undo2 className='mr-1 h-4 w-4' />
              {revertLabel}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
