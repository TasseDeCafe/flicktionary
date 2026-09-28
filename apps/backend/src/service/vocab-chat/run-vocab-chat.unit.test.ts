import { describe, expect, test } from 'vitest'
import type { DbVocabChatMessage } from '../../transport/database/vocab-chat/vocab-chat-repository'
import { buildHistoryMessages } from './run-vocab-chat'

const message = (overrides: Partial<DbVocabChatMessage>): DbVocabChatMessage => ({
  id: 'm',
  study_session_id: 's',
  role: 'user',
  content: '',
  proposal: null,
  new_thread_suggestion: null,
  created_at: '2026-09-28T00:00:00Z',
  ...overrides,
})

describe('buildHistoryMessages', () => {
  test('renders proposals with their id and item states so the model can add them later', () => {
    const prior = [
      message({ id: 'u1', role: 'user', content: 'gym words?' }),
      message({
        id: 'a1',
        role: 'assistant',
        content: 'Here are a few.',
        proposal: {
          items: [
            { headword: 'штанга', note: 'barbell', example: '', inVocabulary: false, highlightId: 'h1' },
            { headword: 'гантель', note: 'dumbbell', example: '', inVocabulary: true, highlightId: null },
          ],
        },
      }),
    ]
    const history = buildHistoryMessages(prior, 'add the rest')
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(history[1]!.content).toBe(
      'Here are a few.\n\n[Proposed cards, proposal_id=a1]\n0. штанга — barbell (added)\n1. гантель — dumbbell (already in vocabulary)'
    )
    expect(history[2]!.content).toBe('add the rest')
  })

  test('folds older turns into a summary on the first verbatim user message', () => {
    const prior = Array.from({ length: 16 }, (_, i) =>
      message({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` })
    )
    const history = buildHistoryMessages(prior, 'latest')
    // 12 verbatim messages + the new one; the verbatim window starts on a user turn.
    expect(history).toHaveLength(13)
    expect(history[0]!.role).toBe('user')
    const first = history[0]!.content as string
    expect(first.startsWith('Earlier in this chat (summarized):\nLearner: turn 0\nAssistant: turn 1')).toBe(true)
    expect(first.endsWith('---\n\nturn 4')).toBe(true)
  })
})
