import { cached } from './cache.js';

// Detects releases the catalogue filed under the wrong anime, e.g. "Kage-Jitsu! 2nd 01.ass"
// (a side story) listed under "Kage no Jitsuryokusha ni Naritakute! 2nd season".
// Only side stories and similar relations count: sequels and prequels share the base title
// that groups often use in file names for every season.
// AniList itself blocks Cloudflare's IPs, so its data comes from the animap.id mirror.
const ANIMAP_URL = 'https://animap.id/api/anilist';
const SIDE_RELATIONS = new Set(['SIDE_STORY', 'SPIN_OFF', 'SUMMARY', 'ALTERNATIVE', 'OTHER', 'COMPILATION']);
const CACHE_SECONDS = 7 * 24 * 3600;
const CACHE_MISS_SECONDS = 3600;

export function normalizeTitle(value) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeAll(titles) {
  return titles.filter(Boolean).map(normalizeTitle).filter(Boolean);
}

async function animapJson(path) {
  const response = await fetch(`${ANIMAP_URL}/${path}`);
  if (!response.ok) throw new Error(`animap ${path} HTTP ${response.status}`);
  return response.json();
}

/** Returns { own: string[], sideTitles: string[] } of normalized titles, or null when unavailable. */
export function getSideStoryTitles(ctx, anilistId) {
  return cached(
    ctx,
    `titles-v3/${anilistId}`,
    (value) => (value ? CACHE_SECONDS : CACHE_MISS_SECONDS),
    async () => {
      const raw = await animapJson(`${anilistId}/raw`);
      const media = raw?.data?.Media ?? raw;
      if (!media?.title) return null;
      const own = normalizeAll([media.title.romaji, media.title.english, media.title.native, ...(media.synonyms ?? [])]);
      const sideIds = (media.relations?.edges ?? [])
        .filter((edge) => SIDE_RELATIONS.has(edge.relationType) && edge.node?.type === 'ANIME' && edge.node?.id)
        .map((edge) => edge.node.id);
      const related = await Promise.all(sideIds.map((id) => animapJson(String(id)).catch(() => null)));
      const sideTitles = related
        .filter(Boolean)
        .flatMap((entry) => normalizeAll([entry.title_romaji, entry.title_english, entry.title_native, ...(entry.synonyms ?? [])]))
        // A side title that is (the start of) our own title would also match our own files.
        .filter((title) => !own.some((ownTitle) => ownTitle === title || ownTitle.startsWith(`${title} `)));
      return { own, sideTitles: [...new Set(sideTitles)] };
    },
  );
}

/** "[Demo Subs] Kage-Jitsu! 2nd 01 [BD 1080p FLAC].ass" -> "kage jitsu 2nd". */
export function releaseTitle(filename, groupName) {
  let text = filename
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[_.]+/g, ' ');
  // Everything from the episode number on: " - 01", " 01", "S02E01", "E01", "01v2".
  text = text.replace(/(^|\s)(-\s*)?(S\d+)?E?\d{1,4}(v\d)?(\s.*|$)/i, ' ');
  let title = normalizeTitle(text);
  const group = groupName ? normalizeTitle(groupName) : '';
  if (group && title.startsWith(`${group} `)) title = title.slice(group.length + 1);
  return title;
}

export function isSideStoryRelease(release, titles) {
  if (!titles || !release.filename) return false;
  const title = releaseTitle(release.filename, release.group);
  return Boolean(title) && titles.sideTitles.includes(title) && !titles.own.includes(title);
}
