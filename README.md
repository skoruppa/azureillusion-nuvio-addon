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
falling back to the AzureIllusion API. IMDb IDs are mapped with Simkl: `/redirect` finds the anime,
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

Scripts that already contain `[Fonts]` are returned unchanged, and any failure falls back to the original file.
The `X-Fonts` response header reports what was embedded. libass (Nuvio) loads these fonts when
`ass_set_extract_fonts` is enabled.

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
