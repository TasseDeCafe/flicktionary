import { useMemo, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, MessageCircle, Plus, Search, X } from 'lucide-react'
import { getBackendErrorCodeFromError } from '@flicktionary/api-client/utils/backend-error-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Input } from '@flicktionary/ui/components/input'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { LanguageSelectField } from '@/components/language-select-field'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import { useTranslateForCapture, type CaptureSearch } from '../api/vocab-chat-hooks'
import { CaptureCandidateRow } from './capture-candidate-row'
import { TermRowSkeleton } from './term-row'

const QUERY_MAX = 500
const CONTEXT_MAX = 2000

// "Translate & add" — the signed-in "Add a word". The learner types in any
// language, optionally with the context they met the term in; a quick pass
// (MODEL_TRANSLATE) returns 1-3 target-language candidates, and each row's Add
// runs the regular ad-hoc card creation (the accurate pass writes the card).
// "Ask about this" escalates to the vocabulary chat, carrying the search and
// its candidates over as the chat's opening exchange. The submitted search
// lives in the URL (`q`, `lang`, `ctx`) and its results in the query cache, so
// a detour into an added card or the chat and back restores them.
export const CaptureView = ({ q, lang, ctx }: { q?: string; lang?: string; ctx?: string }) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const close = useModalScreenClose({ to: '/vocabulary' })

  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()

  const cefrSetLanguages = useMemo(
    () => (prefs?.targetLanguagePrefs ?? []).map((p) => p.targetLanguage).sort(),
    [prefs]
  )
  const targetLanguage = lang ?? prefs?.lastTargetLanguage ?? cefrSetLanguages[0] ?? null
  const requiresCefr = !!prefs && !!targetLanguage && !cefrSetLanguages.includes(targetLanguage)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)

  const submittedSearch: CaptureSearch | null =
    q && targetLanguage ? { text: q, targetLanguage, context: ctx ?? null } : null
  const {
    data: translation,
    isFetching: isTranslating,
    error: translationError,
  } = useTranslateForCapture(requiresCefr ? null : submittedSearch)
  const [query, setQuery] = useState(q ?? '')
  const [context, setContext] = useState(ctx ?? '')
  const [isContextOpen, setIsContextOpen] = useState(!!ctx)

  const trimmedQuery = query.trim()
  const trimmedContext = context.trim()
  const candidates = translation?.candidates ?? []

  // Searches replace the history entry: stepping through lookups isn't a
  // stack, so back/close leaves the screen instead of replaying each search.
  const setSearch = (next: { q?: string; lang?: string; ctx?: string }) =>
    void navigate({ to: '/vocabulary/new-word', search: next, replace: true })

  const handleTranslate = () => {
    if (!targetLanguage || !trimmedQuery) return
    setSearch({ lang: targetLanguage, q: trimmedQuery, ...(trimmedContext ? { ctx: trimmedContext } : {}) })
  }

  const switchLanguage = (code: string) => {
    setQuery('')
    setContext('')
    setIsContextOpen(false)
    setSearch({ lang: code })
  }

  const closeContext = () => {
    setContext('')
    setIsContextOpen(false)
  }

  // With results on screen, the chat opens on them (the search and its
  // candidates as the opening exchange); an edited, unsubmitted query rides
  // along as the draft. Otherwise the typed query becomes the draft.
  const openChat = () => {
    if (!targetLanguage) return
    const hasResults = !!submittedSearch && candidates.length > 0
    const draft = hasResults
      ? trimmedQuery !== q
        ? trimmedQuery
        : ''
      : [trimmedQuery, trimmedContext].filter(Boolean).join('\n\n')
    void navigate({
      to: '/chat/new',
      search: {
        language: targetLanguage,
        ...(hasResults ? { seedQ: submittedSearch.text, ...(ctx ? { seedCtx: ctx } : {}) } : {}),
        ...(draft ? { message: draft } : {}),
      },
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
              {/* Query input: Enter or the search button translates. The
                  optional context (where the learner met the term) steers the
                  sense and inspires the examples. */}
              <form
                className='flex flex-col gap-2'
                onSubmit={(e) => {
                  e.preventDefault()
                  handleTranslate()
                }}
              >
                <div className='flex items-center gap-2'>
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
                </div>
                {isContextOpen ? (
                  <div className='flex items-start gap-2'>
                    <Textarea
                      value={context}
                      maxLength={CONTEXT_MAX}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder={t`Where you met it: a sentence, even partial`}
                      className='max-h-40 min-h-16 text-base'
                      rows={2}
                      autoFocus={!ctx}
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-11 shrink-0'
                      onClick={closeContext}
                      aria-label={t`Remove context`}
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground self-start'
                    onClick={() => setIsContextOpen(true)}
                  >
                    <Plus className='size-4' />
                    {t`Add context`}
                  </Button>
                )}
              </form>

              {/* Candidates: each row adds its own card, independently. */}
              {isTranslating && <SkeletonList count={2} renderItem={() => <TermRowSkeleton />} />}
              {!isTranslating && translationError && (
                <p className='text-destructive text-sm'>{translationErrorMessage}</p>
              )}
              {!isTranslating && translation && candidates.length === 0 && (
                <p className='text-muted-foreground text-sm'>{t`No suggestions for this one. Try asking in the chat.`}</p>
              )}
              {!isTranslating && submittedSearch && candidates.length > 0 && (
                <ul className='flex flex-col divide-y rounded-xl border'>
                  {candidates.map((candidate) => (
                    <CaptureCandidateRow
                      key={`${submittedSearch.text}-${submittedSearch.context}-${candidate.headword}`}
                      candidate={candidate}
                      search={submittedSearch}
                      inputLanguage={translation?.inputLanguage ?? null}
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
