// Open-licensed Google Fonts (OFL/Apache/UFL) for families a script uses but nobody uploaded,
// e.g. "Signika SemiBold" or a group's "Lato Black PL". The css2 API serves static instances of
// any weight, also for variable families, as plain TTF to clients that do not accept WOFF2.
const CSS_URL = 'https://fonts.googleapis.com/css2';
const USER_AGENT = 'Mozilla/4.0'; // makes css2 answer with TrueType URLs
const MAX_FONT_BYTES = 15 * 1024 * 1024;
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_INSTANCES = 100;

const WEIGHTS = new Map([
  ['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200], ['light', 300],
  ['regular', 400], ['normal', 400], ['book', 400], ['medium', 500], ['semibold', 600], ['demibold', 600],
  ['bold', 700], ['extrabold', 800], ['ultrabold', 800], ['black', 900], ['heavy', 900],
]);
const WEIGHT_NAMES = new Map([[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'],
  [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']]);

const fontCache = new Map(); // css2 query -> { promise, missUntil? }

/**
 * Splits a family named in a script into a Google Fonts family and style:
 * "Signika SemiBold" -> { family: "Signika", weight: 600 }, "Lato Black PL" -> { family: "Lato", weight: 900 }.
 * Words are tried from the end, so multi-word families ("Libre Franklin SemiBold") keep their name.
 */
export function parseFamily(name) {
  // Groups add Polish glyphs and a "PL" tag to fonts; the Google originals already cover Polish.
  let words = name.trim().replace(/^@/, '').split(/\s+/).filter((word) => !/^[[(]?PL[\])]?$/i.test(word));
  let weight = null;
  let italic = false;
  for (;;) {
    const last = words.at(-1)?.toLowerCase().replace(/-/g, '');
    if (words.length > 1 && last === 'italic') {
      italic = true;
      words = words.slice(0, -1);
    } else if (words.length > 1 && WEIGHTS.has(last) && weight === null) {
      weight = WEIGHTS.get(last);
      words = words.slice(0, -1);
    } else {
      break;
    }
  }
  return { family: words.join(' '), weight, italic };
}

/** The family name a script should use for the downloaded instance, e.g. "Lato Black". */
export function googleFamilyName({ family, weight }) {
  return weight && weight !== 400 ? `${family} ${WEIGHT_NAMES.get(weight)}` : family;
}

async function downloadInstance(query) {
  const css = await fetch(`${CSS_URL}?family=${query}`, { headers: { 'User-Agent': USER_AGENT } });
  const url = css.ok ? /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(await css.text())?.[1] : null;
  if (!url) return null;
  const response = await fetch(url);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!response.ok || length > MAX_FONT_BYTES) return null;
  const bytes = await response.arrayBuffer();
  return bytes.byteLength > MAX_FONT_BYTES ? null : bytes;
}

// Caches the promise, so parallel requests for one instance share a single download.
function fetchInstance(family, weight, italic) {
  const query = `${encodeURIComponent(family)}:ital,wght@${italic ? 1 : 0},${weight}`;
  const cached = fontCache.get(query);
  if (cached && !(cached.missUntil <= Date.now())) return cached.promise;
  const promise = downloadInstance(query).catch(() => null).then((bytes) => {
    if (!bytes) fontCache.set(query, { promise, missUntil: Date.now() + MISS_TTL_MS });
    return bytes;
  });
  if (fontCache.size >= MAX_CACHED_INSTANCES) fontCache.delete(fontCache.keys().next().value);
  fontCache.set(query, { promise });
  return promise;
}

/**
 * Downloads the instances a missing family needs, one per used bold/italic variant.
 * Returns { name, fonts: [{ fileName, bytes }] } or null when Google Fonts does not have it.
 */
export async function loadGoogleFamily(scriptFamily, variants) {
  const parsed = parseFamily(scriptFamily);
  if (!parsed.family) return null;
  const downloads = await Promise.all(variants.map(async (variant) => {
    const [bold, italic] = variant.split('|').map((value) => value === '1');
    const weight = parsed.weight ?? (bold ? 700 : 400);
    const wantsItalic = parsed.italic || italic;
    const bytes = await fetchInstance(parsed.family, weight, wantsItalic)
      ?? (wantsItalic ? await fetchInstance(parsed.family, weight, false) : null)
      ?? (weight !== 400 ? await fetchInstance(parsed.family, 400, false) : null);
    return bytes && { fileName: `${parsed.family.replace(/\s+/g, '')}-${weight}${wantsItalic ? 'i' : ''}.ttf`, bytes };
  }));
  // Variants that fell back to the same instance share one file.
  const fonts = downloads.filter((font, index) => font && downloads.findIndex((other) => other?.bytes === font.bytes) === index);
  return fonts.length ? { name: googleFamilyName(parsed), fonts } : null;
}
