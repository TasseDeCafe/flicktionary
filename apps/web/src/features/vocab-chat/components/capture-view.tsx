import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Check, Loader2, MessageCircle, Pencil, Plus, Search } from 'lucide-react'
import type { CaptureCandidate } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { getBackendErrorCodeFromError } from '@flicktionary/api-client/utils/backend-error-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Input } from '@flicktionary/ui/components/input'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { LanguageSelectField } from '@/components/language-select-field'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { useMarkCandidateAdded, useTranslateForCapture } from '../api/vocab-chat-hooks'

const QUERY_MAX = 500

// "Translate & add" — the signed-in "Add a word". The learner types in any
// language; a quick pass (MODEL_TRANSLATE) returns 1-3 target-language candidates, and Add
// runs the regular ad-hoc card creation (the accurate pass writes the card).
// "Ask about this" escalates to the vocabulary chat with the query carried
// over. The submitted search lives in the URL (`q`, `lang`) and its results in
// the query cache, so a detour into an added card and back restores them.
export const CaptureView = ({ q, lang }: { q?: string; lang?: string }) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const close = useModalScreenClose({ to: '/vocabulary' })

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: createAdhoc } = useCreateAdhocCard()
  const markCandidateAdded = useMarkCandidateAdded()

  const cefrSetLanguages = useMemo(
    () => (prefs?.targetLanguagePrefs ?? []).map((p) => p.targetLanguage).sort(),
    [prefs]
  )
  const targetLanguage = lang ?? prefs?.lastTargetLanguage ?? cefrSetLanguages[0] ?? null
  const requiresCefr = !!prefs && !!targetLanguage && !cefrSetLanguages.includes(targetLanguage)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  const submittedQuery = q ?? null
  const {
    data: translation,
    isFetching: isTranslating,
    error: translationError,
  } = useTranslateForCapture(requiresCefr ? null : submittedQuery, targetLanguage)
  const [query, setQuery] = useState(q ?? '')
  const [addingHeadword, setAddingHeadword] = useState<string | null>(null)
  // Headwords added from this screen, labeled "Added" rather than "In your
  // vocabulary" (both point at the card).
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set())

  const trimmedQuery = query.trim()
  const candidates = translation?.candidates ?? []

  // Searches replace the history entry: stepping through lookups isn't a
  // stack, so back/close leaves the screen instead of replaying each search.
  const setSearch = (next: { q?: string; lang?: string }) =>
    void navigate({ to: '/vocabulary/new-word', search: next, replace: true })

  const handleTranslate = () => {
    if (!targetLanguage || !trimmedQuery) return
    setSearch({ lang: targetLanguage, q: trimmedQuery })
  }

  const switchLanguage = (code: string) => {
    setQuery('')
    setSearch({ lang: code })
  }

  const handleAdd = (candidate: CaptureCandidate) => {
    if (!targetLanguage || !submittedQuery || addingHeadword !== null) return
    setAddingHeadword(candidate.headword)
    createAdhoc(
      {
        targetLanguage,
        headword: candidate.headword,
        context: candidate.example || null,
        // Only a real translation lookup carries a meaning to steer by; a
        // target-language input is its own meaning.
        meaningHint: translation?.inputLanguage !== targetLanguage ? submittedQuery : null,
      },
      {
        onSuccess: (response) => {
          markCandidateAdded({
            text: submittedQuery,
            targetLanguage,
            headword: candidate.headword,
            card: { cardId: response.data.cardId, sessionId: response.data.sessionId },
          })
          setJustAdded((prev) => new Set(prev).add(candidate.headword))
        },
        onError: () => toast.error(t`Failed to create card`),
        onSettled: () => setAddingHeadword(null),
      }
    )
  }

  const openChat = () => {
    if (!targetLanguage) return
    void navigate({
      to: '/chat/new',
      search: { language: targetLanguage, ...(trimmedQuery ? { message: trimmedQuery } : {}) },
    })
  }

  const translationErrorMessage =
    translationError && getBackendErrorCodeFromError(translationError) === 'native_language_not_set'
      ? t`Set your native language first.`
      : t`Translation failed. Try again.`

  const handleCefrContinue = () => {
    if (!cefrChoice || !targetLanguage) return
    setCefr({ targetLanguage, cefrLevel: cefrChoice })
  }

  return (
    <ModalScreen onClose={close} title={t`Add a word`}>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 md:max-w-lg'>
          <LanguageSelectField
            label={t`Target language`}
            value={targetLanguage}
            placeholder={t`Pick a language`}
            pinnedCode={prefs?.lastTargetLanguage ?? undefined}
            onChange={switchLanguage}
          />

          {requiresCefr && targetLanguage ? (
            <div className='flex flex-col gap-4'>
              <CefrStep targetLanguage={targetLanguage} value={cefrChoice} onChange={setCefrChoice} />
              <Button size='xl' className='w-full' onClick={handleCefrContinue} disabled={!cefrChoice || isSettingCefr}>
                {isSettingCefr ? t`Saving…` : t`Continue`}
              </Button>
            </div>
          ) : (
            <>
              {/* Query input: Enter or the search button translates. */}
              <form
                className='flex items-center gap-2'
                onSubmit={(e) => {
                  e.preventDefault()
                  handleTranslate()
                }}
              >
                <Input
                  value={query}
                  maxLength={QUERY_MAX}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t`A word or phrase, in any language`}
                  className='h-11 text-base'
                  enterKeyHint='search'
                  autoFocus
                />
                <Button
                  type='submit'
                  size='icon'
                  className='size-11 shrink-0'
                  disabled={!trimmedQuery || !targetLanguage}
                  aria-label={t`Translate`}
                >
                  {isTranslating ? <Loader2 className='size-4 animate-spin' /> : <Search className='size-4' />}
                </Button>
              </form>

              {/* Candidates: each row adds one card. */}
              {isTranslating && <SkeletonList count={2} renderItem={() => <CandidateRowSkeleton />} />}
              {!isTranslating && translationError && (
                <p className='text-destructive text-sm'>{translationErrorMessage}</p>
              )}
              {!isTranslating && translation && candidates.length === 0 && (
                <p className='text-muted-foreground text-sm'>{t`No suggestions for this one. Try asking in the chat.`}</p>
              )}
              {!isTranslating && candidates.length > 0 && (
                <ul className='flex flex-col divide-y rounded-xl border'>
                  {candidates.map((candidate) => (
                    <CandidateRow
                      key={`${submittedQuery}-${candidate.headword}`}
                      candidate={candidate}
                      isAdding={addingHeadword === candidate.headword}
                      disabled={addingHeadword !== null}
                      justAdded={justAdded.has(candidate.headword)}
                      onAdd={() => handleAdd(candidate)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      {/* Chat escalation pinned to the bottom (WizardShell's footer recipe) so
          it stays in thumb reach below any number of candidates. */}
      {!requiresCefr && (
        <div className='bg-background/95 pb-safe shrink-0 border-t px-4 pt-3 backdrop-blur'>
          <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
            <Button variant='outline' size='xl' className='w-full' onClick={openChat} disabled={!targetLanguage}>
              <MessageCircle className='size-5' />
              {trimmedQuery ? t`Ask about this` : t`Start a vocabulary chat`}
            </Button>
          </div>
        </div>
      )}
    </ModalScreen>
  )
}

const CandidateRow = ({
  candidate,
  isAdding,
  disabled,
  justAdded,
  onAdd,
}: {
  candidate: CaptureCandidate
  isAdding: boolean
  disabled: boolean
  justAdded: boolean
  onAdd: () => void
}) => {
  const { t } = useLingui()
  const card = candidate.existingCard
  return (
    <li className='flex items-start gap-3 px-4 py-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='font-semibold'>{candidate.headword}</span>
        {candidate.note && <span className='text-muted-foreground text-sm'>{candidate.note}</span>}
        {candidate.example && <span className='text-sm italic'>{candidate.example}</span>}
      </div>
      {/* Once the card exists the row's action becomes an explicit Edit, with
          the status on its own line so it isn't mistaken for the button. */}
      {card ? (
        <div className='flex shrink-0 flex-col items-end gap-1.5'>
          <span className='flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400'>
            <Check className='size-3.5' />
            {justAdded ? t`Added` : t`In your vocabulary`}
          </span>
          <Button variant='outline' size='sm' asChild>
            <Link
              to='/sessions/$sessionId/review/$cardId'
              params={{ sessionId: card.sessionId, cardId: card.cardId }}
              search={{ scope: 'language' as const }}
            >
              <Pencil className='size-3.5' />
              {t`Edit card`}
            </Link>
          </Button>
        </div>
      ) : (
        <Button variant='secondary' size='sm' className='shrink-0' onClick={onAdd} disabled={disabled}>
          {isAdding ? <Loader2 className='size-4 animate-spin' /> : <Plus className='size-4' />}
          {t`Add`}
        </Button>
      )}
    </li>
  )
}

const CandidateRowSkeleton = () => (
  <div className='flex items-start gap-3 rounded-xl border px-4 py-3'>
    <div className='flex flex-1 flex-col gap-2'>
      <Skeleton className='h-5 w-32' />
      <Skeleton className='h-4 w-48' />
      <Skeleton className='h-4 w-56' />
    </div>
    <Skeleton className='h-8 w-16' />
  </div>
)
