import { cached } from './cache.js';

// Maps IMDb (season/episode follow TVDB numbering) to an anime entry and its local episode.
// Uses /redirect for the ID and the CF-cached detail endpoints, as Simkl recommends.
const SIMKL_URL = 'https://api.simkl.com';
const APP_NAME = 'azureillusion-nuvio';
const APP_VERSION = '0.1';
const SEQUENTIAL_TYPES = new Set(['tv', 'ona', 'ova']);

const CACHE_HIT_SECONDS = 7 * 24 * 3600;
const CACHE_MISS_SECONDS = 24 * 3600;
const CACHE_EPISODES_SECONDS = 12 * 3600;

function simklUrl(path, clientId, extra = {}) {
  const params = new URLSearchParams({ client_id: clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION, ...extra });
  return `${SIMKL_URL}${path}?${params}`;
}

async function simklGet(path, clientId, extra) {
  const response = await fetch(simklUrl(path, clientId, extra), { headers: { 'User-Agent': `${APP_NAME}/${APP_VERSION}` } });
  if (!response.ok) throw new Error(`Simkl ${path} HTTP ${response.status}`);
  return response.json();
}

async function redirectToSimkl(clientId, ids) {
  const response = await fetch(simklUrl('/redirect', clientId, { to: 'simkl', ...ids }), {
    redirect: 'manual',
    headers: { 'User-Agent': `${APP_NAME}/${APP_VERSION}` },
  });
  const match = /simkl\.com\/(anime|tv|movies)\/(\d+)/.exec(response.headers.get('Location') ?? '');
  return match ? { type: match[1], id: match[2] } : null;
}

function getAnime(ctx, clientId, simklId) {
  return cached(ctx, `simkl/anime/${simklId}`, () => CACHE_HIT_SECONDS, async () => {
    const data = await simklGet(`/anime/${simklId}`, clientId, { extended: 'full' });
    return {
      simklId: String(data.ids?.simkl ?? simklId),
      anilistId: data.ids?.anilist ? String(data.ids.anilist) : null,
      malId: data.ids?.mal ? String(data.ids.mal) : null,
      animeType: data.anime_type ?? null,
      tvdbSeasons: data.mapped_tvdb_seasons ?? [],
      relations: (data.relations ?? [])
        .filter((relation) => SEQUENTIAL_TYPES.has(relation.anime_type) && relation.ids?.simkl)
        .map((relation) => String(relation.ids.simkl)),
    };
  });
}

// Compact [localEpisode, tvdbSeason, tvdbEpisode] triples; long series have over a thousand episodes.
function getEpisodeMap(ctx, clientId, simklId) {
  return cached(ctx, `simkl/episodes/${simklId}`, () => CACHE_EPISODES_SECONDS, async () => {
    const episodes = await simklGet(`/anime/episodes/${simklId}`, clientId);
    return episodes
      .filter((episode) => episode.type === 'episode' && episode.episode && episode.tvdb?.season != null && episode.tvdb?.episode)
      .map((episode) => [episode.episode, episode.tvdb.season, episode.tvdb.episode]);
  });
}

async function findSeasonEntry(ctx, clientId, base, season) {
  if (base.tvdbSeasons.includes(season)) return base;
  for (const simklId of base.relations) {
    const candidate = await getAnime(ctx, clientId, simklId);
    if (candidate.tvdbSeasons.includes(season)) return candidate;
  }
  return null;
}

/**
 * Resolves `tt…` (movie) or `tt…:season:episode` to { anilistId, malId, episode }.
 * Returns null for non-anime titles or when the episode cannot be mapped unambiguously.
 */
export async function resolveImdb(ctx, clientId, imdbId, season, episode) {
  return cached(
    ctx,
    `simkl/imdb/${imdbId}/${season ?? '-'}/${episode ?? '-'}`,
    (value) => (value ? CACHE_HIT_SECONDS : CACHE_MISS_SECONDS),
    async () => {
      const target = await cached(
        ctx,
        `simkl/redirect/imdb/${imdbId}`,
        (value) => (value ? CACHE_HIT_SECONDS : CACHE_MISS_SECONDS),
        () => redirectToSimkl(clientId, { imdb: imdbId }),
      );
      if (target?.type !== 'anime') return null;

      const base = await getAnime(ctx, clientId, target.id);
      if (season === null || episode === null) return { anilistId: base.anilistId, malId: base.malId, episode: null };

      const entry = await findSeasonEntry(ctx, clientId, base, season);
      if (!entry) return null;

      const episodeMap = await getEpisodeMap(ctx, clientId, entry.simklId);
      const match = episodeMap.find(([, tvdbSeason, tvdbEpisode]) => tvdbSeason === season && tvdbEpisode === episode);
      // Without per-episode data, a single-season entry still numbers episodes the same way as TVDB.
      const localEpisode = match ? match[0] : episodeMap.length === 0 && entry.tvdbSeasons.length === 1 ? episode : null;
      if (localEpisode === null) return null;

      return { anilistId: entry.anilistId, malId: entry.malId, episode: localEpisode };
    },
  );
}
