import { describe, expect, it } from 'vitest'
import { GrammarSchema } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// Regression: the per-card chat's update_card_fields tool (and the LLM passes)
// author the grammar bag and can emit a valid-but-out-of-enum value — e.g.
// pos:"determiner" for a Russian определитель. A strict enum 500s EVERY read of
// the card and its whole session on output validation. GrammarSchema must drop
// the unrecognized value instead of throwing.
describe('GrammarSchema leniency', () => {
  it('drops an out-of-enum pos instead of throwing', () => {
    const parsed = GrammarSchema.parse({ pos: 'determiner', display_form: 'не́который' })
    expect(parsed.pos).toBeUndefined()
    expect(parsed.display_form).toBe('не́который')
  })

  it('drops out-of-enum gender / animacy / aspect but keeps valid keys', () => {
    const parsed = GrammarSchema.parse({
      pos: 'noun',
      gender: 'bogus',
      animacy: 'nope',
      aspect: 'weird',
      notes: 'kept',
    })
    expect(parsed.pos).toBe('noun')
    expect(parsed.gender).toBeUndefined()
    expect(parsed.animacy).toBeUndefined()
    expect(parsed.aspect).toBeUndefined()
    expect(parsed.notes).toBe('kept')
  })

  it('still accepts a fully valid bag unchanged', () => {
    const valid = { pos: 'verb' as const, aspect: 'impf' as const, is_reflexive: false }
    expect(GrammarSchema.parse(valid)).toMatchObject(valid)
  })
})
