import { cached } from './cache.js';
import { configurePage } from './configure.js';
import { resolveAniListViaSimkl, resolveImdb } from './simkl.js';
import { getSideStoryTitles, isSideStoryRelease, normalizeTitle } from './titles.js';

const API_BASE = 'https://subs.azureillusion.ovh';
const ANIMAP_BASE = 'https://animap.id';
const LOGO_URL = `${API_BASE}/branding/azureillusion-logo-v3.png`;
const ADDON_VERSION = '0.3.0';
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

// animap first (no limits), then Simkl, and the AzureIllusion API last: it spends the user's rate limit.
async function resolveAniListId(ctx, env, apiKey, prefix, id) {
  if (prefix === 'anilist') return id;
  const result = await cached(
    ctx,
    `resolve/${prefix}/${id}`,
    (value) => (value.anilistId ? CACHE_RESOLVE_SECONDS : CACHE_RESOLVE_MISS_SECONDS),
    async () => {
      const sources = [
        ['animap', () => resolveViaAnimap(prefix, id)],
        ['simkl', () => (env.SIMKL_CLIENT_ID ? resolveAniListViaSimkl(ctx, env.SIMKL_CLIENT_ID, prefix, id) : null)],
      ];
      for (const [name, resolve] of sources) {
        try {
          const anilistId = await resolve();
          if (anilistId) return { anilistId: String(anilistId) };
        } catch (error) {
          console.warn(`${name} ${prefix}:${id} failed: ${error.message}`);
        }
      }
      return { anilistId: await resolveViaApi(apiKey, prefix, id) };
    },
  );
  return result.anilistId;
}

async function searchReleases(ctx, apiKey, anilistId, episode) {
  const params = new URLSearchParams({ anilistId, format: 'ASS,SRT', limit: '100' });
  if (episode !== null) params.set('episode', String(episode));
  return cached(
    ctx,
    `search-v2/${anilistId}/${episode ?? '-'}`,
    () => CACHE_SEARCH_SECONDS,
    async () => {
      const data = await apiGet(`/api/public/v1/subtitles/search?${params}`, apiKey);
      return (data.releases ?? []).map((release) => ({
        id: release.id,
        language: release.language,
        format: release.format,
        group: release.group?.name ?? null,
        groupSlug: release.group?.slug ?? null,
        filename: release.filename ?? '',
        sizeBytes: Number(release.sizeBytes) || 0,
        publishedAt: release.publishedAt ?? null,
      }));
    },
  );
}

// Per-group translation progress for the series ("12/12"), keyed by release id and group slug.
async function getGroupProgress(ctx, apiKey, anilistId) {
  return cached(ctx, `progress/${anilistId}`, () => CACHE_SEARCH_SECONDS, async () => {
    const data = await apiGet(`/api/public/v1/anime/${anilistId}/subtitles`, apiKey);
    const byRelease = {};
    const byGroup = {};
    for (const pkg of data.packages ?? []) {
      const progress = {
        translated: Number(pkg.translatedEpisodes) || 0,
        total: Number(pkg.totalEpisodes) || 0,
        percent: Number(pkg.progressPercent) || 0,
      };
      if (pkg.group?.slug && !byGroup[pkg.group.slug]) byGroup[pkg.group.slug] = progress;
      for (const release of pkg.releases ?? []) byRelease[release.id] = progress;
    }
    return { byRelease, byGroup };
  });
}

function progressFor(progress, release) {
  return progress?.byRelease[release.id] ?? (release.groupSlug ? progress?.byGroup[release.groupSlug] : null) ?? null;
}

// Video source the release is synced to, as named in its filename.
function releaseSource(filename) {
  // Tokens are separated by spaces, dots, brackets or underscores ("_BD_1080p_", "[WEB 1080p]").
  const has = (pattern) => new RegExp(`(^|[^a-z0-9])(${pattern})([^a-z0-9]|$)`, 'i').test(filename);
  if (has('BD|BDRip|Blu-?Ray|BDMV')) return 'BD';
  if (has('WEB|WEB-?DL|WEB-?Rip|CR|AMZN|NF|SubsPlease|Erai-raws')) return 'WEB';
  if (has('DVD|DVDRip')) return 'DVD';
  if (has('HDTV|TV')) return 'TV';
  return null;
}

function groupKey(release) {
  return `${release.groupSlug ?? release.group}|${release.format}`;
}

