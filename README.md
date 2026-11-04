# AzureIllusion Napisy

Subtitles addon for **Nuvio** (also installable in Stremio) serving Polish anime subtitles from
[AzureIllusion](https://subs.azureillusion.ovh). Every user provides their own AzureIllusion API key.

## Installation

1. Create an API key after logging in to [AzureIllusion](https://subs.azureillusion.ovh). A separate key just for this
   addon is recommended.
2. Open **https://azureillusion-nuvio-addon.skoruppa.workers.dev**, paste the key and click *Sprawdź klucz*.
3. Optionally enable *Próbuj dodawać czcionki do plików ASS* (see [Embedded fonts](#embedded-fonts)).
4. Click *Zainstaluj w Nuvio* (or *Zainstaluj w Stremio* from the arrow menu), or copy the manifest URL and paste it in
   the app's addon settings.

The key is part of the manifest URL (`/{apiKey}/manifest.json`), so do not share it. Changing the fonts option
changes the URL: remove the old addon and install it again.

## Features

- **Supported IDs:** `kitsu:`, `mal:`, `anilist:` (with an episode number, or none for movies) and IMDb
  `tt<id>[:<season>:<episode>]`.
- **Readable list:** every release is labelled with its group, format, the group's translation progress for the
  series and the video source, e.g. `Demo Subs [ASS] 12/12 BD`. Groups that translated the whole series come first,
  then the AzureIllusion ranking.
- **Matching the played file:** the file name sent by the player (`filename` extra) moves releases made for the same
  raw release (e.g. `[SubsPlease] ...` and a subtitle named `SubsPlease_...`) or the same source (BD/WEB) to the top.
- **Wrong-series filter:** releases whose file name is the title of a side story of the series (e.g. `Kage-Jitsu! 2nd`
  filed under *Kage no Jitsuryokusha ni Naritakute! 2nd season*) are hidden.
- **Hard-subbed streams:** files ending with `.docc` (streams from the Docchi addon, which have burned-in Polish
  subtitles) get no subtitles.
- **Embedded fonts** for ASS files, optional (below).

## How it works

1. `/` - configuration page; validates the key against `/api/public/v1/health` and builds the manifest URL.
   `/{apiKey}/configure` reopens it with the key filled in.
2. `/{apiKey}/subtitles/{type}/{id}.json` - resolves the AniList ID, searches releases (ASS/SRT), adds the groups'
   progress from `/anime/{anilistId}/subtitles`, filters and orders them.
3. `/{apiKey}/sub/{releaseId}.{ass|srt}` - proxies the subtitle file, adding the user's `Authorization` header.
4. With fonts enabled (`/{apiKey}/fonts/...`), ASS URLs point to the fonts service instead.

**ID mapping.** Kitsu and MAL IDs are converted to AniList IDs with [animap.id](https://animap.id) (no rate limits),
falling back to Simkl and finally to the AzureIllusion API. IMDb IDs are mapped with Simkl: `/redirect` finds the
anime, `mapped_tvdb_seasons` and `relations` pick the entry for the season, and the episode list converts TVDB
season/episode numbers to the entry's local episode (e.g. One Piece S22E15 -> episode 1100). Side-story titles come
from AniList data mirrored by animap (AniList blocks Cloudflare's IPs).

**Caching.** ID mappings and titles (7 days), Simkl episode lists (12 h), search results and group progress (30 min)
are cached with the Workers Cache API. The AzureIllusion API allows 60 requests per minute per key, and the API is
only used where no other source exists.

## Embedded fonts

With *Próbuj dodawać czcionki do plików ASS*, ASS files are served by the fonts service in [`fonts/`](fonts/)
(a Vercel function, because subsetting takes ~50-150 ms of CPU, more than a free Worker allows). Like
[assfonts](https://github.com/wyzdwdz/assfonts), it:

1. downloads the subtitle and the group's font files (`/anime/{anilistId}/subtitles`, `files[type=FONT]`),
2. collects families, bold/italic variants and characters from styles and `\fn`/`\b`/`\i`/`\r` tags,
3. matches them to font name tables (including variable-font named instances),
4. subsets each font with HarfBuzz (`harfbuzzjs`) and
5. uuencodes them into a `[Fonts]` section before `[Events]`.

Fonts the group did not upload and Android does not have (libass would fall back to Roboto) are replaced with
open-licensed stand-ins from [`fonts/substitutes/`](fonts/substitutes/): Arial, Times New Roman and Courier New with
metric-compatible Liberation Sans/Serif/Mono, Comic Sans MS with Comic Neue and Trebuchet MS with Fira Sans. A group's
own font always wins. The script is rewritten to name the substitute; on a sample of 16 files this added about
25-65 KB per affected file.

Scripts that already contain `[Fonts]` are returned unchanged, and any failure falls back to the original file. The
`X-Fonts` response header reports what was embedded, substituted and missing. Nuvio's libass loads these fonts
(`ass_set_extract_fonts`); fonts nobody provides (e.g. commercial Japanese fonts) still fall back to the device font.

## Self-hosting

Everything (configuration page, addon and fonts service) can run as **one Node.js process** without Cloudflare or
Vercel. It uses the same code: `selfhost/server.mjs` runs the Worker from `src/` and serves `/ass/...` from `fonts/`
itself, with an in-memory cache instead of the Workers Cache API.

### Docker (recommended)

Images for `linux/amd64` and `linux/arm64` are published to `ghcr.io/skoruppa/azureillusion-nuvio-addon` for every
release tag (`latest`, `X.Y.Z`, `X.Y`).

```bash
curl -O https://raw.githubusercontent.com/skoruppa/azureillusion-nuvio-addon/main/docker-compose.yml
# edit PUBLIC_URL (and optionally SIMKL_CLIENT_ID) in docker-compose.yml
docker compose up -d
```

To build the image yourself, clone the repository and use `build: .` in `docker-compose.yml`. The addon listens on
port 7000. Open `PUBLIC_URL` in a browser, paste an AzureIllusion API key and install.

### Plain Node.js (22+)

```bash
cd fonts && npm ci --omit=dev && cd ..
PUBLIC_URL=https://napisy.example.com SIMKL_CLIENT_ID=... npm start
```

### Configuration

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | recommended | Public address of the addon, e.g. `https://napisy.example.com`. Without it the address is taken from the request and the `X-Forwarded-Proto`/`X-Forwarded-Host` headers. |
| `SIMKL_CLIENT_ID` | no | Enables IMDb (`tt...`) IDs and the Simkl fallback for Kitsu/MAL. Create an app in the developer settings of a Simkl account. |
| `PORT` / `HOST` | no | Listening address, default `0.0.0.0:7000`. |
| `FONTS_BASE_URL` | no | Use a separate fonts service instead of the built-in one. |

Users bring their own AzureIllusion API keys; the server does not need one.

### Reverse proxy and HTTPS

Put the addon behind a reverse proxy with HTTPS (Caddy, nginx, Traefik). Nuvio and Stremio install addons from
`https://` addresses; plain `http://` only works on `localhost`. A minimal Caddyfile:

```
napisy.example.com {
    reverse_proxy localhost:7000
}
```

**API keys are part of every URL.** Disable or redact request paths in your proxy's access logs, or the logs will
contain your users' keys. The addon itself never logs paths.

### Resources

Listing subtitles is cheap. Embedding fonts costs roughly 50-150 ms of CPU per new subtitle file; fonts stay in memory
(up to 200 font files) and finished files are served with long `Cache-Control` headers. A small VPS should be enough
for personal or small-group use. The in-memory cache is cleared on restart.

## Development

```bash
cp .env.example .env                       # SIMKL_CLIENT_ID, AZUREILLUSION_API_KEY (for smoke tests)
npm install
npm run dev                                # Worker: http://localhost:8787
(cd fonts && npm install && npm run dev)   # fonts service: http://localhost:3001
./scripts/smoke.sh                         # or: ./scripts/smoke.sh kitsu:45857:1 tt12343534:2:1
npm start                                  # or both in one process: http://localhost:7000
```

### Deploying the hosted version

1. **Fonts service on Vercel:** project with *Root Directory* `fonts`, then `vercel deploy --prod`. Set the
   function region to `fra1` in the project settings (close to the AzureIllusion servers); `regions` in
   `vercel.json` alone was not applied.
2. **Worker on Cloudflare:** set `FONTS_BASE_URL` in `wrangler.toml` `[vars]` to the Vercel URL, then
   `npx wrangler secret put SIMKL_CLIENT_ID` and `npm run deploy`.
3. **Docker image:** push a `vX.Y.Z` tag; `.github/workflows/docker-publish.yml` builds and publishes it and creates a
   GitHub release.
