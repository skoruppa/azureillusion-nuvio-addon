// Minimal TrueType/OpenType reader: just enough to match fonts the way libass does for embedded
// fonts (Windows family names, plus full names or, for CFF fonts, PostScript names) and to pick
// bold/italic variants.
const FAMILY = 1;
const FULL_NAME = 4;
const POSTSCRIPT_NAME = 6;
const TYPOGRAPHIC_FAMILY = 16;
const WINDOWS = 3;

function readTables(view) {
  let base = 0;
  // TrueType collection: use the first face, as hb_face_create(blob, 0) does.
  if (view.getUint32(0) === 0x74746366 /* 'ttcf' */) base = view.getUint32(12);
  const numTables = view.getUint16(base + 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const record = base + 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(record), view.getUint8(record + 1), view.getUint8(record + 2), view.getUint8(record + 3),
    );
    tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) });
  }
  return tables;
}

function decodeName(bytes, platformId) {
  // Windows and Unicode platforms store UTF-16BE; Mac Roman is close enough to Latin-1 for matching.
  if (platformId === 0 || platformId === 3) {
    let text = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return text;
  }
  return String.fromCharCode(...bytes);
}

function readNameTable(view, bytes, name) {
  const windows = new Map(); // nameId -> Set<lowercase string>
  const other = new Map();
  if (!name) return { windows, other };
  const count = view.getUint16(name.offset + 2);
  const stringsStart = name.offset + view.getUint16(name.offset + 4);
  for (let i = 0; i < count; i++) {
    const record = name.offset + 6 + i * 12;
    const platformId = view.getUint16(record);
    const nameId = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const start = stringsStart + view.getUint16(record + 10);
    const value = decodeName(bytes.subarray(start, start + length), platformId).trim().toLowerCase();
    if (!value) continue;
    const byId = platformId === WINDOWS ? windows : other;
    if (!byId.has(nameId)) byId.set(nameId, new Set());
    byId.get(nameId).add(value);
  }
  return { windows, other };
}

function libassNames({ windows, other }, isPostScript) {
  const names = new Set(windows.get(FAMILY));
  if (names.size === 0) {
    const fallback = windows.get(TYPOGRAPHIC_FAMILY) ?? other.get(TYPOGRAPHIC_FAMILY) ?? other.get(FAMILY);
    if (fallback) names.add([...fallback][0]);
  }
  const fullNames = isPostScript ? [...(windows.get(POSTSCRIPT_NAME) ?? other.get(POSTSCRIPT_NAME) ?? [])].slice(0, 1) : windows.get(FULL_NAME);
  fullNames?.forEach((value) => names.add(value));
  return names;
}

export function readFontInfo(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTables(view);
  const names = libassNames(readNameTable(view, bytes, tables.get('name')), tables.has('CFF ') || tables.has('CFF2'));

  let weight = 400;
  let italic = false;
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 64) {
    weight = view.getUint16(os2.offset + 4);
    italic = (view.getUint16(os2.offset + 62) & 1) === 1;
  }
  return { names, weight, italic };
}
