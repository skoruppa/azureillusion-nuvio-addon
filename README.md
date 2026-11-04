# AzureIllusion Napisy - Nuvio addon

Also installable in Stremio (standard addon protocol).

Subtitles addon serving Polish anime subtitles from [AzureIllusion](https://subs.azureillusion.ovh).
Runs as a Cloudflare Worker. Every user provides their own AzureIllusion API key.

## Supported IDs

- `kitsu:<id>[:<episode>]`
- `mal:<id>[:<episode>]`
- `anilist:<id>[:<episode>]`
- `tt<imdb>[:<season>:<episode>]` - only when `SIMKL_CLIENT_ID` is set

Kitsu and MAL IDs are converted to AniList IDs with [animap.id](https://animap.id) (no rate limits),
falling back to Simkl (when `SIMKL_CLIENT_ID` is set) and finally to the AzureIllusion API. IMDb IDs are mapped with Simkl: `/redirect` finds the anime,
`mapped_tvdb_seasons` and `relations` pick the entry for the season, and the episode list converts
TVDB season/episode numbers to the entry's local episode (e.g. One Piece S22E15 → episode 1100).

## How it works

1. `/` - configuration page; validates the key against `/api/public/v1/health` and builds the manifest URL
   `/{apiKey}/manifest.json`. `/{apiKey}/configure` reopens it with the key filled in.
2. `/{apiKey}/subtitles/{type}/{id}.json` - resolves the AniList ID, searches releases (ASS/SRT) and returns them.
3. `/{apiKey}/sub/{releaseId}.{ass|srt}` - proxies the subtitle file, adding the user's `Authorization` header.

ID mappings (7 days), Simkl episode lists (12 h) and search results (30 min) are cached with the Cache API.
The AzureIllusion API allows 60 requests per minute per key.

## Embedded fonts (`/{apiKey}/fonts/manifest.json`)

With the "Próbuj dodawać czcionki do plików ASS" option, ASS URLs point to the fonts service in [`fonts/`](fonts/)
(a Vercel function, because subsetting takes ~50-80 ms of CPU, more than a free Worker allows):

1. downloads the subtitle and the group's font files from `/anime/{anilistId}/subtitles` (`files[type=FONT]`),
2. collects families, bold/italic variants and characters from styles and `\fn`/`\b`/`\i`/`\r` tags,
3. matches them to font name tables (including variable-font named instances),
4. subsets each font with HarfBuzz (`harfbuzzjs`, the engine assfonts uses) and
5. uuencodes them into a `[Fonts]` section before `[Events]`.

Fonts that the group did not upload and Android does not have (libass would fall back to Roboto)
are replaced with open-licensed stand-ins from [`fonts/substitutes/`](fonts/substitutes/): Arial,
Times New Roman and Courier New with metric-compatible Liberation Sans/Serif/Mono, Comic Sans MS
with Comic Neue and Trebuchet MS with Fira Sans. The script is rewritten to name the substitute;
on a sample of 16 files this added about 25-65 KB per affected file.

Scripts that already contain `[Fonts]` are returned unchanged, and any failure falls back to the original file.
The `X-Fonts` response header reports what was embedded. libass (Nuvio) loads these fonts when
`ass_set_extract_fonts` is enabled.

## Self-hosting

Everything (configuration page, addon and the fonts service) can run as **one Node.js process**,
without Cloudflare or Vercel. It uses the same code: `selfhost/server.mjs` runs the Worker from `src/`
and serves `/ass/...` from `fonts/` itself, with an in-memory cache instead of the Workers Cache API.

### Docker (recommended)

Images for `linux/amd64` and `linux/arm64` are published to
`ghcr.io/skoruppa/azureillusion-nuvio-addon` for every release tag (`latest`, `X.Y.Z`, `X.Y`).

```bash
curl -O https://raw.githubusercontent.com/skoruppa/azureillusion-nuvio-addon/main/docker-compose.yml
# edit PUBLIC_URL (and optionally SIMKL_CLIENT_ID) in docker-compose.yml
docker compose up -d
```

To build the image yourself, clone the repository and use `build: .` in `docker-compose.yml`.

The addon listens on port 7000. Open `PUBLIC_URL` in a browser, paste an AzureIllusion API key and install.

### Plain Node.js (22+)

```bash
cd fonts && npm ci --omit=dev && cd ..
PUBLIC_URL=https://napisy.example.com SIMKL_CLIENT_ID=... npm start
```

### Configuration

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | recommended | Public address of the addon, e.g. `https://napisy.example.com`. Without it the address is taken from the request and the `X-Forwarded-Proto`/`X-Forwarded-Host` headers. |
| `SIMKL_CLIENT_ID` | no | Enables IMDb (`tt...`) IDs. Create an app in the developer settings of a Simkl account. Without it only `kitsu:`, `mal:` and `anilist:` IDs work. |
| `PORT` / `HOST` | no | Listening address, default `0.0.0.0:7000`. |
| `FONTS_BASE_URL` | no | Use a separate fonts service instead of the built-in one. |

Users bring their own AzureIllusion API keys; the server does not need one.

### Reverse proxy and HTTPS

Put the addon behind a reverse proxy with HTTPS (Caddy, nginx, Traefik). Nuvio and Stremio install
addons from `https://` addresses; plain `http://` only works on `localhost`. A minimal Caddyfile:

```
napisy.example.com {
    reverse_proxy localhost:7000
}
```

**API keys are part of every URL** (`/{apiKey}/manifest.json`). Disable or redact request paths in your
proxy's access logs, or the logs will contain your users' keys. The addon itself never logs paths.

### Resources

Listing subtitles is cheap. Embedding fonts subsets them with HarfBuzz (WASM): roughly 50-150 ms of CPU
per new subtitle file, then the fonts stay in memory (up to 200 font files) and finished files are
served with long `Cache-Control` headers. A small VPS should be enough for personal or small-group use.
The in-memory cache is cleared on restart.

## Development

```bash
cp .env.example .env          # fill SIMKL_CLIENT_ID and AZUREILLUSION_API_KEY
npm install
npm run dev                   # Worker: http://localhost:8787
(cd fonts && npm install && npm run dev)   # fonts service: http://localhost:3001
./scripts/smoke.sh            # or: ./scripts/smoke.sh kitsu:45857:1 tt12343534:2:1

# 1. fonts service on Vercel (project root: fonts/, region fra1 from vercel.json)
(cd fonts && npx vercel --prod)
# 2. Worker: set FONTS_BASE_URL in wrangler.toml [vars] to the Vercel URL, then
npx wrangler secret put SIMKL_CLIENT_ID
npm run deploy
```

Bind the Worker to a custom domain (Workers → Settings → Domains & Routes): the Cache API used for
ID mappings and search results does not work on `*.workers.dev`.
