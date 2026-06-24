import { describe, expect, it } from 'vitest'
import { defaultStudyIntentDraft, draftToStudyIntent } from '@flicktionary/ui/components/study-options-section'

describe('draftToStudyIntent', () => {
  it('converts an untouched draft to undefined — no studyIntent on the wire, backend default applies', () => {
    expect(draftToStudyIntent(defaultStudyIntentDraft)).toBeUndefined()
  })

  it('a touched draft is the FULL SET of checked skills — recognition only when still checked', () => {
    expect(
      draftToStudyIntent({
        recognition: false,
        production: true,
        pronunciation: false,
        exactForm: false,
        touched: true,
      })
    ).toEqual({ skills: ['meaning_production'], formScope: 'lemma' })
  })

  it('keeps recognition when checked alongside other skills', () => {
    expect(
      draftToStudyIntent({ recognition: true, production: true, pronunciation: true, exactForm: false, touched: true })
    ).toEqual({
      skills: ['meaning_recognition', 'meaning_production', 'pronunciation'],
      formScope: 'lemma',
    })
  })

  it("maps the exact-form toggle to formScope 'form'", () => {
    expect(
      draftToStudyIntent({ recognition: true, production: false, pronunciation: false, exactForm: true, touched: true })
    ).toEqual({ skills: ['meaning_recognition'], formScope: 'form' })
  })

  it('an emptied (touched, 0-skill) draft is undefined — no intent on the wire, a needs-data card', () => {
    expect(
      draftToStudyIntent({
        recognition: false,
        production: false,
        pronunciation: false,
        exactForm: true,
        touched: true,
      })
    ).toBeUndefined()
  })
})
