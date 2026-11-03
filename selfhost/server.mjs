// Single-process self-hosted addon: the Cloudflare Worker (src/) and the fonts service (fonts/)
// behind one Node.js HTTP server. Configuration comes from environment variables, see README.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { MemoryCache } from './memory-cache.mjs';

globalThis.caches ??= { default: new MemoryCache() };

const { default: worker } = await import('../src/index.js');
const { GET: fontsHandler } = await import('../fonts/api/ass.js');

const PORT = Number(process.env.PORT ?? 7000);
const HOST = process.env.HOST ?? '0.0.0.0';
// Public address as seen by Nuvio/Stremio, e.g. https://napisy.example.com. Without it the
// address is taken from the request (and X-Forwarded-* headers set by a reverse proxy).
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '');

function publicOrigin(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim() ?? 'http';
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() ?? req.headers.host ?? `localhost:${PORT}`;
  return `${proto}://${host}`;
}

const HOP_BY_HOP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade']);

async function toRequest(req, origin) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(origin + req.url, { method: req.method, headers, body });
}

async function sendResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
}

function workerEnv(origin) {
  return {
    SIMKL_CLIENT_ID: process.env.SIMKL_CLIENT_ID ?? '',
    // Fonts are served by this same process unless another fonts service is configured.
    FONTS_BASE_URL: process.env.FONTS_BASE_URL || origin,
  };
}

createServer(async (req, res) => {
  try {
    const origin = publicOrigin(req);
    const request = await toRequest(req, origin);
    const path = new URL(request.url).pathname;

    // /ass/{apiKey}/{anilistId}/{releaseId}.ass, the same route the Vercel deployment rewrites.
    const fonts = /^\/ass\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
    if (fonts && req.method === 'GET') {
      const [, key, anilist, file] = fonts;
      await sendResponse(res, await fontsHandler(new Request(`${origin}/api/ass?key=${key}&anilist=${anilist}&file=${file}`)));
      return;
    }

    const pending = [];
    const ctx = { waitUntil: (promise) => pending.push(Promise.resolve(promise).catch(() => {})) };
    await sendResponse(res, await worker.fetch(request, workerEnv(origin), ctx));
    await Promise.all(pending);
  } catch (error) {
    // The path contains the user's API key, so it is never logged.
    console.error(`${req.method} request failed: ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}).listen(PORT, HOST, () => console.log(`AzureIllusion Napisy listening on http://${HOST}:${PORT}`));
