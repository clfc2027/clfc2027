// TEST sync dashboard for the 2026 season. Writes to FLEXI (clfc2026-flexi) only, so the
// FGK clone in workers/fgk-test can read it. Remove after testing.
import { passcodeState } from "../../shared/auth.js";

const PLAYHQ_BASE = "https://api.playhq.com";

const PAGE = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>2026 sync (TEST)</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f6f8; color: #1d1d1f; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  .sub { color: #5b6270; margin-bottom: 16px; }
  section { background: #fff; border: 1px solid #e3e6ec; border-radius: 10px; padding: 16px; margin-bottom: 16px; max-width: 760px; }
  label { display: block; font-weight: 600; margin: 8px 0 4px; }
  input, select { font: inherit; padding: 9px; border: 1px solid #c9ced8; border-radius: 6px; min-width: 260px; }
  button { font: inherit; font-weight: 600; background: #14213d; color: #fff; border: 0; padding: 9px 14px; border-radius: 6px; cursor: pointer; margin-top: 10px; margin-right: 6px; }
  button:disabled { opacity: .5; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; margin-top: 8px; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid #e3e6ec; }
  .ok { color: #067647; font-weight: 600; }
  .warn { color: #b42318; font-weight: 600; }
  .muted { color: #5b6270; }
</style>
</head>
<body>
<h1>2026 sync (TEST)</h1>
<div class="sub">Writes to FLEXI (clfc2026-flexi). The FGK test copy reads from there.</div>

<section>
  <label for="pass">Admin passcode</label>
  <input id="pass" type="password" autocomplete="off">
  <div><button id="loadBtn">Load rounds</button></div>
  <div id="loadMsg" class="muted"></div>
</section>

<section id="syncBox" hidden>
  <label for="round">Round</label>
  <select id="round"></select>
  <div><button id="syncBtn">Sync this round</button></div>
  <div id="active" class="muted"></div>
  <div id="results"></div>
</section>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, passcode: $('pass').value }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

function showActive(state) {
  $('active').textContent = state.activeRound ? 'Active round in the test wheel: ' + state.activeRound : 'No round set yet.';
}

$('loadBtn').onclick = async () => {
  $('loadMsg').textContent = 'Loading rounds from PlayHQ…';
  try {
    const data = await post('/api/rounds', {});
    const sel = $('round');
    sel.innerHTML = data.rounds.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + (r.date ? ' (' + esc(r.date) + ')' : '') + '</option>').join('');
    $('syncBox').hidden = false;
    $('loadMsg').textContent = data.rounds.length + ' rounds found.';
    showActive(data);
  } catch (e) { $('loadMsg').innerHTML = '<span class="warn">' + esc(e.message) + '</span>'; }
};

$('syncBtn').onclick = async () => {
  const roundName = $('round').value;
  $('syncBtn').disabled = true;
  $('results').textContent = 'Syncing ' + roundName + '…';
  try {
    const data = await post('/api/sync-round', { roundName });
    const rows = data.results.map((r) => {
      const games = r.games.length ? r.games.map((g) => g.opponent + ': ' + (g.status === 'synced' ? g.players + ' players' : g.status)).join('<br>') : '<span class="muted">no game this round</span>';
      return '<tr><td>' + esc(r.team) + '</td><td>' + games + '</td></tr>';
    }).join('');
    $('results').innerHTML = '<table><tr><th>Team</th><th>Game</th></tr>' + rows + '</table>';
    showActive(data);
  } catch (e) { $('results').innerHTML = '<span class="warn">' + esc(e.message) + '</span>'; }
  $('syncBtn').disabled = false;
};
</script>
</body>
</html>`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function requirePasscode(env, passcode) {
  const state = passcodeState(passcode, env);
  if (state === "not-set") return json({ error: "ADMIN_PASSCODE is not set on this Worker." }, 500);
  if (state !== "ok") return json({ error: "Wrong passcode." }, 401);
  return null;
}

async function playhq(endpoint, apiKey, version = "v1") {
  const res = await fetch(`${PLAYHQ_BASE}/${version}${endpoint}`, {
    headers: { "x-api-key": apiKey, "x-phq-tenant": "afl", Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`PlayHQ ${res.status}: ${res.statusText}`);
  return res.json();
}

async function teams2026(db) {
  const { results: teams } = await db.prepare(
    `SELECT t.* FROM teams t JOIN seasons s ON t.season_id = s.id WHERE s.season_year = 2026 ORDER BY t.id`
  ).all();
  const seen = new Set();
  return teams.filter((t) => (seen.has(t.team_name) ? false : (seen.add(t.team_name), true)));
}

async function syncFixtures(db, apiKey, team) {
  const data = await playhq(`/teams/${team.playhq_team_id}/fixture`, apiKey);
  for (const f of data.data || []) {
    const opponent = f.competitors?.find((c) => c.id !== team.playhq_team_id);
    await db.prepare(
      `INSERT OR REPLACE INTO fixtures
         (season_id, team_id, playhq_game_id, round_id, round_name, is_final_round,
          game_date, game_time, timezone, opponent_team_id, opponent_name,
          venue_id, venue_name, venue_surface, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      team.season_id, team.id, f.id,
      f.round?.id || null, f.round?.name || null, f.round?.isFinalRound ? 1 : 0,
      f.schedule?.date || null, f.schedule?.time || null, f.schedule?.timezone || null,
      opponent?.id || null, opponent?.name || null,
      f.venue?.id || null, f.venue?.name || null, f.venue?.surfaceName || null,
      f.status || null
    ).run();
  }
}

// Replace this game's team sheet with what PlayHQ has now (an empty list is kept as empty).
async function syncSheet(db, apiKey, team, gameId) {
  await db.prepare(`DELETE FROM team_sheet_players WHERE game_id = ?`).bind(gameId).run();
  const summary = await playhq(`/games/${gameId}/summary`, apiKey, "v2");
  const mine = (summary.data?.appearances || []).filter((a) => a.teamId === team.playhq_team_id);
  for (const p of mine) {
    await db.prepare(
      `INSERT OR IGNORE INTO team_sheet_players
         (game_id, playhq_player_id, first_name, last_name, player_number, player_position, captain_role, is_fill_in, is_emergency, role_type)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      gameId, p.id, p.firstName, p.lastName, p.playerNumber ?? null, p.position || null, p.captainRole || null,
      p.isFillIn ? 1 : 0, p.isEmergency ? 1 : 0, p.roleType || "Player"
    ).run();
  }
  const { results } = await db.prepare(
    `SELECT COUNT(*) AS n FROM team_sheet_players WHERE game_id = ? AND role_type = 'Player'`
  ).bind(gameId).all();
  return results[0]?.n || 0;
}

async function listRounds(db) {
  const { results } = await db.prepare(
    `SELECT f.round_name AS name, MIN(f.game_date) AS date
       FROM fixtures f JOIN teams t ON t.id = f.team_id JOIN seasons s ON s.id = t.season_id
      WHERE s.season_year = 2026 AND f.round_name IS NOT NULL
      GROUP BY f.round_name ORDER BY MIN(f.game_date)`
  ).all();
  return results;
}

async function activeRound(db) {
  const row = await db.prepare(`SELECT round_name, set_at FROM fgk_test_active WHERE id = 1`).first();
  return row ? { activeRound: row.round_name, setAt: row.set_at } : { activeRound: null };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
    }
    if (request.method !== "POST" || !path.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const denied = requirePasscode(env, body.passcode);
    if (denied) return denied;

    const db = env.FLEXI;
    const apiKey = env.PLAYHQ_API_KEY;

    try {
      if (path === "/api/rounds") {
        for (const t of await teams2026(db)) await syncFixtures(db, apiKey, t);
        return json({ rounds: await listRounds(db), ...(await activeRound(db)) });
      }

      if (path === "/api/sync-round") {
        const roundName = String(body.roundName || "");
        if (!roundName) return json({ error: "Choose a round first." }, 400);
        const teams = await teams2026(db);
        const results = [];
        for (const team of teams) {
          await syncFixtures(db, apiKey, team);
          const { results: games } = await db.prepare(
            `SELECT playhq_game_id AS gameId, opponent_name AS opponent FROM fixtures WHERE team_id = ? AND round_name = ? ORDER BY game_date`
          ).bind(team.id, roundName).all();
          const out = [];
          for (const g of games) {
            const players = await syncSheet(db, apiKey, team, g.gameId);
            out.push({ opponent: g.opponent || "?", gameId: g.gameId, players, status: players ? "synced" : "no_team_sheet" });
          }
          results.push({ team: team.team_name, games: out });
        }
        await db.prepare(
          `INSERT INTO fgk_test_active (id, round_name, set_at) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET round_name = excluded.round_name, set_at = excluded.set_at`
        ).bind(roundName, new Date().toISOString()).run();
        return json({ roundName, results, ...(await activeRound(db)) });
      }

      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  },
};
