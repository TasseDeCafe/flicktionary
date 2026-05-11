import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, MoreVertical } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { toast } from 'sonner'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ChunksSort } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { useDeleteChunk, useListChunksInfinite, useListLanguages } from '../api/vocabulary-hooks'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import { Input } from '@/components/ui/input'
import { VocabularyActionDrawer } from './vocabulary-action-drawer'
import { VocabularyEmptyState } from './vocabulary-empty-state'
import { VocabularyLanguageSwitcher } from './vocabulary-language-switcher'
import { VocabularyOptionsOverlay } from './vocabulary-options-overlay'
import { VocabularyRow } from './vocabulary-row'
import { Button } from '@/components/ui/button'

const ESTIMATED_ROW_HEIGHT = 72

// Module-level so it survives unmount when the user opens the focus view.
// Keyed by the active filter combo — a stale offset from a different result
// set never gets applied. Lost on hard reload (good enough for now; bump to
// sessionStorage if survival across reloads is wanted).
let savedScroll: { key: string; offset: number } | null = null

// Same rationale as savedScroll: survives the focus-view round-trip so the
// user lands back on the language they were browsing instead of being reset
// to languages[0].
let savedLanguage: string | null = null

const SortPills = ({ value, onChange }: { value: ChunksSort; onChange: (next: ChunksSort) => void }) => {
  const { t } = useLingui()
  const options: Array<{ value: ChunksSort; label: string }> = [
    { value: 'recent', label: t`Recently added` },
    { value: 'due', label: t`Due soonest` },
  ]
  return (
    <div className='flex gap-1 rounded-full bg-gray-100 p-1'>
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type='button'
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export const VocabularyListView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement | null>(null)

  const [selectedLanguage, setSelectedLanguageState] = useState<string | null>(savedLanguage)
  const setSelectedLanguage = (next: string | null) => {
    savedLanguage = next
    setSelectedLanguageState(next)
  }
  const [sort, setSort] = useState<ChunksSort>('recent')
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 250)
  const [activeChunk, setActiveChunk] = useState<ChunkRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)

  const { data: languages, isLoading: languagesLoading } = useListLanguages()

  // First non-empty languages list seeds the selected language. After that the
  // user controls it via the switcher.
  useEffect(() => {
    if (selectedLanguage !== null) return
    if (!languages || languages.length === 0) return
    setSelectedLanguage(languages[0]!)
  }, [languages, selectedLanguage])

  const {
    data,
    isLoading: chunksLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useListChunksInfinite({ targetLanguage: selectedLanguage, sort, q: debouncedSearch })

  const rows: ChunkRow[] = useMemo(() => {
    if (!data) return []
    return data.pages.flatMap((page) => page.rows)
  }, [data])

  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? rows.length + 1 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
  })

  // Trigger the next-page fetch when the sentinel item (rows.length) enters
  // the virtualized window.
  const virtualItems = rowVirtualizer.getVirtualItems()
  const lastItem = virtualItems[virtualItems.length - 1]
  useEffect(() => {
    if (!lastItem) return
    if (lastItem.index < rows.length) return
    if (!hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [lastItem, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Restore scroll position on remount (e.g. when the user closes the focus
  // view back to /vocabulary). Tracks per filter combo so changing language /
  // sort / search starts fresh. Runs once per filterKey, after rows are
  // available so the virtualizer has something to render at the offset.
  const filterKey = `${selectedLanguage ?? ''}|${sort}|${debouncedSearch}`
  const restoredKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (restoredKeyRef.current === filterKey) return
    if (rows.length === 0) return
    if (savedScroll && savedScroll.key === filterKey && savedScroll.offset > 0 && parentRef.current) {
      parentRef.current.scrollTop = savedScroll.offset
    }
    restoredKeyRef.current = filterKey
  }, [filterKey, rows.length])

  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunk()

  const handleEdit = (chunk: ChunkRow) => {
    if (!chunk.studySessionId || !chunk.firstCardId) return
    setDrawerOpen(false)
    // `from: 'vocabulary'` tells the focus view to close back to /vocabulary
    // instead of the triage list (its default parent).
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId: chunk.studySessionId, cardId: chunk.firstCardId },
      search: { from: 'vocabulary' as const, ...(chunk.sourceAvailable ? { source: 'available' as const } : {}) },
    })
  }

  const handleRowTap = (chunk: ChunkRow) => {
    // Primary action: jump straight to edit. Fall back to the options drawer
    // for chunks whose source card has been deleted (so Delete remains
    // reachable). A removed source session can still open the card editor,
    // but its context/source link stay hidden.
    if (chunk.firstCardId && chunk.studySessionId) {
      handleEdit(chunk)
      return
    }
    setActiveChunk(chunk)
    setDrawerOpen(true)
  }

  const handleRowOptions = (chunk: ChunkRow) => {
    setActiveChunk(chunk)
    setDrawerOpen(true)
  }

  const handleOpenSource = (chunk: ChunkRow) => {
    if (!chunk.studySessionId || !chunk.sourceAvailable) return
    setDrawerOpen(false)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: chunk.studySessionId },
      // `from: 'vocabulary'` makes the X-close in session view land back here.
      // The segment is optional — chunks pre-dating the field land without flash.
      search: {
        ...(chunk.firstCardSegmentId ? { segment: chunk.firstCardSegmentId } : {}),
        from: 'vocabulary' as const,
      },
    })
  }

  const handleDelete = (chunk: ChunkRow) => {
    deleteChunk(
      { id: chunk.id },
      {
        onSuccess: () => {
          setDrawerOpen(false)
          toast.success(t`Term deleted`)
        },
      }
    )
  }

  const isInitialLoad = chunksLoading && rows.length === 0
  const showEmpty = !chunksLoading && !languagesLoading && rows.length === 0 && (languages?.length ?? 0) === 0
  const showLanguageEmpty = !chunksLoading && !languagesLoading && rows.length === 0 && (languages?.length ?? 0) > 0

  return (
    <div className='mx-auto flex h-full w-full max-w-2xl flex-col gap-4 px-4 py-6'>
      <header className='flex items-center gap-3'>
        <BookOpen className='h-7 w-7 text-yellow-500' />
        <h1 className='text-2xl font-bold'>{t`Vocabulary`}</h1>
        <Button
          variant='ghost'
          size='icon'
          className='ml-auto'
          onClick={() => setOptionsOpen(true)}
          disabled={!selectedLanguage}
          aria-label={t`Vocabulary options`}
        >
          <MoreVertical className='h-5 w-5' />
        </Button>
      </header>

      <p className='text-muted-foreground text-sm'>
        {t`Every term you've kept, across every session. Tap a row to edit, or open the menu for more options.`}
      </p>

      {languages && languages.length > 1 && selectedLanguage && (
        <VocabularyLanguageSwitcher
          languages={languages}
          value={selectedLanguage}
          onChange={(next) => setSelectedLanguage(next)}
        />
      )}

      <Input
        type='search'
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder={t`Search headword, translation, or definition…`}
        className='w-full'
      />

      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground text-xs tracking-wider uppercase'>{t`Sort`}</span>
        <SortPills value={sort} onChange={setSort} />
      </div>

      {showEmpty && <VocabularyEmptyState />}

      {showLanguageEmpty && (
        <div className='rounded-xl border bg-gray-50 p-6 text-center text-sm text-gray-600'>
          {debouncedSearch.length > 0 ? t`No matches.` : t`No vocabulary in this language yet.`}
        </div>
      )}

      {!showEmpty && !showLanguageEmpty && (
        <div
          ref={parentRef}
          className='flex-1 overflow-y-auto rounded-xl border bg-white md:min-h-[60vh]'
          aria-busy={isInitialLoad}
          onScroll={(e) => {
            savedScroll = { key: filterKey, offset: e.currentTarget.scrollTop }
          }}
        >
          {isInitialLoad ? (
            <div className='py-8 text-center text-sm text-gray-500'>{t`Loading…`}</div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const isLoaderRow = virtualRow.index >= rows.length
                const chunk = rows[virtualRow.index]
                const style: React.CSSProperties = {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }
                if (isLoaderRow) {
                  return (
                    <div key='loader' style={style} className='flex items-center justify-center text-xs text-gray-500'>
                      {hasNextPage ? t`Loading more…` : t`End of list`}
                    </div>
                  )
                }
                if (!chunk) return null
                return (
                  <VocabularyRow
                    key={chunk.id}
                    chunk={chunk}
                    onTap={handleRowTap}
                    onOptions={handleRowOptions}
                    style={style}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      <VocabularyActionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        chunk={activeChunk}
        onOpenSource={handleOpenSource}
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />

      <VocabularyOptionsOverlay open={optionsOpen} onOpenChange={setOptionsOpen} targetLanguage={selectedLanguage} />
    </div>
  )
}
