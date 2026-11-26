import { collectFontUsage, hasFontsSection } from '../lib/ass.js';
import { embedFonts, prefetchGoogleFonts } from '../lib/embed.js';
import { findLibraryFonts } from '../lib/library.js';
import { readFontInfo } from '../lib/sfnt.js';
import { fontStore } from '../lib/store.js';

// GET /ass/{apiKey}/{anilistId}/{releaseId}.ass (rewritten to /api/ass?...)
// Returns the subtitle with the fonts it uses embedded; falls back to the original file on any font problem.
const API_BASE = 'https://subs.azureillusion.ovh/api/public/v1';
const API_PATH = new URL(API_BASE).pathname;
const USER_AGENT = 'Nuvio-Addon-AzureIllusion-Fonts/0.4.2';
const MAX_FONT_BYTES = 40 * 1024 * 1024;
const PACKAGES_TTL_MS = 30 * 60 * 1000;
const FONT_CACHE_LIMIT = 200;
const MAX_UNKNOWN_DOWNLOADS = 25;
const META_VERSION = 1;

// Warm instances are reused (Fluid compute), so keep cheap in-process caches.
const packagesCache = new Map(); // anilistId -> { expires, packages }
const fontCache = new Map(); // file id -> ArrayBuffer

const CACHE_LONG = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_SHORT = 'public, max-age=300, s-maxage=300';

