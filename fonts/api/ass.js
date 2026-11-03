import { embedFonts } from '../lib/embed.js';

// GET /ass/{apiKey}/{anilistId}/{releaseId}.ass (rewritten to /api/ass?...)
// Returns the subtitle with the fonts it uses embedded; falls back to the original file on any font problem.
const API_BASE = 'https://subs.azureillusion.ovh/api/public/v1';
const USER_AGENT = 'Nuvio-Addon-AzureIllusion-Fonts/0.1.0';
const MAX_FONT_BYTES = 40 * 1024 * 1024;
const PACKAGES_TTL_MS = 30 * 60 * 1000;
const FONT_CACHE_LIMIT = 200;

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
function fontPath(file) {
  if (file.downloadUrl?.startsWith(`${API_BASE}/`)) return file.downloadUrl.slice(API_BASE.length);
  return `/subtitles/file?type=font&id=${encodeURIComponent(file.id)}`;
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

async function withFonts(apiKey, anilistId, releaseId, original) {
  const hasBom = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(original);

  const packages = await getPackages(apiKey, anilistId);
  const owner = packages.find((pkg) => (pkg.releases ?? []).some((release) => release.id === releaseId));
  const fontFiles = (owner?.files ?? []).filter((file) => file.type === 'FONT');
  if (fontFiles.length === 0) return { body: original, info: 'no-fonts' };

  let total = 0;
  const allowed = fontFiles.filter((file) => (total += Number(file.sizeBytes) || 0) <= MAX_FONT_BYTES);
  const fonts = await Promise.all(
    allowed.map(async (file) => ({ fileName: file.filename, bytes: await getFont(apiKey, file) })),
  );

  const result = await embedFonts(text, fonts);
  if (result.embedded.length === 0) return { body: original, info: result.skipped ?? `none-matched;missing=${result.missing.length}` };
  const encoded = new TextEncoder().encode(result.text);
  const body = hasBom ? new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]) : encoded;
  return { body, info: `embedded=${result.embedded.length};missing=${result.missing.length}` };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const apiKey = params.get('key')?.trim();
  const anilistId = params.get('anilist') ?? '';
  const releaseId = /^(.+)\.ass$/i.exec(params.get('file') ?? '')?.[1];
  if (!apiKey || !/^\d+$/.test(anilistId) || !releaseId) return new Response('Bad Request', { status: 400 });

  let original;
  try {
    const response = await apiFetch(`/subtitles/file?type=subtitle&id=${encodeURIComponent(releaseId)}`, apiKey);
    original = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return new Response(`Nie udało się pobrać napisów (${error.message}).`, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const started = Date.now();
    const { body, info } = await withFonts(apiKey, anilistId, releaseId, original);
    return subtitleResponse(body, CACHE_LONG, { 'X-Fonts': `${info};ms=${Date.now() - started}` });
  } catch (error) {
    console.warn(`fonts ${releaseId} failed: ${error.message}`);
    return subtitleResponse(original, CACHE_SHORT, { 'X-Fonts': 'error' });
  }
}
