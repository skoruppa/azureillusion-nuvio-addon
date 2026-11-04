import { collectFontUsage, hasFontsSection, insertFontsSection, renameFontFamilies } from './ass.js';
import { readFontInfo } from './sfnt.js';
import { subsetFont } from './subset.js';
import { loadSubstituteFonts, substitutesFor } from './substitutes.js';

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

/**
 * Embeds the subsetted fonts an ASS script uses, picked from `fonts` ([{ fileName, bytes }]).
 * Families missing from `fonts` that have an open-licensed substitute (Arial -> Liberation Sans,
 * ...) are renamed in the script and the substitute is embedded instead.
 * Returns { text, embedded, missing, substituted }.
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

  return { text: embedded.length ? insertFontsSection(text, embedded) : text, embedded, missing, substituted };
}
