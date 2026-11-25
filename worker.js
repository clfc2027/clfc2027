// Hub Worker: serves the static hub from public/ through the ASSETS binding.
// The club gate (workers/club-gate) reaches the hub through a service binding, so the hub needs a script.
// Tool icons come from the R2 bucket hub-icons (binding HUB_ICONS), served at /hub-icons/<file>.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/hub-icons/")) {
      const key = decodeURIComponent(url.pathname.slice("/hub-icons/".length));
      if (!/^[A-Za-z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });
      const obj = await env.HUB_ICONS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
