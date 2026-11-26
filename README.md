# AzureIllusion Napisy

Subtitles addon for **Nuvio** (also installable in Stremio) serving Polish anime subtitles from
[AzureIllusion](https://subs.azureillusion.ovh). Every user provides their own AzureIllusion API key.

## Installation

1. Create an API key in the [AzureIllusion API settings](https://subs.azureillusion.ovh/account?tab=api) (log in with Discord first). A separate key just
   for this addon is recommended.
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

1. downloads the subtitle and the group's font files it needs (`/anime/{anilistId}/subtitles`, `files[type=FONT]`, see
   [Font index](#font-index)),
2. collects families, bold/italic variants and characters from styles and `\fn`/`\b`/`\i`/`\r` tags,
3. matches them to font name tables the way libass does for embedded fonts (Windows family names, plus full names or,
   for CFF fonts, PostScript names),
4. subsets each font with HarfBuzz (`harfbuzzjs`) and
5. uuencodes them into a `[Fonts]` section before `[Events]`.

Fonts the group did not upload and Android does not have (libass would fall back to Roboto) are replaced with
open-licensed stand-ins from [`fonts/substitutes/`](fonts/substitutes/): Arial, Times New Roman and Courier New with
metric-compatible Liberation Sans/Serif/Mono, Comic Sans MS with Comic Neue and Trebuchet MS with Fira Sans. A group's
own font always wins. The script is rewritten to name the substitute; on a sample of 16 files this added about
25-65 KB per affected file.

Families still missing are looked up in [Google Fonts](https://fonts.google.com) (all open-licensed): the name is
split into family, weight and style ("Signika SemiBold" -> Signika 600) and the css2 API serves a static TTF of that
instance. A group's "PL" tag is dropped ("Gentium Basic PL" -> Gentium Basic, the original already has Polish glyphs)
and the script is renamed accordingly. Each family adds roughly 10-20 KB after subsetting.

The last step is the AzureIllusion font library (`/fonts`), which holds the fonts all groups uploaded, so a family one
group forgot is often there from another group (e.g. `Kozuka Gothic Mikakunin B PL`). One request per family
(`family=` matches the font's own family names, also for files like `0057EU.TTF` that contain `HoboEU`) returns every
face with its weight and italic flag, and each bold/italic variant the script uses gets the closest face, the way libass
picks one. Only when a family has more than 30 files and the first page has no close face is that variant requested
separately (`weight=`, `italic=`). The downloaded font must carry the family name. Library lookups count against the
user's limit of 60 requests per minute, so the library comes after the free sources, at most 5 families and 8 files are
fetched per subtitle, and searches are kept in the font index.

Scripts that already contain `[Fonts]` are returned unchanged, and any failure falls back to the original file. The
`X-Fonts` response header reports how many families were embedded, substituted, taken from Google Fonts or the library,
and missing, plus how many of the group's files were used (`group=used/all`). Nuvio's libass loads these fonts
(`ass_set_extract_fonts`); fonts nobody uploaded still fall back to the device font.

### Font index

A group's package can hold dozens of fonts (77 in one DemoSubs package) while a script uses a few, and every download
counts against the user's 60 requests per minute. The fonts service therefore keeps an index of every font file it has
seen (the names libass matches, weight and italic, by file id; files never change) and of font library searches (7 days,
1 day when nothing was found). With the index, only the group files whose names the script uses are downloaded. Files
not in the index yet are downloaded at most 25 per subtitle, those whose file names look like the families the script
uses first, and added to it. When files were left out and a family is still missing, the response is cached for 5
minutes only (`X-Fonts` ends with `partial`), so the next request completes it.

The index is shared by all users, as the font data does not depend on the API key. The hosted version keeps it in
Cloudflare D1, behind `POST /api/font-store` on the Worker; self-hosted instances keep it in `DATA_DIR`, or in memory
without it. Font files themselves stay in the instance's memory.

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
| `DATA_DIR` | recommended | Directory for the [font index](#font-index) (`font-store.json`), kept across restarts. The Docker image uses `/data`, a volume in `docker-compose.yml`. Without it the index lives in memory. |
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
for personal or small-group use. The in-memory cache is cleared on restart; the font index in `DATA_DIR` is not (a few
MB at most).

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
3. **Font index (D1):** `npx wrangler d1 create azureillusion-nuvio-fonts` (put its `database_id` in `wrangler.toml`),
   `npx wrangler d1 migrations apply azureillusion-nuvio-fonts --remote`, generate a random token and set it as the
   Worker secret `FONT_STORE_TOKEN`. In the Vercel project, set `FONT_STORE_URL`
   (`https://<worker>/api/font-store`) and the same `FONT_STORE_TOKEN`, then redeploy. Without them the fonts service
   keeps the index in memory.
4. **Docker image:** push a `vX.Y.Z` tag; `.github/workflows/docker-publish.yml` builds and publishes it and creates a
   GitHub release.