async function apiFetch(path, apiKey) {
  const response = await fetch(API_BASE + path, { headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${path.split('?')[0]} HTTP ${response.status}`);
  return response;
}

async function getPackages(apiKey, anilistId) {
  const cached = packagesCache.get(anilistId);
  if (cached && cached.expires > Date.now()) return cached.packages;
  const body = await (await apiFetch(`/anime/${anilistId}/subtitles`, apiKey)).json();
  const packages = body?.data?.packages ?? [];
  packagesCache.set(anilistId, { expires: Date.now() + PACKAGES_TTL_MS, packages });
  return packages;
}

// Prefer the API's own downloadUrl, but only on the API host: the request carries the user's key.
function apiPath(url) {
  if (url?.startsWith(`${API_BASE}/`)) return url.slice(API_BASE.length);
  if (url?.startsWith(`${API_PATH}/`)) return url.slice(API_PATH.length);
  return null;
}

function fontPath(file) {
  return apiPath(file.downloadUrl) ?? `/subtitles/file?type=font&id=${encodeURIComponent(file.id)}`;
}

function fontLibrary(apiKey) {
  return {
    search: async (query) => (await (await apiFetch(`/fonts?${query}`, apiKey)).json())?.data,
    download: async (item) => (await apiFetch(apiPath(item.downloadUrl) ?? `/fonts/${encodeURIComponent(item.id)}/download`, apiKey)).arrayBuffer(),
  };
}

async function getFont(apiKey, file) {
  const cached = fontCache.get(file.id);
  if (cached) return cached;
  const bytes = await (await apiFetch(fontPath(file), apiKey)).arrayBuffer();
  if (fontCache.size >= FONT_CACHE_LIMIT) fontCache.delete(fontCache.keys().next().value);
  fontCache.set(file.id, bytes);
  return bytes;
}

function subtitleResponse(body, cacheControl, extraHeaders = {}) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/x-ssa; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheControl,
      ...extraHeaders,
    },
  });
}

// The group's font files for this release with their stored name metadata. Does not need the
// subtitle, so it runs alongside its download.
async function listGroupFonts(apiKey, anilistId, releaseId) {
  const packages = await getPackages(apiKey, anilistId);
  const owner = packages.find((pkg) => (pkg.releases ?? []).some((release) => release.id === releaseId));
  // Even without group fonts, open-licensed substitutes (e.g. for Arial) may apply.
  const fontFiles = (owner?.files ?? []).filter((file) => file.type === 'FONT');
  if (fontFiles.length === 0) return [];
  const stored = (await fontStore().get({ files: fontFiles.map((file) => file.id) }).catch(() => null))?.files ?? new Map();
  return fontFiles.map((file) => {
    const meta = stored.get(file.id);
    return { file, meta: meta?.v === META_VERSION ? meta : null };
  });
}

function fontMeta(bytes) {
  try {
    const info = readFontInfo(bytes);
    return { v: META_VERSION, names: [...info.names], weight: info.weight, italic: info.italic };
  } catch {
    return { v: META_VERSION, names: [] };
  }
}

function normalizeName(name) {
  return name.toLowerCase().replace(/\.(ttf|otf|ttc)$/, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function fileNameScore(file, families) {
  const name = normalizeName(file.filename ?? '');
  let best = 2;
  for (const family of families) {
    if (!family) continue;
    if (name.startsWith(family) || family.startsWith(name)) return 0;
    if (name.includes(family) || family.includes(name)) best = 1;
  }
  return best;
}

async function loadGroupFonts(apiKey, entries, usedFamilies) {
  const isNeeded = (meta) => meta.names.some((name) => usedFamilies.has(name));
  const normalized = [...usedFamilies].map(normalizeName);
  const unknown = entries.filter((entry) => !entry.meta)
    .map((entry) => ({ entry, score: fileNameScore(entry.file, normalized) }))
    .sort((a, b) => a.score - b.score)
    .map(({ entry }) => entry);
  const probed = unknown.slice(0, MAX_UNKNOWN_DOWNLOADS);

  let total = 0;
  const wanted = [...entries.filter((entry) => entry.meta && isNeeded(entry.meta)), ...probed]
    .filter((entry) => (total += Number(entry.file.sizeBytes) || 0) <= MAX_FONT_BYTES);
  const downloaded = await Promise.all(wanted.map(async (entry) => {
    try {
      const bytes = await getFont(apiKey, entry.file);
      return { ...entry, bytes, meta: entry.meta ?? fontMeta(bytes), learned: !entry.meta };
    } catch {
      return { ...entry, failed: true };
    }
  }));

  const learned = downloaded.filter((entry) => entry.learned).map((entry) => ({ id: entry.file.id, meta: entry.meta }));
  if (learned.length > 0) await fontStore().put({ files: learned }).catch(() => {});

  const fonts = downloaded.filter((entry) => entry.bytes && isNeeded(entry.meta)).map((entry) => ({ fileName: entry.file.filename, bytes: entry.bytes }));
  const covered = new Set(downloaded.filter((entry) => entry.bytes).flatMap((entry) => entry.meta.names));
  const uncovered = [...usedFamilies].some((family) => !covered.has(family));
  const partial = downloaded.some((entry) => entry.failed) || (unknown.length > probed.length && uncovered);
  return { fonts, partial, files: entries.length, unknown: unknown.length };
}

async function withFonts(original, fonts, apiKey) {
  const hasBom = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(original);

  const library = fontLibrary(apiKey);
  const result = await embedFonts(text, fonts, { findFonts: (families) => findLibraryFonts(library, families) });
  if (result.embedded.length === 0) return { body: original, info: result.skipped ?? `none-matched;missing=${result.missing.length}` };
  const encoded = new TextEncoder().encode(result.text);
  const body = hasBom ? new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]) : encoded;
  return { body, info: `embedded=${result.embedded.length};substituted=${result.substituted.length};google=${result.google.length};library=${result.library.length};missing=${result.missing.length}` };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const apiKey = params.get('key')?.trim();
  const anilistId = params.get('anilist') ?? '';
  const releaseId = /^(.+)\.ass$/i.exec(params.get('file') ?? '')?.[1];
  if (!apiKey || !/^\d+$/.test(anilistId) || !releaseId) return new Response('Bad Request', { status: 400 });

  const started = Date.now();
  // Settled promise: a font failure must not hide the subtitle download error, or the reverse.
  const groupFonts = listGroupFonts(apiKey, anilistId, releaseId).then((entries) => ({ entries }), (error) => ({ error }));
  let original;
  try {
    const response = await apiFetch(`/subtitles/file?type=subtitle&id=${encodeURIComponent(releaseId)}`, apiKey);
    original = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return new Response(`Nie udało się pobrać napisów (${error.message}).`, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    // Look up Google Fonts while the group's fonts are downloading.
    const text = new TextDecoder().decode(original);
    const embedded = hasFontsSection(text);
    if (!embedded) prefetchGoogleFonts(text);
    const listed = await groupFonts;
    if (listed.error) throw listed.error;
    const group = embedded
      ? { fonts: [], partial: false, files: listed.entries.length }
      : await loadGroupFonts(apiKey, listed.entries, new Set(collectFontUsage(text).keys()));
    const { body, info } = await withFonts(original, group.fonts, apiKey);
    const groupInfo = `group=${group.fonts.length}/${group.files}${group.partial ? ';partial' : ''}`;
    return subtitleResponse(body, group.partial ? CACHE_SHORT : CACHE_LONG, { 'X-Fonts': `${info};${groupInfo};ms=${Date.now() - started}` });
  } catch (error) {
    console.warn(`fonts ${releaseId} failed: ${error.message}`);
    return subtitleResponse(original, CACHE_SHORT, { 'X-Fonts': 'error' });
  }
}
