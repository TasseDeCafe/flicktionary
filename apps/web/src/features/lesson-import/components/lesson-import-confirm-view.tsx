import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { AlertTriangle, ChevronDown, Sparkles, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import type { ImportBatchRow } from '@flicktionary/api-client/orpc-contracts/lesson-import-contract'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Checkbox } from '@flicktionary/ui/components/checkbox'
import { SkeletonList, Skeleton } from '@flicktionary/ui/components/skeleton'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import { useConfirmLessonBatch, useGetLessonBatch } from '../api/lesson-import-hooks'

type FacetSkill = ImportBatchRow['proposedSkills'][number]

// Rows the extractor could not confidently pre-check start unticked; the user
// opts them in after reading the expansion. Matches the extractor's validated
// calibration (all real errors landed at confidence <= 0.8).
const DEFAULT_CHECKED_CONFIDENCE = 0.8

type RowOverride = { accepted?: boolean; skills?: FacetSkill[] }

const defaultAccepted = (row: ImportBatchRow): boolean =>
  row.plannedAction !== 'skip' && row.confidence >= DEFAULT_CHECKED_CONFIDENCE

type GroupKey = 'new' | 'known' | 'pronunciation' | 'unparsed' | 'wins'

const groupForRow = (row: ImportBatchRow): GroupKey => {
  if (row.type === 'win') return 'wins'
  if (row.type === 'noise' || row.plannedAction === 'skip') return 'unparsed'
  if (row.type === 'pronunciation') return 'pronunciation'
  if (row.plannedAction === 'create') return 'new'
  return 'known'
}

