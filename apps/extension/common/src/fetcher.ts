export interface Fetcher {
  fetch: (url: string, body: unknown) => Promise<unknown>
}

export class HttpFetcher implements Fetcher {
  async fetch(url: string, body: unknown) {
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return await response.json()
  }
}
