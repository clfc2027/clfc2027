import { passcodeState, constantTimeEqual } from "../shared/auth.js";
import { CSS } from "./styles.js";
import { JS } from "./client.js";

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
var HUB_URL = "https://clfc2027.clfc2027.workers.dev/";
// Coach PIN lockout: after this many wrong PINs in a row, the grade is locked for a while.
var PIN_MAX_FAILS = 5;
var PIN_LOCK_MINUTES = 15;
var pinTableReady = false;

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
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
function requireAdmin(request, env) {
  const supplied = request.headers.get("x-admin-passcode") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const state = passcodeState(supplied, env); // shared/auth.js
  if (state === "not-set") {
    // Fail closed: a missing secret must never mean open access.
    const err = new Error("Admin passcode is not set up on the server");
    err.status = 500;
    throw err;
  }
  if (state !== "ok") {
    const err = new Error("Unauthorised");
    err.status = 401;
    throw err;
  }
}

async function getGrades(db) {
  const { results } = await db.prepare(
    `SELECT t.id AS team_id, t.season_id, COALESCE(t.grade_name, t.team_name) AS grade_name, t.team_name, s.season_year
       FROM teams t JOIN seasons s ON s.id = t.season_id
      WHERE s.season_year = ?1
      ORDER BY grade_name`
  ).bind(BOARD_YEAR).all();
  return { year: BOARD_YEAR, grades: results };
}
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
async function getRounds(db, teamId) {
  const { results } = await db.prepare(
    `SELECT DISTINCT round_name, opponent_name, game_date, venue_name
       FROM fixtures WHERE team_id = ?1 AND round_name IS NOT NULL
       ORDER BY game_date DESC LIMIT 40`
  ).bind(teamId).all();
  return { rounds: results };
}
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
async function deleteSelection(db, teamId, round) {
  const existing = await db.prepare(`SELECT id FROM team_selections WHERE team_id = ?1 AND round_name = ?2`).bind(teamId, round).first();
  if (!existing) return { ok: true, deleted: false };
  await db.prepare(`DELETE FROM team_selection_players WHERE selection_id = ?1`).bind(existing.id).run();
  await db.prepare(`DELETE FROM team_selections WHERE id = ?1`).bind(existing.id).run();
  return { ok: true, deleted: true };
}


function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function hexOf(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  return hexOf(crypto.getRandomValues(new Uint8Array(16)));
}

async function hashPin(salt, pin) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pin));
  return hexOf(digest);
}

function validPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

