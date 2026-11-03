import { cached } from './cache.js';
import { configurePage } from './configure.js';
import { resolveImdb } from './simkl.js';

const API_BASE = 'https://subs.azureillusion.ovh';
const ANIMAP_BASE = 'https://animap.id';
const LOGO_URL = `${API_BASE}/branding/azureillusion-logo-v3.png`;
const ADDON_VERSION = '0.1.0';
const USER_AGENT = `Nuvio-Addon-AzureIllusion/${ADDON_VERSION}`;
const ID_PREFIXES = ['kitsu:', 'mal:', 'anilist:'];
const IMDB_PREFIX = 'tt';
const API_IDENTIFIER_FILTERS = { kitsu: 'kitsuId', mal: 'malId' };
const RESERVED_SEGMENTS = new Set(['configure', 'manifest.json', 'api']);

const CACHE_RESOLVE_SECONDS = 7 * 24 * 3600;
const CACHE_RESOLVE_MISS_SECONDS = 6 * 3600;
const CACHE_SEARCH_SECONDS = 30 * 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const LANGUAGE_CODES = {
  pl: 'pol', pl2: 'pol', en: 'eng', ja: 'jpn', de: 'deu', fr: 'fra',
  es: 'spa', it: 'ita', pt: 'por', uk: 'ukr', ru: 'rus',
};

const SUBTITLE_CONTENT_TYPES = {
  ass: 'text/x-ssa; charset=utf-8',
  ssa: 'text/x-ssa; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
};

function buildManifest(configured, env) {
  return {
    id: 'pl.skoruppa.azureillusion',
    version: ADDON_VERSION,
    name: 'AzureIllusion Napisy',
    description: 'Polskie napisy do anime z AzureIllusion. Wymaga własnego klucza API.',
    logo: LOGO_URL,
    resources: ['subtitles'],
    types: ['anime', 'series', 'movie'],
    idPrefixes: env.SIMKL_CLIENT_ID ? [...ID_PREFIXES, IMDB_PREFIX] : ID_PREFIXES,
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: !configured,
    },
  };
}

