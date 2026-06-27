import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Eye, Lock, Mic, Pencil, PencilLine, Save, Trash2 } from 'lucide-react'
import {
  defaultStudyIntentDraft,
  draftToStudyIntent,
  StudyOptionsSection,
  type StudyIntentDraft,
  type StudyIntentValue,
} from '@flicktionary/ui/components/study-options-section'
import { StudySkillCards, type StudySkillCardItem } from '@flicktionary/ui/components/study-skill-cards'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { Button } from '@flicktionary/ui/components/button'
import { FloatingSheet, FloatingSheetContent } from '@flicktionary/ui/components/floating-sheet'
import { composeChatSeedPrompt, usePresetTagTexts, type PresetTag } from '@flicktionary/ui/components/preset-tags'
import { HighlightNoteEditor } from '@flicktionary/ui/components/highlight-note-editor'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import type { GlossViewState } from '@flicktionary/core/types/gloss-view-state'
import type { FlicktionaryStudyFacetDto, SavedHighlightDto, SaveWordStudyIntent } from '@asbplayer-fork/common'
import {
  fetchSavedGloss,
  fetchStudyTargets,
  updateSavedHighlightNote,
  type FlicktionaryFacetSkill,
  type GlossData,
} from '../../services/flicktionary/flicktionary-client'

// The shared gloss view state under this file's historical name — the overlay
// never constructs the web-only `idle` member.
export type GlossContent = GlossViewState

// Save-time options from the tooltip's two commit lanes (web gloss-sheet
// parity). The plain Save lane sends studyIntent (+ a note typed before saving,
// which rides along and seeds the chat once); the Save-note lane sets
// noteOnly=true (empty stub card + seeded chat, no enrichment / study facets).
export interface GlossSaveOptions {
  studyIntent?: StudyIntentValue
  noteOnly?: boolean
  note?: string | null
  presetTags?: string[]
  chatSeedPrompt?: string | null
}

// Web FloatingSheet section paddings (header/body/footer), so the composed
// card matches the web sheet's rhythm.
const CARD_HEADER_CLASS = 'flex flex-col gap-1 px-2 pt-3 pb-2'
const CARD_BODY_CLASS = 'flex flex-col gap-2 px-2 pb-2 text-sm'
const CARD_FOOTER_CLASS = 'bg-popover sticky bottom-0 z-10 mt-auto flex flex-col gap-2 px-2 pt-3 pb-3'

// Both popovers hardcode the web app's DARK theme: they always float over
// video, where the light card would glare. FloatingSheetContent is the same
// scroll-capped Radix popover surface the web reader uses; `desktopOnly` keeps
// the extension's desktop overlay anchored even in narrow browser windows.
const POPOVER_CONTENT_CLASS = 'dark w-88 pointer-events-auto z-[2147483647]'

// The gloss body, shared by the preview and saved modes: the web app's
// GlossCardBody (IPA + gloss + POS/register badges + loading skeletons) plus
// the extension-only empty/error rows GlossCardBody doesn't model.
const GlossBody = ({ content, srDescription }: { content: GlossContent; srDescription: string }) => (
  <>
    <GlossCardBody
      loading={content.status === 'loading'}
      gloss={content.status === 'ready' ? content.gloss || null : null}
      pos={content.status === 'ready' ? content.pos : null}
      register={content.status === 'ready' ? content.register : null}
      ipaLabel={content.status === 'ready' ? content.ipaDisplay : null}
      ipaLemma={content.status === 'ready' && content.ipaDisplay ? content.ipaLemma : null}
      srDescription={srDescription}
    />
    {content.status === 'ready' && !content.gloss && (
      <p className='text-muted-foreground text-sm'>
        <Trans>No translation available</Trans>
      </p>
    )}
    {content.status === 'error' && <p className='text-destructive text-sm'>{content.message}</p>}
  </>
)

