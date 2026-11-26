const MAX_MEMORY_FILES = 20000;
const MAX_MEMORY_SEARCHES = 2000;
const LOCAL_TTL_MS = 6 * 60 * 60 * 1000;
const REMOTE_TIMEOUT_MS = 3000;

function bound(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value);
}

export function memoryStore(initial = {}) {
  const files = new Map(Object.entries(initial.files ?? {}));
  const searches = new Map(Object.entries(initial.searches ?? {}));
  return {
    async get({ files: ids = [], searches: queries = [] } = {}) {
      const now = Date.now();
      return {
        files: new Map(ids.filter((id) => files.has(id)).map((id) => [id, files.get(id)])),
        searches: new Map(queries.filter((query) => searches.get(query)?.expires > now).map((query) => [query, searches.get(query).data])),
      };
    },
    async put({ files: newFiles = [], searches: newSearches = [] } = {}) {
      for (const { id, meta } of newFiles) files.set(id, meta);
      for (const { query, data, ttl } of newSearches) searches.set(query, { data, expires: Date.now() + ttl });
      bound(files, MAX_MEMORY_FILES);
      bound(searches, MAX_MEMORY_SEARCHES);
    },
    snapshot() {
      const now = Date.now();
      return { files: Object.fromEntries(files), searches: Object.fromEntries([...searches].filter(([, entry]) => entry.expires > now)) };
    },
  };
}

export function remoteStore(url, token) {
  const call = async (body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`font store HTTP ${response.status}`);
    return response.json();
  };
  return {
    async get({ files = [], searches = [] } = {}) {
      const data = await call({ action: 'get', files, searches });
      return { files: new Map(Object.entries(data.files ?? {})), searches: new Map(Object.entries(data.searches ?? {})) };
    },
    async put({ files = [], searches = [] } = {}) {
      await call({ action: 'put', files, searches });
    },
  };
}

export function layeredStore(local, remote) {
  return {
    async get(keys = {}) {
      const found = await local.get(keys);
      const files = (keys.files ?? []).filter((id) => !found.files.has(id));
      const searches = (keys.searches ?? []).filter((query) => !found.searches.has(query));
      if (files.length === 0 && searches.length === 0) return found;
      const fetched = await remote.get({ files, searches }).catch((error) => {
        console.warn(`font store read failed: ${error.message}`);
        return null;
      });
      if (!fetched) return found;
      fetched.files.forEach((meta, id) => found.files.set(id, meta));
      fetched.searches.forEach((data, query) => found.searches.set(query, data));
      await local.put({
        files: [...fetched.files].map(([id, meta]) => ({ id, meta })),
        searches: [...fetched.searches].map(([query, data]) => ({ query, data, ttl: LOCAL_TTL_MS })),
      });
      return found;
    },
    async put(entries = {}) {
      await local.put(entries);
      await remote.put(entries).catch((error) => console.warn(`font store write failed: ${error.message}`));
    },
  };
}

let current = process.env.FONT_STORE_URL && process.env.FONT_STORE_TOKEN
  ? layeredStore(memoryStore(), remoteStore(process.env.FONT_STORE_URL, process.env.FONT_STORE_TOKEN))
  : memoryStore();

export function fontStore() {
  return current;
}

export function setFontStore(store) {
  current = store;
}
