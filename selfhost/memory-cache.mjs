// In-process stand-in for the Workers Cache API (`caches.default`) used by src/cache.js.
// Honours `Cache-Control: max-age` of stored responses and keeps at most MAX_ENTRIES.
const MAX_ENTRIES = 5000;

export class MemoryCache {
  #entries = new Map(); // url -> { expires, status, headers, body }

  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  }

  async put(request, response) {
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1];
    if (!maxAge) return;
    const key = typeof request === 'string' ? request : request.url;
    if (this.#entries.size >= MAX_ENTRIES) this.#entries.delete(this.#entries.keys().next().value);
    this.#entries.set(key, {
      expires: Date.now() + Number(maxAge) * 1000,
      status: response.status,
      headers: [...response.headers],
      body: await response.arrayBuffer(),
    });
  }

  async delete(request) {
    return this.#entries.delete(typeof request === 'string' ? request : request.url);
  }
}
