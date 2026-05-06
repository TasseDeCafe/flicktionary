import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { toast } from 'sonner'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ChunksSort } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { useDeleteChunk, useListChunksInfinite, useListLanguages } from '../api/vocabulary-hooks'
import { VocabularyActionDrawer } from './vocabulary-action-drawer'
import { VocabularyEmptyState } from './vocabulary-empty-state'
import { VocabularyLanguageSwitcher } from './vocabulary-language-switcher'
import { VocabularyRow } from './vocabulary-row'

const ESTIMATED_ROW_HEIGHT = 72

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

  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null)
  const [sort, setSort] = useState<ChunksSort>('recent')
  const [activeChunk, setActiveChunk] = useState<ChunkRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

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
  } = useListChunksInfinite({ targetLanguage: selectedLanguage, sort })

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

  const { mutate: deleteChunk, isPending: isDeleting } = useDeleteChunk()

  const handleRowTap = (chunk: ChunkRow) => {
    setActiveChunk(chunk)
    setDrawerOpen(true)
  }

  const handleEdit = (chunk: ChunkRow) => {
    if (!chunk.studySessionId || !chunk.firstCardId) return
    setDrawerOpen(false)
    // `from: 'vocabulary'` tells the focus view to close back to /vocabulary
    // instead of the triage list (its default parent).
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId: chunk.studySessionId, cardId: chunk.firstCardId },
      search: { from: 'vocabulary' as const },
    })
  }

  const handleOpenSource = (chunk: ChunkRow) => {
    if (!chunk.studySessionId) return
    setDrawerOpen(false)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: chunk.studySessionId },
    })
  }

  const handleDelete = (chunk: ChunkRow) => {
    deleteChunk(
      { id: chunk.id },
      {
        onSuccess: () => {
          setDrawerOpen(false)
          toast.success(t`Chunk deleted`)
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
      </header>

      <p className='text-muted-foreground text-sm'>
        {t`Every chunk you've kept, across every session. Tap a row for actions.`}
      </p>

      {languages && languages.length > 1 && selectedLanguage && (
        <VocabularyLanguageSwitcher
          languages={languages}
          value={selectedLanguage}
          onChange={(next) => setSelectedLanguage(next)}
        />
      )}

      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground text-xs tracking-wider uppercase'>{t`Sort`}</span>
        <SortPills value={sort} onChange={setSort} />
      </div>

      {showEmpty && <VocabularyEmptyState />}

      {showLanguageEmpty && (
        <div className='rounded-xl border bg-gray-50 p-6 text-center text-sm text-gray-600'>
          {t`No vocabulary in this language yet.`}
        </div>
      )}

      {!showEmpty && !showLanguageEmpty && (
        <div
          ref={parentRef}
          className='min-h-[60vh] flex-1 overflow-y-auto rounded-xl border bg-white'
          aria-busy={isInitialLoad}
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
                return <VocabularyRow key={chunk.id} chunk={chunk} onTap={handleRowTap} style={style} />
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
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  )
}