// Nuvio shows the subtitle id as its label, so keep it readable and unique.
function subtitleLabels(releases, progress) {
  const counts = new Map();
  releases.forEach((release) => counts.set(groupKey(release), (counts.get(groupKey(release)) ?? 0) + 1));
  const used = new Set();
  return releases.map((release) => {
    const group = (release.group ?? 'AzureIllusion').slice(0, 60);
    const groupProgress = progressFor(progress, release);
    const episodes = groupProgress
      ? (groupProgress.total ? ` ${groupProgress.translated}/${groupProgress.total}` : ` ${groupProgress.translated} odc.`)
      : '';
    const source = releaseSource(release.filename ?? '');
    let label = `${group} [${release.format.toUpperCase()}]${episodes}${source ? ` ${source}` : ''}`;
    // Several releases of one group for the same episode: tell them apart by publication date.
    if (counts.get(groupKey(release)) > 1 && release.publishedAt) {
      const date = new Date(release.publishedAt);
      label += ` (${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')})`;
    }
    for (let index = 2; used.has(label); index++) label = label.replace(/( #\d+)?$/, ` #${index}`);
    used.add(label);
    return label;
  });
}

// Complete translations first, otherwise API order of groups. Within a group the larger file comes
// first: the catalogue sometimes files short side-story scripts under the main series' episodes.
// What the played file says about its timing: the raw release group ("[SubsPlease] ...") and the source.
function videoHints(filename) {
  if (!filename) return null;
  const group = /^\s*\[([^\]]+)\]/.exec(filename)?.[1];
  return { group: group ? normalizeTitle(group) : null, source: releaseSource(filename) };
}

// Subtitles made for the same raw release (+2) or at least the same source (+1) are likely in sync.
function matchScore(release, hints) {
  if (!hints || !release.filename) return 0;
  let score = 0;
  if (hints.group && ` ${normalizeTitle(release.filename)} `.includes(` ${hints.group} `)) score += 2;
  if (hints.source && releaseSource(release.filename) === hints.source) score += 1;
  return score;
}

function orderReleases(releases, progress, hints) {
  const groups = new Map();
  for (const release of releases) {
    if (!groups.has(groupKey(release))) groups.set(groupKey(release), []);
    groups.get(groupKey(release)).push(release);
  }
  const ordered = [...groups.values()].flatMap((items) => [...items].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)));
  const complete = ordered.filter((release) => progressFor(progress, release)?.percent >= 100);
  const byProgress = [...complete, ...ordered.filter((release) => !complete.includes(release))];
  // Releases matching the played file come first, even from groups that are not finished yet.
  return byProgress
    .map((release, index) => ({ release, index, score: matchScore(release, hints) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.release);
}

async function resolveTarget(ctx, env, apiKey, parsed) {
  if (parsed.prefix !== 'imdb') {
    return { anilistId: await resolveAniListId(ctx, env, apiKey, parsed.prefix, parsed.id), episode: parsed.episode };
  }
  if (!env.SIMKL_CLIENT_ID) return null;
  const mapped = await resolveImdb(ctx, env.SIMKL_CLIENT_ID, parsed.id, parsed.season, parsed.episode);
  if (!mapped) return null;
  const anilistId = mapped.anilistId ?? (mapped.malId ? await resolveAniListId(ctx, env, apiKey, 'mal', mapped.malId) : null);
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

async function handleSubtitles(request, ctx, env, apiKey, contentId, withFonts, videoFilename) {
  const parsed = parseContentId(contentId);
  if (!parsed) return json({ subtitles: [] }, { maxAge: 86400 });

  try {
    const target = await resolveTarget(ctx, env, apiKey, parsed);
    if (!target?.anilistId) return json({ subtitles: [] }, { maxAge: 3600 });

    // Progress and titles only improve the list; never fail the whole list because of them.
    const optional = (promise, what) => promise.catch((error) => {
      console.warn(`${what} ${target.anilistId} failed: ${error.message}`);
      return null;
    });
    const [releases, progress, titles] = await Promise.all([
      searchReleases(ctx, apiKey, target.anilistId, target.episode),
      optional(getGroupProgress(ctx, apiKey, target.anilistId), 'progress'),
      optional(getSideStoryTitles(ctx, target.anilistId), 'titles'),
    ]);
    const origin = new URL(request.url).origin;
    const relevant = releases.filter((release) => !isSideStoryRelease(release, titles));
    const ordered = orderReleases(relevant, progress, videoHints(videoFilename));
    const labels = subtitleLabels(ordered, progress);
    const subtitles = ordered.map((release, index) => ({
      id: labels[index],
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
      return handleSubtitles(request, ctx, env, apiKey, rest[1].replace(/\.json$/, ''), withFonts, extra.get('filename'));
    }

    if (resource === 'sub' && rest.length === 1) {
      const match = /^(.+)\.(ass|ssa|srt)$/i.exec(rest[0]);
      if (match) return handleSubtitleFile(apiKey, match[1], match[2].toLowerCase());
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};
