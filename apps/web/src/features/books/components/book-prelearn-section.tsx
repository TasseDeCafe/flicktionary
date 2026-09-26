import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { toast } from 'sonner'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { Book, PrelearnHorizon, PrelearnItem } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Card } from '@flicktionary/ui/components/card'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@flicktionary/ui/components/tabs'
import { EvidenceLine } from '@/features/sessions/components/evidence-line'
import {
  useGetPrelearnCandidates,
  useGetPrelearnGlosses,
  useLearnPrelearnWord,
  useMarkPrelearnKnown,
  useUndoPrelearnKnown,
} from '../api/books-hooks'

// Per-viewer convenience only: whether the section was left open.
const OPEN_STORAGE_KEY = 'book-prelearn-open'

const readOpen = (): boolean => {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const writeOpen = (open: boolean) => {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked (private window): the section just starts closed.
  }
}

type BookPrelearnSectionProps = {
  book: Book
  // The last part is read to the end: nothing is ahead.
  finished: boolean
}

// "Learn before you read" (docs/READER-SPEC.md, book page): frequent words in
// the chapters ahead that the reader neither knows nor has saved, each with
// the sentence it comes up in next. Known marks a word as known (undoable),
// Learn saves it as a recognition card built from that sentence. Collapsed by
// default; nothing is fetched until it's opened.
export const BookPrelearnSection = ({ book, finished }: BookPrelearnSectionProps) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(readOpen)
  const [horizon, setHorizon] = useState<PrelearnHorizon>('next_part')
  // Rows acted on stay hidden until the refetch that drops them lands.
  const [hiddenLemmas, setHiddenLemmas] = useState<ReadonlySet<string>>(new Set())
  const [learningLemmas, setLearningLemmas] = useState<ReadonlySet<string>>(new Set())

  const contentSourceId = book.contentSourceId
  const supported = book.priority.analysis.status !== 'unsupported'
  const { data, isLoading } = useGetPrelearnCandidates(contentSourceId, horizon, open && supported && !finished)
  const items = data?.items ?? []
  const { data: glosses, isFetching: glossesFetching } = useGetPrelearnGlosses(contentSourceId, items)
  const { mutate: markKnown } = useMarkPrelearnKnown(contentSourceId)
  const { mutate: undoKnown } = useUndoPrelearnKnown(contentSourceId)
  const { mutate: learn } = useLearnPrelearnWord(contentSourceId)

  if (!supported || finished) return null

  const toggleOpen = () => {
    setOpen(!open)
    writeOpen(!open)
  }

  const hide = (lemma: string) => setHiddenLemmas((prev) => new Set(prev).add(lemma))
  const unhide = (lemma: string) =>
    setHiddenLemmas((prev) => {
      const next = new Set(prev)
      next.delete(lemma)
      return next
    })
  const setLearning = (lemma: string, learning: boolean) =>
    setLearningLemmas((prev) => {
      const next = new Set(prev)
      if (learning) next.add(lemma)
      else next.delete(lemma)
      return next
    })

  const onKnown = (item: PrelearnItem) => {
    hide(item.lemma)
    const headword = item.headword
    markKnown(
      { contentSourceId, lemma: item.lemma },
      {
        onSuccess: () => {
          toast.success(t`"${headword}" marked as known`, {
            action: {
              label: t`Undo`,
              onClick: () => {
                unhide(item.lemma)
                undoKnown({ targetLanguage: book.language, lemmas: [item.lemma] })
              },
            },
          })
        },
        onError: () => unhide(item.lemma),
      }
    )
  }

  const onLearn = (item: PrelearnItem) => {
    setLearning(item.lemma, true)
    learn(
      { contentSourceId, lemma: item.lemma, headword: item.headword, context: item.context },
      {
        onSuccess: () => hide(item.lemma),
        onSettled: () => setLearning(item.lemma, false),
      }
    )
  }

  const visible = items.filter((item) => !hiddenLemmas.has(item.lemma))
  const savedCount = data?.savedCount ?? 0

  return (
    <Card className='gap-0 py-0'>
      <button
        type='button'
        onClick={toggleOpen}
        aria-expanded={open}
        className='flex w-full items-center gap-2 rounded-xl p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100'
      >
        <span className='min-w-0 flex-1'>
          <span className='block text-sm font-medium'>{t`Words worth knowing for this book`}</span>
          <span className='text-muted-foreground block text-xs'>
            {t`Frequent in the chapters ahead, not yet in your vocabulary.`}
          </span>
        </span>
        <ChevronDown
          className={cn('text-muted-foreground h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className='flex flex-col gap-3 px-3 pb-3'>
          <Tabs value={horizon} onValueChange={(value) => setHorizon(value as PrelearnHorizon)}>
            <TabsList className='w-full'>
              <TabsTrigger value='next_part' className='py-1.5'>{t`Next chapter`}</TabsTrigger>
              <TabsTrigger value='rest_of_book' className='py-1.5'>{t`Rest of book`}</TabsTrigger>
            </TabsList>
          </Tabs>

          {book.priority.analysis.status === 'analyzing' && (
            <p className='text-muted-foreground text-xs'>{t`Still analyzing some chapters — more words may appear.`}</p>
          )}

          {isLoading ? (
            <SkeletonList count={4} renderItem={() => <PrelearnRowSkeleton />} />
          ) : visible.length === 0 ? (
            <p className='text-muted-foreground py-2 text-sm'>
              {t`Nothing left to prepare: every frequent word ahead is already known or saved.`}
            </p>
          ) : (
            <ul className='flex flex-col'>
              {visible.map((item) => (
                <PrelearnRow
                  key={item.lemma}
                  item={item}
                  gloss={glosses?.get(item.lemma) ?? null}
                  glossLoading={glossesFetching && !glosses?.has(item.lemma)}
                  learning={learningLemmas.has(item.lemma)}
                  onKnown={() => onKnown(item)}
                  onLearn={() => onLearn(item)}
                />
              ))}
            </ul>
          )}

          {!isLoading && savedCount > 0 && (
            <p className='text-muted-foreground text-xs'>
              {plural(savedCount, {
                one: '# more word from this book is already in your vocabulary.',
                other: '# more words from this book are already in your vocabulary.',
              })}
            </p>
          )}
          {!isLoading && !book.priority.pinned && (
            <p className='text-muted-foreground text-xs'>{t`Turn on "Prioritize words from this book" above to learn these words first.`}</p>
          )}
        </div>
      )}
    </Card>
  )
}

