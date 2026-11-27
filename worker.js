// Hub Worker: serves the static hub from public/ through the ASSETS binding.
// The club gate (workers/club-gate) reaches the hub through a service binding, so the hub needs a script.
// Tool icons come from the R2 bucket hub-icons (binding HUB_ICONS), served at /hub-icons/<file>.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/hub-icons/")) {
      // Workers responses are not cached at the edge by default, so cache icons in the Cache API.
      // Only GET responses are stored; a hit skips the R2 read.
      const cacheable = request.method === "GET";
      if (cacheable) {
        const cached = await caches.default.match(request);
        if (cached) return cached;
      }
      const key = decodeURIComponent(url.pathname.slice("/hub-icons/".length));
      if (!/^[A-Za-z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });
      const obj = await env.HUB_ICONS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const response = new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png", "Cache-Control": "public, max-age=86400" },
      });
      if (cacheable) ctx.waitUntil(caches.default.put(request, response.clone()));
      return response;
    }
    return env.ASSETS.fetch(request);
  },
};
