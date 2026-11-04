import { readFile } from 'node:fs/promises';

// Open-licensed stand-ins for fonts that groups do not upload and Android lacks, where libass
// would otherwise fall back to Roboto. See substitutes/README.md for sources and licenses.
const SUBSTITUTE_FAMILIES = {
  'Liberation Sans': ['liberation/LiberationSans-Regular.ttf', 'liberation/LiberationSans-Bold.ttf',
    'liberation/LiberationSans-Italic.ttf', 'liberation/LiberationSans-BoldItalic.ttf'],
  'Liberation Serif': ['liberation/LiberationSerif-Regular.ttf', 'liberation/LiberationSerif-Bold.ttf',
    'liberation/LiberationSerif-Italic.ttf', 'liberation/LiberationSerif-BoldItalic.ttf'],
  'Liberation Mono': ['liberation/LiberationMono-Regular.ttf', 'liberation/LiberationMono-Bold.ttf',
    'liberation/LiberationMono-Italic.ttf', 'liberation/LiberationMono-BoldItalic.ttf'],
  'Comic Neue': ['comic-neue/ComicNeue-Regular.ttf', 'comic-neue/ComicNeue-Bold.ttf',
    'comic-neue/ComicNeue-Italic.ttf', 'comic-neue/ComicNeue-BoldItalic.ttf'],
  'Fira Sans': ['fira-sans/FiraSans-Regular.ttf', 'fira-sans/FiraSans-Bold.ttf',
    'fira-sans/FiraSans-Italic.ttf', 'fira-sans/FiraSans-BoldItalic.ttf'],
};

// Lowercase family named in the script -> substitute family.
const SUBSTITUTES = new Map([
  ['arial', 'Liberation Sans'],
  ['arial mt', 'Liberation Sans'],
  ['helvetica', 'Liberation Sans'],
  ['times new roman', 'Liberation Serif'],
  ['times', 'Liberation Serif'],
  ['courier new', 'Liberation Mono'],
  ['courier', 'Liberation Mono'],
  ['comic sans ms', 'Comic Neue'],
  ['trebuchet ms', 'Fira Sans'],
]);

const fileCache = new Map(); // relative path -> ArrayBuffer

/** Substitutes for the given missing families: Map<lowercase family, substitute family>. */
export function substitutesFor(missingFamilies) {
  return new Map(missingFamilies.filter((family) => SUBSTITUTES.has(family)).map((family) => [family, SUBSTITUTES.get(family)]));
}

/** Loads the files of the given substitute families as [{ fileName, bytes }]. */
export async function loadSubstituteFonts(families) {
  const paths = [...new Set(families)].flatMap((family) => SUBSTITUTE_FAMILIES[family] ?? []);
  return Promise.all(paths.map(async (path) => {
    if (!fileCache.has(path)) {
      const bytes = await readFile(new URL(`../substitutes/${path}`, import.meta.url));
      fileCache.set(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return { fileName: path.split('/').pop(), bytes: fileCache.get(path) };
  }));
}