async function ensurePinTable(db) {
  if (pinTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS coach_pins (
       team_id INTEGER PRIMARY KEY REFERENCES teams(id),
       salt TEXT NOT NULL,
       pin_hash TEXT NOT NULL,
       failed_attempts INTEGER NOT NULL DEFAULT 0,
       locked_until TEXT,
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  pinTableReady = true;
}

// Only 2027 grades can be opened on the board.
async function assertBoardTeam(db, teamId) {
  const row = await db.prepare(
    `SELECT s.season_year FROM teams t JOIN seasons s ON s.id = t.season_id WHERE t.id = ?1`
  ).bind(teamId).first();
  if (!row || Number(row.season_year) !== BOARD_YEAR) {
    throw httpError(`Only ${BOARD_YEAR} grades are on the coaches board`, 403);
  }
}

// Fails closed: a grade with no PIN set cannot be opened by anyone.
async function verifyCoachPin(db, teamId, pin) {
  await ensurePinTable(db);
  const row = await db.prepare(
    `SELECT salt, pin_hash, failed_attempts, locked_until FROM coach_pins WHERE team_id = ?1`
  ).bind(teamId).first();
  if (!row) throw httpError("No coach PIN has been set for this grade yet", 403);
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw httpError("Too many wrong PINs. Try again in a few minutes.", 429);
  }
  const given = await hashPin(row.salt, typeof pin === "string" ? pin : "");
  if (constantTimeEqual(given, row.pin_hash)) {
    if (row.failed_attempts) {
      await db.prepare(`UPDATE coach_pins SET failed_attempts = 0, locked_until = NULL WHERE team_id = ?1`).bind(teamId).run();
    }
    return;
  }
  const fails = row.failed_attempts + 1;
  if (fails >= PIN_MAX_FAILS) {
    const until = new Date(Date.now() + PIN_LOCK_MINUTES * 60000).toISOString();
    await db.prepare(`UPDATE coach_pins SET failed_attempts = 0, locked_until = ?1 WHERE team_id = ?2`).bind(until, teamId).run();
  } else {
    await db.prepare(`UPDATE coach_pins SET failed_attempts = ?1 WHERE team_id = ?2`).bind(fails, teamId).run();
  }
  throw httpError("Wrong PIN", 401);
}

// Every coach-facing read and write goes through here: the grade must be a 2027 grade and the PIN must match.
async function requireCoach(request, db, teamId) {
  if (!teamId) throw httpError("team_id is required", 400);
  await assertBoardTeam(db, teamId);
  await verifyCoachPin(db, teamId, request.headers.get("x-coach-pin") || "");
}

async function setCoachPin(db, teamId, pin) {
  if (!teamId) throw httpError("team_id is required", 400);
  if (!validPin(pin)) throw httpError("PIN must be exactly 4 digits", 400);
  await assertBoardTeam(db, teamId);
  await ensurePinTable(db);
  const salt = randomSalt();
  const hash = await hashPin(salt, pin);
  await db.prepare(
    `INSERT INTO coach_pins (team_id, salt, pin_hash, failed_attempts, locked_until, updated_at)
       VALUES (?1, ?2, ?3, 0, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(team_id) DO UPDATE SET
       salt = excluded.salt, pin_hash = excluded.pin_hash,
       failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP`
  ).bind(teamId, salt, hash).run();
  return { ok: true };
}

async function listCoachPins(db) {
  await ensurePinTable(db);
  const { results } = await db.prepare(
    `SELECT t.id AS team_id, COALESCE(t.grade_name, t.team_name) AS grade_name,
            CASE WHEN cp.team_id IS NULL THEN 0 ELSE 1 END AS has_pin
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       LEFT JOIN coach_pins cp ON cp.team_id = t.id
      WHERE s.season_year = ?1
      ORDER BY grade_name`
  ).bind(BOARD_YEAR).all();
  return { year: BOARD_YEAR, grades: results };
}

// Public read for the grade pages: the saved team names only, never PINs or member IDs.
async function getPublished(db, teamId, round) {
  if (!teamId || !round) throw httpError("team_id and round are required", 400);
  const team = await db.prepare(
    `SELECT COALESCE(grade_name, team_name) AS grade_name FROM teams WHERE id = ?1`
  ).bind(teamId).first();
  const data = await loadSelection(db, teamId, round);
  const strip = (card) => (card ? { name: card.name, jumper: card.jumper || null } : null);
  const positions = {};
  for (const [slot, card] of Object.entries(data.positions)) positions[slot] = strip(card);
  return {
    grade_name: team ? team.grade_name : null,
    round_name: round,
    selection: data.selection
      ? {
          opponent_name: data.selection.opponent_name,
          match_date: data.selection.match_date,
          venue_name: data.selection.venue_name,
          status: data.selection.status
        }
      : null,
    positions,
    interchange: data.interchange.map(strip)
  };
}

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
    window.__HUB_URL__ = ${JSON.stringify(hubUrl)};
  </script>
  <script>${JS}</script>
</body>
</html>`;
}

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,x-admin-passcode,x-coach-pin,Authorization"
        }
      });
    }
    try {
      // Public
      if (pathname === "/" || pathname === "/board") return html(renderApp(env.HUB_URL || HUB_URL));
      if (pathname === "/api/grades") return json(await getGrades(env.DB));
      if (pathname === "/api/published" && method === "GET") {
        return json(await getPublished(env.DB, url.searchParams.get("team_id"), url.searchParams.get("round")));
      }
      if (pathname === "/api/coach/verify" && method === "POST") {
        const { team_id, pin } = await request.json();
        await assertBoardTeam(env.DB, team_id);
        await verifyCoachPin(env.DB, team_id, pin);
        return json({ ok: true });
      }

      // Coaches only (PIN for the grade in x-coach-pin)
      if (pathname === "/api/players" && method === "GET") {
        await requireCoach(request, env.DB, url.searchParams.get("team_id"));
        const search = (url.searchParams.get("search") || "").trim();
        return json(await searchPlayers(env.DB, search));
      }
      if (pathname === "/api/rounds" && method === "GET") {
        const teamId = url.searchParams.get("team_id");
        await requireCoach(request, env.DB, teamId);
        return json(await getRounds(env.DB, teamId));
      }
      if (pathname === "/api/team" && method === "GET") {
        const teamId = url.searchParams.get("team_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env.DB, teamId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await loadSelection(env.DB, teamId, round));
      }
      if (pathname === "/api/team" && (method === "POST" || method === "PUT")) {
        const payload = await request.json();
        await requireCoach(request, env.DB, payload.team_id);
        return json(await saveSelection(env.DB, payload));
      }
      if (pathname === "/api/team" && method === "DELETE") {
        const teamId = url.searchParams.get("team_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env.DB, teamId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await deleteSelection(env.DB, teamId, round));
      }

      // Admin only (ADMIN_PASSCODE): set and check each grade's coach PIN
      if (pathname === "/api/admin/coach-pins" && method === "GET") {
        requireAdmin(request, env);
        return json(await listCoachPins(env.DB));
      }
      if (pathname === "/api/admin/coach-pin" && method === "POST") {
        requireAdmin(request, env);
        const { team_id, pin } = await request.json();
        return json(await setCoachPin(env.DB, team_id, pin));
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500);
    }
  }
};
export {
  worker_default as default
};
