// Shared across users: cached values never depend on the caller's API key.
export async function cached(ctx, cacheKey, ttlFor, producer) {
  const cache = caches.default;
  const request = new Request(`https://cache.internal/${cacheKey}`);
  const hit = await cache.match(request);
  if (hit) return hit.json();

  const value = await producer();
  const ttl = ttlFor(value);
  if (ttl > 0) {
    const response = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(request, response));
  }
  return value;
}
