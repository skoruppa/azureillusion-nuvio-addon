// ASS parsing for font embedding: which font families are used, with which characters,
// and in which bold/italic variants - the same information assfonts collects.

function splitFields(line, count) {
  const fields = [];
  let rest = line;
  for (let i = 0; i < count - 1; i++) {
    const comma = rest.indexOf(',');
    if (comma < 0) break;
    fields.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  fields.push(rest);
  return fields.map((field, index) => (index < count - 1 ? field.trim() : field));
}

function normalizeFamily(name) {
  // A leading '@' requests vertical layout of the same family.
  return name.trim().replace(/^@/, '').toLowerCase();
}

function parseSections(text) {
  const styles = new Map();
  const events = [];
  let section = '';
  let styleFormat = null;
  let eventFormat = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.toLowerCase();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trimStart();

    if (section === '[v4+ styles]' || section === '[v4 styles]') {
      if (key === 'format') styleFormat = value.split(',').map((field) => field.trim().toLowerCase());
      else if (key === 'style' && styleFormat) {
        const fields = splitFields(value, styleFormat.length);
        const get = (name) => fields[styleFormat.indexOf(name)] ?? '';
        styles.set(get('name').toLowerCase(), {
          font: normalizeFamily(get('fontname')),
          bold: get('bold') !== '' && get('bold') !== '0',
          italic: get('italic') !== '' && get('italic') !== '0',
        });
      }
    } else if (section === '[events]') {
      if (key === 'format') eventFormat = value.split(',').map((field) => field.trim().toLowerCase());
      else if (key === 'dialogue' && eventFormat) {
        const fields = splitFields(value, eventFormat.length);
        events.push({ style: (fields[eventFormat.indexOf('style')] ?? '').replace(/^\*/, '').toLowerCase(), text: fields[eventFormat.indexOf('text')] ?? '' });
      }
    }
  }
  return { styles, events };
}

function applyOverrides(block, state, styles, defaultStyle) {
  // Tags are processed left to right; \r resets to the line style or a named style.
  const tags = block.split('\\').slice(1);
  for (const tag of tags) {
    let match;
    if ((match = /^fn(.*)$/.exec(tag))) {
      const name = match[1].replace(/\).*$/, '').trim();
      state.font = name ? normalizeFamily(name) : defaultStyle.font;
    } else if ((match = /^b(\d+)/.exec(tag))) {
      const value = Number(match[1]);
      state.bold = value === 1 || value >= 600;
    } else if ((match = /^i(\d+)/.exec(tag))) {
      state.italic = match[1] !== '0';
    } else if ((match = /^p(\d+)/.exec(tag))) {
      state.drawing = Number(match[1]) > 0;
    } else if ((match = /^r(.*)$/.exec(tag))) {
      const style = styles.get(match[1].trim().toLowerCase()) ?? defaultStyle;
      Object.assign(state, { font: style.font, bold: style.bold, italic: style.italic });
    }
  }
}

/** Returns Map<family, { chars: Set<number>, variants: Set<'bold|italic'> }>. */
export function collectFontUsage(text) {
  const { styles, events } = parseSections(text);
  const usage = new Map();
  const fallbackStyle = { font: 'arial', bold: false, italic: false };

  const record = (state, character) => {
    if (!state.font) return;
    let entry = usage.get(state.font);
    if (!entry) usage.set(state.font, (entry = { chars: new Set(), variants: new Set() }));
    entry.chars.add(character.codePointAt(0));
    entry.variants.add(`${state.bold ? 1 : 0}|${state.italic ? 1 : 0}`);
  };

  for (const event of events) {
    const style = styles.get(event.style) ?? styles.get('default') ?? fallbackStyle;
    const state = { font: style.font, bold: style.bold, italic: style.italic, drawing: false };
    const parts = event.text.split(/(\{[^}]*\})/);
    for (const part of parts) {
      if (part.startsWith('{') && part.endsWith('}')) {
        applyOverrides(part.slice(1, -1), state, styles, style);
        continue;
      }
      if (state.drawing) continue;
      const visible = part.replace(/\\[Nn]/g, '').replace(/\\h/g, ' ');
      for (const character of visible) record(state, character);
    }
  }
  return usage;
}

/**
 * Renames font families in style definitions and \fn tags, e.g. to point at substitute fonts.
 * `mapping` is Map<lowercase family, new family>; everything else is kept byte for byte.
 */
export function renameFontFamilies(text, mapping) {
  if (mapping.size === 0) return text;
  const rename = (name) => {
    const vertical = name.trim().startsWith('@') ? '@' : '';
    const target = mapping.get(normalizeFamily(name));
    return target ? vertical + target : null;
  };
  let section = '';
  let fontnameIndex = -1;
  return text.split(/(\r?\n)/).map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.toLowerCase();
      return line;
    }
    const colon = line.indexOf(':');
    if (colon < 0) return line;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (section === '[v4+ styles]' || section === '[v4 styles]') {
      if (key === 'format') {
        fontnameIndex = line.slice(colon + 1).split(',').map((field) => field.trim().toLowerCase()).indexOf('fontname');
      } else if (key === 'style' && fontnameIndex >= 0) {
        // Style fields never contain commas, so a plain split keeps the line intact.
        const fields = line.slice(colon + 1).split(',');
        const renamed = fields[fontnameIndex] !== undefined && rename(fields[fontnameIndex]);
        if (renamed) {
          fields[fontnameIndex] = fields[fontnameIndex].replace(/\S.*\S|\S/, renamed);
          return line.slice(0, colon + 1) + fields.join(',');
        }
      }
    } else if (section === '[events]' && (key === 'dialogue' || key === 'comment')) {
      return line.replace(/\\fn([^\\})]*)/g, (tag, name) => {
        const renamed = name.trim() && rename(name);
        return renamed ? `\\fn${renamed}` : tag;
      });
    }
    return line;
  }).join('');
}

export function hasFontsSection(text) {
  return /^\[Fonts\]\s*$/im.test(text);
}

// SSA/ASS attachment encoding: 3 bytes -> 4 characters of 6 bits + 33, 80 characters per line.
export function uuencode(bytes) {
  let output = '';
  let line = '';
  const push = (value) => {
    line += String.fromCharCode(value + 33);
    if (line.length === 80) {
      output += `${line}\n`;
      line = '';
    }
  };
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    push(a >> 2);
    push(((a & 0x3) << 4) | (b >> 4));
    push(((b & 0xf) << 2) | (c >> 6));
    push(c & 0x3f);
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    push(bytes[i] >> 2);
    push((bytes[i] & 0x3) << 4);
  } else if (remaining === 2) {
    push(bytes[i] >> 2);
    push(((bytes[i] & 0x3) << 4) | (bytes[i + 1] >> 4));
    push((bytes[i + 1] & 0xf) << 2);
  }
  if (line) output += `${line}\n`;
  return output;
}

/** Inserts a [Fonts] section before [Events], where Aegisub writes attachments. */
export function insertFontsSection(text, fonts) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const body = fonts
    .map((font) => `fontname: ${font.name}${newline}${uuencode(font.bytes).replace(/\n/g, newline)}`)
    .join('');
  const section = `[Fonts]${newline}${body}${newline}`;
  const events = /^\[Events\]\s*$/im.exec(text);
  return events ? text.slice(0, events.index) + section + text.slice(events.index) : text + newline + section;
}
