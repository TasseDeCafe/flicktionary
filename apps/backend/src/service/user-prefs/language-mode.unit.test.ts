import { describe, expect, it, vi } from 'vitest'
import { getLanguageMode } from './language-mode'

const createDeps = (params: { nativeLanguage: string | null; showTranslationsEnabled: boolean }) => ({
  usersRepository: {
    getNativeLanguage: vi.fn().mockResolvedValue(params.nativeLanguage),
  },
  targetLanguagePrefsRepository: {
    getShowTranslationsEnabled: vi.fn().mockResolvedValue(params.showTranslationsEnabled),
  },
})

describe('getLanguageMode', () => {
  it('keeps translation fields and allows L1 notes when translations are enabled across languages', async () => {
    const deps = createDeps({ nativeLanguage: 'fr', showTranslationsEnabled: true })
    const mode = await getLanguageMode({
      userId: 'user-1',
      targetLanguage: 'en',
      usersRepository: deps.usersRepository as never,
      targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository as never,
    })

    expect(mode).toMatchObject({
      nativeLanguage: 'fr',
      targetLanguage: 'en',
      sameLanguage: false,
      showTranslationsEnabled: true,
      hideTranslationFields: false,
      allowL1Notes: true,
    })
  })

  it('hides translation fields but keeps L1 notes when translations are disabled across languages', async () => {
    const deps = createDeps({ nativeLanguage: 'fr', showTranslationsEnabled: false })
    const mode = await getLanguageMode({
      userId: 'user-1',
      targetLanguage: 'en',
      usersRepository: deps.usersRepository as never,
      targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository as never,
    })

    expect(mode.nativeLanguage).toBe('fr')
    expect(mode.hideTranslationFields).toBe(true)
    expect(mode.allowL1Notes).toBe(true)
  })

  it('hides translation fields and L1 notes when native and target languages match', async () => {
    const deps = createDeps({ nativeLanguage: 'EN', showTranslationsEnabled: true })
    const mode = await getLanguageMode({
      userId: 'user-1',
      targetLanguage: 'en',
      usersRepository: deps.usersRepository as never,
      targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository as never,
    })

    expect(mode.sameLanguage).toBe(true)
    expect(mode.hideTranslationFields).toBe(true)
    expect(mode.allowL1Notes).toBe(false)
  })

  it('falls back to the session snapshot when the live native language is missing', async () => {
    const deps = createDeps({ nativeLanguage: null, showTranslationsEnabled: false })
    const mode = await getLanguageMode({
      userId: 'user-1',
      targetLanguage: 'en',
      snapshotNativeLanguage: 'fr',
      usersRepository: deps.usersRepository as never,
      targetLanguagePrefsRepository: deps.targetLanguagePrefsRepository as never,
    })

    expect(mode.nativeLanguage).toBe('fr')
    expect(mode.hideTranslationFields).toBe(true)
    expect(mode.allowL1Notes).toBe(true)
  })
})