type PrelearnRowProps = {
  item: PrelearnItem
  gloss: string | null
  glossLoading: boolean
  learning: boolean
  onKnown: () => void
  onLearn: () => void
}

const PrelearnRow = ({ item, gloss, glossLoading, learning, onKnown, onLearn }: PrelearnRowProps) => {
  const { t } = useLingui()
  const aheadCount = item.aheadCount
  return (
    <li className='border-b py-3 first:pt-1 last:border-b-0 last:pb-1'>
      <div className='flex items-baseline gap-2'>
        <span className='shrink-0 font-medium'>{item.headword}</span>
        <span className='text-muted-foreground min-w-0 flex-1 truncate text-sm'>
          {gloss ?? (glossLoading ? <Skeleton className='inline-block h-3.5 w-24 align-middle' /> : null)}
        </span>
        <span className='text-muted-foreground shrink-0 text-xs' title={t`Times it comes up ahead`}>
          {t`×${aheadCount}`}
        </span>
      </div>
      <EvidenceLine surface={item.surface} context={item.context} />
      <div className='mt-2 flex justify-end gap-2'>
        <Button variant='outline' className='h-11 min-w-24 sm:h-9' disabled={learning} onClick={onKnown}>
          {t`Known`}
        </Button>
        <Button className='h-11 min-w-24 sm:h-9' disabled={learning} onClick={onLearn}>
          {learning ? (
            <>
              <Loader2 className='animate-spin' />
              {t`Adding…`}
            </>
          ) : (
            t`Learn`
          )}
        </Button>
      </div>
    </li>
  )
}

const PrelearnRowSkeleton = () => (
  <div className='border-b py-3 last:border-b-0'>
    <div className='flex items-center gap-2'>
      <Skeleton className='h-5 w-24' />
      <Skeleton className='h-4 w-20' />
    </div>
    <Skeleton className='mt-2 h-3 w-full' />
    <Skeleton className='mt-1 h-3 w-2/3' />
    <div className='mt-2 flex justify-end gap-2'>
      <Skeleton className='h-11 w-24 sm:h-9' />
      <Skeleton className='h-11 w-24 sm:h-9' />
    </div>
  </div>
)