export const LessonImportConfirmView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { batchId } = useParams({ from: '/_authenticated/_app/lessons/import/$batchId' })

  const { data, isLoading } = useGetLessonBatch(batchId)
  const { mutate: confirmBatch, isPending: isConfirming } = useConfirmLessonBatch(batchId)
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  // Safety net for batches whose target language has no stored CEFR level
  // (drafts created before the wizard asked, or entry points that skip the
  // wizard): the backend rejects the confirm with `cefr_not_set`, we collect
  // the level here and retry.
  const [cefrNeeded, setCefrNeeded] = useState(false)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  // Decisions are stored as sparse overrides on top of the per-row defaults,
  // so no state needs syncing when the rows query lands or refetches.
  const [overrides, setOverrides] = useState<Map<string, RowOverride>>(new Map())
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const rows = useMemo(() => data?.rows ?? [], [data])
  const decisionFor = (row: ImportBatchRow) => {
    const override = overrides.get(row.id)
    return {
      accepted: override?.accepted ?? defaultAccepted(row),
      skills: override?.skills ?? row.proposedSkills,
    }
  }
  const patchRow = (rowId: string, patch: RowOverride) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(rowId, { ...next.get(rowId), ...patch })
      return next
    })
  }

  const groups = useMemo(() => {
    const buckets: Record<GroupKey, ImportBatchRow[]> = {
      new: [],
      known: [],
      pronunciation: [],
      unparsed: [],
      wins: [],
    }
    for (const row of rows) buckets[groupForRow(row)].push(row)
    return buckets
  }, [rows])

  const selectable = (key: GroupKey) => key === 'new' || key === 'known' || key === 'pronunciation'
  const acceptedRows = rows.filter((row) => selectable(groupForRow(row)) && decisionFor(row).accepted)
  const newCount = acceptedRows.filter((row) => row.plannedAction === 'create').length
  const updateCount = acceptedRows.length - newCount

  const handleConfirm = () => {
    confirmBatch(
      {
        batchId,
        decisions: rows
          .filter((row) => selectable(groupForRow(row)))
          .map((row) => {
            const decision = decisionFor(row)
            return { rowId: row.id, accepted: decision.accepted, skills: decision.skills }
          }),
      },
      {
        onSuccess: (response) => {
          void navigate({
            to: '/sessions/$sessionId/review',
            params: { sessionId: response.data.sessionId },
            replace: true,
          })
        },
        onError: (err) => {
          const code = (err as { data?: { errors?: Array<{ code?: string }> } })?.data?.errors?.[0]?.code ?? ''
          if (code === 'cefr_not_set') {
            setCefrNeeded(true)
            return
          }
          // The central handler already opens the create-account prompt.
          if (code === ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED) return
          toast.error(t`Failed to add the cards`)
        },
      }
    )
  }

  const handleCefrSubmit = () => {
    if (!cefrChoice || !data) return
    setCefr(
      { targetLanguage: data.batch.targetLanguage, cefrLevel: cefrChoice },
      {
        onSuccess: () => {
          setCefrNeeded(false)
          handleConfirm()
        },
      }
    )
  }

  const close = useModalScreenClose({ to: '/sessions' })

  // An already-confirmed batch (re-opened link, double navigation) has nothing
  // left to confirm — its session is the destination.
  if (data?.batch.status === 'confirmed' && data.batch.studySessionId) {
    return <Navigate to='/sessions/$sessionId/review' params={{ sessionId: data.batch.studySessionId }} replace />
  }

  if (data?.batch.status === 'failed') {
    return (
      <ModalScreen onClose={close} closeIcon='x' title={t`Import lesson notes`}>
        <div className='mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 pt-16 text-center md:max-w-lg'>
          <AlertTriangle className='text-destructive size-8' />
          <p className='text-lg font-semibold'>{t`We couldn't read these notes`}</p>
          <p className='text-muted-foreground text-sm'>{t`Extraction failed after several attempts. Try uploading the file again — if it keeps failing, paste the notes as text instead.`}</p>
          <Button size='xl' className='w-full' onClick={() => void navigate({ to: '/lessons/import' })}>
            {t`Try again`}
          </Button>
        </div>
      </ModalScreen>
    )
  }

  if (isLoading || data?.batch.status === 'extracting') {
    return (
      <ModalScreen onClose={close} closeIcon='x' title={t`Import lesson notes`}>
        <div className='mx-auto flex w-full max-w-md flex-col gap-6 px-4 pt-8 md:max-w-lg'>
          {data?.batch.status === 'extracting' && (
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Sparkles className='size-4 animate-pulse text-yellow-500' />
              {t`Reading the notes — this takes about a minute…`}
            </div>
          )}
          <SkeletonList count={8} renderItem={() => <ConfirmRowSkeleton />} className='flex flex-col gap-2' />
        </div>
      </ModalScreen>
    )
  }

  if (cefrNeeded && data) {
    return (
      <ModalScreen onClose={close} closeIcon='x' title={data.batch.sourceTitle}>
        <div className='flex flex-1 flex-col overflow-hidden'>
          <div className='flex-1 overflow-y-auto px-4 pb-28'>
            <div className='mx-auto flex w-full max-w-md flex-col gap-6 pt-8 md:max-w-lg'>
              <CefrStep targetLanguage={data.batch.targetLanguage} value={cefrChoice} onChange={setCefrChoice} />
            </div>
          </div>
          <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
              <Button
                size='xl'
                className='w-full'
                disabled={!cefrChoice || isSettingCefr || isConfirming}
                onClick={handleCefrSubmit}
              >
                {isSettingCefr || isConfirming ? t`Adding…` : t`Continue`}
              </Button>
            </div>
          </div>
        </div>
      </ModalScreen>
    )
  }

  const sections: Array<{ key: GroupKey; title: string; subtitle?: string }> = [
    { key: 'new', title: t`New cards`, subtitle: t`Terms that aren't in your vocabulary yet` },
    {
      key: 'known',
      title: t`Already in your vocabulary`,
      subtitle: t`Adds the lesson's study angle to the existing card`,
    },
    { key: 'pronunciation', title: t`Pronunciation` },
    { key: 'unparsed', title: t`Couldn't parse`, subtitle: t`Kept here so nothing is silently dropped` },
    { key: 'wins', title: t`Wins` },
  ]

  return (
    <ModalScreen onClose={close} closeIcon='x' title={data?.batch.sourceTitle ?? t`Import lesson notes`}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto px-4 pb-28'>
          <div className='mx-auto flex w-full max-w-md flex-col md:max-w-lg'>
            {sections.map(({ key, title, subtitle }) => {
              const sectionRows = groups[key]
              if (sectionRows.length === 0) return null
              const isSelectable = selectable(key)
              const allOn = isSelectable && sectionRows.every((row) => decisionFor(row).accepted)
              return (
                <section key={key} className='pt-5'>
                  <div className='bg-background sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 px-4 py-2'>
                    <div className='min-w-0'>
                      <h2 className='text-sm font-semibold'>
                        {title} <span className='text-muted-foreground font-normal'>({sectionRows.length})</span>
                      </h2>
                      {subtitle && <p className='text-muted-foreground truncate text-xs'>{subtitle}</p>}
                    </div>
                    {isSelectable && (
                      <button
                        type='button'
                        className='text-foreground/70 hover:text-foreground shrink-0 text-xs font-medium underline-offset-2 transition-colors hover:underline'
                        onClick={() => {
                          setOverrides((prev) => {
                            const next = new Map(prev)
                            for (const sectionRow of sectionRows) {
                              next.set(sectionRow.id, { ...next.get(sectionRow.id), accepted: !allOn })
                            }
                            return next
                          })
                        }}
                      >
                        {allOn ? t`Deselect all` : t`Select all`}
                      </button>
                    )}
                  </div>
                  <div className='flex flex-col gap-2'>
                    {sectionRows.map((row) => (
                      <ConfirmRow
                        key={row.id}
                        row={row}
                        selectable={isSelectable}
                        accepted={decisionFor(row).accepted}
                        skills={decisionFor(row).skills}
                        expanded={expandedRowId === row.id}
                        onToggleExpanded={() => setExpandedRowId((prev) => (prev === row.id ? null : row.id))}
                        onToggleAccepted={() => patchRow(row.id, { accepted: !decisionFor(row).accepted })}
                        onToggleSkill={(skill) => {
                          const current = decisionFor(row).skills
                          const next = current.includes(skill)
                            ? current.filter((s) => s !== skill)
                            : [...current, skill]
                          // An empty skill set means "don't import" — keep at
                          // least one selected; untick the row instead.
                          if (next.length === 0) return
                          patchRow(row.id, { skills: next })
                        }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
          <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
            <Button
              size='xl'
              className='w-full'
              disabled={acceptedRows.length === 0 || isConfirming}
              onClick={handleConfirm}
            >
              {isConfirming
                ? t`Adding…`
                : updateCount > 0
                  ? t`Add ${newCount} cards · update ${updateCount}`
                  : t`Add ${newCount} cards`}
            </Button>
          </div>
        </div>
      </div>
    </ModalScreen>
  )
}

const ConfirmRowSkeleton = () => (
  <div className='flex items-center gap-3 rounded-xl border p-3'>
    <Skeleton className='size-5 shrink-0 rounded-md' />
    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
      <Skeleton className='h-4 w-32' />
      <Skeleton className='h-3 w-52' />
    </div>
  </div>
)

type ConfirmRowProps = {
  row: ImportBatchRow
  selectable: boolean
  accepted: boolean
  skills: FacetSkill[]
  expanded: boolean
  onToggleExpanded: () => void
  onToggleAccepted: () => void
  onToggleSkill: (skill: FacetSkill) => void
}

const ConfirmRow = ({
  row,
  selectable,
  accepted,
  skills,
  expanded,
  onToggleExpanded,
  onToggleAccepted,
  onToggleSkill,
}: ConfirmRowProps) => {
  const { t } = useLingui()
  const isWin = row.type === 'win'
  const displayForm = row.stressMark ?? row.targetForm ?? row.headword
  const showsLapse = row.plannedAction === 'lapse_and_add_facet'
  const duplicateHeadword = row.duplicateHeadword ?? ''

  const skillLabels: Record<FacetSkill, string> = {
    meaning_recognition: t`Recognition`,
    meaning_production: t`Production`,
    pronunciation: t`Pronunciation`,
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        selectable && !accepted && 'opacity-60',
        isWin && 'border-amber-200 bg-amber-50/50'
      )}
    >
      {/* Two-line summary row; the whole surface toggles the expansion, the
          checkbox alone toggles acceptance. */}
      <button
        type='button'
        onClick={onToggleExpanded}
        className='flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100'
      >
        {selectable ? (
          <span
            role='presentation'
            className='pt-0.5'
            onClick={(e) => {
              e.stopPropagation()
              onToggleAccepted()
            }}
          >
            <Checkbox checked={accepted} aria-label={t`Import this row`} />
          </span>
        ) : isWin ? (
          <Trophy className='mt-0.5 size-4 shrink-0 text-amber-500' />
        ) : (
          <span className='w-4 shrink-0' />
        )}
        <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <span className='flex items-center gap-2'>
            <span className={cn('truncate font-medium', isWin && 'font-normal')}>
              {isWin ? row.sourceText : displayForm}
            </span>
            {row.targetForm && (
              <span className='text-muted-foreground shrink-0 truncate text-xs'>({row.headword})</span>
            )}
            {showsLapse && (
              <span className='flex shrink-0 items-center gap-1 rounded-md bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700'>
                <AlertTriangle className='size-3' />
                {t`lapse`}
              </span>
            )}
          </span>
          {!isWin && row.context && <span className='text-muted-foreground truncate text-sm'>{row.context}</span>}
        </span>
        {!isWin && (
          <ChevronDown
            className={cn('text-muted-foreground mt-1 size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
          />
        )}
      </button>

      {expanded && !isWin && (
        <div className='flex flex-col gap-3 border-t px-3 py-3'>
          <div className='flex flex-col gap-1'>
            <span className='text-muted-foreground text-xs font-medium'>{t`From the notes`}</span>
            <p className='text-sm whitespace-pre-wrap'>{row.sourceText}</p>
            {row.wrongForm && (
              <p className='text-muted-foreground text-sm'>
                {t`Your attempt:`} <span className='line-through'>{row.wrongForm}</span>
              </p>
            )}
            {row.duplicateHeadword && (
              <p className='text-muted-foreground text-sm'>{t`Already saved as "${duplicateHeadword}"`}</p>
            )}
            {showsLapse && (
              <p className='text-sm text-orange-700'>{t`This card was rated as forgotten — it will come back for review sooner.`}</p>
            )}
          </div>
          {selectable && (
            <div className='flex flex-wrap gap-2'>
              {(Object.keys(skillLabels) as FacetSkill[]).map((skill) => {
                const selected = skills.includes(skill)
                return (
                  <button
                    key={skill}
                    type='button'
                    aria-pressed={selected}
                    onClick={() => onToggleSkill(skill)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border-foreground bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/40 active:bg-accent/60'
                    )}
                  >
                    {skillLabels[skill]}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
