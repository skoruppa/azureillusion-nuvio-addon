import { readFontInfo } from './sfnt.js';

const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_SEARCHES = 300;
const MAX_CACHED_FONTS = 100;
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const MAX_FAMILIES = 5;
const MAX_DOWNLOADS = 8;

const REGULAR = '0|0';
const STYLES = new Map([
  ['', REGULAR], ['regular', REGULAR], ['normal', REGULAR], ['book', REGULAR], ['roman', REGULAR], ['r', REGULAR],
  ['bold', '1|0'], ['bd', '1|0'], ['b', '1|0'],
  ['italic', '0|1'], ['oblique', '0|1'], ['it', '0|1'], ['i', '0|1'],
  ['bolditalic', '1|1'], ['boldoblique', '1|1'], ['italicbold', '1|1'], ['bi', '1|1'], ['z', '1|1'],
]);

const searchCache = new Map();
const fontCache = new Map();

function normalize(name) {
  return name.toLowerCase().replace(/\.(ttf|otf|ttc)$/, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function remember(cache, key, value, limit) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function search(api, query) {
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = api.search(query).then((data) => ({ items: data?.items ?? [], total: Number(data?.total) || 0 }));
  promise.catch(() => searchCache.delete(key));
  remember(searchCache, key, { promise, expires: Date.now() + SEARCH_TTL_MS }, MAX_CACHED_SEARCHES);
  return promise;
}

function candidatesFor(family, items) {
  const base = normalize(family);
  const byFile = new Map();
  for (const item of items) {
    const fileName = item.fileName ?? item.name ?? '';
    const name = normalize(fileName);
    const style = name.startsWith(base) ? STYLES.get(name.slice(base.length)) : undefined;
    if (!style || !/\.(ttf|otf|ttc)$/i.test(fileName) || !(Number(item.sizeBytes) <= MAX_FONT_BYTES)) continue;
    const key = item.sha256 ?? item.id;
    const entry = byFile.get(key) ?? { item, style, uploads: 0 };
    entry.uploads += 1;
    byFile.set(key, entry);
  }
  return [...byFile.values()];
}

function mostUploaded(candidates) {
  return candidates.sort((a, b) => b.uploads - a.uploads || Number(a.item.sizeBytes) - Number(b.item.sizeBytes))[0];
}

function pickFiles(candidates, variants) {
  const picked = new Set();
  for (const variant of variants) {
    const best = mostUploaded(candidates.filter((entry) => entry.style === variant))
      ?? mostUploaded(candidates.filter((entry) => entry.style === REGULAR));
    if (!best) return [];
    picked.add(best);
  }
  return [...picked];
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

async function lookupFamily(api, family, variants, budget) {
  const first = await search(api, family);
  let items = first.items;
  if (first.total > items.length && !candidatesFor(family, items).some((entry) => entry.style === REGULAR)) {
    items = items.concat((await search(api, `${family}.`)).items);
  }
  const files = pickFiles(candidatesFor(family, items), variants);
  if (files.length === 0 || files.length > budget.downloads) return [];
  budget.downloads -= files.length;
  const fonts = await Promise.all(files.map((entry) => download(api, entry)));
  return fonts.every((font) => readFontInfo(font.bytes).names.has(family)) ? fonts : [];
}

export async function findLibraryFonts(api, families) {
  const budget = { downloads: MAX_DOWNLOADS };
  const results = await Promise.all(families.slice(0, MAX_FAMILIES).map(({ family, variants }) =>
    lookupFamily(api, family, variants, budget).catch(() => [])));
  return results.flat();
}
