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
// 2026 compare: each board reads last year's team from PlayHQ on request. Nothing is copied from the main database.
var COMPARE_YEAR = 2026;
var COMPARE_TEAMS = {
  league: { name: "Cockburn Lakes (B)", playhq_team_id: "046b90e4-54e4-4bf7-af9f-955b8ae7981e" },
  reserves: { name: "Cockburn Lakes (BR)", playhq_team_id: "5bf15ff7-0818-4082-9177-d88d822a99fc" },
  colts: { name: "Cockburn Lakes (DBC)", playhq_team_id: "a95954ed-ff52-4e15-82a3-80a9417d2a32" },
  thirds: { name: "Cockburn Lakes (E2S)", playhq_team_id: "696edf4b-d7e4-44bc-ae14-129cb746fc25" }
};
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
  await assertGrade(env.FLEXI, gradeId);
  await verifyBoardPin(env, env.FLEXI, request.headers.get("x-coach-pin") || "");
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
// The most recently saved round for a grade. Public, names and jumpers only.
async function getLatestPublished(db, gradeId) {
  const grade = await assertGrade(db, gradeId);
  const latest = await db.prepare(
    `SELECT round_name FROM board_selections WHERE grade_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT 1`
  ).bind(gradeId).first();
  if (!latest) return { grade_id: gradeId, grade_name: grade.grade_name, round_name: null, selection: null, positions: {}, interchange: [] };
  return getPublished(db, gradeId, latest.round_name);
}
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
          round_name: round,
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

