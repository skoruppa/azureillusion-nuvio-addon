// Minimal TrueType/OpenType reader: just enough to match fonts the way libass does
// (family, typographic family and full names) and to pick bold/italic variants.
const FAMILY_NAME_IDS = new Set([1, 4, 16]);

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
  const byId = new Map(); // nameId -> Set<lowercase string>
  if (!name) return byId;
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
    if (!byId.has(nameId)) byId.set(nameId, new Set());
    byId.get(nameId).add(value);
  }
  return byId;
}

// Named instances of a variable font ("Alegreya Medium") are addressed in ASS by family + instance name.
function readInstanceNames(view, fvar, namesById) {
  if (!fvar) return [];
  const axesOffset = view.getUint16(fvar.offset + 4);
  const axisCount = view.getUint16(fvar.offset + 8);
  const axisSize = view.getUint16(fvar.offset + 10);
  const instanceCount = view.getUint16(fvar.offset + 12);
  const instanceSize = view.getUint16(fvar.offset + 14);
  const families = [...(namesById.get(16) ?? []), ...(namesById.get(1) ?? [])];
  const result = [];
  for (let i = 0; i < instanceCount; i++) {
    const instance = fvar.offset + axesOffset + axisCount * axisSize + i * instanceSize;
    for (const subfamily of namesById.get(view.getUint16(instance)) ?? []) {
      for (const family of families) result.push(`${family} ${subfamily}`);
    }
  }
  return result;
}

export function readFontInfo(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTables(view);
  const namesById = readNameTable(view, bytes, tables.get('name'));
  const names = new Set();
  for (const nameId of FAMILY_NAME_IDS) namesById.get(nameId)?.forEach((value) => names.add(value));
  readInstanceNames(view, tables.get('fvar'), namesById).forEach((value) => names.add(value));

  let weight = 400;
  let italic = false;
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 64) {
    weight = view.getUint16(os2.offset + 4);
    italic = (view.getUint16(os2.offset + 62) & 1) === 1;
  }
  return { names, weight, italic };
}
