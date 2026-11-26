const MAX_KEYS = 500;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_VALUE_BYTES = 256 * 1024;

const encoder = new TextEncoder();

function authorized(request, token) {
  const given = encoder.encode(request.headers.get('Authorization') ?? '');
  const expected = encoder.encode(`Bearer ${token}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

function keys(values) {
  return Array.isArray(values) ? values.slice(0, MAX_KEYS).map(String) : [];
}

async function readEntries(db, body) {
  const [files, searches] = await db.batch([
    db.prepare('SELECT id, meta FROM font_files WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys(body.files))),
    db.prepare('SELECT query, data FROM font_searches WHERE query IN (SELECT value FROM json_each(?1)) AND expires_at > ?2')
      .bind(JSON.stringify(keys(body.searches)), Date.now()),
  ]);
  return {
    files: Object.fromEntries(files.results.map((row) => [row.id, JSON.parse(row.meta)])),
    searches: Object.fromEntries(searches.results.map((row) => [row.query, JSON.parse(row.data)])),
  };
}

async function writeEntries(db, body) {
  const now = Date.now();
  const statements = [];
  for (const { id, meta } of (Array.isArray(body.files) ? body.files : []).slice(0, MAX_KEYS)) {
    const value = JSON.stringify(meta ?? null);
    if (id && value.length <= MAX_VALUE_BYTES) statements.push(db.prepare('INSERT OR REPLACE INTO font_files (id, meta) VALUES (?1, ?2)').bind(String(id), value));
  }
  for (const { query, data, ttl } of (Array.isArray(body.searches) ? body.searches : []).slice(0, MAX_KEYS)) {
    const value = JSON.stringify(data ?? null);
    const expires = now + Math.min(Math.max(Number(ttl) || 0, 0), MAX_TTL_MS);
    if (query && value.length <= MAX_VALUE_BYTES) {
      statements.push(db.prepare('INSERT OR REPLACE INTO font_searches (query, data, expires_at) VALUES (?1, ?2, ?3)').bind(String(query), value, expires));
    }
  }
  if (statements.length === 0) return;
  statements.push(db.prepare('DELETE FROM font_searches WHERE expires_at <= ?1').bind(now));
  await db.batch(statements);
}

export async function handleFontStore(request, env) {
  if (!env.FONTS_DB || !env.FONT_STORE_TOKEN) return new Response('Not Found', { status: 404 });
  if (!authorized(request, env.FONT_STORE_TOKEN)) return new Response('Unauthorized', { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  try {
    if (body?.action === 'get') return Response.json(await readEntries(env.FONTS_DB, body));
    if (body?.action === 'put') {
      await writeEntries(env.FONTS_DB, body);
      return Response.json({ ok: true });
    }
  } catch (error) {
    console.error(`font store ${body?.action} failed: ${error.message}`);
    return new Response('Font store error', { status: 500 });
  }
  return new Response('Bad Request', { status: 400 });
}
