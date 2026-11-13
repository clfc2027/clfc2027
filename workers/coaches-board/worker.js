var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var POSITIONS = [
  { id: "FULL_BACK", label: "Full Back", short: "FB", x: 50, y: 7, line: "back" },
  { id: "BACK_POCKET_L", label: "Back Pocket", short: "BP", x: 26, y: 15, line: "back" },
  { id: "BACK_POCKET_R", label: "Back Pocket", short: "BP", x: 74, y: 15, line: "back" },
  { id: "BACK_FLANK_L", label: "Back Flank", short: "BF", x: 16, y: 26, line: "back" },
  { id: "CENTRE_HALF_BACK", label: "Centre Half Back", short: "CHB", x: 50, y: 24, line: "back" },
  { id: "BACK_FLANK_R", label: "Back Flank", short: "BF", x: 84, y: 26, line: "back" },
  { id: "WING_L", label: "Wing", short: "W", x: 10, y: 44, line: "mid" },
  { id: "RUCK", label: "Ruck", short: "RK", x: 41, y: 39, line: "mid" },
  { id: "RUCK_ROVER", label: "Ruck Rover", short: "RR", x: 59, y: 39, line: "mid" },
  { id: "CENTRE", label: "Centre", short: "C", x: 41, y: 51, line: "mid" },
  { id: "ROVER", label: "Rover", short: "ROV", x: 59, y: 51, line: "mid" },
  { id: "WING_R", label: "Wing", short: "W", x: 90, y: 44, line: "mid" },
  { id: "FORWARD_FLANK_L", label: "Forward Flank", short: "FF-L", x: 16, y: 69, line: "forward" },
  { id: "CENTRE_HALF_FORWARD", label: "Centre Half Forward", short: "CHF", x: 50, y: 71, line: "forward" },
  { id: "FORWARD_FLANK_R", label: "Forward Flank", short: "FF-R", x: 84, y: 69, line: "forward" },
  { id: "FORWARD_POCKET_L", label: "Forward Pocket", short: "FP", x: 26, y: 84, line: "forward" },
  { id: "FULL_FORWARD", label: "Full Forward", short: "FF", x: 50, y: 92, line: "forward" },
  { id: "FORWARD_POCKET_R", label: "Forward Pocket", short: "FP", x: 74, y: 84, line: "forward" }
];
var INTERCHANGE_COUNT = 4;
var BOARD_YEAR = 2027;
var COMPARE_YEAR = 2026;
var HUB_URL = "https://clfc2027.clfc2027.workers.dev/";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json, "json");
__name2(json, "json");
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(html, "html");
__name2(html, "html");
function requireAdmin(request, env) {
  if (!env.ADMIN_PASSCODE) return;
  const supplied = request.headers.get("x-admin-passcode") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (supplied !== env.ADMIN_PASSCODE) {
    const err = new Error("Unauthorised");
    err.status = 401;
    throw err;
  }
}
__name(requireAdmin, "requireAdmin");
__name2(requireAdmin, "requireAdmin");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,x-admin-passcode,Authorization"
        }
      });
    }
    try {
      if (pathname === "/" || pathname === "/board") return html(renderApp(env.HUB_URL || HUB_URL));
      if (pathname === "/api/compare/grades") {
        const year = Number(url.searchParams.get("year") || COMPARE_YEAR);
        return json(await getCompareGrades(env.DB, year));
      }
      if (pathname === "/api/compare/rounds") {
        const teamId = url.searchParams.get("team_id");
        if (!teamId) return json({ error: "team_id is required" }, 400);
        return json(await getCompareRounds(env.DB, teamId));
      }
      if (pathname === "/api/compare/sync-game" && request.method === "POST") {
        requireAdmin(request, env);
        const { game_id } = await request.json();
        if (!game_id) return json({ error: "game_id is required" }, 400);
        return json(await syncCompareGame(env.DB, env.PLAYHQ_API_KEY, game_id));
      }
      if (pathname === "/api/compare/sync-fixtures" && request.method === "POST") {
        requireAdmin(request, env);
        const { team_id } = await request.json();
        if (!team_id) return json({ error: "team_id is required" }, 400);
        return json(await syncCompareFixtures(env.DB, env.PLAYHQ_API_KEY, team_id));
      }
      if (pathname === "/api/upcoming-opposition") {
        const teamId = url.searchParams.get("team_id");
        const round = url.searchParams.get("round");
        if (!teamId || !round) return json({ error: "team_id and round are required" }, 400);
        return json(await getUpcomingOpposition(env.DB, env.PLAYHQ_API_KEY, teamId, round));
      }
      if (pathname === "/api/compare/sheet") {
        const gameId = url.searchParams.get("game_id");
        if (!gameId) return json({ error: "game_id is required" }, 400);
        return json(await getCompareSheet(env.DB, gameId));
      }
      if (pathname === "/api/grades") return json(await getGrades(env.DB));
      if (pathname === "/api/players") {
        const search = (url.searchParams.get("search") || "").trim();
        return json(await searchPlayers(env.DB, search));
      }
      if (pathname === "/api/rounds") {
        const teamId = url.searchParams.get("team_id");
        if (!teamId) return json({ error: "team_id is required" }, 400);
        return json(await getRounds(env.DB, teamId));
      }
      if (pathname === "/api/team" && request.method === "GET") {
        const teamId = url.searchParams.get("team_id");
        const round = url.searchParams.get("round");
        if (!teamId || !round) return json({ error: "team_id and round are required" }, 400);
        return json(await loadSelection(env.DB, teamId, round));
      }
      if (pathname === "/api/team" && (request.method === "POST" || request.method === "PUT")) {
        requireAdmin(request, env);
        const payload = await request.json();
        return json(await saveSelection(env.DB, payload));
      }
      if (pathname === "/api/team" && request.method === "DELETE") {
        requireAdmin(request, env);
        const teamId = url.searchParams.get("team_id");
        const round = url.searchParams.get("round");
        if (!teamId || !round) return json({ error: "team_id and round are required" }, 400);
        return json(await deleteSelection(env.DB, teamId, round));
      }
      if (pathname === "/api/history") {
        const teamId = url.searchParams.get("team_id");
        if (!teamId) return json({ error: "team_id is required" }, 400);
        return json(await getHistory(env.DB, teamId));
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500);
    }
  }
};
async function getGrades(db) {
  const { results } = await db.prepare(
    `SELECT t.id AS team_id, t.season_id, COALESCE(t.grade_name, t.team_name) AS grade_name, t.team_name, s.season_year
       FROM teams t JOIN seasons s ON s.id = t.season_id
      WHERE s.season_year = ?1
      ORDER BY grade_name`
  ).bind(BOARD_YEAR).all();
  return { year: BOARD_YEAR, grades: results };
}
__name(getGrades, "getGrades");
__name2(getGrades, "getGrades");
async function searchPlayers(db, search) {
  if (search.length < 2) return { players: [] };
  const like = `%${search.toLowerCase()}%`;
  const { results } = await db.prepare(
    `SELECT id AS member_id, first_name, last_name, playhq_player_id
       FROM member_directory
       WHERE role = 'player'
         AND (LOWER(first_name || ' ' || last_name) LIKE ?1 OR LOWER(last_name) LIKE ?1)
       ORDER BY last_name, first_name
       LIMIT 8`
  ).bind(like).all();
  const players = [];
  for (const p of results) {
    let jumper = null;
    if (p.playhq_player_id) {
      const row = await db.prepare(
        `SELECT player_number FROM team_sheet_players
           WHERE playhq_player_id = ?1 AND player_number IS NOT NULL AND player_number != ''
           ORDER BY fetched_at DESC LIMIT 1`
      ).bind(p.playhq_player_id).first();
      jumper = row?.player_number ?? null;
    }
    players.push({
      member_id: p.member_id,
      name: `${p.first_name} ${p.last_name}`,
      last_name: p.last_name,
      playhq_player_id: p.playhq_player_id,
      jumper
    });
  }
  return { players };
}
__name(searchPlayers, "searchPlayers");
__name2(searchPlayers, "searchPlayers");
async function getRounds(db, teamId) {
  const { results } = await db.prepare(
    `SELECT DISTINCT round_name, opponent_name, game_date, venue_name
       FROM fixtures WHERE team_id = ?1 AND round_name IS NOT NULL
       ORDER BY game_date DESC LIMIT 40`
  ).bind(teamId).all();
  return { rounds: results };
}
__name(getRounds, "getRounds");
__name2(getRounds, "getRounds");
async function loadSelection(db, teamId, round) {
  const selection = await db.prepare(
    `SELECT id, season_id, team_id, round_name, opponent_name, match_date, venue_name, status
       FROM team_selections WHERE team_id = ?1 AND round_name = ?2`
  ).bind(teamId, round).first();
  if (!selection) return { selection: null, positions: {}, interchange: [] };
  const { results: players } = await db.prepare(
    `SELECT slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number
       FROM team_selection_players WHERE selection_id = ?1`
  ).bind(selection.id).all();
  const positions = {};
  const interchange = [];
  for (const p of players) {
    const card = {
      member_id: p.member_id,
      playhq_player_id: p.playhq_player_id,
      name: p.player_name,
      jumper: p.player_number
    };
    if (p.slot_type === "interchange") interchange[p.slot_order] = card;
    else positions[p.slot] = card;
  }
  return { selection, positions, interchange: interchange.filter(Boolean) };
}
__name(loadSelection, "loadSelection");
__name2(loadSelection, "loadSelection");
async function saveSelection(db, payload) {
  const { season_id, team_id, round_name, opponent_name, match_date, venue_name, status, positions, interchange } = payload;
  if (!team_id || !round_name) throw Object.assign(new Error("team_id and round_name are required"), { status: 400 });
  if (!season_id) throw Object.assign(new Error("season_id is required"), { status: 400 });
  const boardTeam = await db.prepare(
    `SELECT s.season_year FROM teams t JOIN seasons s ON s.id = t.season_id WHERE t.id = ?1`
  ).bind(team_id).first();
  if (!boardTeam || Number(boardTeam.season_year) !== BOARD_YEAR) {
    throw Object.assign(new Error(`Only ${BOARD_YEAR} grades can be saved on the coaches board`), { status: 403 });
  }
  const allIds = [
    ...Object.values(positions || {}).map((p) => p?.member_id).filter(Boolean),
    ...(interchange || []).map((p) => p?.member_id).filter(Boolean)
  ];
  const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  if (dupes.length) throw Object.assign(new Error("A player has been selected more than once"), { status: 409 });
  const existing = await db.prepare(`SELECT id FROM team_selections WHERE team_id = ?1 AND round_name = ?2`).bind(team_id, round_name).first();
  let selectionId;
  if (existing) {
    selectionId = existing.id;
    await db.prepare(
      `UPDATE team_selections SET opponent_name = ?1, match_date = ?2, venue_name = ?3, status = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5`
    ).bind(opponent_name || null, match_date || null, venue_name || null, status || "draft", selectionId).run();
    await db.prepare(`DELETE FROM team_selection_players WHERE selection_id = ?1`).bind(selectionId).run();
  } else {
    const result = await db.prepare(
      `INSERT INTO team_selections (season_id, team_id, round_name, opponent_name, match_date, venue_name, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(season_id, team_id, round_name, opponent_name || null, match_date || null, venue_name || null, status || "draft").run();
    selectionId = result.meta.last_row_id;
  }
  const inserts = [];
  for (const [slot, card] of Object.entries(positions || {})) {
    if (!card) continue;
    inserts.push(
      db.prepare(
        `INSERT INTO team_selection_players (selection_id, slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number)
           VALUES (?1, ?2, 'field', 0, ?3, ?4, ?5, ?6)`
      ).bind(selectionId, slot, card.member_id || null, card.playhq_player_id || null, card.name, card.jumper || null)
    );
  }
  (interchange || []).forEach((card, i) => {
    if (!card) return;
    inserts.push(
      db.prepare(
        `INSERT INTO team_selection_players (selection_id, slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number)
           VALUES (?1, ?2, 'interchange', ?3, ?4, ?5, ?6, ?7)`
      ).bind(selectionId, `INTERCHANGE_${i}`, i, card.member_id || null, card.playhq_player_id || null, card.name, card.jumper || null)
    );
  });
  if (inserts.length) await db.batch(inserts);
  return { ok: true, selection_id: selectionId };
}
__name(saveSelection, "saveSelection");
__name2(saveSelection, "saveSelection");
async function deleteSelection(db, teamId, round) {
  const existing = await db.prepare(`SELECT id FROM team_selections WHERE team_id = ?1 AND round_name = ?2`).bind(teamId, round).first();
  if (!existing) return { ok: true, deleted: false };
  await db.prepare(`DELETE FROM team_selection_players WHERE selection_id = ?1`).bind(existing.id).run();
  await db.prepare(`DELETE FROM team_selections WHERE id = ?1`).bind(existing.id).run();
  return { ok: true, deleted: true };
}
__name(deleteSelection, "deleteSelection");
__name2(deleteSelection, "deleteSelection");
async function getHistory(db, teamId) {
  const { results } = await db.prepare(
    `SELECT round_name, opponent_name, match_date, status, updated_at
       FROM team_selections WHERE team_id = ?1 ORDER BY updated_at DESC LIMIT 20`
  ).bind(teamId).all();
  return { history: results };
}
__name(getHistory, "getHistory");
__name2(getHistory, "getHistory");
async function getCompareGrades(db, year) {
  const { results } = await db.prepare(
    `SELECT t.id AS team_id, COALESCE(t.grade_name, t.team_name) AS grade_name, t.team_name, s.season_year,
            COUNT(DISTINCT tsp.game_id) AS sheets
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       LEFT JOIN fixtures f ON f.team_id = t.id
       LEFT JOIN team_sheet_players tsp ON tsp.game_id = f.playhq_game_id
      WHERE s.season_year = ?1
      GROUP BY t.id
      ORDER BY grade_name`
  ).bind(year).all();
  return { year, grades: results };
}
__name(getCompareGrades, "getCompareGrades");
__name2(getCompareGrades, "getCompareGrades");
// Result + opposition team sheet for 2026 compare games. Kept out of team_sheet_players on purpose,
// so opposition names never get matched to our member_directory or jumper lookups.
var resultsTableReady = false;
async function ensureResultsTable(db) {
  if (resultsTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS compare_game_results (
       game_id TEXT PRIMARY KEY,
       team_id INTEGER,
       outcome TEXT,
       our_name TEXT, our_goals INTEGER, our_behinds INTEGER, our_score INTEGER,
       opp_name TEXT, opp_goals INTEGER, opp_behinds INTEGER, opp_score INTEGER,
       opp_players TEXT,
       synced_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  resultsTableReady = true;
}
__name(ensureResultsTable, "ensureResultsTable");
__name2(ensureResultsTable, "ensureResultsTable");
async function getCompareRounds(db, teamId) {
  await ensureResultsTable(db);
  const { results } = await db.prepare(
    `SELECT f.playhq_game_id AS game_id, f.round_name, f.opponent_name, f.game_date, f.venue_name, f.status,
            (SELECT COUNT(*) FROM team_sheet_players tsp
              WHERE tsp.game_id = f.playhq_game_id AND COALESCE(tsp.role_type, 'Player') = 'Player') AS players,
            r.outcome, r.our_score, r.opp_score,
            CASE WHEN r.game_id IS NULL THEN 0 ELSE 1 END AS has_result
       FROM fixtures f
       LEFT JOIN compare_game_results r ON r.game_id = f.playhq_game_id
      WHERE f.team_id = ?1 AND f.round_name IS NOT NULL
      ORDER BY f.game_date ASC`
  ).bind(teamId).all();
  return { rounds: results };
}
__name(getCompareRounds, "getCompareRounds");
__name2(getCompareRounds, "getCompareRounds");
async function getCompareSheet(db, gameId) {
  const game = await db.prepare(
    `SELECT f.playhq_game_id AS game_id, f.round_name, f.opponent_name, f.game_date, f.venue_name, f.status,
            COALESCE(t.grade_name, t.team_name) AS grade_name, t.team_name, s.season_year
       FROM fixtures f
       JOIN teams t ON t.id = f.team_id
       JOIN seasons s ON s.id = f.season_id
      WHERE f.playhq_game_id = ?1`
  ).bind(gameId).first();
  if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
  const { results } = await db.prepare(
    `SELECT playhq_player_id, first_name, last_name, player_number, captain_role, is_emergency, is_fill_in
       FROM team_sheet_players
      WHERE game_id = ?1 AND COALESCE(role_type, 'Player') = 'Player'
      ORDER BY is_emergency ASC, CAST(player_number AS INTEGER), last_name`
  ).bind(gameId).all();
  const players = results.map((p) => ({
    playhq_player_id: p.playhq_player_id,
    name: `${(p.first_name || "").trim()} ${(p.last_name || "").trim()}`.trim(),
    jumper: p.player_number || null,
    captain: p.captain_role || null,
    emergency: !!p.is_emergency,
    fill_in: !!p.is_fill_in
  }));
  await ensureResultsTable(db);
  const r = await db.prepare(`SELECT * FROM compare_game_results WHERE game_id = ?1`).bind(gameId).first();
  let result = null;
  let opposition = null;
  if (r) {
    result = {
      outcome: r.outcome,
      our: { name: r.our_name, goals: r.our_goals, behinds: r.our_behinds, score: r.our_score },
      opp: { name: r.opp_name, goals: r.opp_goals, behinds: r.opp_behinds, score: r.opp_score }
    };
    try { opposition = JSON.parse(r.opp_players || "[]"); } catch (e) { opposition = []; }
  }
  return { game, players, result, opposition };
}
__name(getCompareSheet, "getCompareSheet");
__name2(getCompareSheet, "getCompareSheet");

// ---------- PlayHQ sync (same calls as the admin worker, locked to COMPARE_YEAR) ----------
var PLAYHQ_BASE = "https://api.playhq.com";
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}
async function playhq(endpoint, apiKey, version = "v1") {
  const res = await fetch(`${PLAYHQ_BASE}/${version}${endpoint}`, {
    headers: { "x-api-key": apiKey, "x-phq-tenant": "afl", "Accept": "application/json" }
  });
  if (!res.ok) throw httpError(`PlayHQ ${res.status}: ${res.statusText}`, 502);
  return res.json();
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function needApiKey(apiKey) {
  if (!apiKey) throw httpError("PLAYHQ_API_KEY secret is not set on the coaches-board worker", 503);
}
async function syncCompareGame(db, apiKey, gameId) {
  needApiKey(apiKey);
  const fx = await db.prepare(
    `SELECT f.playhq_game_id, f.round_name, t.id AS team_db_id, t.playhq_team_id, s.season_year
       FROM fixtures f JOIN teams t ON t.id = f.team_id JOIN seasons s ON s.id = f.season_id
      WHERE f.playhq_game_id = ?1`
  ).bind(gameId).first();
  if (!fx) throw httpError("Game not found — sync the grade's fixtures first", 404);
  if (Number(fx.season_year) !== COMPARE_YEAR) throw httpError(`Only ${COMPARE_YEAR} games can be synced from the coaches board`, 403);

  await ensureResultsTable(db);
  // Game summary = both teams' players + outcome. Team fixture = the scores.
  const [summary, fixtureFeed] = await Promise.all([
    playhq(`/games/${gameId}/summary`, apiKey, "v2"),
    playhq(`/teams/${fx.playhq_team_id}/fixture`, apiKey).catch(() => null)
  ]);
  const appearances = summary.data?.appearances || [];
  const ours = appearances.filter((a) => a.teamId === fx.playhq_team_id);
  const theirs = appearances.filter((a) => a.teamId !== fx.playhq_team_id && (a.roleType || "Player") === "Player");

  const sumTeams = summary.data?.teams || [];
  const fxGame = (fixtureFeed?.data || []).find((g) => g.id === gameId);
  const comps = fxGame?.competitors || [];
  const sub = (c, type) => c?.scoreSubTotal?.find((s) => s.type === type)?.value ?? null;
  const usC = comps.find((c) => c.id === fx.playhq_team_id);
  const themC = comps.find((c) => c.id !== fx.playhq_team_id);
  const usT = sumTeams.find((t) => t.id === fx.playhq_team_id);
  const themT = sumTeams.find((t) => t.id !== fx.playhq_team_id);
  const oppPlayers = theirs
    .map((a) => ({
      playhq_player_id: a.id || null,
      name: `${(a.firstName || "").trim()} ${(a.lastName || "").trim()}`.trim(),
      jumper: a.playerNumber || null,
      captain: a.captainRole || null,
      fill_in: !!a.isFillIn,
      emergency: !!a.isEmergency
    }))
    .sort((a, b) => (parseInt(a.jumper) || 999) - (parseInt(b.jumper) || 999));
  const resultStmt = db.prepare(
    `INSERT INTO compare_game_results
       (game_id, team_id, outcome, our_name, our_goals, our_behinds, our_score, opp_name, opp_goals, opp_behinds, opp_score, opp_players, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
     ON CONFLICT(game_id) DO UPDATE SET
       team_id = excluded.team_id, outcome = excluded.outcome,
       our_name = excluded.our_name, our_goals = excluded.our_goals, our_behinds = excluded.our_behinds, our_score = excluded.our_score,
       opp_name = excluded.opp_name, opp_goals = excluded.opp_goals, opp_behinds = excluded.opp_behinds, opp_score = excluded.opp_score,
       opp_players = excluded.opp_players, synced_at = CURRENT_TIMESTAMP`
  ).bind(
    gameId, fx.team_db_id, usC?.outcome || usT?.outcome || null,
    usC?.name || usT?.name || null, sub(usC, "TOTAL_GOALS"), sub(usC, "TOTAL_BEHINDS"), usC?.scoreTotal ?? null,
    themC?.name || themT?.name || null, sub(themC, "TOTAL_GOALS"), sub(themC, "TOTAL_BEHINDS"), themC?.scoreTotal ?? null,
    JSON.stringify(oppPlayers)
  );

  if (!ours.length) {
    await resultStmt.run();
    return { game_id: gameId, round_name: fx.round_name, status: "NO_TEAM_SHEET", players: 0, has_result: 1 };
  }

  const players = ours.filter((a) => (a.roleType || "Player") === "Player").length;
  const sourceHash = await sha256Hex(JSON.stringify(ours));
  const stmts = [resultStmt, db.prepare(`DELETE FROM team_sheet_players WHERE game_id = ?1`).bind(gameId)];
  for (const p of ours) {
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO team_sheet_players
         (game_id, playhq_player_id, first_name, last_name, player_number, player_position, captain_role, is_fill_in, is_emergency, role_type)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(gameId, p.id, p.firstName ?? null, p.lastName ?? null, p.playerNumber ?? null, p.playerPosition || p.position || null,
      p.captainRole || null, p.isFillIn ? 1 : 0, p.isEmergency ? 1 : 0, p.roleType || "Player"));
  }
  stmts.push(db.prepare(
    `INSERT INTO team_sheet_sync_state (game_id, team_id, source_hash, synced_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
     ON CONFLICT(game_id) DO UPDATE SET team_id = excluded.team_id, source_hash = excluded.source_hash, synced_at = CURRENT_TIMESTAMP`
  ).bind(gameId, fx.team_db_id, sourceHash));
  stmts.push(db.prepare(
    `UPDATE member_directory
        SET playhq_player_id = (
          SELECT tsp.playhq_player_id FROM team_sheet_players tsp
           WHERE LOWER(TRIM(tsp.first_name)) = LOWER(TRIM(member_directory.first_name))
             AND LOWER(TRIM(tsp.last_name)) = LOWER(TRIM(member_directory.last_name))
           LIMIT 1)
      WHERE playhq_player_id IS NULL`
  ));
  await db.batch(stmts);
  return { game_id: gameId, round_name: fx.round_name, status: "UPDATED", players, has_result: 1 };
}
__name(syncCompareGame, "syncCompareGame");
__name2(syncCompareGame, "syncCompareGame");
// The opposition's team sheet for the 2027 game on the board, read live from PlayHQ (nothing is saved).
async function getUpcomingOpposition(db, apiKey, teamId, round) {
  needApiKey(apiKey);
  const fx = await db.prepare(
    `SELECT f.playhq_game_id, f.round_name, f.opponent_name, f.game_date, t.playhq_team_id, s.season_year
       FROM fixtures f JOIN teams t ON t.id = f.team_id JOIN seasons s ON s.id = f.season_id
      WHERE f.team_id = ?1 AND LOWER(TRIM(f.round_name)) = LOWER(TRIM(?2))
      ORDER BY f.game_date LIMIT 1`
  ).bind(teamId, round).first();
  if (!fx) return { status: "NO_FIXTURE", players: [] };
  if (Number(fx.season_year) !== BOARD_YEAR) throw httpError(`Only ${BOARD_YEAR} games can be checked`, 403);
  const summary = await playhq(`/games/${fx.playhq_game_id}/summary`, apiKey, "v2");
  const players = (summary.data?.appearances || [])
    .filter((a) => a.teamId !== fx.playhq_team_id && (a.roleType || "Player") === "Player")
    .map((a) => ({
      playhq_player_id: a.id || null,
      name: `${(a.firstName || "").trim()} ${(a.lastName || "").trim()}`.trim(),
      jumper: a.playerNumber || null
    }));
  return {
    status: players.length ? "OK" : "NOT_NAMED",
    round_name: fx.round_name,
    opponent_name: fx.opponent_name,
    game_date: fx.game_date,
    players
  };
}
__name(getUpcomingOpposition, "getUpcomingOpposition");
__name2(getUpcomingOpposition, "getUpcomingOpposition");
async function syncCompareFixtures(db, apiKey, teamId) {
  needApiKey(apiKey);
  const team = await db.prepare(
    `SELECT t.id, t.playhq_team_id, t.season_id, t.team_name, s.season_year
       FROM teams t JOIN seasons s ON s.id = t.season_id WHERE t.id = ?1`
  ).bind(teamId).first();
  if (!team) throw httpError("Team not found", 404);
  if (Number(team.season_year) !== COMPARE_YEAR) throw httpError(`Only ${COMPARE_YEAR} teams can be synced from the coaches board`, 403);

  const data = await playhq(`/teams/${team.playhq_team_id}/fixture`, apiKey);
  const fixtures = data.data || [];
  const stmts = fixtures.map((f) => {
    const opponent = f.competitors?.find((c) => c.id !== team.playhq_team_id);
    return db.prepare(
      `INSERT INTO fixtures
         (season_id, team_id, playhq_game_id, round_id, round_name, is_final_round, game_date, game_time, timezone,
          opponent_team_id, opponent_name, venue_id, venue_name, venue_surface, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(playhq_game_id) DO UPDATE SET
         season_id = excluded.season_id, team_id = excluded.team_id, round_id = excluded.round_id,
         round_name = excluded.round_name, is_final_round = excluded.is_final_round, game_date = excluded.game_date,
         game_time = excluded.game_time, timezone = excluded.timezone, opponent_team_id = excluded.opponent_team_id,
         opponent_name = excluded.opponent_name, venue_id = excluded.venue_id, venue_name = excluded.venue_name,
         venue_surface = excluded.venue_surface, status = excluded.status, updated_at = CURRENT_TIMESTAMP`
    ).bind(team.season_id, team.id, f.id, f.round?.id || null, f.round?.name || null, f.round?.isFinalRound ? 1 : 0,
      f.schedule?.date || null, f.schedule?.time || null, f.schedule?.timezone || null, opponent?.id || null,
      opponent?.name || null, f.venue?.id || null, f.venue?.name || null, f.venue?.surfaceName || null, f.status || null);
  });
  if (stmts.length) await db.batch(stmts);
  return { ok: true, team: team.team_name, fixtures: fixtures.length };
}
__name(syncCompareFixtures, "syncCompareFixtures");
__name2(syncCompareFixtures, "syncCompareFixtures");
function renderApp(hubUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CLFC Coaches Board</title>
<style>
${CSS}
</style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.__POSITIONS__ = ${JSON.stringify(POSITIONS)};
    window.__INTERCHANGE_COUNT__ = ${INTERCHANGE_COUNT};
    window.__COMPARE_YEAR__ = ${COMPARE_YEAR};
    window.__HUB_URL__ = ${JSON.stringify(hubUrl)};
  <\/script>
  <script>${JS}<\/script>
</body>
</html>`;
}
__name(renderApp, "renderApp");
__name2(renderApp, "renderApp");
var CSS = `
:root {
  --navy: #0a1730;
  --navy-2: #0f2245;
  --red: #d4283a;
  --red-dark: #a91f2e;
  --silver: #b8c2d4;
  --glow: rgba(70, 120, 220, .35);
  --ink: #0a1220;
  --paper: #f4f5f8;
  --line: rgba(255,255,255,.14);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(circle at 15% 0%, var(--navy-2), var(--navy) 55%) fixed;
  color: #fff;
  min-height: 100vh;
}
h1, h2, h3, .display { font-family: "Oswald", "Arial Narrow", sans-serif; text-transform: uppercase; letter-spacing: .02em; }
button { font-family: inherit; cursor: pointer; border: 0; }
input, select { font-family: inherit; }

#app { max-width: 1180px; margin: 0 auto; padding: 20px 18px 60px; }

.masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border: 1px solid var(--line); background: linear-gradient(100deg, rgba(10,23,48,.9), rgba(15,34,69,.7)); margin-bottom: 18px; box-shadow: 0 16px 40px rgba(0,0,0,.3); }
.masthead .brand { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(160deg, var(--red), var(--red-dark)); display: grid; place-items: center; font: 900 16px/1 "Oswald", sans-serif; box-shadow: 0 0 0 3px rgba(255,255,255,.08), 0 0 24px var(--glow); }
.masthead h1 { font-size: 20px; letter-spacing: .06em; }
.masthead .sub { color: var(--silver); font-size: 11px; letter-spacing: .1em; }
.present-toggle { background: rgba(255,255,255,.08); color: #fff; padding: 9px 16px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; border: 1px solid var(--line); }
.present-toggle:hover { background: rgba(255,255,255,.16); }

.controls-bar { display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: 10px; margin-bottom: 16px; }
.controls-bar .field { display: flex; flex-direction: column; gap: 4px; }
.controls-bar label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--silver); }
.controls-bar select, .controls-bar input { padding: 10px 11px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: #fff; font-size: 13px; }
.controls-bar select option { color: #000; }
.controls-bar input::placeholder { color: rgba(255,255,255,.35); }
.round-list-wrap { position: relative; }
.round-suggest { position: absolute; top: 100%; left: 0; right: 0; background: #101f3f; border: 1px solid var(--line); z-index: 20; max-height: 160px; overflow: auto; }
.round-suggest div { padding: 8px 11px; font-size: 12px; cursor: pointer; }
.round-suggest div:hover { background: rgba(255,255,255,.08); }
.action-buttons { display: flex; align-items: flex-end; gap: 8px; }
.action-buttons button { padding: 10px 14px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
.btn-primary { background: var(--red); color: #fff; }
.btn-primary:hover { background: var(--red-dark); }
.btn-ghost { background: rgba(255,255,255,.08); color: #fff; border: 1px solid var(--line); }
.btn-ghost:hover { background: rgba(255,255,255,.16); }

.team-banner { text-align: center; padding: 18px; border: 1px solid var(--line); background: rgba(255,255,255,.03); margin-bottom: 18px; }
.team-banner .club { font-size: 12px; letter-spacing: .18em; color: var(--silver); }
.team-banner .grade { font: 900 30px/1.05 "Oswald", sans-serif; margin: 4px 0; }
.team-banner .round { font-size: 13px; color: var(--silver); letter-spacing: .08em; margin-bottom: 6px; }
.team-banner .versus { display: flex; align-items: center; justify-content: center; gap: 14px; font: 700 18px "Oswald", sans-serif; }
.team-banner .versus .vs { color: var(--red); font-size: 12px; letter-spacing: .2em; }

.board-layout { display: grid; grid-template-columns: 1fr 220px; gap: 18px; }
.oval-wrap { position: relative; aspect-ratio: 4 / 5; background:
    radial-gradient(ellipse at center, #1c5c33 0%, #164a29 70%, #123f22 100%);
  border-radius: 50% / 42%;
  border: 3px solid rgba(255,255,255,.5);
  box-shadow: inset 0 0 60px rgba(0,0,0,.4), 0 20px 50px rgba(0,0,0,.4);
  overflow: hidden;
}
/* 50m arcs, top (defensive) and bottom (forward) */
.oval-wrap::before, .oval-wrap::after {
  content: ""; position: absolute; left: 15%; right: 15%; height: 34%;
  border: 1px dashed rgba(255,255,255,.35); border-bottom: 0; border-radius: 50% 50% 0 0;
}
.oval-wrap::before { top: 6%; }
.oval-wrap::after { bottom: 6%; transform: rotate(180deg); }

/* Lines separating backs / middle third / forwards, matching guernsey structure */
.third-line { position: absolute; left: 4%; right: 4%; height: 0; border-top: 1px dashed rgba(255,255,255,.3); }
.third-line.top { top: 33%; }
.third-line.bottom { top: 67%; }

/* Centre square housing ruck / ruck-rover / centre / rover */
.centre-square { position: absolute; left: 28%; right: 28%; top: 36%; height: 30%; border: 1px solid rgba(255,255,255,.4); }
.centre-circle { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 1px solid rgba(255,255,255,.5); border-radius: 50%; }

.arc-label { position: absolute; font: 700 13px "Oswald", sans-serif; color: rgba(255,255,255,.55); letter-spacing: .04em; }
.arc-label.top { top: 3%; right: 4%; }
.arc-label.bottom { bottom: 3%; left: 4%; }
.line-label { position: absolute; left: -2px; font: 700 9px "Oswald", sans-serif; letter-spacing: .12em; color: rgba(255,255,255,.4); writing-mode: vertical-rl; text-orientation: mixed; }
.line-label.backs { top: 6%; }
.line-label.forwards { bottom: 6%; }

.slot { position: absolute; transform: translate(-50%, -50%); width: 88px; text-align: center; z-index: 5; }
.slot-card { cursor: pointer; transition: transform .12s ease; user-select: none; padding-bottom: 2px; }
.slot-card:hover { transform: translateY(-2px); }
.slot-card.dragover .jumper { outline: 2px solid #fff; }
.slot-card .jumper { font: 900 13px "Oswald", sans-serif; color: #fff; padding: 3px 4px; line-height: 1.1; }
.slot-card .pname { font-size: 10px; font-weight: 700; color: #fff; padding: 3px 4px; line-height: 1.2; margin-top: 1px; }
.slot-card .pos-label { font-size: 8px; letter-spacing: .07em; color: rgba(255,255,255,.85); text-transform: uppercase; margin-top: 3px; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.slot-card[data-line="back"] .jumper, .slot-card[data-line="back"] .pname { background: var(--red); }
.slot-card[data-line="back"] .pname { background: var(--red-dark); }
.slot-card[data-line="mid"] .jumper { background: #1c4fa8; }
.slot-card[data-line="mid"] .pname { background: #163d84; }
.slot-card[data-line="forward"] .jumper { background: #1c7a3c; }
.slot-card[data-line="forward"] .pname { background: #155c2d; }
.slot-card.empty .jumper, .slot-card.empty .pname { background: rgba(255,255,255,.08); border: 1px dashed rgba(255,255,255,.3); color: rgba(255,255,255,.55); }
.slot-card.empty .pname { font-weight: 400; }
.slot-card .remove-x { position: absolute; top: -7px; right: -7px; width: 17px; height: 17px; border-radius: 50%; background: var(--red); font-size: 11px; line-height: 17px; display: none; z-index: 6; }
.slot-card:hover .remove-x { display: block; }
/* Board name-only cards (2027 board) */
.slot-card .pname.solo { font-size: 11px; padding: 6px 4px; line-height: 1.15; margin-top: 0; }
.slot-card[data-line="back"] .pname.solo { background: var(--red); }
.slot-card[data-line="mid"] .pname.solo { background: #1c4fa8; }
.slot-card[data-line="forward"] .pname.solo { background: #1c7a3c; }
.slot-card.empty .pname.solo { background: rgba(255,255,255,.08); }
.interchange-slot .pname.ic-name { font-size: 13px; padding: 0; background: none; }

.interchange-panel { border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 14px; height: fit-content; }
.interchange-panel h3 { font-size: 12px; letter-spacing: .1em; margin-bottom: 10px; color: var(--silver); }
.interchange-slot { position: relative; margin-bottom: 8px; }
.interchange-slot .slot-card { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; padding: 8px; }
.interchange-slot .num { font: 900 11px "Oswald"; color: var(--silver); width: 14px; }

.selector-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(4,10,22,.8); display: none; align-items: center; justify-content: center; padding: 20px; }
.selector-overlay.show { display: flex; }
.selector-modal { width: min(380px, 100%); background: #0f2245; border: 1px solid var(--line); border-top: 4px solid var(--red); padding: 18px; }
.selector-modal h4 { font-size: 12px; letter-spacing: .1em; color: var(--silver); margin-bottom: 10px; }
.selector-modal input { width: 100%; padding: 11px; background: rgba(255,255,255,.08); border: 1px solid var(--line); color: #fff; font-size: 14px; margin-bottom: 8px; }
.selector-results div { padding: 9px 8px; font-size: 13px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,.06); }
.selector-results div:hover { background: rgba(255,255,255,.08); }
.selector-results .empty { color: rgba(255,255,255,.4); cursor: default; }
.selector-close { margin-top: 10px; width: 100%; padding: 9px; background: rgba(255,255,255,.08); color: #fff; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }

.status-line { margin-top: 14px; font-size: 11px; color: var(--silver); text-align: center; min-height: 16px; }
.status-line.err { color: #ff8a93; }
.status-line.ok { color: #7fe0a0; }

.presenting .controls-bar, .presenting .action-buttons, .presenting .interchange-panel h3 { }
body.presenting .controls-bar, body.presenting .action-buttons-wrap, body.presenting .present-toggle span.edit-label { display: none; }
body.presenting .slot-card .remove-x { display: none !important; }
body.presenting #app { max-width: 720px; }

/* Back to hub */
.back-btn { display: inline-flex; align-items: center; gap: 6px; color: #fff; text-decoration: none; background: rgba(255,255,255,.08); border: 1px solid var(--line); padding: 9px 14px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.back-btn:hover { background: rgba(255,255,255,.16); }
.masthead-right { display: flex; gap: 8px; align-items: center; }
body.presenting .back-btn { display: none; }

/* 2026 compare bar */
.compare-bar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); background: rgba(255,255,255,.03); margin-bottom: 16px; }
.compare-bar .field { display: flex; flex-direction: column; gap: 4px; min-width: 200px; flex: 1; }
.compare-bar label.flabel { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--silver); }
.compare-bar select { padding: 10px 11px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: #fff; font-size: 13px; }
.compare-bar select option { color: #000; }
.compare-bar .hint { font-size: 12px; color: var(--silver); align-self: center; }
.toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; align-self: center; user-select: none; }
.toggle input { display: none; }
.toggle .track { width: 42px; height: 22px; border-radius: 11px; background: rgba(255,255,255,.15); position: relative; transition: background .15s; }
.toggle .knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.toggle input:checked + .track { background: var(--red); }
.toggle input:checked + .track .knob { left: 23px; }
.toggle .tlabel { font: 700 14px "Oswald", sans-serif; letter-spacing: .06em; text-transform: uppercase; }
body.presenting .compare-bar { display: none; }

/* 2026 compare pop-up */
.cmp-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(4,10,22,.85); display: flex; align-items: flex-start; justify-content: center; padding: 20px; overflow: auto; }
.cmp-modal { width: min(980px, 100%); background: #0c1c3a; border: 1px solid var(--line); border-top: 4px solid var(--silver); padding: 16px; position: relative; }
.cmp-close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; background: rgba(255,255,255,.1); color: #fff; font-size: 18px; }
.cmp-close:hover { background: var(--red); }
.cmp-head { text-align: center; margin-bottom: 14px; padding-right: 30px; padding-left: 30px; }
.cmp-head .tag { display: inline-block; background: var(--silver); color: var(--navy); font: 700 11px "Oswald", sans-serif; letter-spacing: .14em; padding: 3px 10px; margin-bottom: 6px; }
.cmp-head .grade { font: 900 24px/1.1 "Oswald", sans-serif; text-transform: uppercase; }
.cmp-head .round { font-size: 12px; color: var(--silver); letter-spacing: .08em; margin: 4px 0 6px; text-transform: uppercase; }
.cmp-head .versus { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; font: 700 16px "Oswald", sans-serif; text-transform: uppercase; }
.cmp-head .versus .vs { color: var(--red); font-size: 11px; letter-spacing: .2em; }
.cmp-modal .board-layout { grid-template-columns: 1fr 220px; }
.cmp-modal .oval-wrap { max-width: 560px; width: 100%; margin: 0 auto; }
.cmp-modal .oval-wrap { filter: saturate(.75); }
.slot-card.cmp { cursor: default; }
.slot-card.cmp:hover { transform: none; }
.slot-card.cmp.match .jumper { box-shadow: inset 0 0 0 2px #ffd34d; }
.slot-card.cmp.match .pname::after { content: " \\2605"; color: #ffd34d; }
.cmp-side h3 { font-size: 12px; letter-spacing: .1em; margin: 0 0 8px; color: var(--silver); }
.cmp-side .ic-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; margin-bottom: 6px; background: rgba(255,255,255,.05); font-size: 12px; }
.cmp-side .ic-row .jn { font: 900 13px "Oswald", sans-serif; min-width: 30px; }
.cmp-side .ic-row.match { box-shadow: inset 3px 0 0 #ffd34d; }
.cmp-side .ic-row.emg { opacity: .75; }
.cmp-side .panel { border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 12px; margin-bottom: 12px; }
.cmp-summary { font-size: 12px; color: var(--silver); line-height: 1.5; }
.cmp-summary strong { color: #ffd34d; }
.cmp-empty { text-align: center; padding: 40px 10px; color: var(--silver); font-size: 14px; }
.scoreline { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; max-width: 620px; margin: 8px auto 0; }
.scoreline .team { text-transform: uppercase; }
.scoreline .us { text-align: right; }
.scoreline .them { text-align: left; }
.scoreline .tname { font: 700 15px "Oswald", sans-serif; letter-spacing: .04em; }
.scoreline .tscore { font: 900 26px/1.1 "Oswald", sans-serif; margin-top: 2px; }
.scoreline .vs { color: var(--red); font-size: 11px; letter-spacing: .2em; }
.outcome { display: inline-block; padding: 5px 10px; font: 700 12px "Oswald", sans-serif; letter-spacing: .14em; }
.outcome.won { background: #1c7a3c; }
.outcome.lost { background: var(--red); }
.outcome.draw { background: #6b7a90; }
.opp-panel { margin-top: 16px; border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 12px; }
.opp-panel h3 { font-size: 12px; letter-spacing: .1em; margin-bottom: 10px; color: var(--silver); text-transform: uppercase; }
.opp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.opp-row { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: rgba(255,255,255,.05); font-size: 12px; }
.opp-row .jn { font: 900 13px "Oswald", sans-serif; min-width: 30px; color: var(--silver); }
.opp-row.emg { opacity: .7; }
.opp-row .on { flex: 1; }
.opp-row.match27 { background: rgba(255,140,40,.18); box-shadow: inset 3px 0 0 #ff8c28; opacity: 1; }
.opp-row.match27 .on { font-weight: 700; }
.tag27 { background: #ff8c28; color: #1a0e02; font: 700 10px "Oswald", sans-serif; letter-spacing: .06em; padding: 2px 6px; white-space: nowrap; }
.up-note { font-size: 12px; color: var(--silver); margin: -4px 0 10px; line-height: 1.45; }
.up-note.hit strong { color: #ff8c28; font-size: 14px; }
@media (max-width: 560px) { .scoreline .tname { font-size: 12px; } .scoreline .tscore { font-size: 20px; } }
.cmp-reopen { padding: 10px 14px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; background: rgba(255,255,255,.08); color: #fff; border: 1px solid var(--line); white-space: nowrap; }
.cmp-reopen:hover { background: rgba(255,255,255,.16); }
.cmp-reopen:disabled { opacity: .6; cursor: wait; }
.cmp-resync { position: absolute; top: 10px; left: 10px; padding: 8px 10px; font-size: 10px; }
@media (max-width: 860px) { .cmp-resync { position: static; margin-bottom: 10px; } }

@media (max-width: 860px) {
  .board-layout, .cmp-modal .board-layout { grid-template-columns: 1fr; }
  .masthead { flex-wrap: wrap; }
  .compare-bar .field { min-width: 0; flex-basis: 100%; }
  .controls-bar { grid-template-columns: 1fr 1fr; }
  .action-buttons { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; }
  .slot { width: 76px; }
  .slot-card .pname { font-size: 9px; }
}
`;
var JS = `
const POSITIONS = window.__POSITIONS__;
const IC_COUNT = window.__INTERCHANGE_COUNT__;
const CMP_YEAR = window.__COMPARE_YEAR__;
const HUB_URL = window.__HUB_URL__ || "/";
const app = document.getElementById("app");

let state = {
  grades: [],
  teamId: null,
  season_id: null,
  round: "",
  opponent: "",
  matchDate: "",
  venue: "",
  positions: {},
  interchange: Array(IC_COUNT).fill(null),
  activeSlot: null, // { type: 'field'|'interchange', slot, index }
  presenting: false,
  cmp: { on: false, grades: [], teamId: "", rounds: [], gameId: "", data: null, open: false, loading: false, error: "" },
};

let ADMIN_PASS = "";
async function api(path, opts, retried) {
  opts = Object.assign({}, opts || {});
  opts.headers = Object.assign({}, opts.headers || {}, ADMIN_PASS ? { "x-admin-passcode": ADMIN_PASS } : {});
  const res = await fetch(path, opts);
  const data = await res.json();
  if (res.status === 401 && !retried) {
    const p = prompt("Enter the admin passcode:");
    if (p) { ADMIN_PASS = p.trim(); return api(path, opts, true); }
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function allSelectedIds() {
  return [
    ...Object.values(state.positions).map((p) => p && p.member_id).filter(Boolean),
    ...state.interchange.map((p) => p && p.member_id).filter(Boolean),
  ];
}

function setStatus(msg, kind) {
  const el = document.getElementById("statusLine");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status-line" + (kind ? " " + kind : "");
}

async function init() {
  render();
  try {
    const { grades } = await api("/api/grades");
    state.grades = grades;
    if (grades.length) {
      state.teamId = String(grades[0].team_id);
      state.season_id = null; // resolved server-side from team
    }
    render();
  } catch (e) {
    setStatus("Could not load grades: " + e.message, "err");
  }
}

function currentGrade() {
  return state.grades.find((g) => String(g.team_id) === String(state.teamId));
}

function render() {
  document.body.classList.toggle("presenting", state.presenting);
  app.innerHTML = \`
    <header class="masthead">
      <div class="brand">
        <div class="brand-mark">CL</div>
        <div>
          <h1>Cockburn Lakes Coaches Board</h1>
          <div class="sub">CLFC 2027 Season</div>
        </div>
      </div>
      <div class="masthead-right">
        <a class="back-btn" href="\${escapeAttr(HUB_URL)}">&larr; Back to Hub</a>
        <button class="present-toggle" id="presentBtn">
          <span class="edit-label">\${state.presenting ? "Exit Present" : "Present"}</span>
          \${state.presenting ? "" : "&nbsp;\xB7 Present Mode"}
        </button>
      </div>
    </header>

    <div class="controls-bar">
      <div class="field">
        <label>Grade</label>
        <select id="gradeSelect"\${state.grades.length ? "" : " disabled"}>
          \${state.grades.length
            ? state.grades
                .map((g) => \`<option value="\${g.team_id}" \${String(g.team_id) === String(state.teamId) ? "selected" : ""}>\${g.grade_name}</option>\`)
                .join("")
            : '<option value="">No ' + (CMP_YEAR + 1) + ' grades yet</option>'}
        </select>
      </div>
      <div class="field round-list-wrap">
        <label>Round</label>
        <input id="roundInput" placeholder="e.g. Round 7" value="\${escapeAttr(state.round)}" autocomplete="off">
        <div class="round-suggest" id="roundSuggest" style="display:none"></div>
      </div>
      <div class="field">
        <label>Opponent</label>
        <input id="opponentInput" placeholder="Opponent club" value="\${escapeAttr(state.opponent)}">
      </div>
      <div class="field">
        <label>Match date</label>
        <input id="dateInput" type="date" value="\${escapeAttr(state.matchDate)}">
      </div>
      <div class="action-buttons action-buttons-wrap">
        <button class="btn-ghost" id="loadBtn">Load</button>
        <button class="btn-ghost" id="clearBtn">Clear</button>
        <button class="btn-primary" id="saveBtn">Save Team</button>
      </div>
    </div>

    \${renderCompareBar()}

    <div class="team-banner">
      <div class="club">COCKBURN LAKES FOOTBALL CLUB</div>
      <div class="grade">\${currentGrade() ? currentGrade().grade_name : "SELECT A GRADE"}</div>
      <div class="round">\${state.round ? state.round.toUpperCase() : "ROUND \u2014"}\${state.venue ? " \xB7 " + state.venue : ""}</div>
      <div class="versus">
        <span>COCKBURN LAKES</span>
        <span class="vs">VS</span>
        <span>\${state.opponent ? state.opponent.toUpperCase() : "OPPONENT"}</span>
      </div>
    </div>

    <div class="board-layout">
      <div class="oval-wrap" id="oval">
        <div class="arc-label top">50</div>
        <div class="arc-label bottom">50</div>
        <div class="line-label backs">BACKS</div>
        <div class="line-label forwards">FORWARDS</div>
        <div class="third-line top"></div>
        <div class="third-line bottom"></div>
        <div class="centre-square"></div>
        <div class="centre-circle"></div>
        \${POSITIONS.map((pos) => renderSlot(pos)).join("")}
      </div>
      <div class="interchange-panel">
        <h3>Interchange</h3>
        \${Array.from({ length: IC_COUNT })
          .map((_, i) => renderInterchangeSlot(i))
          .join("")}
      </div>
    </div>

    <div class="status-line" id="statusLine"></div>

    <div class="selector-overlay" id="selectorOverlay">
      <div class="selector-modal">
        <h4>Select Player</h4>
        <input id="playerSearch" placeholder="Start typing name\u2027" autocomplete="off">
        <div class="selector-results" id="selectorResults"></div>
        <button class="selector-close" id="selectorClose">Cancel</button>
      </div>
    </div>

    \${renderCompareModal()}
  \`;

  bindEvents();
}

function renderSlot(pos) {
  const card = state.positions[pos.id];
  return \`
    <div class="slot" style="left:\${pos.x}%; top:\${pos.y}%;">
      <div class="slot-card \${card ? "" : "empty"}" data-slot="\${pos.id}" data-type="field" data-line="\${pos.line}" draggable="\${card ? "true" : "false"}">
        \${card ? '<div class="remove-x" data-remove-slot="' + pos.id + '" data-remove-type="field">\xD7</div>' : ""}
        \${card ? \`<div class="pname solo">\${escapeHtml(card.name)}</div>\` : \`<div class="pname solo">Tap to add</div>\`}
        <div class="pos-label">\${pos.label}</div>
      </div>
    </div>\`;
}

function renderInterchangeSlot(i) {
  const card = state.interchange[i];
  return \`
    <div class="interchange-slot">
      <div class="slot-card \${card ? "" : "empty"}" data-slot="\${i}" data-type="interchange" draggable="\${card ? "true" : "false"}">
        \${card ? '<div class="remove-x" data-remove-slot="' + i + '" data-remove-type="interchange">\xD7</div>' : ""}
        <div class="num">\${i + 1}</div>
        \${card ? \`<div class="pname ic-name">\${escapeHtml(card.name)}</div>\` : '<div class="pname">Add player</div>'}
      </div>
    </div>\`;
}

function initialLastName(fullName) {
  const parts = fullName.trim().split(" ");
  const last = parts.pop();
  const first = parts.join(" ");
  return (first ? first[0] + ". " : "") + last;
}

function escapeAttr(v) {
  return (v || "").replace(/"/g, "&quot;");
}

function bindEvents() {
  document.getElementById("presentBtn").onclick = () => {
    state.presenting = !state.presenting;
    render();
  };

  const gradeSelect = document.getElementById("gradeSelect");
  if (gradeSelect) {
    gradeSelect.onchange = (e) => {
      state.teamId = e.target.value;
      state.positions = {};
      state.interchange = Array(IC_COUNT).fill(null);
      state.round = "";
      render();
    };
  }

  const roundInput = document.getElementById("roundInput");
  if (roundInput) {
    roundInput.oninput = (e) => {
      state.round = e.target.value;
    };
    roundInput.onfocus = loadRoundSuggestions;
    roundInput.onblur = () => setTimeout(() => {
      const s = document.getElementById("roundSuggest");
      if (s) s.style.display = "none";
    }, 150);
  }

  const opponentInput = document.getElementById("opponentInput");
  if (opponentInput) opponentInput.oninput = (e) => (state.opponent = e.target.value);

  const dateInput = document.getElementById("dateInput");
  if (dateInput) dateInput.oninput = (e) => (state.matchDate = e.target.value);

  const loadBtn = document.getElementById("loadBtn");
  if (loadBtn) loadBtn.onclick = loadSelection;

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.onclick = () => {
    if (!confirm("Clear the board? Unsaved changes will be lost.")) return;
    state.positions = {};
    state.interchange = Array(IC_COUNT).fill(null);
    render();
  };

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.onclick = saveSelection;

  bindCompareEvents();

  document.querySelectorAll(".slot-card:not(.cmp)").forEach((card) => {
    card.addEventListener("click", () => openSelector(card.dataset.type, card.dataset.slot));
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: card.dataset.type, slot: card.dataset.slot }));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("dragover");
    });
    card.addEventListener("dragleave", () => card.classList.remove("dragover"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("dragover");
      const from = JSON.parse(e.dataTransfer.getData("text/plain"));
      const to = { type: card.dataset.type, slot: card.dataset.slot };
      swapSlots(from, to);
    });
  });

  document.querySelectorAll("[data-remove-slot]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromSlot(btn.dataset.removeType, btn.dataset.removeSlot);
    });
  });

  const selectorClose = document.getElementById("selectorClose");
  if (selectorClose) selectorClose.onclick = closeSelector;
  const overlay = document.getElementById("selectorOverlay");
  if (overlay) overlay.onclick = (e) => { if (e.target === overlay) closeSelector(); };
}

function getSlotValue(type, slot) {
  return type === "interchange" ? state.interchange[Number(slot)] : state.positions[slot];
}
function setSlotValue(type, slot, value) {
  if (type === "interchange") state.interchange[Number(slot)] = value;
  else state.positions[slot] = value;
}

function swapSlots(from, to) {
  if (from.type === to.type && from.slot === to.slot) return;
  const a = getSlotValue(from.type, from.slot);
  const b = getSlotValue(to.type, to.slot);
  setSlotValue(from.type, from.slot, b);
  setSlotValue(to.type, to.slot, a);
  render();
}

function removeFromSlot(type, slot) {
  setSlotValue(type, slot, null);
  render();
}

function openSelector(type, slot) {
  state.activeSlot = { type, slot };
  document.getElementById("selectorOverlay").classList.add("show");
  const input = document.getElementById("playerSearch");
  input.value = "";
  input.focus();
  document.getElementById("selectorResults").innerHTML = "";
  let t;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => runPlayerSearch(input.value), 250);
  };
}

function closeSelector() {
  document.getElementById("selectorOverlay").classList.remove("show");
  state.activeSlot = null;
}

async function runPlayerSearch(q) {
  const box = document.getElementById("selectorResults");
  if (!q || q.trim().length < 2) {
    box.innerHTML = '<div class="empty">Keep typing\u2027 (2+ letters)</div>';
    return;
  }
  try {
    const { players } = await api("/api/players?search=" + encodeURIComponent(q.trim()));
    const already = allSelectedIds();
    const filtered = players.filter((p) => !already.includes(p.member_id));
    if (!filtered.length) {
      box.innerHTML = '<div class="empty">No matching, available players</div>';
      return;
    }
    box.innerHTML = filtered
      .map(
        (p) =>
          \`<div data-mid="\${p.member_id}">\${p.name}\${p.jumper ? " \u2014 #" + p.jumper : ""}</div>\`
      )
      .join("");
    box.querySelectorAll("[data-mid]").forEach((row, i) => {
      row.onclick = () => {
        const player = filtered[i];
        setSlotValue(state.activeSlot.type, state.activeSlot.slot, {
          member_id: player.member_id,
          playhq_player_id: player.playhq_player_id,
          name: player.name,
          jumper: player.jumper,
        });
        closeSelector();
        render();
      };
    });
  } catch (e) {
    box.innerHTML = '<div class="empty">Search failed: ' + e.message + "</div>";
  }
}

async function loadRoundSuggestions() {
  if (!state.teamId) return;
  try {
    const { rounds } = await api("/api/rounds?team_id=" + state.teamId);
    const box = document.getElementById("roundSuggest");
    if (!rounds.length) return;
    box.innerHTML = rounds
      .map(
        (r) =>
          \`<div data-round="\${escapeAttr(r.round_name)}" data-opp="\${escapeAttr(r.opponent_name || "")}" data-date="\${escapeAttr(r.game_date || "")}" data-venue="\${escapeAttr(r.venue_name || "")}">\${r.round_name}\${r.opponent_name ? " \u2014 vs " + r.opponent_name : ""}</div>\`
      )
      .join("");
    box.style.display = "block";
    box.querySelectorAll("[data-round]").forEach((row) => {
      row.onclick = () => {
        state.round = row.dataset.round;
        state.opponent = row.dataset.opp || state.opponent;
        state.matchDate = (row.dataset.date || "").slice(0, 10);
        state.venue = row.dataset.venue || state.venue;
        box.style.display = "none";
        render();
      };
    });
  } catch (e) {
    // silent \u2014 suggestions are optional
  }
}

async function loadSelection() {
  if (!state.teamId || !state.round) {
    setStatus("Choose a grade and round first.", "err");
    return;
  }
  try {
    const data = await api("/api/team?team_id=" + state.teamId + "&round=" + encodeURIComponent(state.round));
    if (!data.selection) {
      setStatus("No saved team found for that round yet.", "");
      return;
    }
    state.opponent = data.selection.opponent_name || "";
    state.matchDate = (data.selection.match_date || "").slice(0, 10);
    state.venue = data.selection.venue_name || "";
    state.positions = data.positions || {};
    state.interchange = Array(IC_COUNT).fill(null).map((_, i) => data.interchange[i] || null);
    render();
    setStatus("Loaded saved team.", "ok");
  } catch (e) {
    setStatus("Could not load team: " + e.message, "err");
  }
}

async function saveSelection() {
  if (!state.teamId || !state.round.trim()) {
    setStatus("Grade and round are required before saving.", "err");
    return;
  }
  if (!state.opponent.trim()) {
    setStatus("Enter an opponent before saving.", "err");
    return;
  }
  const grade = currentGrade();
  try {
    const res = await api("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season_id: grade ? grade.season_id || null : null,
        team_id: state.teamId,
        round_name: state.round.trim(),
        opponent_name: state.opponent.trim(),
        match_date: state.matchDate || null,
        venue_name: state.venue || null,
        status: "saved",
        positions: state.positions,
        interchange: state.interchange,
      }),
    });
    setStatus("Team saved.", "ok");
  } catch (e) {
    setStatus("Save failed: " + e.message, "err");
  }
}

/* ---------- 2026 season compare ---------- */

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function boardKeys() {
  const keys = new Set();
  const cards = [...Object.values(state.positions), ...state.interchange].filter(Boolean);
  cards.forEach((c) => {
    if (c.playhq_player_id) keys.add("id:" + c.playhq_player_id);
    if (c.name) keys.add("n:" + c.name.trim().toLowerCase());
  });
  return keys;
}

function isOnBoard(p, keys) {
  return (p.playhq_player_id && keys.has("id:" + p.playhq_player_id)) || keys.has("n:" + (p.name || "").trim().toLowerCase());
}

// ---------- Opposition's 2027 team sheet (for the round on the 2027 board) ----------
function playerKeys(p) {
  const keys = [];
  if (p.playhq_player_id) keys.push("id:" + p.playhq_player_id);
  if (p.name) keys.push("n:" + p.name.trim().toLowerCase().replace(/\\s+/g, " "));
  return keys;
}

async function loadUpcomingOpposition(force) {
  const c = state.cmp;
  const key = (state.teamId || "") + "|" + (state.round || "").trim().toLowerCase();
  if (!state.teamId || !state.round.trim()) {
    c.upcoming = { key, status: "NO_ROUND" };
    render();
    return;
  }
  // Only a found team sheet is kept; "not named yet" is re-checked each time the pop-up opens.
  if (!force && c.upcoming && c.upcoming.key === key && c.upcoming.status === "OK") return;
  c.upcoming = { key, status: "LOADING" };
  render();
  try {
    const data = await api("/api/upcoming-opposition?team_id=" + encodeURIComponent(state.teamId) + "&round=" + encodeURIComponent(state.round.trim()));
    if (!c.upcoming || c.upcoming.key !== key) return; // board changed while loading
    c.upcoming = Object.assign({ key }, data);
  } catch (e) {
    c.upcoming = { key, status: "ERROR", error: e.message };
  }
  render();
}

// Works out which 2026 opposition players are also named in the opposition's 2027 team sheet.
function upcomingInfo(oppPlayers) {
  const u = state.cmp.upcoming || { status: "NO_ROUND" };
  const nextYr = CMP_YEAR + 1;
  const index = new Map();
  (u.status === "OK" ? u.players : []).forEach((p) => playerKeys(p).forEach((k) => { if (!index.has(k)) index.set(k, p); }));
  const match = (p) => {
    for (const k of playerKeys(p)) if (index.has(k)) return index.get(k);
    return null;
  };
  const count = oppPlayers.filter((p) => match(p)).length;
  const opponent = u.opponent_name || "the opposition";
  const round = u.round_name || state.round || "";
  // Only say anything about 2027 once the opposition's 2027 team sheet is actually on PlayHQ.
  // Not named yet, still loading, no round picked, or any error: show the 2026 info only.
  const note = u.status === "OK"
    ? "<strong>" + count + "</strong> of these players " + (count === 1 ? "is" : "are") + " named for " + escapeHtml(opponent) +
      " in " + escapeHtml(round) + " " + nextYr + "."
    : "";
  return { match, count, note, opponent, round };
}

// Every sync writes a result row, so a round with no result row has never been synced from here.
function needsSyncRound(r) {
  return !r.has_result;
}

function roundResultTag(r) {
  if (!r.outcome && r.our_score == null) return "";
  const o = String(r.outcome || "").toUpperCase();
  const letter = o === "WON" ? "W" : o === "LOST" ? "L" : o.startsWith("DR") ? "D" : "";
  const score = r.our_score != null && r.opp_score != null ? " " + r.our_score + "–" + r.opp_score : "";
  return " \xB7 " + letter + score;
}

function fmtScore(t) {
  if (!t || t.score == null) return "";
  return (t.goals != null && t.behinds != null ? t.goals + "." + t.behinds + " " : "") + "(" + t.score + ")";
}

function renderCompareBar() {
  const c = state.cmp;
  let html = '<div class="compare-bar">' +
    '<label class="toggle"><input type="checkbox" id="cmpToggle"' + (c.on ? " checked" : "") + '>' +
    '<span class="track"><span class="knob"></span></span><span class="tlabel">' + CMP_YEAR + ' Season</span></label>';
  if (!c.on) {
    html += '<span class="hint">Switch on to pull up a ' + CMP_YEAR + ' team sheet and compare it with your board.</span>';
    return html + "</div>";
  }
  html += '<div class="field"><label class="flabel">' + CMP_YEAR + ' Grade</label><select id="cmpGrade">' +
    '<option value="">Select grade…</option>' +
    c.grades.map((g) =>
      '<option value="' + g.team_id + '"' + (String(g.team_id) === String(c.teamId) ? " selected" : "") + ">" +
      escapeHtml(g.grade_name) + "</option>"
    ).join("") + "</select></div>";
  html += '<div class="field"><label class="flabel">' + CMP_YEAR + ' Round</label><select id="cmpRound"' + (c.teamId ? "" : " disabled") + ">" +
    '<option value="">' + (c.teamId ? "Select round…" : "Pick a grade first") + "</option>" +
    c.rounds.map((r) =>
      '<option value="' + escapeHtml(r.game_id) + '"' + (r.game_id === c.gameId ? " selected" : "") + ">" +
      escapeHtml(r.round_name) + (r.opponent_name ? " — vs " + escapeHtml(r.opponent_name) : "") +
      roundResultTag(r) +
      (r.players ? "" : (r.no_sheet || r.has_result ? " (no sheet on PlayHQ)" : " (not synced)")) + "</option>"
    ).join("") + "</select></div>";
  if (c.teamId) {
    const missing = c.rounds.filter(needsSyncRound).length;
    html += '<button class="cmp-reopen" id="cmpSyncGrade"' + (c.syncing ? " disabled" : "") + ">" +
      (c.syncing ? "Syncing…" : "↻ Sync " + CMP_YEAR + " Grade" + (missing ? " (" + missing + " to go)" : "")) + "</button>";
  }
  if (c.data) html += '<button class="cmp-reopen" id="cmpReopen">View ' + CMP_YEAR + ' Side</button>';
  if (c.progress) html += '<span class="hint">' + escapeHtml(c.progress) + "</span>";
  if (c.loading) html += '<span class="hint">Loading…</span>';
  if (c.error) html += '<span class="hint" style="color:#ff8a93">' + escapeHtml(c.error) + "</span>";
  return html + "</div>";
}

function renderCompareModal() {
  const c = state.cmp;
  if (!c.open || !c.data) return "";
  const g = c.data.game;
  const keys = boardKeys();
  const listed = c.data.players.filter((p) => !p.emergency);
  const emergencies = c.data.players.filter((p) => p.emergency);
  const field = listed.slice(0, POSITIONS.length);
  const bench = listed.slice(POSITIONS.length);
  const matches = c.data.players.filter((p) => isOnBoard(p, keys)).length;
  const meta = [g.round_name, fmtDate(g.game_date), g.venue_name].filter(Boolean).map(escapeHtml).join(" \xB7 ");

  const slots = POSITIONS.map((pos, i) => {
    const p = field[i];
    const cls = "slot-card cmp" + (p ? "" : " empty") + (p && isOnBoard(p, keys) ? " match" : "");
    const inner = p
      ? '<div class="jumper">#' + escapeHtml(p.jumper || "-") + '</div><div class="pname">' + escapeHtml(initialLastName(p.name)) + "</div>"
      : '<div class="jumper">&nbsp;</div><div class="pname">—</div>';
    return '<div class="slot" style="left:' + pos.x + "%; top:" + pos.y + '%;"><div class="' + cls + '" data-line="' + pos.line + '">' + inner + "</div></div>";
  }).join("");

  const row = (p, extraCls) =>
    '<div class="ic-row' + (isOnBoard(p, keys) ? " match" : "") + (extraCls ? " " + extraCls : "") + '">' +
    '<span class="jn">#' + escapeHtml(p.jumper || "-") + "</span><span>" + (p.name ? escapeHtml(p.name) : '<em style="opacity:.6">Name hidden on PlayHQ</em>') +
    (p.captain ? " (" + escapeHtml(p.captain) + ")" : "") + (p.fill_in ? " \xB7 fill-in" : "") + "</span></div>";

  const body = c.data.players.length
    ? '<div class="board-layout">' +
        '<div class="oval-wrap">' +
          '<div class="arc-label top">50</div><div class="arc-label bottom">50</div>' +
          '<div class="line-label backs">BACKS</div><div class="line-label forwards">FORWARDS</div>' +
          '<div class="third-line top"></div><div class="third-line bottom"></div>' +
          '<div class="centre-square"></div><div class="centre-circle"></div>' + slots +
        "</div>" +
        '<div class="cmp-side">' +
          '<div class="panel"><h3>Interchange</h3>' + (bench.length ? bench.map((p) => row(p)).join("") : '<div class="cmp-summary">None listed</div>') + "</div>" +
          (emergencies.length ? '<div class="panel"><h3>Emergencies</h3>' + emergencies.map((p) => row(p, "emg")).join("") + "</div>" : "") +
          '<div class="panel cmp-summary">' + c.data.players.length + " players named. Positions are filled in jumper order, not where they actually played.<br><br>" +
            "<strong>★ " + matches + "</strong> of them " + (matches === 1 ? "is" : "are") + " on your " + (CMP_YEAR + 1) + " board.</div>" +
        "</div>" +
      "</div>"
    : '<div class="cmp-empty">' + (c.data.result ? "PlayHQ has no Cockburn Lakes team sheet for this game." : "No team sheet has been synced from PlayHQ for this game yet.") + "</div>";

  const res = c.data.result;
  const outcome = String((res && res.outcome) || "").toUpperCase();
  const outCls = outcome === "WON" ? "won" : outcome === "LOST" ? "lost" : outcome ? "draw" : "";
  const versus = res
    ? '<div class="scoreline">' +
        '<div class="team us"><div class="tname">Cockburn Lakes</div><div class="tscore">' + escapeHtml(fmtScore(res.our) || "—") + "</div></div>" +
        '<div class="mid">' + (outcome ? '<span class="outcome ' + outCls + '">' + escapeHtml(outcome) + "</span>" : '<span class="vs">VS</span>') + "</div>" +
        '<div class="team them"><div class="tname">' + escapeHtml(g.opponent_name || (res.opp && res.opp.name) || "Opponent") + '</div><div class="tscore">' + escapeHtml(fmtScore(res.opp) || "—") + "</div></div>" +
      "</div>"
    : '<div class="versus"><span>Cockburn Lakes</span><span class="vs">VS</span><span>' + escapeHtml(g.opponent_name || "Opponent") + "</span></div>" +
      '<div class="cmp-summary" style="margin-top:6px">Result not synced yet — hit Re-sync from PlayHQ.</div>';

  const opp = c.data.opposition;
  const up = upcomingInfo(opp || []);
  const oppPanel = '<div class="opp-panel"><h3>' + escapeHtml(g.opponent_name || "Opposition") + (opp && opp.length ? " \xB7 " + opp.length + " players" : "") + "</h3>" +
    (opp && opp.length && up.note ? '<div class="up-note' + (up.count ? " hit" : "") + '">' + up.note + "</div>" : "") +
    (opp && opp.length
      ? '<div class="opp-grid">' + opp.map((p) => {
          const hit = up.match(p);
          return '<div class="opp-row' + (p.emergency ? " emg" : "") + (hit ? " match27" : "") + '"><span class="jn">#' + escapeHtml(p.jumper || "-") + "</span><span class=\\"on\\">" + (p.name ? escapeHtml(p.name) : '<em style="opacity:.6">Name hidden on PlayHQ</em>') +
            (p.captain ? " (" + escapeHtml(p.captain) + ")" : "") + (p.emergency ? " \xB7 emg" : "") + "</span>" +
            (hit ? '<span class="tag27" title="Named for ' + escapeHtml(up.opponent) + " in " + escapeHtml(up.round) + '">' + (CMP_YEAR + 1) + (hit.jumper ? " #" + escapeHtml(hit.jumper) : "") + "</span>" : "") +
            "</div>";
        }).join("") + "</div>"
      : '<div class="cmp-summary">' + (opp ? "PlayHQ has no team sheet for the opposition in this game." : "Opposition not synced yet — hit Re-sync from PlayHQ.") + "</div>") +
    "</div>";

  return '<div class="cmp-overlay" id="cmpOverlay"><div class="cmp-modal">' +
    '<button class="cmp-close" id="cmpClose" title="Close">\xD7</button>' +
    '<button class="cmp-reopen cmp-resync" id="cmpResync"' + (c.syncing ? " disabled" : "") + ">" + (c.syncing ? "Syncing…" : "↻ Re-sync from PlayHQ") + "</button>" +
    '<div class="cmp-head"><div class="tag">' + (g.season_year || CMP_YEAR) + " TEAM SHEET</div>" +
      '<div class="grade">' + escapeHtml(g.grade_name || "") + "</div>" +
      '<div class="round">' + meta + "</div>" +
      versus +
    "</div>" + body + oppPanel + "</div></div>";
}

function bindCompareEvents() {
  const t = document.getElementById("cmpToggle");
  if (t) t.onchange = (e) => toggleCompare(e.target.checked);

  const gs = document.getElementById("cmpGrade");
  if (gs) gs.onchange = (e) => selectCompareGrade(e.target.value);

  const rs = document.getElementById("cmpRound");
  if (rs) rs.onchange = (e) => selectCompareRound(e.target.value);

  const sg = document.getElementById("cmpSyncGrade");
  if (sg) sg.onclick = syncCompareGrade;

  const rsy = document.getElementById("cmpResync");
  if (rsy) rsy.onclick = () => selectCompareRound(state.cmp.gameId, true);

  const re = document.getElementById("cmpReopen");
  if (re) re.onclick = () => { state.cmp.open = true; render(); loadUpcomingOpposition(); };

  const close = document.getElementById("cmpClose");
  if (close) close.onclick = closeCompare;
  const ov = document.getElementById("cmpOverlay");
  if (ov) ov.onclick = (e) => { if (e.target === ov) closeCompare(); };
}

function closeCompare() {
  state.cmp.open = false;
  render();
}

async function toggleCompare(on) {
  const c = state.cmp;
  c.on = on;
  c.error = "";
  if (!on) { c.open = false; render(); return; }
  if (!c.grades.length) {
    c.loading = true;
    render();
    try {
      const data = await api("/api/compare/grades?year=" + CMP_YEAR);
      c.grades = data.grades || [];
      // Pre-pick the 2026 team matching the current 2027 grade, if there is one
      const cur = currentGrade();
      const match = cur && c.grades.find((g) => g.team_name === cur.team_name || g.grade_name === cur.grade_name);
      c.loading = false;
      if (match) { await selectCompareGrade(String(match.team_id)); return; }
    } catch (e) {
      c.error = "Could not load " + CMP_YEAR + " grades: " + e.message;
    }
    c.loading = false;
  }
  render();
}

async function selectCompareGrade(teamId) {
  const c = state.cmp;
  c.teamId = teamId;
  c.progress = "";
  c.rounds = [];
  c.gameId = "";
  c.data = null;
  c.error = "";
  if (!teamId) { render(); return; }
  c.loading = true;
  render();
  try {
    const data = await api("/api/compare/rounds?team_id=" + encodeURIComponent(teamId));
    c.rounds = data.rounds || [];
  } catch (e) {
    c.error = "Could not load rounds: " + e.message;
  }
  c.loading = false;
  render();
}

async function syncOneGame(gameId) {
  return api("/api/compare/sync-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_id: gameId }),
  });
}

// Picking a round that isn't synced yet pulls it from PlayHQ first (same as admin), then pops it up.
async function selectCompareRound(gameId, force) {
  const c = state.cmp;
  c.gameId = gameId;
  c.error = "";
  c.progress = "";
  if (!gameId) { c.data = null; render(); return; }
  const round = c.rounds.find((r) => r.game_id === gameId);
  const needsSync = force || (round && needsSyncRound(round));
  if (!force) c.data = null;
  c.loading = !needsSync;
  c.syncing = needsSync;
  if (needsSync) c.progress = "Pulling " + (round ? round.round_name : "game") + " from PlayHQ…";
  render();
  try {
    if (needsSync) {
      const res = await syncOneGame(gameId);
      if (round) { round.players = res.players; round.no_sheet = res.status === "NO_TEAM_SHEET"; round.has_result = res.has_result; }
    }
    c.data = await api("/api/compare/sheet?game_id=" + encodeURIComponent(gameId));
    if (round && c.data.result) {
      round.has_result = 1;
      round.outcome = c.data.result.outcome;
      round.our_score = c.data.result.our.score;
      round.opp_score = c.data.result.opp.score;
    }
    c.open = true;
    loadUpcomingOpposition();
  } catch (e) {
    c.error = (needsSync ? "Sync failed: " : "Could not load team sheet: ") + e.message;
  } finally {
    c.loading = false;
    c.syncing = false;
    c.progress = "";
    render();
  }
}

// Re-syncs the grade's fixtures, then pulls every played round that has no team sheet yet.
async function syncCompareGrade() {
  const c = state.cmp;
  if (!c.teamId || c.syncing) return;
  c.syncing = true;
  c.error = "";
  c.progress = "Syncing fixtures from PlayHQ…";
  render();
  let updated = 0, none = 0, failed = 0;
  try {
    await api("/api/compare/sync-fixtures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: c.teamId }),
    });
    const data = await api("/api/compare/rounds?team_id=" + encodeURIComponent(c.teamId));
    c.rounds = data.rounds || [];
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
    const todo = c.rounds.filter((r) => needsSyncRound(r) && (r.status === "FINAL" || (r.game_date && r.game_date <= today)));
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      c.progress = "Syncing " + r.round_name + " (" + (i + 1) + " of " + todo.length + ")…";
      render();
      try {
        const res = await syncOneGame(r.game_id);
        r.players = res.players;
        r.no_sheet = res.status === "NO_TEAM_SHEET";
        r.has_result = res.has_result;
        if (r.no_sheet) none++; else updated++;
      } catch (e) {
        failed++;
        if (/passcode|Unauthorised|PLAYHQ_API_KEY/i.test(e.message)) throw e;
      }
    }
    try {
      const fresh = await api("/api/compare/rounds?team_id=" + encodeURIComponent(c.teamId));
      c.rounds = fresh.rounds || c.rounds;
    } catch (e) {}
    c.progress = "Done — " + updated + " synced" + (none ? ", " + none + " with no sheet on PlayHQ" : "") + (failed ? ", " + failed + " failed" : "") + ".";
  } catch (e) {
    c.error = "Sync failed: " + e.message;
    c.progress = "";
  }
  c.syncing = false;
  render();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.cmp.open) closeCompare();
});

init();
`;
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
