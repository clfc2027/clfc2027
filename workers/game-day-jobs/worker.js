// Game Day jobs Worker: allocates weekly jobs from the saved coaches boards,
// serves the jobs for each grade page, and takes organiser edits behind a PIN.
// Secret (set in the dashboard, never in code): ORGANISER_PIN
import { GRADES, JOB_LABELS, buildJobSpecs, allocateRound } from "./allocation.js";

const SEASON = 2027;
const HOME_VENUE = "anning park";
// Words that identify each grade in the grade_name stored by the PlayHQ sync.
const GRADE_MATCH = { league: "b grade", colts: "colts", reserves: "b reserves", thirds: "e2 south" };
const GAME_LABELS = { league: "League", colts: "Colts", reserves: "Reserves", thirds: "Thirds" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-organiser-pin",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function checkPin(request, env) {
  // Fail closed: if the PIN secret is missing, nothing organiser-side works.
  if (!env.ORGANISER_PIN) throw httpError("ORGANISER_PIN secret is not set on this Worker", 503);
  if ((request.headers.get("x-organiser-pin") || "") !== env.ORGANISER_PIN) throw httpError("Incorrect PIN", 401);
}

function gradeOf(gradeName) {
  const name = (gradeName || "").toLowerCase();
  return GRADES.find((g) => name.includes(GRADE_MATCH[g])) || null;
}

function playerKey(p) {
  if (p.member_id) return `m${p.member_id}`;
  if (p.playhq_player_id) return `p${p.playhq_player_id}`;
  return `n${(p.player_name || "").trim().toLowerCase()}`;
}

// ---------- reading the saved data ----------

async function listRounds(db) {
  const { results } = await db
    .prepare(
      `SELECT f.round_name, MIN(f.game_date) AS first_date
         FROM fixtures f JOIN seasons s ON s.id = f.season_id
        WHERE s.season_year = ? AND f.round_name IS NOT NULL
        GROUP BY f.round_name ORDER BY first_date`
    )
    .bind(SEASON)
    .all();
  return results.map((r) => r.round_name);
}

async function roundGames(db, round) {
  const { results } = await db
    .prepare(
      `SELECT t.grade_name, f.venue_name
         FROM fixtures f JOIN teams t ON t.id = f.team_id JOIN seasons s ON s.id = f.season_id
        WHERE s.season_year = ? AND f.round_name = ?`
    )
    .bind(SEASON, round)
    .all();
  const games = {};
  for (const r of results) {
    const g = gradeOf(r.grade_name);
    if (!g || games[g]) continue;
    games[g] = { home: (r.venue_name || "").toLowerCase().includes(HOME_VENUE) };
  }
  return games;
}

async function roundPools(db, round) {
  const { results: selections } = await db
    .prepare(
      `SELECT ts.id, t.grade_name
         FROM team_selections ts JOIN teams t ON t.id = ts.team_id JOIN seasons s ON s.id = ts.season_id
        WHERE s.season_year = ? AND ts.round_name = ?`
    )
    .bind(SEASON, round)
    .all();
  const pools = {};
  for (const sel of selections) {
    const g = gradeOf(sel.grade_name);
    if (!g) continue;
    const { results: players } = await db
      .prepare(
        `SELECT member_id, playhq_player_id, player_name
           FROM team_selection_players WHERE selection_id = ?`
      )
      .bind(sel.id)
      .all();
    pools[g] = players.map((p) => ({
      key: playerKey(p),
      name: p.player_name,
      member_id: p.member_id,
      playhq_player_id: p.playhq_player_id,
    }));
  }
  return pools;
}

async function seasonCounts(db) {
  const { results } = await db
    .prepare(
      `SELECT player_key, job_type, COUNT(*) AS n FROM job_allocations
        WHERE season = ? AND player_key IS NOT NULL AND status IN ('auto', 'manual')
        GROUP BY player_key, job_type`
    )
    .bind(SEASON)
    .all();
  const counts = new Map();
  for (const r of results) {
    const c = counts.get(r.player_key) || { total: 0, byType: {} };
    counts.set(r.player_key, { total: c.total + r.n, byType: { ...c.byType, [r.job_type]: r.n } });
  }
  return counts;
}

// ---------- allocation ----------

