import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useDeleteChunk, useListChunksInfinite, useListLanguages } from '../api/vocabulary-hooks'
import { useDebouncedValue } from '@/features/sessions/hooks/use-debounced-value'
import { SearchInput } from '@flicktionary/ui/components/search-input'
import { VocabularyFilterControl, type VocabFilters } from './vocabulary-filter-control'
import { setSavedVocabularySearch } from '../saved-search'
import { VocabularyActionDrawer } from './vocabulary-action-drawer'
import { VocabularyDeleteConfirmDrawer } from './vocabulary-delete-confirm-drawer'
import { VocabularyEmptyState } from './vocabulary-empty-state'
import { VocabularyLanguageSwitcher, VocabularyLanguageSwitcherSkeleton } from './vocabulary-language-switcher'
import { VocabularyOptionsOverlay } from './vocabulary-options-overlay'
import { VocabularyRow, VocabularyRowSkeleton } from './vocabulary-row'
import { Button } from '@flicktionary/ui/components/button'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { useScrollRestoration } from '@/hooks/use-scroll-restoration'

const ESTIMATED_ROW_HEIGHT = 72

// Module-level so it survives the focus-view round-trip — without it the user
// lands back on languages[0] instead of whatever they were browsing.
let savedLanguage: string | null = null

export const VocabularyListView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const search = useSearch({ from: '/_authenticated/_app/vocabulary/' })

  const [selectedLanguage, setSelectedLanguageState] = useState<string | null>(savedLanguage)
  const setSelectedLanguage = (next: string | null) => {
    savedLanguage = next
    setSelectedLanguageState(next)
  }
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 250)
  // Sort & filter state lives in the URL (see the route's search schema). Drop
  // default/empty values when writing back so the URL stays clean.
  const filters: VocabFilters = {
    sort: search.sort ?? 'recent',
    status: search.status,
    skills: search.skills ?? [],
    hasMultipleForms: search.forms ?? false,
  }
  const setFilters = (next: VocabFilters) => {
    void navigate({
      to: '/vocabulary',
      search: {
        ...(next.sort !== 'recent' ? { sort: next.sort } : {}),
        ...(next.status ? { status: next.status } : {}),
        ...(next.skills.length > 0 ? { skills: next.skills } : {}),
        ...(next.hasMultipleForms ? { forms: true } : {}),
      },
    })
  }
  const [activeChunk, setActiveChunk] = useState<ChunkRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [deleteConfirmChunk, setDeleteConfirmChunk] = useState<ChunkRow | null>(null)

  // Mirror the URL filters into the module stash so the focus view's
  // chevron-back can restore them when returning from a card.
  useEffect(() => {
    setSavedVocabularySearch(search)
  }, [search])

  const { data: languages, isLoading: languagesLoading } = useListLanguages()

  // First non-empty languages list seeds the selected language. After that the
  // user controls it via the switcher.
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-chain-state-updates -- derivable (`selectedLanguage ?? languages?.[0]`); scheduled for the phase-2 effect cleanup, see docs/proposals/add-eslint-effect.md */
    if (selectedLanguage !== null) return
    if (!languages || languages.length === 0) return
    setSelectedLanguage(languages[0]!)
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-chain-state-updates */
  }, [languages, selectedLanguage])

  const {
    data,
    isLoading: chunksLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useListChunksInfinite({
    targetLanguage: selectedLanguage,
    sort: filters.sort,
    q: debouncedSearch,
    skills: filters.skills,
    status: filters.status,
    hasMultipleForms: filters.hasMultipleForms,
  })
  const rows: ChunkRow[] = useMemo(() => {
    if (!data) return []
    return data.pages.flatMap((page) => page.rows)
  }, [data])

  // Restores scroll position when the container remounts (e.g. focus-view
  // round-trip). Resets when the filter combo changes so a stale offset from
  // a different result set never gets applied.
  const filterKey = `${selectedLanguage ?? ''}|${filters.sort}|${debouncedSearch}|${filters.status ?? 'all'}|${filters.skills.join(',')}|${filters.hasMultipleForms ? 'forms' : ''}`
  const { ref: parentRef, onScroll: onParentScroll } = useScrollRestoration<HTMLDivElement>({
    scope: 'vocabulary',
    filterKey,
    ready: rows.length > 0,
  })

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

  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunk()

  const handleEdit = (chunk: ChunkRow) => {
    if (!chunk.studySessionId || !chunk.firstCardId) return
    setDrawerOpen(false)
    // `from: 'vocabulary'` tells the focus view to close back to /vocabulary
    // instead of the session vocabulary list (its default parent).
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

  const handleRequestDelete = (chunk: ChunkRow) => {
    setDrawerOpen(false)
    setDeleteConfirmChunk(chunk)
  }

  const handleConfirmDelete = (chunk: ChunkRow) => {
    deleteChunk(
      { id: chunk.id },
      {
        onSuccess: () => {
          setDeleteConfirmChunk(null)
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

      {languagesLoading && <VocabularyLanguageSwitcherSkeleton />}

      {languages && languages.length > 1 && selectedLanguage && (
        <VocabularyLanguageSwitcher
          languages={languages}
          value={selectedLanguage}
          onChange={(next) => setSelectedLanguage(next)}
        />
      )}

      <div className='flex items-center gap-2'>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t`Search terms…`} className='flex-1' />
        <VocabularyFilterControl filters={filters} onChange={setFilters} />
      </div>

      {showEmpty && <VocabularyEmptyState />}

      {showLanguageEmpty && (
        <div className='bg-muted text-muted-foreground rounded-xl border p-6 text-center text-sm'>
          {debouncedSearch.length > 0 || filters.status || filters.skills.length > 0 || filters.hasMultipleForms
            ? t`No matches.`
            : t`No vocabulary in this language yet.`}
        </div>
      )}

      {!showEmpty && !showLanguageEmpty && (
        <div
          ref={parentRef}
          className='bg-card flex-1 overflow-y-auto rounded-xl border md:min-h-[60vh]'
          aria-busy={isInitialLoad}
          onScroll={onParentScroll}
        >
          {isInitialLoad ? (
            <SkeletonList count={8} renderItem={() => <VocabularyRowSkeleton />} />
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
                    <div
                      key='loader'
                      style={style}
                      className='text-muted-foreground flex items-center justify-center text-xs'
                    >
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
        onEdit={handleEdit}
        onOpenSource={handleOpenSource}
        onRequestDelete={handleRequestDelete}
      />

      <VocabularyDeleteConfirmDrawer
        open={deleteConfirmChunk !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteConfirmChunk(null)
        }}
        chunk={deleteConfirmChunk}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />

      <VocabularyOptionsOverlay open={optionsOpen} onOpenChange={setOptionsOpen} targetLanguage={selectedLanguage} />
    </div>
  )
}
