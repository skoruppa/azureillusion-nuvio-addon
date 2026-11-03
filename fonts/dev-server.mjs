// Local stand-in for Vercel: serves /ass/{key}/{anilistId}/{file} with the same handler.
import { createServer } from 'node:http';
import { GET } from './api/ass.js';

const port = Number(process.env.PORT ?? 3001);
createServer(async (req, res) => {
  const match = /^\/ass\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(new URL(req.url, 'http://local').pathname);
  if (!match) {
    res.writeHead(404).end('Not Found');
    return;
  }
  const [, key, anilist, file] = match;
  const response = await GET(new Request(`http://local/api/ass?key=${key}&anilist=${anilist}&file=${file}`));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`fonts dev server on http://localhost:${port}`));