// ---------- 2026 compare (PlayHQ on request, stored in clfc2026-flexi) ----------
var PLAYHQ_BASE = "https://api.playhq.com";
var compareReady = false;
async function ensureCompareTables(db) {
  if (compareReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS compare_fixtures (
       playhq_game_id TEXT PRIMARY KEY,
       team_key TEXT NOT NULL,
       round_name TEXT,
       opponent_name TEXT,
       game_date TEXT,
       venue_name TEXT,
       status TEXT,
       fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS compare_results (
       game_id TEXT PRIMARY KEY,
       outcome TEXT,
       our_name TEXT, our_goals INTEGER, our_behinds INTEGER, our_score INTEGER,
       opp_name TEXT, opp_goals INTEGER, opp_behinds INTEGER, opp_score INTEGER,
       opp_players TEXT,
       synced_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS compare_sheets (
       game_id TEXT PRIMARY KEY,
       player_count INTEGER NOT NULL,
       players TEXT NOT NULL,
       synced_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`
  ).run();
  compareReady = true;
}
function compareTeamFor(gradeId) {
  const team = COMPARE_TEAMS[gradeId];
  if (!team) throw httpError("No 2026 team is set up for this board", 404);
  return team;
}
function needApiKey(apiKey) {
  if (!apiKey) throw httpError("PLAYHQ_API_KEY secret is not set on the coaches-board worker", 503);
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
// Reads the 2026 fixture feed from PlayHQ and stores the games. Each request writes what it fetched.
async function fetchCompareFixtures(db, apiKey, gradeId) {
  needApiKey(apiKey);
  await ensureCompareTables(db);
  const team = compareTeamFor(gradeId);
  const data = await playhq(`/teams/${team.playhq_team_id}/fixture`, apiKey);
  const fixtures = (data.data || []).filter((f) => f.round?.name);
  const stmts = fixtures.map((f) => {
    const opponent = f.competitors?.find((c) => c.id !== team.playhq_team_id);
    return db.prepare(
      `INSERT INTO compare_fixtures (playhq_game_id, team_key, round_name, opponent_name, game_date, venue_name, status, fetched_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
       ON CONFLICT(playhq_game_id) DO UPDATE SET team_key = excluded.team_key, round_name = excluded.round_name,
         opponent_name = excluded.opponent_name, game_date = excluded.game_date, venue_name = excluded.venue_name,
         status = excluded.status, fetched_at = CURRENT_TIMESTAMP`
    ).bind(f.id, gradeId, f.round.name, opponent?.name || null, f.schedule?.date || null, f.venue?.name || null, f.status || null);
  });
  if (stmts.length) await db.batch(stmts);
  return { team, fixtures, opponentOf: (f) => f.competitors?.find((c) => c.id !== team.playhq_team_id) };
}
async function getCompareRounds(db, apiKey, gradeId) {
  await fetchCompareFixtures(db, apiKey, gradeId);
  const { results } = await db.prepare(
    `SELECT f.playhq_game_id AS game_id, f.round_name, f.opponent_name, f.game_date, f.venue_name, f.status,
            COALESCE((SELECT cs.player_count FROM compare_sheets cs WHERE cs.game_id = f.playhq_game_id), 0) AS players,
            r.outcome, r.our_score, r.opp_score,
            CASE WHEN r.game_id IS NULL THEN 0 ELSE 1 END AS has_result
       FROM compare_fixtures f
       LEFT JOIN compare_results r ON r.game_id = f.playhq_game_id
      WHERE f.team_key = ?1
      ORDER BY f.game_date ASC`
  ).bind(gradeId).all();
  return { year: COMPARE_YEAR, team_name: compareTeamFor(gradeId).name, rounds: results };
}
// Only reads what was stored by a request. Never reads or writes the official team sheet tables.
async function getCompareSheet(db, gameId) {
  await ensureCompareTables(db);
  const game = await db.prepare(
    `SELECT playhq_game_id AS game_id, round_name, opponent_name, game_date, venue_name, status, team_key
       FROM compare_fixtures WHERE playhq_game_id = ?1`
  ).bind(gameId || "").first();
  if (!game) throw httpError("Game not found. Open the round list first.", 404);
  const own = await db.prepare(`SELECT players FROM compare_sheets WHERE game_id = ?1`).bind(gameId).first();
  const players = own ? JSON.parse(own.players || "[]") : [];
  players.sort((a, b) => (a.emergency === b.emergency ? 0 : a.emergency ? 1 : -1) || (parseInt(a.jumper) || 999) - (parseInt(b.jumper) || 999));
  const r = await db.prepare(`SELECT * FROM compare_results WHERE game_id = ?1`).bind(gameId).first();
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
  return { game: { ...game, season_year: COMPARE_YEAR, team_name: compareTeamFor(game.team_key).name }, players, result, opposition };
}
// Pulls one 2026 game's summary and fixture result from PlayHQ and stores it in clfc2026-flexi.
async function syncCompareGame(db, apiKey, gameId, gradeId) {
  needApiKey(apiKey);
  await ensureCompareTables(db);
  const team = compareTeamFor(gradeId);
  const fixtureFeed = await playhq(`/teams/${team.playhq_team_id}/fixture`, apiKey);
  const fx = (fixtureFeed.data || []).find((g) => g.id === gameId);
  if (!fx || !fx.round?.name) throw httpError("Game not found in the 2026 fixtures for this grade", 404);
  const summary = await playhq(`/games/${gameId}/summary`, apiKey, "v2");

  const appearances = summary.data?.appearances || [];
  const ours = appearances.filter((a) => a.teamId === team.playhq_team_id);
  const theirs = appearances.filter((a) => a.teamId !== team.playhq_team_id && (a.roleType || "Player") === "Player");
  const sumTeams = summary.data?.teams || [];
  const comps = fx.competitors || [];
  const sub = (c, type) => c?.scoreSubTotal?.find((s) => s.type === type)?.value ?? null;
  const usC = comps.find((c) => c.id === team.playhq_team_id);
  const themC = comps.find((c) => c.id !== team.playhq_team_id);
  const usT = sumTeams.find((t) => t.id === team.playhq_team_id);
  const themT = sumTeams.find((t) => t.id !== team.playhq_team_id);
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
  const sheet = ours.map((a) => ({
    playhq_player_id: a.id || null,
    name: `${(a.firstName || "").trim()} ${(a.lastName || "").trim()}`.trim(),
    jumper: a.playerNumber || null,
    captain: a.captainRole || null,
    emergency: !!a.isEmergency,
    fill_in: !!a.isFillIn,
    role_type: a.roleType || "Player"
  }));
  const playerCount = sheet.filter((p) => p.role_type === "Player").length;

  const resultStmt = db.prepare(
    `INSERT INTO compare_results
       (game_id, outcome, our_name, our_goals, our_behinds, our_score, opp_name, opp_goals, opp_behinds, opp_score, opp_players, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, CURRENT_TIMESTAMP)
     ON CONFLICT(game_id) DO UPDATE SET
       outcome = excluded.outcome, our_name = excluded.our_name, our_goals = excluded.our_goals, our_behinds = excluded.our_behinds,
       our_score = excluded.our_score, opp_name = excluded.opp_name, opp_goals = excluded.opp_goals, opp_behinds = excluded.opp_behinds,
       opp_score = excluded.opp_score, opp_players = excluded.opp_players, synced_at = CURRENT_TIMESTAMP`
  ).bind(
    gameId, usC?.outcome || usT?.outcome || null,
    usC?.name || usT?.name || null, sub(usC, "TOTAL_GOALS"), sub(usC, "TOTAL_BEHINDS"), usC?.scoreTotal ?? null,
    themC?.name || themT?.name || null, sub(themC, "TOTAL_GOALS"), sub(themC, "TOTAL_BEHINDS"), themC?.scoreTotal ?? null,
    JSON.stringify(oppPlayers)
  );
  const sheetStmt = db.prepare(
    `INSERT INTO compare_sheets (game_id, player_count, players, synced_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
     ON CONFLICT(game_id) DO UPDATE SET player_count = excluded.player_count, players = excluded.players, synced_at = CURRENT_TIMESTAMP`
  ).bind(gameId, playerCount, JSON.stringify(sheet));
  await db.batch([resultStmt, sheetStmt]);
  return { game_id: gameId, round_name: fx.round.name, status: ours.length ? "UPDATED" : "NO_TEAM_SHEET", players: playerCount, has_result: 1 };
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
    window.__COMPARE_YEAR__ = ${COMPARE_YEAR};
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
      if (pathname === "/api/grades") return json(await getGrades(env.FLEXI));
      if (pathname === "/api/coach/verify" && method === "POST") {
        const { pin } = await request.json();
        await verifyBoardPin(env, env.FLEXI, pin);
        return json({ ok: true });
      }
      if (pathname === "/api/published/latest" && method === "GET") {
        return json(await getLatestPublished(env.FLEXI, url.searchParams.get("grade_id")));
      }
      if (pathname === "/api/published" && method === "GET") {
        return json(await getPublished(env.FLEXI, url.searchParams.get("grade_id"), url.searchParams.get("round")));
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
        return json(await getSavedRounds(env.FLEXI, gradeId));
      }
      if (pathname === "/api/team" && method === "GET") {
        const gradeId = url.searchParams.get("grade_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env, gradeId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await loadSelection(env.FLEXI, gradeId, round));
      }
      if (pathname === "/api/team" && (method === "POST" || method === "PUT")) {
        const payload = await request.json();
        await requireCoach(request, env, payload.grade_id);
        return json(await saveSelection(env.FLEXI, payload));
      }
      if (pathname === "/api/team" && method === "DELETE") {
        const gradeId = url.searchParams.get("grade_id");
        const round = url.searchParams.get("round");
        await requireCoach(request, env, gradeId);
        if (!round) return json({ error: "round is required" }, 400);
        return json(await deleteSelection(env.FLEXI, gradeId, round));
      }

      if (pathname === "/api/compare/rounds" && method === "GET") {
        const gradeId = url.searchParams.get("grade_id");
        await requireCoach(request, env, gradeId);
        return json(await getCompareRounds(env.FLEXI, env.PLAYHQ_API_KEY, gradeId));
      }
      if (pathname === "/api/compare/sheet" && method === "GET") {
        const gradeId = url.searchParams.get("grade_id");
        await requireCoach(request, env, gradeId);
        return json(await getCompareSheet(env.FLEXI, url.searchParams.get("game_id")));
      }
      if (pathname === "/api/compare/sync-game" && method === "POST") {
        const payload = await request.json();
        await requireCoach(request, env, payload.grade_id);
        return json(await syncCompareGame(env.FLEXI, env.PLAYHQ_API_KEY, payload.game_id, payload.grade_id));
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
