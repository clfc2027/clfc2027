import { passcodeState, constantTimeEqual } from "../../shared/auth.js";
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
var HUB_URL = "https://clfc2027.clfc2027.workers.dev/";
// The four boards. They live in this Worker's own tables, so they exist before any PlayHQ sync.
var BOARD_GRADES = [
  { id: "league", grade_name: "B Grade", sort_order: 1 },
  { id: "reserves", grade_name: "B Reserves", sort_order: 2 },
  { id: "colts", grade_name: "Colts", sort_order: 3 },
  { id: "thirds", grade_name: "Thirds", sort_order: 4 }
];
// Shared coaches PIN, kept in the COACH_PIN secret. A missing secret keeps the board locked.
var PIN_MAX_FAILS = 5;
var PIN_LOCK_MINUTES = 15;
var boardReady = false;

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


function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function hexOf(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Creates the board tables on first use and seeds the four grades.
async function ensureBoard(db) {
  if (boardReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS board_grades (
       id TEXT PRIMARY KEY,
       grade_name TEXT NOT NULL,
       sort_order INTEGER NOT NULL
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS board_selections (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       grade_id TEXT NOT NULL REFERENCES board_grades(id),
       round_name TEXT NOT NULL,
       opponent_name TEXT,
       match_date TEXT,
       venue_name TEXT,
       status TEXT DEFAULT 'saved',
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(grade_id, round_name)
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS board_selection_players (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       selection_id INTEGER NOT NULL REFERENCES board_selections(id) ON DELETE CASCADE,
       slot TEXT NOT NULL,
       slot_type TEXT NOT NULL DEFAULT 'field',
       slot_order INTEGER DEFAULT 0,
       member_id INTEGER,
       playhq_player_id TEXT,
       player_name TEXT NOT NULL,
       player_number TEXT,
       UNIQUE(selection_id, slot)
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS board_pin_state (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       failed_attempts INTEGER NOT NULL DEFAULT 0,
       locked_until TEXT
     )`
  ).run();
  await db.prepare(`INSERT OR IGNORE INTO board_pin_state (id, failed_attempts) VALUES (1, 0)`).run();
  for (const g of BOARD_GRADES) {
    await db.prepare(
      `INSERT OR IGNORE INTO board_grades (id, grade_name, sort_order) VALUES (?1, ?2, ?3)`
    ).bind(g.id, g.grade_name, g.sort_order).run();
  }
  boardReady = true;
}

async function assertGrade(db, gradeId) {
  await ensureBoard(db);
  const row = await db.prepare(`SELECT id, grade_name FROM board_grades WHERE id = ?1`).bind(gradeId || "").first();
  if (!row) throw httpError("Unknown grade", 404);
  return row;
}

// Checks the shared coaches PIN against the COACH_PIN secret. Fails closed if the secret is missing.
async function verifyBoardPin(env, db, pin) {
  if (!env.COACH_PIN) throw httpError("The coaches PIN is not set up on the server", 500);
  await ensureBoard(db);
  const row = await db.prepare(`SELECT failed_attempts, locked_until FROM board_pin_state WHERE id = 1`).first();
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw httpError("Too many wrong PINs. Try again in a few minutes.", 429);
  }
  const given = typeof pin === "string" ? pin : "";
  if (constantTimeEqual(given, env.COACH_PIN)) {
    await db.prepare(`UPDATE board_pin_state SET failed_attempts = 0, locked_until = NULL WHERE id = 1`).run();
    return;
  }
  const fails = row.failed_attempts + 1;
  if (fails >= PIN_MAX_FAILS) {
    const until = new Date(Date.now() + PIN_LOCK_MINUTES * 60000).toISOString();
    await db.prepare(`UPDATE board_pin_state SET failed_attempts = 0, locked_until = ?1 WHERE id = 1`).bind(until).run();
  } else {
    await db.prepare(`UPDATE board_pin_state SET failed_attempts = ?1 WHERE id = 1`).bind(fails).run();
  }
  throw httpError("Wrong PIN", 401);
}

// Every coach-facing read and write checks the grade exists and the shared PIN.
async function requireCoach(request, env, gradeId) {
  if (!gradeId) throw httpError("grade_id is required", 400);
  await assertGrade(env.DB, gradeId);
  await verifyBoardPin(env, env.DB, request.headers.get("x-coach-pin") || "");
}

async function getGrades(db) {
  await ensureBoard(db);
  const { results } = await db.prepare(
    `SELECT id AS grade_id, grade_name FROM board_grades ORDER BY sort_order`
  ).all();
  return { grades: results };
}

// Round names already used on this grade's board, so a coach can reuse a round's opponent and ground.
async function getSavedRounds(db, gradeId) {
  const { results } = await db.prepare(
    `SELECT round_name, opponent_name, match_date, venue_name
       FROM board_selections WHERE grade_id = ?1
       ORDER BY updated_at DESC LIMIT 40`
  ).bind(gradeId).all();
  return { rounds: results };
}

async function loadSelection(db, gradeId, round) {
  const selection = await db.prepare(
    `SELECT id, grade_id, round_name, opponent_name, match_date, venue_name, status
       FROM board_selections WHERE grade_id = ?1 AND round_name = ?2`
  ).bind(gradeId, round).first();
  if (!selection) return { selection: null, positions: {}, interchange: [] };
  const { results: players } = await db.prepare(
    `SELECT slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number
       FROM board_selection_players WHERE selection_id = ?1`
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
  const { grade_id, round_name, opponent_name, match_date, venue_name, status, positions, interchange } = payload;
  if (!grade_id || !round_name) throw httpError("grade_id and round_name are required", 400);
  await assertGrade(db, grade_id);
  const allIds = [
    ...Object.values(positions || {}).map((p) => p?.member_id).filter(Boolean),
    ...(interchange || []).map((p) => p?.member_id).filter(Boolean)
  ];
  const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  if (dupes.length) throw httpError("A player has been selected more than once", 409);

  const existing = await db.prepare(
    `SELECT id FROM board_selections WHERE grade_id = ?1 AND round_name = ?2`
  ).bind(grade_id, round_name).first();
  let selectionId;
  if (existing) {
    selectionId = existing.id;
    await db.prepare(
      `UPDATE board_selections SET opponent_name = ?1, match_date = ?2, venue_name = ?3, status = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5`
    ).bind(opponent_name || null, match_date || null, venue_name || null, status || "saved", selectionId).run();
    await db.prepare(`DELETE FROM board_selection_players WHERE selection_id = ?1`).bind(selectionId).run();
  } else {
    const result = await db.prepare(
      `INSERT INTO board_selections (grade_id, round_name, opponent_name, match_date, venue_name, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(grade_id, round_name, opponent_name || null, match_date || null, venue_name || null, status || "saved").run();
    selectionId = result.meta.last_row_id;
  }
  const inserts = [];
  for (const [slot, card] of Object.entries(positions || {})) {
    if (!card) continue;
    inserts.push(
      db.prepare(
        `INSERT INTO board_selection_players (selection_id, slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number)
           VALUES (?1, ?2, 'field', 0, ?3, ?4, ?5, ?6)`
      ).bind(selectionId, slot, card.member_id || null, card.playhq_player_id || null, card.name, card.jumper || null)
    );
  }
  (interchange || []).forEach((card, i) => {
    if (!card) return;
    inserts.push(
      db.prepare(
        `INSERT INTO board_selection_players (selection_id, slot, slot_type, slot_order, member_id, playhq_player_id, player_name, player_number)
           VALUES (?1, ?2, 'interchange', ?3, ?4, ?5, ?6, ?7)`
      ).bind(selectionId, `INTERCHANGE_${i}`, i, card.member_id || null, card.playhq_player_id || null, card.name, card.jumper || null)
    );
  });
  if (inserts.length) await db.batch(inserts);
  return { ok: true, selection_id: selectionId };
}

async function deleteSelection(db, gradeId, round) {
  const existing = await db.prepare(
    `SELECT id FROM board_selections WHERE grade_id = ?1 AND round_name = ?2`
  ).bind(gradeId, round).first();
  if (!existing) return { ok: true, deleted: false };
  await db.prepare(`DELETE FROM board_selection_players WHERE selection_id = ?1`).bind(existing.id).run();
  await db.prepare(`DELETE FROM board_selections WHERE id = ?1`).bind(existing.id).run();
  return { ok: true, deleted: true };
}

// Public read for the grade pages: the saved team names only, never PINs or member IDs.
async function getPublished(db, gradeId, round) {
  if (!gradeId || !round) throw httpError("grade_id and round are required", 400);
  const grade = await assertGrade(db, gradeId);
  const data = await loadSelection(db, gradeId, round);
  const strip = (card) => (card ? { name: card.name, jumper: card.jumper || null } : null);
  const positions = {};
  for (const [slot, card] of Object.entries(data.positions)) positions[slot] = strip(card);
  return {
    grade_id: gradeId,
    grade_name: grade.grade_name,
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
      if (pathname === "/api/coach/verify" && method === "POST") {
        const { pin } = await request.json();
        await verifyBoardPin(env, env.DB, pin);
        return json({ ok: true });
      }
      if (pathname === "/api/published" && method === "GET") {
        return json(await getPublished(env.DB, url.searchParams.get("grade_id"), url.searchParams.get("round")));
      }
      // Coaches only (PIN in x-coach-pin)
      if (pathname === "/api/players" && method === "GET") {
        await requireCoach(request, env, url.searchParams.get("grade_id"));
        const search = (url.searchParams.get("search") || "").trim();
        return json(await searchPlayers(env.DB, search));
      }
      if (pathname === "/api/rounds" && method === "GET") {
        const gradeId = url.searchParams.get("grade_id");
        await requireCoach(request, env, gradeId);
        return json(await getSavedRounds(env.DB, gradeId));
      }
      if (pathname === "/api/team" && method === "GET") {
        const gradeId = url.searchParams.get("grade_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env, gradeId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await loadSelection(env.DB, gradeId, round));
      }
      if (pathname === "/api/team" && (method === "POST" || method === "PUT")) {
        const payload = await request.json();
        await requireCoach(request, env, payload.grade_id);
        return json(await saveSelection(env.DB, payload));
      }
      if (pathname === "/api/team" && method === "DELETE") {
        const gradeId = url.searchParams.get("grade_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env, gradeId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await deleteSelection(env.DB, gradeId, round));
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
