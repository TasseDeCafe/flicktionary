import { describe, expect, test } from 'vitest'
import { parseCheckpointSensePassText, type CheckpointSenseItem } from './checkpoint-sense-pass'

const items: CheckpointSenseItem[] = [
  {
    headword: 'печь',
    segmentText: 'Мама затопила печь.',
    senses: [
      { userLookupId: 'id-stove', sense: 'stove' },
      { userLookupId: 'id-bake', sense: 'to bake' },
    ],
  },
  {
    headword: 'ключ',
    segmentText: 'Он потерял ключ от двери.',
    senses: [
      { userLookupId: 'id-key', sense: 'key' },
      { userLookupId: 'id-spring', sense: 'water spring' },
    ],
  },
]

describe('parseCheckpointSensePassText', () => {
  test('maps numbered picks back to userLookupIds', () => {
    const picks = parseCheckpointSensePassText('1: 1\n2: 1', items)
    expect(picks).toEqual([
      { headword: 'печь', pickedUserLookupId: 'id-stove' },
      { headword: 'ключ', pickedUserLookupId: 'id-key' },
    ])
  })

  test('"none" and missing answers pick nothing', () => {
    const picks = parseCheckpointSensePassText('1: none', items)
    expect(picks).toEqual([
      { headword: 'печь', pickedUserLookupId: null },
      { headword: 'ключ', pickedUserLookupId: null },
    ])
  })

  test('tolerates chatter lines and an out-of-range sense number', () => {
    const picks = parseCheckpointSensePassText('Here are my picks:\n1: 2\n2: 7', items)
    expect(picks).toEqual([
      { headword: 'печь', pickedUserLookupId: 'id-bake' },
      { headword: 'ключ', pickedUserLookupId: null },
    ])
  })
})
