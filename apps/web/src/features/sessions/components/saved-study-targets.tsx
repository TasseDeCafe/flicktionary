import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Eye, Lock, Mic, Pencil } from 'lucide-react'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import type { FacetSkill, StudyIntent } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StudySkillCards, type StudySkillCardItem } from '@flicktionary/ui/components/study-skill-cards'
import { useStudyTargets } from '@/features/vocabulary/api/vocabulary-hooks'

type SkillMeta = { key: FacetSkill; icon: ReactNode; label: string }

const useSkillMeta = (): SkillMeta[] => {
  const { t } = useLingui()
  return [
    { key: 'meaning_recognition', icon: <Eye className='h-5 w-5' />, label: t`Recognition` },
    { key: 'meaning_production', icon: <Pencil className='h-5 w-5' />, label: t`Production` },
    { key: 'pronunciation', icon: <Mic className='h-5 w-5' />, label: t`Pronunciation` },
  ]
}

type SavedStudyTargetsProps = {
  // null = pre-enrich (read the stored study_intent); set = post-enrich (read the
  // term's live facets, which reflect any edits made in the term view).
  chunkId: string | null
  storedIntent: StudyIntent | null
  surfaceForm: string
}

// Read-only view of the study-target picker for an already-saved highlight. It
// renders the SAME StudySkillCards as the preview sheet so the UI barely changes
// on save — only it's locked: the whole picker is dimmed + non-interactive, with
// a lock caption. The picker is a SAVE-TIME decision; editing it afterwards lives
// in the focus / term view alone. (Switching scope post-enrich means creating or
// deleting durable form facets, which this compact sheet can't represent — that
// mismatch is exactly the bug surface we close by locking here.)
export const SavedStudyTargets = ({ chunkId, storedIntent, surfaceForm }: SavedStudyTargetsProps) => {
  const { t } = useLingui()
  const meta = useSkillMeta()
  // Post-enrich the live facets are authoritative (they reflect term-view edits);
  // pre-enrich we only have the stored intent. No poll — this is display-only.
  const { data: targets } = useStudyTargets(chunkId)

  const { skills, formScope } = resolveTargets({ chunkId, storedIntent, targets, surfaceForm })

  const cards: StudySkillCardItem[] = meta.map((m) => ({
    key: m.key,
    icon: m.icon,
    label: m.label,
    selected: skills.has(m.key),
    onToggle: () => {},
  }))

  return (
    <div className='flex flex-col gap-2'>
      {/* The picker keeps its preview layout but is uniformly dimmed and
          non-interactive — `pointer-events-none` blocks every control at once, so
          there's no half-disabled mismatch. No `disabled`/`formScopeDisabled` on
          the children: those add per-element opacity that would break the uniform
          locked look. */}
      <div className='pointer-events-none opacity-70'>
        <StudySkillCards cards={cards} formScope={formScope} surfaceForm={surfaceForm} onFormScopeChange={() => {}} />
      </div>
      <div className='text-muted-foreground/70 flex items-center gap-1 text-xs'>
        <Lock className='h-3 w-3' />
        {t`Edit these in the term view`}
      </div>
    </div>
  )
}

// Resolves the enabled skills + scope from whichever source is authoritative.
// Pre-enrich: the highlight's stored study_intent. Post-enrich: the live facets,
// reading the skills attached to the active target (the form when one exists for
// this surface, otherwise the lemma).
const resolveTargets = ({
  chunkId,
  storedIntent,
  targets,
  surfaceForm,
}: {
  chunkId: string | null
  storedIntent: StudyIntent | null
  targets: { facets: { skill: FacetSkill; targetForm: string; enabled: boolean }[] } | undefined
  surfaceForm: string
}): { skills: Set<FacetSkill>; formScope: 'lemma' | 'form' } => {
  if (chunkId == null || !targets) {
    return { skills: new Set(storedIntent?.skills ?? []), formScope: storedIntent?.formScope ?? 'lemma' }
  }
  const surfaceTarget = normalizeTargetForm(surfaceForm)
  const hasForm = surfaceTarget.length > 0 && targets.facets.some((f) => f.targetForm === surfaceTarget && f.enabled)
  const activeTargetForm = hasForm ? surfaceTarget : ''
  const skills = new Set<FacetSkill>(
    targets.facets.filter((f) => f.targetForm === activeTargetForm && f.enabled).map((f) => f.skill)
  )
  return { skills, formScope: hasForm ? 'form' : 'lemma' }
}
