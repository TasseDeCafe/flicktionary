import { describe, expect, test } from 'vitest'
import { parseCheckpointMwePassText, type CheckpointMweItem } from './checkpoint-mwe-pass'

const items: CheckpointMweItem[] = [
  { mweHeadword: 'auf machen', segmentText: 'Er macht die Tür auf.' },
  { mweHeadword: 'run out of', segmentText: 'He ran straight out of luck.' },
]

describe('parseCheckpointMwePassText', () => {
  test('maps yes/no verdicts back to items', () => {
    expect(parseCheckpointMwePassText('1: yes\n2: no', items)).toEqual([
      { mweHeadword: 'auf machen', occurs: true },
      { mweHeadword: 'run out of', occurs: false },
    ])
  })

  test('missing or unparseable answers count as "does not occur"', () => {
    expect(parseCheckpointMwePassText('Sure!\n1: yes', items)).toEqual([
      { mweHeadword: 'auf machen', occurs: true },
      { mweHeadword: 'run out of', occurs: false },
    ])
  })
})