export interface GlossTooltipProps {
  // The word span to anchor against. Lives in the (transformed) subtitle shadow
  // tree, while the tooltip content is portaled into the separate,
  // non-transformed popover shadow host.
  anchor: HTMLElement
  word: string
  content: GlossContent
  // Explicit save (mirrors the right-click power-shortcut): persists the
  // highlighted word. Looking via hover stays free. The payload carries the
  // touched "Study options" draft and, when the note editor was used, the
  // note/tags + the note-only flag. The right-click shortcut bypasses the
  // tooltip and always saves with the backend default.
  onSave: (save: GlossSaveOptions) => void
  // When set, saving is unavailable here (e.g. off YouTube, where saving isn't
  // wired up yet). Render Save disabled with this reason instead of an active
  // button — looking is still free, so the gloss above stays fully usable.
  saveDisabledReason?: string | null
  // Whether the user is paired ("signed in") with Flicktionary. When false,
  // glossing and saving both fail, so we surface a Sign in button in place of
  // Save (the gloss area already shows the "Sign in to translate" message).
  signedIn: boolean
  // Start the pairing flow (mirrors the popup's "Sign in with Flicktionary").
  onSignIn: () => void
  // A save kicked off from this popover is in flight — Save renders disabled
  // as "Saving…" until the outcome swaps the popover into saved mode.
  saving?: boolean
  portalContainer: HTMLElement
  // Hover bridge: the pointer entering/leaving the popover. Entering cancels
  // the pending hide AND pins the popover (it stops hiding on pointer-leave —
  // see glossPinnedRef in SubtitleOverlayApp); before that, leaving dismisses.
  onPointerEnter: () => void
  onPointerLeave: () => void
  // Outside pointerdown — the parent dismisses a PINNED popover on it (same
  // gesture as the saved-mode popover) and ignores it while unpinned.
  onOutsidePointerDown: () => void
}

