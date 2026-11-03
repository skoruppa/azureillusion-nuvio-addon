import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// HarfBuzz hb-subset (the engine assfonts uses), compiled to WASM by harfbuzzjs.
const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_NAME_ID = 4;
const HB_SUBSET_SETS_NAME_LANG_ID = 5;

let instancePromise = null;

function loadHarfBuzz() {
  instancePromise ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
    const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {});
    return instance.exports;
  })();
  return instancePromise;
}

/** Keeps only the glyphs for `codepoints`; returns null when HarfBuzz cannot subset the font. */
export async function subsetFont(buffer, codepoints) {
  const hb = await loadHarfBuzz();
  const source = new Uint8Array(buffer);
  const fontPointer = hb.malloc(source.byteLength);
  new Uint8Array(hb.memory.buffer).set(source, fontPointer);

  const blob = hb.hb_blob_create(fontPointer, source.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const input = hb.hb_subset_input_create_or_fail();
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const codepoint of codepoints) hb.hb_set_add(unicodes, codepoint);
  // Keep every name in every language: libass matches typographic families, variable-font
  // instance names and families declared only in non-English records. Names are tiny.
  for (const set of [HB_SUBSET_SETS_NAME_ID, HB_SUBSET_SETS_NAME_LANG_ID]) {
    const names = hb.hb_subset_input_set(input, set);
    hb.hb_set_clear(names);
    hb.hb_set_invert(names);
  }

  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);

  let result = null;
  if (subset) {
    const resultBlob = hb.hb_face_reference_blob(subset);
    const offset = hb.hb_blob_get_data(resultBlob, 0);
    const length = hb.hb_blob_get_length(resultBlob);
    if (length > 0) result = new Uint8Array(hb.memory.buffer).slice(offset, offset + length);
    hb.hb_blob_destroy(resultBlob);
    hb.hb_face_destroy(subset);
  }
  hb.hb_face_destroy(face);
  hb.free(fontPointer);
  return result;
}
