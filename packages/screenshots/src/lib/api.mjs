// Minimal fetch client for the handful of backend endpoints the seed script
// drives. Paths and shapes mirror packages/api-client/src/orpc-contracts
// (OpenAPI routes: path params in the URL, the rest of the input as JSON body).
import { API_URL } from './env.mjs'

export const apiClient = (accessToken) => {
  const call = async (method, path, body) => {
    const res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
    }
    return text ? JSON.parse(text) : null
  }

  return {
    completeOnboarding: (nativeLanguage) => call('POST', '/user-prefs/complete-onboarding', { nativeLanguage }),
    setCefrForLanguage: (targetLanguage, cefrLevel) =>
      call('PUT', '/user-prefs/cefr-for-language', { targetLanguage, cefrLevel }),
    importText: (input) => call('POST', '/study-sessions/import-text', input),
    createHighlight: (sessionId, input) => call('POST', `/study-sessions/${sessionId}/highlights`, input),
    sendCardChatMessage: (cardId, content) => call('POST', `/cards/${cardId}/chat`, { content }),
    composePracticeQueue: (targetLanguage) => call('POST', '/practice/queue/compose', { targetLanguage }),
  }
}