// Hover gloss popover — mirrors the web app's fast-gloss popover. FloatingSheet
// handles anchoring, collision, and internal scrolling through Radix Popover.
export function GlossTooltip({
  anchor,
  word,
  content,
  onSave,
  onPointerEnter,
  onPointerLeave,
  onOutsidePointerDown,
  saveDisabledReason,
  signedIn,
  onSignIn,
  saving,
  portalContainer,
}: GlossTooltipProps) {
  const { t } = useLingui()
  // "Study options" draft (full-set semantics). The SECTION is the shared web
  // component — safe in shadow surfaces since the ui Checkbox/Switch were
  // px-pinned at source (the rem-vs-host-root trap is fixed there, see the
  // Switch's track-height comment).
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)
  // Pre-save note editor (web parity): the two commit lanes are Save (full card,
  // a typed note rides along) and Save note (note-only stub + seeded chat).
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [noteExpanded, setNoteExpanded] = useState(false)
  const { prompts: presetPrompts } = usePresetTagTexts()

  // A new word = a new save target: re-arm the draft + note editor (the section
  // re-collapses via its `key={word}` remount).
  useEffect(() => {
    setStudyDraft(defaultStudyIntentDraft)
    setNote('')
    setTags([])
    setNoteExpanded(false)
  }, [word])

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  // Both lanes build the same note payload; noteOnly flips which lane runs.
  const buildSave = (noteOnly: boolean): GlossSaveOptions => ({
    studyIntent: noteOnly ? undefined : draftToStudyIntent(studyDraft),
    noteOnly,
    note: note.trim() || null,
    presetTags: tags,
    chatSeedPrompt: composeChatSeedPrompt(tags, presetPrompts, note),
  })

  return (
    <FloatingSheet
      open
      onOpenChange={(open) => {
        if (!open) onOutsidePointerDown()
      }}
      anchor={anchor}
      modal={false}
      portalContainer={portalContainer}
      desktopOnly
    >
      <FloatingSheetContent
        data-flicktionary-gloss-popover=''
        onMouseEnter={onPointerEnter}
        onMouseLeave={onPointerLeave}
        disableAnimation
        visualScrollAffordance
        className={POPOVER_CONTENT_CLASS}
      >
        <div className={CARD_HEADER_CLASS}>
          <div className='text-foreground text-base font-semibold break-words'>{word}</div>
          <GlossBody content={content} srDescription={t`Translation and save action for the hovered word.`} />
        </div>

        {/* Study options — only when saving is actually available. The shared
            web section (Radix Checkbox + Switch, px-pinned at source), so the
            controls are pixel-identical to the web sheet. */}
        {signedIn && !saveDisabledReason && (
          <div className={CARD_BODY_CLASS}>
            <StudyOptionsSection key={word} value={studyDraft} onChange={setStudyDraft} surfaceForm={word} />
          </div>
        )}

        {/* Pre-save note editor — shown once the user taps Add note. */}
        {signedIn && !saveDisabledReason && noteExpanded && (
          <div className={CARD_BODY_CLASS}>
            <HighlightNoteEditor note={note} tags={tags} onNoteChange={setNote} onToggleTag={toggleTag} />
          </div>
        )}

        {/* Not signed in → both glossing and saving fail, so offer Sign in in
            place of Save (the gloss area shows the "Sign in to translate" note).
            Otherwise the explicit Save — discoverable counterpart to the
            right-click shortcut, disabled (with a reason) where unavailable. */}
        <div data-floating-sheet-sticky-footer='' className={CARD_FOOTER_CLASS}>
          {!signedIn ? (
            <Button type='button' size='xl' className='w-full' onClick={onSignIn}>
              <Trans>Sign in</Trans>
            </Button>
          ) : saveDisabledReason ? (
            <>
              <Button type='button' size='xl' className='w-full' disabled>
                <Save className='mr-1 h-4 w-4' />
                <Trans>Save</Trans>
              </Button>
              <div className='text-muted-foreground text-xs'>{saveDisabledReason}</div>
            </>
          ) : noteExpanded ? (
            // Two commit lanes, both full-size and 50/50 wide (no morph). Save
            // (full card; the note rides along + seeds chat) and Save note
            // (note-only stub + seeded chat, no enrichment) — Save note is
            // disabled until there's a note or preset to seed the chat with.
            <div className='grid grid-cols-2 gap-2'>
              <Button
                type='button'
                size='xl'
                className='w-full'
                disabled={saving}
                onClick={() => onSave(buildSave(false))}
              >
                <Save className='mr-1 h-4 w-4' />
                {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
              </Button>
              <Button
                type='button'
                variant='outline'
                size='xl'
                className='w-full'
                disabled={saving || (!note.trim() && tags.length === 0)}
                onClick={() => onSave(buildSave(true))}
              >
                <Trans>Save note</Trans>
              </Button>
            </div>
          ) : (
            // Collapsed: Save (full card) + Add note (opens the editor).
            <div className='grid grid-cols-2 gap-2'>
              <Button
                type='button'
                size='xl'
                className='w-full'
                disabled={saving}
                onClick={() => onSave(buildSave(false))}
              >
                <Save className='mr-1 h-4 w-4' />
                {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
              </Button>
              <Button
                type='button'
                variant='outline'
                size='xl'
                className='w-full'
                disabled={saving}
                onClick={() => setNoteExpanded(true)}
              >
                <PencilLine className='mr-1 h-4 w-4' />
                <Trans>Add note</Trans>
              </Button>
            </div>
          )}
        </div>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}

// The three studiable skills, in render order.
const SAVED_SKILLS: FlicktionaryFacetSkill[] = ['meaning_recognition', 'meaning_production', 'pronunciation']

// Study targets inside the saved-mode popover — parity with the web reader's
// saved gloss sheet. Read-only: the picker keeps its preview layout but is
// uniformly dimmed + non-interactive (the study-target choice is a SAVE-TIME
// decision; editing it afterwards lives in the web app's term view alone, since
// switching scope post-enrich means creating/deleting durable form facets this
// compact popover can't represent). The displayed state comes from the stored
// study_intent pre-enrich, then the term's live facets once a chunkId resolves.
function SavedStudyTargetsSection({ highlight }: { highlight: SavedHighlightDto }) {
  const { t } = useLingui()
  const chunkId = highlight.chunkId
  const [facets, setFacets] = useState<ReadonlyArray<FlicktionaryStudyFacetDto> | null>(null)

  // Post-enrich: load the live facets so the cards reflect the term's real state.
  useEffect(() => {
    if (!chunkId) return
    let cancelled = false
    void fetchStudyTargets(chunkId).then((loaded) => {
      if (!cancelled && loaded) setFacets(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [chunkId])

  const meta: Record<FlicktionaryFacetSkill, { icon: React.ReactNode; label: string }> = {
    meaning_recognition: { icon: <Eye className='h-5 w-5' />, label: t`Recognition` },
    meaning_production: { icon: <Pencil className='h-5 w-5' />, label: t`Production` },
    pronunciation: { icon: <Mic className='h-5 w-5' />, label: t`Pronunciation` },
  }

  const { skills, formScope } = resolveSavedTargets({
    storedIntent: highlight.studyIntent,
    facets: chunkId ? facets : null,
    surfaceForm: highlight.selectionText,
  })

  const cards: StudySkillCardItem[] = SAVED_SKILLS.map((skill) => ({
    key: skill,
    icon: meta[skill].icon,
    label: meta[skill].label,
    selected: skills.has(skill),
    onToggle: () => {},
  }))

  return (
    <div className='flex flex-col gap-2'>
      {/* Uniformly dimmed + non-interactive — `pointer-events-none` locks every
          control at once, with no per-element opacity mismatch. */}
      <div className='pointer-events-none opacity-70'>
        <StudySkillCards
          cards={cards}
          formScope={formScope}
          surfaceForm={highlight.selectionText}
          onFormScopeChange={() => {}}
        />
      </div>
      <div className='text-muted-foreground/70 flex items-center gap-1 text-xs'>
        <Lock className='h-3 w-3' />
        {t`Edit these in the web app`}
      </div>
    </div>
  )
}

// Resolves the enabled skills + scope from whichever source is authoritative.
// Pre-enrich: the highlight's stored study_intent. Post-enrich: the live facets,
// reading the skills attached to the active target (the form when one exists for
// this surface, otherwise the lemma).
function resolveSavedTargets({
  storedIntent,
  facets,
  surfaceForm,
}: {
  storedIntent: SaveWordStudyIntent | null
  facets: ReadonlyArray<FlicktionaryStudyFacetDto> | null
  surfaceForm: string
}): { skills: Set<FlicktionaryFacetSkill>; formScope: 'lemma' | 'form' } {
  if (!facets) {
    return {
      skills: new Set<FlicktionaryFacetSkill>(storedIntent?.skills ?? []),
      formScope: storedIntent?.formScope ?? 'lemma',
    }
  }
  const surfaceTarget = normalizeTargetForm(surfaceForm)
  const hasForm = surfaceTarget.length > 0 && facets.some((f) => f.targetForm === surfaceTarget && f.enabled)
  const activeTargetForm = hasForm ? surfaceTarget : ''
  const skills = new Set<FlicktionaryFacetSkill>(
    facets.filter((f) => f.targetForm === activeTargetForm && f.enabled).map((f) => f.skill)
  )
  return { skills, formScope: hasForm ? 'form' : 'lemma' }
}

export interface SavedGlossTooltipProps {
  anchor: HTMLElement
  sessionId: string
  highlight: SavedHighlightDto
  initialGloss?: GlossData
  // The Remove toggle was clicked. The PARENT performs the delete (so it can
  // capture the span's offsets before they leave the store and morph the popover
  // back into the preview gloss for that span — web parity), not the tooltip.
  onRemove: () => void
  // The note/tags write landed — the caller patches the store entry so a
  // re-open shows the saved values without a reload.
  onNotePatched: (note: string | null, presetTags: string[]) => void
  onClose: () => void
  portalContainer: HTMLElement
  // The pointer entered the popover. A HOVER-opened popover (see
  // SavedPopoverState.hover) uses this to cancel its pending word-leave hide
  // and flip itself sticky; a click-opened one is sticky already.
  onPointerEnter?: () => void
}

// Saved-mode popover for a click OR hover on an already-saved span — parity
// with the web session view's gloss sheet minus ghost-extend: cached gloss
// instantly (refreshed via highlights.fastGloss), Remove highlight, and the
// note + preset tags editor that seeds the card chat. A click open is STICKY
// from the start: it has a textarea, so it dismisses on outside pointerdown
// (composedPath — the popover lives in its own shadow root) / play / cue
// change, never on pointer-leave. A hover open starts with the hover gloss's
// grace-timer dismissal and turns sticky once the pointer enters it (the
// parent's onPointerEnter wiring). No Study options / Save here — the word is
// already saved.
export function SavedGlossTooltip({
  anchor,
  sessionId,
  highlight,
  initialGloss,
  onRemove,
  onNotePatched,
  onClose,
  onPointerEnter,
  portalContainer,
}: SavedGlossTooltipProps) {
  const { t } = useLingui()

  const [content, setContent] = useState<GlossContent>(() =>
    initialGloss
      ? { status: 'ready', ...initialGloss }
      : highlight.fastGloss
        ? { status: 'ready', ...parseFastGloss(highlight.fastGloss), ipaDisplay: null, ipaLemma: null }
        : { status: 'loading' }
  )
  const [note, setNote] = useState(highlight.note ?? '')
  const [tags, setTags] = useState<string[]>([...highlight.presetTags])
  const [noteExpanded, setNoteExpanded] = useState(false)
  // Only the note save runs in the tooltip now; Remove is delegated to the
  // parent (see onRemove) so it can morph back to the preview gloss.
  const [busy, setBusy] = useState<'note' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { prompts: presetPrompts } = usePresetTagTexts()

  // Direct opens of older saved highlights may only have the compact persisted
  // fastGloss (or no gloss at all), so refresh them from the saved-gloss path.
  // Save handoffs already carry the freshly displayed preview gloss; refreshing
  // immediately would run a second fast-gloss path and can visibly change the
  // POS/register/translation right after the user clicks Save.
  useEffect(() => {
    if (initialGloss) return
    let cancelled = false
    void fetchSavedGloss(sessionId, highlight.id).then((data) => {
      if (cancelled || !data) return
      setContent({ status: 'ready', ...data })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, highlight.id, initialGloss])

  const handleSaveNote = useCallback(() => {
    const trimmedNote = note.trim()
    setBusy('note')
    setActionError(null)
    void updateSavedHighlightNote({
      sessionId,
      highlightId: highlight.id,
      note: trimmedNote || null,
      presetTags: tags,
      chatSeedPrompt: composeChatSeedPrompt(tags, presetPrompts, note),
    }).then((ok) => {
      setBusy(null)
      if (ok) {
        onNotePatched(trimmedNote || null, tags)
        setNoteExpanded(false)
      } else {
        setActionError(t`Could not save the note.`)
      }
    })
    // presetPrompts is a per-render literal of stable translations — not a dep.
  }, [sessionId, highlight.id, note, tags, onNotePatched, t])

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  const hasNoteDetails = (highlight.note ?? '').trim().length > 0 || highlight.presetTags.length > 0
  // A committed note/preset locks the editor read-only: it seeds the card chat
  // exactly once and re-saving would duplicate that turn, so the only way to
  // change it is to delete the highlight (web parity). `highlight` is the
  // store-backed row, patched in place by onNotePatched on save, so this flips
  // the instant a save lands.
  const noteLocked = hasNoteDetails

  return (
    <FloatingSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      anchor={anchor}
      modal={false}
      portalContainer={portalContainer}
      desktopOnly
    >
      <FloatingSheetContent
        data-flicktionary-saved-popover=''
        onMouseEnter={onPointerEnter}
        disableAnimation
        visualScrollAffordance
        className={POPOVER_CONTENT_CLASS}
      >
        <div className={CARD_HEADER_CLASS}>
          <div className='text-foreground text-base font-semibold break-words'>{highlight.selectionText}</div>
          <GlossBody content={content} srDescription={t`Translation and actions for the saved highlight.`} />
          {actionError && <p className='text-destructive text-sm'>{actionError}</p>}
        </div>

        {/* Study targets — always visible (parity with the web saved sheet),
            read-only here: editing lives in the web app's term view. */}
        <div className={CARD_BODY_CLASS}>
          <SavedStudyTargetsSection highlight={highlight} />
        </div>

        {/* Locked notes render the read-only editor (saved note/chips, no Edit
            affordance); an unsaved highlight shows the editable editor once
            expanded. */}
        {(noteExpanded || noteLocked) && (
          <div className={CARD_BODY_CLASS}>
            <HighlightNoteEditor
              note={note}
              tags={tags}
              onNoteChange={setNote}
              onToggleTag={toggleTag}
              readOnly={noteLocked}
            />
          </div>
        )}

        {/* Unified footer (parity with the web saved sheet): a cyclable green
            "Saved" state that REMOVES the highlight on click (replacing the old
            standalone trash). While composing a new note it turns into "Save
            note"; once a note is committed it locks — just the Saved toggle. */}
        <div data-floating-sheet-sticky-footer='' className={CARD_FOOTER_CLASS}>
          <div className='grid grid-cols-2 gap-2'>
            {noteExpanded && !noteLocked ? (
              <Button type='button' size='xl' className='w-full' disabled={busy !== null} onClick={handleSaveNote}>
                {busy === 'note' ? <Trans>Saving…</Trans> : <Trans>Save note</Trans>}
              </Button>
            ) : (
              // Cyclable Saved → Remove, sized to match Button size='xl'
              // (h-12 px-6 text-base) + w-full so it fills its 50% grid cell.
              <button
                type='button'
                aria-label={t`Saved — click to remove highlight`}
                disabled={busy !== null}
                onClick={onRemove}
                className='group inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-950/40 px-6 text-base font-medium text-emerald-400 transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50'
              >
                <Check className='h-4 w-4 group-hover:hidden' />
                <Trash2 className='hidden h-4 w-4 group-hover:block' />
                <span className='group-hover:hidden'>
                  <Trans>Saved</Trans>
                </span>
                <span className='hidden group-hover:inline'>
                  <Trans>Remove</Trans>
                </span>
              </button>
            )}
            {!noteExpanded && !noteLocked && (
              <Button
                type='button'
                variant='outline'
                size='xl'
                className='w-full'
                onClick={() => setNoteExpanded(true)}
              >
                <PencilLine className='mr-1 h-4 w-4' />
                {hasNoteDetails ? <Trans>Edit note</Trans> : <Trans>Add note</Trans>}
              </Button>
            )}
          </div>
        </div>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}
