import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, Brain, ChevronDown, ChevronUp, Dumbbell, History, Layers, Sparkles, Star } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The composed route's search shape (see practice/composed/$targetLanguage).
type ComposedSearch = {
  pools: PracticePool[]
  scope: 'due_only' | 'new_only' | 'both'
  render: 'flashcards_only' | 'exercises_only' | 'both'
  autoWarmup: boolean
  includeOptInNew: boolean
}

const BOTH_POOLS: PracticePool[] = ['production', 'recognition']

// Small selected/unselected pill for the build-your-own filter rows.
const FilterChip = ({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) => (
  <Button
    type='button'
    size='sm'
    variant={selected ? 'default' : 'outline'}
    disabled={disabled}
    onClick={onSelect}
    className='rounded-full'
  >
    {label}
  </Button>
)

// Every secondary practice mode, behind the landing's single "Custom practice"
// button: presets named by the exact item classes they produce, the reading
// mode, per-pool history, and a build-your-own filter panel. Each preset is
// just the composed engine with a filter spec — render type is derived from
// term state, presets only scope populations.
export const CustomPracticeOverlay = ({
  open,
  onOpenChange,
  targetLanguage,
  productionTotal,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetLanguage: string
  productionTotal: number
}) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [builderOpen, setBuilderOpen] = useState(false)
  // Build-your-own draft, seeded with the everyday defaults.
  const [draft, setDraft] = useState<ComposedSearch>({
    pools: BOTH_POOLS,
    scope: 'both',
    render: 'both',
    autoWarmup: true,
    includeOptInNew: false,
  })

  const startComposed = (search: ComposedSearch) => {
    onOpenChange(false)
    void navigate({ to: '/practice/composed/$targetLanguage', params: { targetLanguage }, search })
  }
  const openRead = () => {
    onOpenChange(false)
    void navigate({
      to: '/practice/review/$targetLanguage',
      params: { targetLanguage },
      search: { pool: 'recognition', scope: 'mixed' },
    })
  }
  const openHistory = (pool: PracticePool) => {
    onOpenChange(false)
    void navigate({ to: '/practice/history/$targetLanguage', params: { targetLanguage }, search: { pool } })
  }

  const presets: Array<{
    key: string
    icon: React.ReactNode
    title: string
    description: string
    search: ComposedSearch
  }> = [
    {
      key: 'review',
      icon: <Layers />,
      title: t`Review (due, no new)`,
      description: t`Due flashcards and due exercises. Introduces nothing new.`,
      search: { pools: BOTH_POOLS, scope: 'due_only', render: 'both', autoWarmup: false, includeOptInNew: false },
    },
    {
      key: 'flashcards',
      icon: <Brain />,
      title: t`Flashcards only`,
      description: t`Due flashcards, no exercises.`,
      search: {
        pools: BOTH_POOLS,
        scope: 'due_only',
        render: 'flashcards_only',
        autoWarmup: false,
        includeOptInNew: false,
      },
    },
    {
      key: 'learn-new',
      icon: <Sparkles />,
      title: t`Learn new`,
      description: t`Warm-up exercises for new terms, plus new pronunciation and form cards.`,
      search: { pools: BOTH_POOLS, scope: 'new_only', render: 'both', autoWarmup: true, includeOptInNew: true },
    },
    {
      key: 'exercises',
      icon: <Dumbbell />,
      title: t`Exercises only`,
      description: t`Warm-up and rehab exercises, no flashcards.`,
      search: { pools: BOTH_POOLS, scope: 'both', render: 'exercises_only', autoWarmup: true, includeOptInNew: false },
    },
    {
      key: 'production',
      icon: <Star />,
      title: t`Production focus`,
      description: t`Only production practice — flashcards and exercises.`,
      search: { pools: ['production'], scope: 'both', render: 'both', autoWarmup: true, includeOptInNew: false },
    },
  ]

  // Build-your-own guards. `new_only + flashcards_only` without opt-in cards
  // is empty by construction (new citation terms enter as exercises, never as
  // flashcards), so the start button explains instead of serving an empty
  // queue. Opt-in-new cards are themselves introductions and flashcards, so
  // the toggle is inert under due_only / exercises_only.
  const optInNewDisabled = draft.scope === 'due_only' || draft.render === 'exercises_only'
  const draftIsEmpty = draft.scope === 'new_only' && draft.render === 'flashcards_only' && !draft.includeOptInNew

  const togglePool = (pool: PracticePool) => {
    setDraft((d) => {
      const has = d.pools.includes(pool)
      // Keep at least one pool selected; adding re-derives from BOTH_POOLS so
      // the canonical production-first order survives any toggle sequence.
      if (has && d.pools.length === 1) return d
      const pools = has
        ? d.pools.filter((p) => p !== pool)
        : BOTH_POOLS.filter((p) => p === pool || d.pools.includes(p))
      return { ...d, pools }
    })
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent className='h-[85svh] sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:overflow-y-auto'>
        <OverlayHeader>
          <OverlayTitle>{t`Custom practice`}</OverlayTitle>
          <OverlayDescription>{t`Pick a focused session instead of the everyday mix.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-2 overflow-y-auto px-4 pb-4 sm:px-0 sm:pb-0'>
          {presets
            .filter((preset) => preset.key !== 'production' || productionTotal > 0)
            .map((preset) => (
              <OptionCard
                key={preset.key}
                variant='navigation'
                icon={preset.icon}
                title={preset.title}
                description={preset.description}
                onSelect={() => startComposed(preset.search)}
              />
            ))}

          <OptionCard
            variant='navigation'
            icon={<BookOpen />}
            title={t`Read`}
            description={t`Review through a short generated text.`}
            onSelect={openRead}
          />
          <OptionCard
            variant='navigation'
            icon={<History />}
            title={t`Reading history`}
            description={productionTotal > 0 ? t`Past generated texts (recognition pool).` : t`Past generated texts.`}
            onSelect={() => openHistory('recognition')}
          />
          {productionTotal > 0 && (
            <OptionCard
              variant='navigation'
              icon={<History />}
              title={t`Reading history (production)`}
              description={t`Past generated texts for the production pool.`}
              onSelect={() => openHistory('production')}
            />
          )}

          {/* Build-your-own filter panel — the full-options escape hatch. */}
          <button
            type='button'
            onClick={() => setBuilderOpen((v) => !v)}
            className='text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1.5 self-start text-sm font-medium transition-colors'
          >
            {builderOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
            {t`Build your own`}
          </button>
          {builderOpen && (
            <div className='flex flex-col gap-4 rounded-xl border p-4'>
              <div className='flex flex-col gap-2'>
                <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Skills`}</p>
                <div className='flex flex-wrap gap-2'>
                  <FilterChip
                    label={t`Production`}
                    selected={draft.pools.includes('production')}
                    onSelect={() => togglePool('production')}
                  />
                  <FilterChip
                    label={t`Recognition`}
                    selected={draft.pools.includes('recognition')}
                    onSelect={() => togglePool('recognition')}
                  />
                </div>
              </div>
              <div className='flex flex-col gap-2'>
                <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Scope`}</p>
                <div className='flex flex-wrap gap-2'>
                  <FilterChip
                    label={t`Everything`}
                    selected={draft.scope === 'both'}
                    onSelect={() => setDraft((d) => ({ ...d, scope: 'both' }))}
                  />
                  <FilterChip
                    label={t`Due only`}
                    selected={draft.scope === 'due_only'}
                    onSelect={() => setDraft((d) => ({ ...d, scope: 'due_only', autoWarmup: false }))}
                  />
                  <FilterChip
                    label={t`New only`}
                    selected={draft.scope === 'new_only'}
                    onSelect={() => setDraft((d) => ({ ...d, scope: 'new_only', autoWarmup: true }))}
                  />
                </div>
              </div>
              <div className='flex flex-col gap-2'>
                <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Item types`}</p>
                <div className='flex flex-wrap gap-2'>
                  <FilterChip
                    label={t`Cards + exercises`}
                    selected={draft.render === 'both'}
                    onSelect={() => setDraft((d) => ({ ...d, render: 'both' }))}
                  />
                  <FilterChip
                    label={t`Flashcards only`}
                    selected={draft.render === 'flashcards_only'}
                    onSelect={() => setDraft((d) => ({ ...d, render: 'flashcards_only' }))}
                  />
                  <FilterChip
                    label={t`Exercises only`}
                    selected={draft.render === 'exercises_only'}
                    onSelect={() => setDraft((d) => ({ ...d, render: 'exercises_only' }))}
                  />
                </div>
              </div>
              <div className='flex flex-col gap-1'>
                <FilterChip
                  label={t`Include new pronunciation & form cards`}
                  selected={draft.includeOptInNew && !optInNewDisabled}
                  disabled={optInNewDisabled}
                  onSelect={() => setDraft((d) => ({ ...d, includeOptInNew: !d.includeOptInNew }))}
                />
                {optInNewDisabled && (
                  <p className='text-muted-foreground text-xs'>
                    {draft.scope === 'due_only'
                      ? t`New pronunciation/form cards are introductions — not available in a due-only session.`
                      : t`Pronunciation/form cards are flashcards — enable a card item type to include them.`}
                  </p>
                )}
              </div>
              {draftIsEmpty && (
                <p className='text-muted-foreground text-xs'>
                  {t`New terms enter as exercises, so there are no new flashcards — include exercises or the new pronunciation/form cards.`}
                </p>
              )}
              <Button
                type='button'
                size='xl'
                className='w-full'
                disabled={draftIsEmpty}
                onClick={() => startComposed({ ...draft, includeOptInNew: draft.includeOptInNew && !optInNewDisabled })}
              >
                {t`Start`}
              </Button>
            </div>
          )}
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
