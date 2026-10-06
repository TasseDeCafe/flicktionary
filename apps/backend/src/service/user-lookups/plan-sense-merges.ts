import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { PlannedRow } from '../../transport/database/user-lookups/merge-user-lookups'

// Plans the one-time merge of vocabulary rows that hold the same meaning under
// different sense labels (scripts/merge-duplicate-senses.ts). Uses the same
// judgment as save-time dedup (senseMatchPass), so the backlog is cleaned up
// with the rule that keeps it clean afterwards.

export type SenseRow = PlannedRow & {
  definition: string | null
  translation: string | null
  targetExample: string | null
}

// Rows of one (user, language, case-folded headword), oldest first.
export type HeadwordGroup = { userId: string; targetLanguage: string; rows: SenseRow[] }

export type PlannedCluster = { userId: string; targetLanguage: string; rows: PlannedRow[] }

// Walks the rows oldest first: each row is compared with the first row of
// every cluster so far and joins the matching one, or starts its own. A pass
// failure leaves the row alone (its own cluster) rather than guessing.
export const planSenseMerges = async (
  group: HeadwordGroup,
  deps: { anthropicPasses: Pick<AnthropicPassesInterface, 'senseMatchPass'>; onError?: (error: unknown) => void }
): Promise<PlannedCluster[]> => {
  const clusters: SenseRow[][] = []
  for (const row of group.rows) {
    let matchedId: string | null = null
    if (clusters.length > 0) {
      try {
        matchedId = await deps.anthropicPasses.senseMatchPass({
          targetLanguage: group.targetLanguage,
          headword: row.headword,
          candidate: {
            sense: row.sense,
            definition: row.definition,
            translation: row.translation,
            sentence: row.targetExample,
          },
          existing: clusters.map(([first]) => ({
            userLookupId: first!.id,
            sense: first!.sense,
            definition: first!.definition,
            translation: first!.translation,
          })),
        })
      } catch (error) {
        deps.onError?.(error)
      }
    }
    const cluster = clusters.find(([first]) => first!.id === matchedId)
    if (cluster) cluster.push(row)
    else clusters.push([row])
  }
  return clusters
    .filter((rows) => rows.length > 1)
    .map((rows) => ({
      userId: group.userId,
      targetLanguage: group.targetLanguage,
      rows: rows.map(({ id, headword, sense }) => ({ id, headword, sense })),
    }))
}
