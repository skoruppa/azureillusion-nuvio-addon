#!/usr/bin/env bash
# Smoke test against a running `npm run dev` using the key from .env.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-http://localhost:8787}"
KEY="$(grep -E '^AZUREILLUSION_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$KEY" ] || { echo "Set AZUREILLUSION_API_KEY in .env"; exit 1; }
K="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$KEY")"

echo "key check:"; curl -s -X POST "$BASE/api/check" -H 'Content-Type: application/json' -d "{\"key\":\"$KEY\"}"; echo
for id in "${@:-kitsu:45857:1 mal:51009:1 anilist:145064:1}"; do
  for one in $id; do
    echo "== $one"
    curl -s "$BASE/$K/subtitles/series/$one.json" | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const subs = JSON.parse(s).subtitles; console.log(`${subs.length} subtitles`);
        for (const x of subs.slice(0, 5)) console.log(` ${x.lang}  ${x.id}`);
        if (subs[0]) console.log(`first file: /<key>/${subs[0].url.split("/").slice(4).join("/")}`);
      });'
  done
done

FIRST="$(curl -s "$BASE/$K/subtitles/series/anilist:145064:1.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).subtitles[0];if(x)console.log(x.url.split("/").slice(4).join("/"))})')"
if [ -n "$FIRST" ]; then
  OUT="$(mktemp)"
  echo "== download $FIRST"
  curl -s -D - -o "$OUT" "$BASE/$K/$FIRST" | grep -i '^HTTP\|^content-type'
  head -c 300 "$OUT"; echo
fi
