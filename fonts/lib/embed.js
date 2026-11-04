import { collectFontUsage, hasFontsSection, insertFontsSection, renameFontFamilies } from './ass.js';
import { readFontInfo } from './sfnt.js';
import { subsetFont } from './subset.js';
import { loadSubstituteFonts, substitutesFor } from './substitutes.js';
import { loadGoogleFamily, parseFamily } from './googlefonts.js';

function variantScore(font, bold, italic) {
  return Math.abs(font.weight - (bold ? 700 : 400)) + (font.italic === italic ? 0 : 1000);
}

function safeFileName(family, index, extension) {
  return `${family.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'font'}_${index}${extension}`;
}

function readCandidates(fonts) {
  return fonts.flatMap((font) => {
    try {
      return [{ ...font, ...readFontInfo(font.bytes) }];
    } catch {
      return [];
    }
  });
}

// Picks the font files covering each used family and variant: { chosen, missing }.
function matchFonts(usage, candidates) {
  const chosen = new Map(); // candidate -> Set<codepoint>
  const missing = [];
  for (const [family, { chars, variants }] of usage) {
    const matches = candidates.filter((font) => font.names.has(family));
    if (matches.length === 0) {
      missing.push(family);
      continue;
    }
    // One file per requested bold/italic combination, like libass' own font selection.
    for (const variant of variants) {
      const [bold, italic] = variant.split('|').map((value) => value === '1');
      const best = matches.reduce((a, b) => (variantScore(b, bold, italic) < variantScore(a, bold, italic) ? b : a));
      const set = chosen.get(best) ?? new Set();
      chars.forEach((codepoint) => set.add(codepoint));
      chosen.set(best, set);
    }
  }
  return { chosen, missing };
}

// Family names are matched in lowercase; Google Fonts needs the spelling the script uses.
function originalSpelling(text, family) {
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<=[,\\\\]fn|,)\\s*@?(${escaped})(?=\\s*[,\\\\})])`, 'i').exec(text)?.[1] ?? family;
}

// Downloads still-missing families from Google Fonts. Returns the fonts to add and the renames
// needed when the downloaded font is named differently (e.g. "Lato Black PL" -> "Lato Black").
async function fromGoogleFonts(text, missing, usage) {
  const results = await Promise.all(missing.map(async (family) => {
    try {
      const found = await loadGoogleFamily(originalSpelling(text, family), [...usage.get(family).variants]);
      return found && { family, ...found, candidates: readCandidates(found.fonts) };
    } catch {
      return null;
    }
  }));
  const fonts = [];
  const renames = new Map();
  for (const result of results.filter(Boolean)) {
    fonts.push(...result.candidates);
    const names = new Set(result.candidates.flatMap((font) => [...font.names]));
    if (names.has(result.family)) continue;
    const target = [result.name, parseFamily(result.name).family].find((name) => names.has(name.toLowerCase()));
    if (target) renames.set(result.family, target);
  }
  return { fonts, renames, found: results.filter(Boolean).map((result) => result.family) };
}

/**
 * Starts Google Fonts downloads for every family the script uses, without waiting for the group's
 * fonts that decide which ones are really missing. Results land in the download cache that
 * embedFonts reads, so a later lookup is instant; unused downloads only cost transfer.
 */
export function prefetchGoogleFonts(text) {
  const usage = collectFontUsage(text);
  const covered = substitutesFor([...usage.keys()]);
  for (const [family, { variants }] of usage) {
    if (covered.has(family)) continue;
    loadGoogleFamily(originalSpelling(text, family), [...variants]).catch(() => {});
  }
}

/**
 * Embeds the subsetted fonts an ASS script uses, picked from `fonts` ([{ fileName, bytes }]).
 * Families missing from `fonts` that have an open-licensed substitute (Arial -> Liberation Sans,
 * ...) are renamed in the script and the substitute is embedded instead; families still missing
 * are looked up in Google Fonts. Returns { text, embedded, missing, substituted, google }.
 */
export async function embedFonts(text, fonts) {
  if (hasFontsSection(text)) return { text, embedded: [], missing: [], substituted: [], skipped: 'already-embedded' };

  let candidates = readCandidates(fonts);
  let { chosen, missing } = matchFonts(collectFontUsage(text), candidates);

  const substitutes = substitutesFor(missing);
  if (substitutes.size > 0) {
    text = renameFontFamilies(text, substitutes);
    candidates = candidates.concat(readCandidates(await loadSubstituteFonts([...substitutes.values()])));
    ({ chosen, missing } = matchFonts(collectFontUsage(text), candidates));
  }
  const substituted = [...substitutes].map(([family, substitute]) => `${family}->${substitute}`);

  let google = [];
  if (missing.length > 0) {
    const usage = collectFontUsage(text);
    const result = await fromGoogleFonts(text, missing, usage);
    if (result.fonts.length > 0) {
      text = renameFontFamilies(text, result.renames);
      candidates = candidates.concat(result.fonts);
      ({ chosen, missing } = matchFonts(collectFontUsage(text), candidates));
      google = result.found;
    }
  }

  const embedded = [];
  let index = 0;
  for (const [font, chars] of chosen) {
    // Space is always needed for layout even when the script never shows it in this font.
    chars.add(0x20);
    const subset = await subsetFont(font.bytes, chars);
    const bytes = subset ?? new Uint8Array(font.bytes);
    const extension = font.fileName.match(/\.(ttf|otf|ttc)$/i)?.[0].toLowerCase() ?? '.ttf';
    embedded.push({
      name: safeFileName([...font.names][0] ?? font.fileName, index++, extension),
      bytes,
      source: font.fileName,
      originalSize: font.bytes.byteLength,
      subsetSize: subset ? subset.byteLength : null,
    });
  }

  return { text: embedded.length ? insertFontsSection(text, embedded) : text, embedded, missing, substituted, google };
}
