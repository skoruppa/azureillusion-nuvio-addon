import { readFontInfo } from './sfnt.js';
import { fontStore } from './store.js';

const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const STORED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORED_EMPTY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_SEARCHES = 300;
const MAX_CACHED_FONTS = 100;
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const MAX_FAMILIES = 5;
const MAX_DOWNLOADS = 8;
const MAX_ATTEMPTS = 2;
const CLOSE_MATCH = 100;

const searchCache = new Map();
const fontCache = new Map();

function remember(cache, key, value, limit) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function trimItem(item) {
  const face = item.faces?.[0];
  return {
    id: item.id,
    sha256: item.sha256,
    fileName: item.fileName ?? item.name,
    sizeBytes: item.sizeBytes,
    downloadUrl: item.downloadUrl,
    families: item.families,
    faces: face ? [{ family: face.family, families: face.families, fullName: face.fullName, weight: face.weight, italic: face.italic }] : [],
  };
}

function queryFor(filters) {
  return new URLSearchParams(filters).toString();
}

async function storedOrFetched(api, query) {
  const stored = (await fontStore().get({ searches: [query] }).catch(() => null))?.searches.get(query);
  if (stored) return stored;
  const data = await api.search(query);
  const result = { items: (data?.items ?? []).map(trimItem), total: Number(data?.total) || 0 };
  await fontStore().put({ searches: [{ query, data: result, ttl: result.items.length ? STORED_TTL_MS : STORED_EMPTY_TTL_MS }] }).catch(() => {});
  return result;
}

function search(api, filters) {
  const query = queryFor(filters);
  const cached = searchCache.get(query);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = storedOrFetched(api, query);
  promise.catch(() => searchCache.delete(query));
  remember(searchCache, query, { promise, expires: Date.now() + SEARCH_TTL_MS }, MAX_CACHED_SEARCHES);
  return promise;
}

async function preloadSearches(queries) {
  const missing = queries.filter((query) => !(searchCache.get(query)?.expires > Date.now()));
  if (missing.length === 0) return;
  const stored = (await fontStore().get({ searches: missing }).catch(() => null))?.searches;
  stored?.forEach((data, query) => remember(searchCache, query, { promise: Promise.resolve(data), expires: Date.now() + SEARCH_TTL_MS }, MAX_CACHED_SEARCHES));
}

function facesFor(family, items) {
  const byFile = new Map();
  for (const item of items) {
    const face = item.faces?.[0];
    const fullName = face?.fullName?.toLowerCase() ?? '';
    const names = (face?.families ?? item.families ?? []).map((name) => name.toLowerCase());
    if (!face || !(names.includes(family) || fullName === family)) continue;
    if (!/\.(ttf|otf|ttc)$/i.test(item.fileName ?? '') || !(Number(item.sizeBytes) <= MAX_FONT_BYTES)) continue;
    const key = item.sha256 ?? item.id;
    const exact = fullName === family || face.family?.toLowerCase() === family;
    const entry = byFile.get(key) ?? {
      item,
      weight: Number(face.weight) || 400,
      italic: face.italic === true,
      canonical: exact ? 0 : fullName.startsWith(family) ? 1 : 2,
      uploads: 0,
    };
    entry.uploads += 1;
    byFile.set(key, entry);
  }
  return [...byFile.values()];
}

function variantScore(face, variant) {
  const [bold, italic] = variant.split('|').map((value) => value === '1');
  const slant = face.italic === italic ? 0 : face.italic ? 2000 : 1000;
  return Math.abs(face.weight - (bold ? 700 : 400)) + slant + (face.canonical === 2 ? 5000 : 0);
}

function bestFace(faces, variant) {
  return faces.reduce((best, face) => {
    if (!best) return face;
    const difference = variantScore(face, variant) - variantScore(best, variant) || face.canonical - best.canonical;
    if (difference !== 0) return difference < 0 ? face : best;
    return face.uploads > best.uploads || (face.uploads === best.uploads && Number(face.item.sizeBytes) < Number(best.item.sizeBytes)) ? face : best;
  }, null);
}

async function familyFaces(api, family, variants) {
  const first = await search(api, { family });
  let faces = facesFor(family, first.items);
  if (first.total <= first.items.length) return faces;
  for (const variant of variants) {
    const best = bestFace(faces, variant);
    if (best && variantScore(best, variant) < CLOSE_MATCH) continue;
    const [bold, italic] = variant.split('|').map((value) => value === '1');
    const page = await search(api, { family, weight: bold ? '700' : '400', italic: String(italic) });
    faces = faces.concat(facesFor(family, page.items));
  }
  return faces;
}

async function download(api, entry) {
  const key = entry.item.sha256 ?? entry.item.id;
  let promise = fontCache.get(key);
  if (!promise) {
    promise = api.download(entry.item);
    promise.catch(() => fontCache.delete(key));
    remember(fontCache, key, promise, MAX_CACHED_FONTS);
  }
  return { fileName: entry.item.fileName, bytes: await promise };
}

function hasFamily(font, family) {
  try {
    return readFontInfo(font.bytes).names.has(family);
  } catch {
    return false;
  }
}

async function lookupFamily(api, family, variants, budget) {
  const faces = await familyFaces(api, family, variants);
  const accepted = new Map();
  const rejected = new Set();
  for (const variant of variants) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const best = bestFace(faces.filter((face) => !rejected.has(face)), variant);
      if (!best || accepted.has(best) || budget.downloads === 0) break;
      budget.downloads -= 1;
      const font = await download(api, best);
      if (hasFamily(font, family)) {
        accepted.set(best, font);
        break;
      }
      rejected.add(best);
    }
  }
  return [...accepted.values()];
}

export async function findLibraryFonts(api, families) {
  const budget = { downloads: MAX_DOWNLOADS };
  await preloadSearches(families.slice(0, MAX_FAMILIES).map(({ family }) => queryFor({ family })));
  const results = await Promise.all(families.slice(0, MAX_FAMILIES).map(({ family, variants }) =>
    lookupFamily(api, family, variants, budget).catch(() => [])));
  return results.flat();
}