async function allocateForRound(db, round) {
  const games = await roundGames(db, round);
  if (!Object.keys(games).length) return;

  const specs = buildJobSpecs(games);
  const insertRows = specs.map((s) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO job_allocations
           (season, round_name, job_id, game_grade, game_home, job_type, slot_no, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(SEASON, round, s.id, s.game, s.home ? 1 : 0, s.type, s.slot, JSON.stringify(s.supplier))
  );
  if (insertRows.length) await db.batch(insertRows);

  const pools = await roundPools(db, round);
  const { results: rows } = await db
    .prepare(`SELECT job_id, player_key, status FROM job_allocations WHERE season = ? AND round_name = ?`)
    .bind(SEASON, round)
    .all();
  const taken = new Set(rows.filter((r) => r.player_key).map((r) => r.player_key));
  const pending = rows.filter((r) => r.status === "pending").map((r) => r.job_id);

  // Only fill slots still pending, whose supplying boards are all saved.
  const ready = specs.filter(
    (s) => pending.includes(s.id) && s.supplier.every((g) => (pools[g] || []).length > 0)
  );
  if (!ready.length) return;

  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const counts = await seasonCounts(db);
  const result = allocateRound({ specs: ready, pools, counts, taken, seed });

  const updates = ready
    .filter((s) => result.assignments[s.id])
    .map((s) => {
      const p = result.assignments[s.id];
      return db
        .prepare(
          `UPDATE job_allocations
              SET player_key = ?, player_name = ?, member_id = ?, playhq_player_id = ?,
                  status = 'auto', fair = ?, seed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE season = ? AND round_name = ? AND job_id = ? AND status = 'pending'`
        )
        .bind(p.key, p.name, p.member_id, p.playhq_player_id, result.fair ? 1 : 0, result.seed, SEASON, round, s.id);
    });
  if (updates.length) await db.batch(updates);
}

async function runAllocation(env) {
  for (const round of await listRounds(env.DB)) {
    await allocateForRound(env.DB, round);
  }
}

// ---------- API ----------

async function defaultRound(db) {
  const row = await db
    .prepare(`SELECT round_name FROM job_allocations WHERE season = ? ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .bind(SEASON)
    .first();
  return row?.round_name || null;
}

// Public: the jobs a grade's players are rostered for (their supplied jobs and their own game's jobs).
async function publicJobs(db, grade, round) {
  const r = round || (await defaultRound(db));
  if (!r) return { round: null, grade, jobs: [] };
  const { results } = await db
    .prepare(
      `SELECT job_id, game_grade, game_home, job_type, slot_no, supplier, player_name, status
         FROM job_allocations WHERE season = ? AND round_name = ?
        ORDER BY game_grade, job_type, slot_no`
    )
    .bind(SEASON, r)
    .all();
  const jobs = results
    .filter((row) => JSON.parse(row.supplier).includes(grade))
    .map((row) => ({
      job_id: row.job_id,
      game: row.game_grade,
      game_label: GAME_LABELS[row.game_grade],
      home: !!row.game_home,
      type: row.job_type,
      label: JOB_LABELS[row.job_type],
      supplier: JSON.parse(row.supplier),
      name: row.player_name || null,
    }));
  return { round: r, grade, jobs };
}

// Organiser: every job for a round, plus the names each job can be filled from.
async function organiserView(db, round) {
  const r = round || (await defaultRound(db));
  const rounds = await listRounds(db);
  if (!r) return { round: null, rounds, jobs: [], pools: {} };
  const { results } = await db
    .prepare(
      `SELECT job_id, game_grade, game_home, job_type, slot_no, supplier, player_key, player_name, status
         FROM job_allocations WHERE season = ? AND round_name = ?
        ORDER BY game_grade, job_type, slot_no`
    )
    .bind(SEASON, r)
    .all();
  const pools = await roundPools(db, r);
  return {
    round: r,
    rounds,
    pools,
    jobs: results.map((row) => ({
      job_id: row.job_id,
      game: row.game_grade,
      game_label: GAME_LABELS[row.game_grade],
      home: !!row.game_home,
      type: row.job_type,
      label: JOB_LABELS[row.job_type],
      supplier: JSON.parse(row.supplier),
      player_key: row.player_key,
      name: row.player_name,
      status: row.status,
    })),
  };
}

async function setJob(db, body) {
  const { round, job_id, player } = body;
  if (!round || !job_id) throw httpError("round and job_id are required", 400);
  const row = await db
    .prepare(`SELECT supplier FROM job_allocations WHERE season = ? AND round_name = ? AND job_id = ?`)
    .bind(SEASON, round, job_id)
    .first();
  if (!row) throw httpError("Job not found", 404);

  if (!player) {
    await db
      .prepare(
        `UPDATE job_allocations SET player_key = NULL, player_name = NULL, member_id = NULL, playhq_player_id = NULL,
                status = 'cleared', updated_at = CURRENT_TIMESTAMP
          WHERE season = ? AND round_name = ? AND job_id = ?`
      )
      .bind(SEASON, round, job_id)
      .run();
    return { ok: true, cleared: true };
  }

  // Organiser may only name someone on the saved board for a supplying grade.
  const pools = await roundPools(db, round);
  const key = playerKey(player);
  const onBoard = JSON.parse(row.supplier).some((g) => (pools[g] || []).some((p) => p.key === key));
  if (!onBoard) throw httpError("That player is not on the saved board for this job", 400);

  await db
    .prepare(
      `UPDATE job_allocations SET player_key = ?, player_name = ?, member_id = ?, playhq_player_id = ?,
              status = 'manual', updated_at = CURRENT_TIMESTAMP
        WHERE season = ? AND round_name = ? AND job_id = ?`
    )
    .bind(key, player.name, player.member_id ?? null, player.playhq_player_id ?? null, SEASON, round, job_id)
    .run();
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (pathname === "/api/jobs" && request.method === "GET") {
        const grade = url.searchParams.get("grade");
        if (!GRADES.includes(grade)) return json({ error: "grade must be league, colts, reserves or thirds" }, 400);
        return json(await publicJobs(env.DB, grade, url.searchParams.get("round")));
      }

      if (pathname === "/api/organiser/login" && request.method === "POST") {
        checkPin(request, env);
        return json({ ok: true });
      }

      if (pathname === "/api/organiser/jobs" && request.method === "GET") {
        checkPin(request, env);
        return json(await organiserView(env.DB, url.searchParams.get("round")));
      }

      if (pathname === "/api/organiser/job" && request.method === "PUT") {
        checkPin(request, env);
        return json(await setJob(env.DB, await request.json()));
      }

      if (pathname === "/api/jobs/run" && request.method === "POST") {
        checkPin(request, env);
        await runAllocation(env);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500);
    }
  },

  // Runs every minute, so a newly saved board is allocated within about a minute.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAllocation(env));
  },
};