function json(data, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

function html(body) {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function apiGet(path, apiKey) {
  const response = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  let envelope = null;
  try {
    envelope = await response.json();
  } catch {
    // Non-JSON error page; handled below.
  }
  if (!response.ok || envelope?.ok !== true) {
    throw new ApiError(envelope?.error?.message ?? `API HTTP ${response.status}`, response.status);
  }
  return envelope.data;
}

function parseContentId(contentId) {
  const parts = contentId.split(':');
  if (/^tt\d+$/.test(parts[0])) {
    const [season, episode] = parts.length === 3 ? [Number(parts[1]), Number(parts[2])] : [null, null];
    if (parts.length === 3 && !(Number.isInteger(season) && Number.isInteger(episode) && season > 0 && episode > 0)) return null;
    return { prefix: 'imdb', id: parts[0], season, episode };
  }
  const [prefix, id] = parts;
  if (!['kitsu', 'mal', 'anilist'].includes(prefix) || !/^\d+$/.test(id ?? '')) return null;
  const episode = parts.length >= 3 ? Number(parts[parts.length - 1]) : null;
  return { prefix, id, episode: Number.isFinite(episode) && episode > 0 ? episode : null };
}

// animap.id has no rate limits, so it spares the user's 60 requests/minute API budget.
async function resolveViaAnimap(prefix, id) {
  const response = await fetch(`${ANIMAP_BASE}/api/v1/map/${prefix}/${id}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  const entry = await response.json();
  const ids = new Set(
    (entry.sources ?? [])
      .map((source) => /^https:\/\/anilist\.co\/anime\/(\d+)$/.exec(source)?.[1])
      .filter(Boolean),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

async function resolveViaApi(apiKey, prefix, id) {
  const filter = API_IDENTIFIER_FILTERS[prefix];
  const page = await apiGet(`/api/public/v1/anime?${filter}=${id}&limit=100`, apiKey);
  // Older API versions ignore unknown filters, so accept only one verified exact match.
  const exact = (page.items ?? []).filter((item) => String(item[filter] ?? '') === id);
  return page.total === 1 && exact.length === 1 ? exact[0].anilistId ?? null : null;
}

async function resolveAniListId(ctx, apiKey, prefix, id) {
  if (prefix === 'anilist') return id;
  const result = await cached(
    ctx,
    `resolve/${prefix}/${id}`,
    (value) => (value.anilistId ? CACHE_RESOLVE_SECONDS : CACHE_RESOLVE_MISS_SECONDS),
    async () => {
      let anilistId = null;
      try {
        anilistId = await resolveViaAnimap(prefix, id);
      } catch (error) {
        console.warn(`animap ${prefix}:${id} failed: ${error.message}`);
      }
      return { anilistId: anilistId ?? (await resolveViaApi(apiKey, prefix, id)) };
    },
  );
  return result.anilistId;
}

async function searchReleases(ctx, apiKey, anilistId, episode) {
  const params = new URLSearchParams({ anilistId, format: 'ASS,SRT', limit: '100' });
  if (episode !== null) params.set('episode', String(episode));
  return cached(
    ctx,
    `search/${anilistId}/${episode ?? '-'}`,
    () => CACHE_SEARCH_SECONDS,
    async () => {
      const data = await apiGet(`/api/public/v1/subtitles/search?${params}`, apiKey);
      return (data.releases ?? []).map((release) => ({
        id: release.id,
        language: release.language,
        format: release.format,
        group: release.group?.name ?? null,
      }));
    },
  );
}

// Nuvio shows the subtitle id as its label, so keep it readable, unique and short.
function subtitleLabel(release) {
  const group = (release.group ?? 'AzureIllusion').slice(0, 60);
  return `${group} [${release.format.toUpperCase()}] #${release.id.slice(-6)}`;
}

async function resolveTarget(ctx, env, apiKey, parsed) {
  if (parsed.prefix !== 'imdb') {
    return { anilistId: await resolveAniListId(ctx, apiKey, parsed.prefix, parsed.id), episode: parsed.episode };
  }
  if (!env.SIMKL_CLIENT_ID) return null;
  const mapped = await resolveImdb(ctx, env.SIMKL_CLIENT_ID, parsed.id, parsed.season, parsed.episode);
  if (!mapped) return null;
  const anilistId = mapped.anilistId ?? (mapped.malId ? await resolveAniListId(ctx, apiKey, 'mal', mapped.malId) : null);
  return { anilistId, episode: mapped.episode };
}

// With fonts enabled, ASS files go through the Vercel function that embeds subsetted fonts;
// everything else (and every file when FONTS_BASE_URL is not configured) is proxied here.
function subtitleFileUrl(origin, env, apiKey, anilistId, release, withFonts) {
  const key = encodeURIComponent(apiKey);
  const releaseId = encodeURIComponent(release.id);
  const extension = release.format.toLowerCase();
  if (withFonts && extension === 'ass' && env.FONTS_BASE_URL) {
    return `${env.FONTS_BASE_URL.replace(/\/$/, '')}/ass/${key}/${anilistId}/${releaseId}.ass`;
  }
  return `${origin}/${key}/sub/${releaseId}.${extension}`;
}

async function handleSubtitles(request, ctx, env, apiKey, contentId, withFonts) {
  const parsed = parseContentId(contentId);
  if (!parsed) return json({ subtitles: [] }, { maxAge: 86400 });

  try {
    const target = await resolveTarget(ctx, env, apiKey, parsed);
    if (!target?.anilistId) return json({ subtitles: [] }, { maxAge: 3600 });

    const releases = await searchReleases(ctx, apiKey, target.anilistId, target.episode);
    const origin = new URL(request.url).origin;
    const subtitles = releases.map((release) => ({
      id: subtitleLabel(release),
      url: subtitleFileUrl(origin, env, apiKey, target.anilistId, release, withFonts),
      lang: LANGUAGE_CODES[release.language?.toLowerCase()] ?? release.language ?? 'pol',
    }));
    return json({ subtitles }, { maxAge: CACHE_SEARCH_SECONDS });
  } catch (error) {
    console.warn(`subtitles ${contentId} failed: ${error.message}`);
    return json({ subtitles: [] }, { maxAge: 60 });
  }
}

async function handleSubtitleFile(apiKey, releaseId, extension) {
  const upstream = await fetch(
    `${API_BASE}/api/public/v1/subtitles/file?type=subtitle&id=${encodeURIComponent(releaseId)}`,
    { headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': USER_AGENT } },
  );
  if (!upstream.ok) {
    return new Response(`Nie udało się pobrać napisów (HTTP ${upstream.status}).`, {
      status: upstream.status === 404 ? 404 : 502,
      headers: CORS_HEADERS,
    });
  }
  return new Response(upstream.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': SUBTITLE_CONTENT_TYPES[extension] ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

async function handleKeyCheck(request) {
  let key = '';
  try {
    key = String((await request.json())?.key ?? '').trim();
  } catch {
    // Treated as a missing key.
  }
  if (!key) return json({ ok: false, message: 'Podaj klucz API.' }, { status: 400 });
  try {
    await apiGet('/api/public/v1/health', key);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: error.status === 401 ? 'Nieprawidłowy klucz API.' : error.message });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    let segments;
    try {
      segments = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && segments.join('/') === 'api/check') return handleKeyCheck(request);
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

    if (segments.length === 0 || (segments.length === 1 && segments[0] === 'configure')) {
      return html(configurePage(ADDON_VERSION));
    }
    if (segments.length === 1 && segments[0] === 'manifest.json') return json(buildManifest(false, env), { maxAge: 3600 });

    // Everything else is /{apiKey}/... or /{apiKey}/fonts/... (embed fonts into ASS files).
    const [rawKey, ...afterKey] = segments;
    const apiKey = rawKey.trim();
    if (!apiKey || RESERVED_SEGMENTS.has(apiKey)) return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    const withFonts = afterKey[0] === 'fonts';
    const [resource, ...rest] = withFonts ? afterKey.slice(1) : afterKey;

    if (resource === 'configure' && rest.length === 0) return html(configurePage(ADDON_VERSION));
    if (resource === 'manifest.json' && rest.length === 0) return json(buildManifest(true, env), { maxAge: 3600 });

    // /{key}/subtitles/{type}/{id}.json or /{key}/subtitles/{type}/{id}/{extra}.json
    if (resource === 'subtitles' && (rest.length === 2 || rest.length === 3)) {
      // Streams from the Docchi addon have burned-in Polish subtitles; their filenames end with .docc.
      const extra = new URLSearchParams(rest.length === 3 ? rest[2].replace(/\.json$/, '') : new URL(request.url).search);
      if (extra.get('filename')?.endsWith('.docc')) return json({ subtitles: [] }, { maxAge: 86400 });
      return handleSubtitles(request, ctx, env, apiKey, rest[1].replace(/\.json$/, ''), withFonts);
    }

    if (resource === 'sub' && rest.length === 1) {
      const match = /^(.+)\.(ass|ssa|srt)$/i.exec(rest[0]);
      if (match) return handleSubtitleFile(apiKey, match[1], match[2].toLowerCase());
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};
