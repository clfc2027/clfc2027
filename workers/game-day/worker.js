// Game Day pages for all grades, served from one Worker.
// URLs: /league, /colts, /reserves, /thirds
// The page template lives at public/game-day.html and is served only through
// this Worker (run_worker_first), so it is never reachable at its own path.

const GRADES = {
  league:   { pageName: "Game Day League",   gradeMatch: "B Grade" },
  colts:    { pageName: "Game Day Colts",    gradeMatch: "Colts" },
  reserves: { pageName: "Game Day Reserves", gradeMatch: "B Reserves" },
  thirds:   { pageName: "Game Day Thirds",   gradeMatch: "E2 South" },
};

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const slug = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
    const grade = Object.prototype.hasOwnProperty.call(GRADES, slug) ? GRADES[slug] : null;
    if (!grade) {
      return new Response("Not found", { status: 404 });
    }

    const templateRes = await env.ASSETS.fetch(new URL("/game-day.html", request.url));
    if (!templateRes.ok) {
      return new Response("Game Day template is missing", { status: 500 });
    }
    const html = (await templateRes.text())
      .replaceAll("__PAGE_NAME__", grade.pageName)
      .replaceAll("__GRADE_MATCH__", grade.gradeMatch);

    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
};
