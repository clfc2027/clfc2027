// CLFC PlayHQ Admin worker — passcode protected
import { passcodeState } from "../../shared/auth.js";
// The passcode is NOT stored in this file. It is read from the ADMIN_PASSCODE secret.
// Set it with:  npx.cmd wrangler secret put ADMIN_PASSCODE --name admin

const PLAYHQ_BASE = "https://api.playhq.com";
// Cockburn Lakes (Perth Football League) organisation ID. Override with a PLAYHQ_ORG_ID var/secret if needed.
const DEFAULT_ORG_ID = "89b6bccc-ad76-4766-8b96-9f1fc00738ec";
const CLUB_NAME = "Cockburn Lakes";

async function playhq(endpoint, apiKey, version = "v1") {
const res = await fetch(`${PLAYHQ_BASE}/${version}${endpoint}`, {
headers: {
"x-api-key": apiKey,
"x-phq-tenant": "afl",
"Accept": "application/json"
}
});
if (!res.ok) throw new Error(`PlayHQ ${res.status}: ${res.statusText}`);
return res.json();
}

// Follows PlayHQ cursor pagination and returns every row.
async function playhqAll(endpoint, apiKey) {
const rows = [];
let cursor = null;
for (let page = 0; page < 25; page++) {
const sep = endpoint.includes("?") ? "&" : "?";
const data = await playhq(cursor ? `${endpoint}${sep}cursor=${encodeURIComponent(cursor)}` : endpoint, apiKey);
rows.push(...(data.data || []));
if (!data.metadata?.hasMore || !data.metadata?.nextCursor) break;
cursor = data.metadata.nextCursor;
}
return rows;
}

function json(data, status = 200) {
return new Response(JSON.stringify(data), {
status,
headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
}

// ---------- Passcode check ----------
async function sha256Hex(value) {
const bytes = new TextEncoder().encode(value);
const digest = await crypto.subtle.digest("SHA-256", bytes);
return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function passcodeOk(request, env) {
// Shared check (shared/auth.js): locked if the secret is missing.
return passcodeState(request.headers.get("x-admin-passcode") || "", env) === "ok";
}

function kickoffToUtcIso(dateStr, timeStr, timeZone) {
if (!dateStr || !timeStr) return null;
const tz = timeZone || "Australia/Perth";
const naive = new Date(`${dateStr}T${timeStr}Z`);
const asTz = new Date(naive.toLocaleString("en-US", { timeZone: tz }));
const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
const offsetMs = asUtc.getTime() - asTz.getTime();
return new Date(naive.getTime() + offsetMs).toISOString();
}

async function getTeams(db) {
const { results } = await db.prepare(`
SELECT t.id, t.team_name, t.playhq_team_id, t.grade_name, s.season_year
FROM teams t LEFT JOIN seasons s ON s.id = t.season_id
ORDER BY s.season_year DESC, t.team_name
`).all();
return results;
}

async function getMembers(db) {
const { results } = await db.prepare(
`SELECT id, first_name, last_name, role FROM member_directory ORDER BY last_name, first_name`
).all();
return results;
}

async function getMemberPin(db, memberId) {
return db.prepare(
`SELECT id, first_name, last_name, pin FROM member_directory WHERE id = ?`
).bind(memberId).first();
}

// ---------- All-seasons sync ----------
// Pulls every season the club has on PlayHQ, and every Cockburn Lakes team in each season.
async function syncAllSeasons(db, apiKey, orgId) {
const seasons = await playhqAll(`/organisations/${orgId}/seasons`, apiKey);
const summary = { seasons: [], teamsAdded: 0, teamsTotal: 0, errors: [] };

for (const s of seasons) {
const year = parseInt(String(s.name || "").match(/\d{4}/)?.[0] || "", 10);
if (!year) continue;

// Keep existing season rows (and their status) untouched apart from the year.
await db.prepare(`
INSERT INTO seasons (season_year, playhq_season_id, organisation_id, association_id, status)
VALUES (?,?,?,?,?)
ON CONFLICT(playhq_season_id) DO UPDATE SET
  season_year = excluded.season_year,
  status = excluded.status
`).bind(year, s.id, orgId, s.association?.id || "", s.status ? String(s.status).toLowerCase() : null).run();
const seasonRow = await db.prepare(`SELECT id FROM seasons WHERE playhq_season_id = ?`).bind(s.id).first();

try {
const teams = (await playhqAll(`/seasons/${s.id}/teams`, apiKey)).filter((t) => t.club?.id === orgId);
for (const t of teams) {
const existing = await db.prepare(`SELECT id FROM teams WHERE playhq_team_id = ?`).bind(t.id).first();
await db.prepare(`
INSERT INTO teams (season_id, playhq_team_id, club_name, team_name, grade_id, grade_name)
VALUES (?,?,?,?,?,?)
ON CONFLICT(playhq_team_id) DO UPDATE SET
season_id = excluded.season_id,
team_name = excluded.team_name,
grade_id = COALESCE(excluded.grade_id, teams.grade_id),
grade_name = COALESCE(excluded.grade_name, teams.grade_name)
`).bind(seasonRow.id, t.id, CLUB_NAME, t.name, t.grade?.id || null, t.grade?.name || null).run();
if (!existing) summary.teamsAdded++;
}
summary.teamsTotal += teams.length;
summary.seasons.push({ year, teams: teams.map((t) => t.name) });
} catch (e) {
summary.errors.push({ year, error: e.message });
}
}
summary.seasons.sort((a, b) => b.year - a.year);
return summary;
}

async function syncFixtures(db, apiKey, teamId, teamDbId, seasonId) {
const data = await playhq(`/teams/${teamId}/fixture`, apiKey);
const fixtures = data.data || [];
let count = 0;
for (const f of fixtures) {
const opponent = f.competitors?.find((c) => c.id !== teamId);
await db.prepare(`
INSERT INTO fixtures
(season_id, team_id, playhq_game_id, round_id, round_name, is_final_round,
game_date, game_time, timezone, opponent_team_id, opponent_name,
venue_id, venue_name, venue_surface, status)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(playhq_game_id) DO UPDATE SET
season_id = excluded.season_id,
team_id = excluded.team_id,
round_id = excluded.round_id,
round_name = excluded.round_name,
is_final_round = excluded.is_final_round,
game_date = excluded.game_date,
game_time = excluded.game_time,
timezone = excluded.timezone,
opponent_team_id = excluded.opponent_team_id,
opponent_name = excluded.opponent_name,
venue_id = excluded.venue_id,
venue_name = excluded.venue_name,
venue_surface = excluded.venue_surface,
status = excluded.status,
updated_at = CURRENT_TIMESTAMP
`).bind(
seasonId,
teamDbId,
f.id,
f.round?.id || null,
f.round?.name || null,
f.round?.isFinalRound ? 1 : 0,
f.schedule?.date || null,
f.schedule?.time || null,
f.schedule?.timezone || null,
opponent?.id || null,
opponent?.name || null,
f.venue?.id || null,
f.venue?.name || null,
f.venue?.surfaceName || null,
f.status || null
).run();
count++;
}
return count;
}

async function linkMembersToPlayhq(db) {
await db.prepare(`
UPDATE member_directory
SET playhq_player_id = (
SELECT tsp.playhq_player_id
FROM team_sheet_players tsp
WHERE LOWER(TRIM(tsp.first_name)) = LOWER(TRIM(member_directory.first_name))
AND LOWER(TRIM(tsp.last_name)) = LOWER(TRIM(member_directory.last_name))
LIMIT 1
)
WHERE playhq_player_id IS NULL
`).run();
}

async function insertTeamSheet(db, gameId, appearances) {
await db.prepare(`DELETE FROM team_sheet_players WHERE game_id = ?`).bind(gameId).run();
for (const p of appearances) {
await db.prepare(`
INSERT OR IGNORE INTO team_sheet_players
(game_id, playhq_player_id, first_name, last_name, player_number, player_position, captain_role, is_fill_in, is_emergency, role_type)
VALUES (?,?,?,?,?,?,?,?,?,?)
`).bind(
gameId,
p.id,
p.firstName,
p.lastName,
p.playerNumber,
p.position || null,
p.captainRole || null,
p.isFillIn ? 1 : 0,
p.isEmergency ? 1 : 0,
p.roleType || "Player"
).run();
}
}

async function syncGamePlayers(db, apiKey, teamId, teamDbId) {
const data = await playhq(`/teams/${teamId}/fixture`, apiKey);
const fixtures = data.data || [];
const today = new Date().toISOString().split("T")[0];
let game = fixtures.find((f) => f.schedule?.date === today);
if (!game) game = fixtures.find((f) => f.status === "UPCOMING");
if (!game) game = [...fixtures].reverse().find((f) => f.status === "FINAL");
if (!game) throw new Error("No game found");

const gameId = game.id;
const summary = await playhq(`/games/${gameId}/summary`, apiKey, "v2");
const appearances = summary.data?.appearances || [];
const ourTeamAppearances = appearances.filter((a) => a.teamId === teamId);
const players = ourTeamAppearances.filter((a) => a.roleType === "Player" && a.playerNumber);

await insertTeamSheet(db, gameId, ourTeamAppearances);
await linkMembersToPlayhq(db);

return {
gameId,
round: game.round?.name,
date: game.schedule?.date,
opponent: game.competitors?.find((c) => c.id !== teamId)?.name,
status: game.status,
playerCount: players.length,
players: players.map((p) => ({
number: p.playerNumber,
name: `${p.firstName} ${p.lastName}`,
isFillIn: p.isFillIn,
isEmergency: p.isEmergency,
captain: p.captainRole || null
}))
};
}

async function syncSpecificGamePlayers(db, apiKey, teamId, teamDbId, game) {
const gameId = game.id;
const summary = await playhq(`/games/${gameId}/summary`, apiKey, "v2");
const appearances = summary.data?.appearances || [];
const ourTeamAppearances = appearances.filter((a) => a.teamId === teamId);
if (!ourTeamAppearances.length) return { gameId, status: "NO_TEAM_SHEET", playerCount: 0 };

const playerCount = ourTeamAppearances.filter((a) => a.roleType === "Player" && a.playerNumber).length;
const sourceHash = await sha256Hex(JSON.stringify(ourTeamAppearances));
const previous = await db.prepare(
`SELECT source_hash FROM team_sheet_sync_state WHERE game_id = ?`
).bind(gameId).first();
if (previous?.source_hash === sourceHash) {
return { gameId, status: "UNCHANGED", playerCount };
}

await insertTeamSheet(db, gameId, ourTeamAppearances);
await db.prepare(`
INSERT INTO team_sheet_sync_state (game_id, team_id, source_hash, synced_at)
VALUES (?,?,?,CURRENT_TIMESTAMP)
ON CONFLICT(game_id) DO UPDATE SET team_id=excluded.team_id, source_hash=excluded.source_hash, synced_at=CURRENT_TIMESTAMP
`).bind(gameId, teamDbId, sourceHash).run();
await linkMembersToPlayhq(db);

return { gameId, status: "UPDATED", playerCount };
}

// Only the latest season's teams — old seasons have no upcoming games.
async function syncAllUpcomingTeamSheets(db, apiKey) {
const { results: teams } = await db.prepare(`
SELECT id, playhq_team_id, team_name, grade_name, season_id FROM teams
WHERE season_id IN (SELECT id FROM seasons WHERE season_year = (SELECT MAX(season_year) FROM seasons))
ORDER BY grade_name, team_name
`).all();
const summary = { teams: 0, fixtures: 0, gamesChecked: 0, updated: 0, unchanged: 0, noTeamSheet: 0, errors: [] };
for (const team of teams) {
summary.teams++;
try {
const fixtureData = await playhq(`/teams/${team.playhq_team_id}/fixture`, apiKey);
const fixtures = fixtureData.data || [];
await syncFixtures(db, apiKey, team.playhq_team_id, team.id, team.season_id);
summary.fixtures += fixtures.length;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
const upcoming = fixtures.filter(
(f) => f.schedule?.date >= today && f.status !== "FINAL" && f.status !== "CANCELLED"
);
for (const game of upcoming) {
summary.gamesChecked++;
const result = await syncSpecificGamePlayers(db, apiKey, team.playhq_team_id, team.id, game);
if (result.status === "UPDATED") summary.updated++;
else if (result.status === "UNCHANGED") summary.unchanged++;
else summary.noTeamSheet++;
}
} catch (e) {
summary.errors.push({ team: team.team_name, grade: team.grade_name, error: e.message });
}
}
summary.currentRounds = await setCurrentRounds(db);
return summary;
}

// Sets current_round for the latest season: each team's earliest fixture dated today (Perth) or later
// and not finished. The round_date is that game's date, which is the voting round_key.
// A team with no upcoming fixture keeps its previous row.
async function setCurrentRounds(db) {
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
const { results: rows } = await db.prepare(`
SELECT t.id AS team_id, t.season_id, t.grade_id, f.playhq_game_id, f.game_date
FROM teams t
JOIN seasons s ON s.id = t.season_id
AND s.season_year = (SELECT MAX(season_year) FROM seasons)
JOIN fixtures f ON f.team_id = t.id
WHERE f.game_date >= ?
AND (f.status IS NULL OR f.status NOT IN ('FINAL', 'CANCELLED'))
ORDER BY t.id, f.game_date, f.game_time
`).bind(today).all();

const seen = new Set();
let set = 0;
for (const r of rows) {
if (seen.has(r.team_id)) continue; // earliest upcoming game per team only
seen.add(r.team_id);
await db.prepare(`
INSERT INTO current_round (season_id, team_id, grade_id, playhq_game_id, round_date, set_at)
VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(season_id, team_id) DO UPDATE SET
grade_id = excluded.grade_id,
playhq_game_id = excluded.playhq_game_id,
round_date = excluded.round_date,
set_at = CURRENT_TIMESTAMP
`).bind(r.season_id, r.team_id, r.grade_id, r.playhq_game_id, r.game_date).run();
set++;
}
return set;
}

async function getSeasons(db) {
const { results } = await db.prepare(`
SELECT id, season_year, playhq_season_id, organisation_id, association_id, status
FROM seasons ORDER BY season_year DESC
`).all();
return results;
}

async function getTeamsForSeason(db, seasonYear) {
const { results } = await db.prepare(`
SELECT t.id, t.team_name, t.club_name, t.grade_id, t.grade_name, t.playhq_team_id,
(SELECT COUNT(*) FROM fixtures f WHERE f.team_id = t.id) AS fixture_count
FROM teams t JOIN seasons s ON t.season_id = s.id
WHERE s.season_year = ?
ORDER BY t.grade_name, t.team_name
`).bind(seasonYear).all();
return results;
}

async function getRoundsForTeam(db, teamId) {
const { results } = await db.prepare(`
SELECT round_id, round_name, MAX(is_final_round) AS is_final_round, MIN(game_date) AS first_date
FROM fixtures WHERE team_id = ?
GROUP BY round_id, round_name
ORDER BY first_date
`).bind(teamId).all();
return results;
}

async function getRoundGames(db, teamId, roundId) {
const { results } = await db.prepare(`
SELECT f.playhq_game_id, f.round_name, f.game_date, f.game_time, f.timezone,
f.status, f.venue_name, f.opponent_name, t.team_name AS our_team_name
FROM fixtures f JOIN teams t ON f.team_id = t.id
WHERE f.team_id = ? AND f.round_id = ?
`).bind(teamId, roundId).all();
return results.map((g) => ({ ...g, kickoff_utc: kickoffToUtcIso(g.game_date, g.game_time, g.timezone) }));
}

async function getUpcomingGames(db, teamId, limit = 5) {
const { results } = await db.prepare(`
SELECT playhq_game_id, round_name, game_date, game_time, timezone,
status, venue_name, opponent_name
FROM fixtures
WHERE team_id = ? AND status != 'FINAL'
ORDER BY game_date ASC, game_time ASC
LIMIT ?
`).bind(teamId, limit).all();
return results.map((g) => ({ ...g, kickoff_utc: kickoffToUtcIso(g.game_date, g.game_time, g.timezone) }));
}

async function getGamePlayersOnly(db, playhqGameId) {
const { results } = await db.prepare(`
SELECT playhq_player_id, first_name, last_name, player_number,
player_position, captain_role, is_fill_in, is_emergency
FROM team_sheet_players
WHERE game_id = ? AND role_type = 'Player'
ORDER BY CAST(player_number AS INTEGER)
`).bind(playhqGameId).all();
return results;
}

// Loads a game live from PlayHQ and saves our team sheet for it into the database.
async function getGameDetail(db, apiKey, playhqGameId) {
const fixture = await db.prepare(`
SELECT f.*, t.team_name, t.grade_name, t.club_name, t.playhq_team_id, s.season_year
FROM fixtures f
JOIN teams t ON f.team_id = t.id
JOIN seasons s ON f.season_id = s.id
WHERE f.playhq_game_id = ?
`).bind(playhqGameId).first();
if (!fixture) throw new Error("Game not found in local index — run a fixture sync for this team first");

const summary = await playhq(`/games/${playhqGameId}/summary`, apiKey, "v2");
const appearances = summary.data?.appearances || [];

const ourTeamAppearances = appearances.filter((a) => a.teamId === fixture.playhq_team_id);
if (ourTeamAppearances.length) {
await insertTeamSheet(db, playhqGameId, ourTeamAppearances);
await linkMembersToPlayhq(db);
}

const players = appearances.map((a) => ({
playhqPlayerId: a.id,
teamId: a.teamId,
isOurTeam: a.teamId === fixture.playhq_team_id,
roleType: a.roleType || "Player",
name: `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim(),
number: a.playerNumber ?? null,
position: a.position || null,
captain: a.captainRole || null,
isFillIn: !!a.isFillIn,
isEmergency: !!a.isEmergency
}));

return {
gameId: playhqGameId,
status: fixture.status,
roundId: fixture.round_id,
roundName: fixture.round_name,
season: String(fixture.season_year),
grade: fixture.grade_name,
homeTeam: fixture.team_name,
awayTeam: fixture.opponent_name,
venue: fixture.venue_name,
gameDate: fixture.game_date,
gameTime: fixture.game_time,
kickoffUtc: kickoffToUtcIso(fixture.game_date, fixture.game_time, fixture.timezone),
savedPlayers: ourTeamAppearances.length,
players
};
}

// ---------- Game day duties (admin grid) ----------
// Names come from the coaches boards saved in FLEXI for the same round.
// Each allocation is one row: season, round, grade, duty, slot and member.
// Saving a round replaces that round's rows, so re-saving never double counts in the tally.
const DUTY_SEASON = 2027;
const DUTY_GRADES = ["colts", "reserves", "league", "thirds"];
const DUTY_GRADE_LABEL = { colts: "Colts", reserves: "Reserves", league: "League", thirds: "Thirds" };
const DUTY_TASKS = [
  { key: "WATER_1H", label: "Water 1st Half", slots: 2 },
  { key: "WATER_2H", label: "Water 2nd Half", slots: 2 },
  { key: "JUMPERS", label: "Jumpers", slots: 1 },
  { key: "SCOREBOARD", label: "Scoreboard", slots: 1 },
  { key: "CHANGEROOM", label: "Changeroom Sweep", slots: 1 },
];
// Away games only need water and jumpers.
const AWAY_TASK_KEYS = ["WATER_1H", "WATER_2H", "JUMPERS"];
// Home games: the coaches board whose team supplies the names for each duty.
const DUTY_SOURCE_HOME = {
  colts: { WATER_1H: "league", WATER_2H: "league", SCOREBOARD: "league", JUMPERS: "colts", CHANGEROOM: "colts" },
  reserves: { WATER_1H: "thirds", WATER_2H: "thirds", SCOREBOARD: "thirds", JUMPERS: "reserves", CHANGEROOM: "reserves" },
  league: { WATER_1H: "colts", WATER_2H: "colts", SCOREBOARD: "colts", JUMPERS: "league", CHANGEROOM: "league" },
  thirds: { WATER_1H: "reserves", WATER_2H: "reserves", SCOREBOARD: "reserves", JUMPERS: "thirds", CHANGEROOM: "thirds" },
};
// Away games: the grade that does this grade's water and jumpers. Its board supplies the names.
// Away games: water is done by the grade named here (Colts game: League; Reserves game: Colts;
// League game: Reserves). Jumpers are always done by the grade playing that game.
const DUTY_SOURCE_AWAY = {
  colts: { WATER_1H: "league", WATER_2H: "league", JUMPERS: "colts" },
  reserves: { WATER_1H: "colts", WATER_2H: "colts", JUMPERS: "reserves" },
  league: { WATER_1H: "reserves", WATER_2H: "reserves", JUMPERS: "league" },
  thirds: { WATER_1H: "thirds", WATER_2H: "thirds", JUMPERS: "thirds" },
};
// Away duties a grade does not do at all (no names needed).
const AWAY_SKIP = { thirds: ["WATER_1H", "WATER_2H"] };
const MSG_NOT_NAMED = "coach not named team";

function httpErr(message, status) {
  return Object.assign(new Error(message), { status });
}

function needFlexi(env) {
  if (!env.FLEXI) throw httpErr("The FLEXI database binding is not set on the admin Worker", 500);
  return env.FLEXI;
}

function seasonOf(value) {
  const n = Number(value || DUTY_SEASON);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw httpErr("Season must be a year, for example 2027", 400);
  return n;
}

async function ensureDutiesTable(flexi) {
  await flexi.prepare(`CREATE TABLE IF NOT EXISTS game_day_allocations (
    season_year INTEGER NOT NULL,
    round_name TEXT NOT NULL,
    grade TEXT NOT NULL,
    task_key TEXT NOT NULL,
    slot INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    saved_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (season_year, round_name, grade, task_key, slot)
  )`).run();
  await flexi.prepare(`CREATE TABLE IF NOT EXISTS game_day_round_type (
    season_year INTEGER NOT NULL,
    round_name TEXT NOT NULL,
    venue_type TEXT NOT NULL,
    saved_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (season_year, round_name)
  )`).run();
}

// The players a grade's coach saved on the coaches board for one round.
// Reads nothing if the coaches board has never been used (its tables don't exist yet).
async function savedBoard(flexi, gradeKey, round) {
  const none = { saved: false, players: [], venue: null };
  if (!round) return none;
  try {
    const sel = await flexi
      .prepare(`SELECT id, venue_name FROM board_selections WHERE grade_id = ?1 AND round_name = ?2`)
      .bind(gradeKey, round)
      .first();
    if (!sel) return none;
    const { results } = await flexi
      .prepare(
        `SELECT DISTINCT member_id, player_name FROM board_selection_players
          WHERE selection_id = ?1 AND member_id IS NOT NULL ORDER BY player_name`
      )
      .bind(sel.id)
      .all();
    return {
      saved: true,
      players: results.map((r) => ({ member_id: r.member_id, name: r.player_name })),
      venue: sel.venue_name || null,
    };
  } catch (e) {
    if (/no such table/i.test(e.message)) return none;
    throw e;
  }
}

// Home or away for a round: the saved choice, else suggested from the coaches boards' saved venue.
async function roundVenue(flexi, season, round) {
  if (!round) return { venue: null, venue_source: null };
  const stored = await flexi
    .prepare(`SELECT venue_type FROM game_day_round_type WHERE season_year = ?1 AND round_name = ?2`)
    .bind(season, round)
    .first();
  if (stored) return { venue: stored.venue_type, venue_source: "saved" };
  const venues = [];
  for (const g of DUTY_GRADES) {
    const b = await savedBoard(flexi, g, round);
    if (b.venue) venues.push(b.venue);
  }
  if (!venues.length) return { venue: null, venue_source: null };
  const home = venues.some((v) => /anning/i.test(v));
  return { venue: home ? "home" : "away", venue_source: "suggested from the coaches board venue" };
}

// Which duties apply, and whose board supplies the names for each, for one round.
function taskRule(venue, gradeKey, taskKey) {
  if (venue === "away") {
    const skipped = (AWAY_SKIP[gradeKey] || []).indexOf(taskKey) >= 0;
    return {
      required: AWAY_TASK_KEYS.indexOf(taskKey) >= 0 && !skipped,
      source: DUTY_SOURCE_AWAY[gradeKey][taskKey],
    };
  }
  return { required: true, source: DUTY_SOURCE_HOME[gradeKey][taskKey] };
}

async function buildPlan(flexi, season, round, venueOverride) {
  const rv = await roundVenue(flexi, season, round);
  const venue = venueOverride || rv.venue;
  const venueSource = venueOverride ? "chosen for this view" : rv.venue_source;
  const boards = {};
  for (const g of DUTY_GRADES) boards[g] = await savedBoard(flexi, g, round);
  const grades = {};
  for (const g of DUTY_GRADES) {
    grades[g] = {
      label: DUTY_GRADE_LABEL[g],
      tasks: DUTY_TASKS.map((t) => {
        const rule = taskRule(venue, g, t.key);
        const options = rule.required ? boards[rule.source].players : [];
        return {
          key: t.key,
          label: t.label,
          slots: Array.from({ length: t.slots }, () => null),
          required: rule.required,
          source: rule.source,
          source_label: DUTY_GRADE_LABEL[rule.source],
          options,
          message: rule.required && options.length === 0 ? MSG_NOT_NAMED : null,
        };
      }),
    };
  }
  return { venue, venue_source: venueSource, grades };
}

// Duties for every grade in one round. Defaults to the latest round that has anything saved.
async function getGameDayDuties(flexi, requestedRound, season, venueOverride) {
  await ensureDutiesTable(flexi);
  const { results: roundRows } = await flexi
    .prepare(
      `SELECT round_name FROM game_day_allocations WHERE season_year = ?1
       UNION SELECT round_name FROM game_day_round_type WHERE season_year = ?1`
    )
    .bind(season)
    .all();
  const rounds = roundRows
    .map((r) => r.round_name)
    .sort((a, b) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0));
  const round = requestedRound ? String(requestedRound).trim() : rounds[rounds.length - 1] || null;

  const plan = await buildPlan(flexi, season, round, venueOverride);
  if (round) {
    const { results } = await flexi
      .prepare(
        `SELECT grade, task_key, slot, member_id, player_name FROM game_day_allocations
          WHERE season_year = ?1 AND round_name = ?2`
      )
      .bind(season, round)
      .all();
    for (const r of results) {
      const grade = plan.grades[r.grade];
      if (!grade) continue;
      const task = grade.tasks.find((t) => t.key === r.task_key);
      if (!task || r.slot >= task.slots.length) continue;
      task.slots[r.slot] = { member_id: r.member_id, name: r.player_name };
    }
  }
  return { season, round, rounds, venue: plan.venue, venue_source: plan.venue_source, grades: plan.grades };
}

// Saves a whole round (all four grades) and its home or away choice in one go.
// Every name must be on the board that supplies that duty for that round.
async function saveGameDayRound(flexi, payload) {
  const season = seasonOf(payload.season);
  const round = String(payload.round || "").trim();
  const venue = payload.venue;
  if (!round || round.length > 10) throw httpErr("Pick a round first", 400);
  if (venue !== "home" && venue !== "away") throw httpErr("Choose home or away for this round first", 400);
  await ensureDutiesTable(flexi);

  const plan = await buildPlan(flexi, season, round, venue);
  const rows = [];
  for (const grade of DUTY_GRADES) {
    const given = (payload.grades && payload.grades[grade] && payload.grades[grade].tasks) || {};
    const picks = [];
    for (const task of plan.grades[grade].tasks) {
      const list = Array.isArray(given[task.key]) ? given[task.key] : [];
      if (list.length > task.slots.length) throw httpErr(`${grade}: ${task.label} has too many players`, 400);
      list.forEach((card, slot) => {
        if (!card) return;
        if (!task.required) {
          throw httpErr(`${DUTY_GRADE_LABEL[grade]} ${task.label} is not needed for an ${venue} game`, 400);
        }
        const memberId = Number(card.member_id);
        const opt = task.options.filter((o) => o.member_id === memberId)[0];
        if (!opt) {
          throw httpErr(`Pick ${DUTY_GRADE_LABEL[grade]} ${task.label} names from the ${task.source_label} board`, 400);
        }
        picks.push({ grade, task_key: task.key, slot, member_id: memberId, name: opt.name });
      });
    }
    rows.push(...picks);
  }
  // Nobody may hold two duties in the same round, across all grades.
  const roundIds = rows.map((p) => p.member_id);
  if (roundIds.some((id, i) => roundIds.indexOf(id) !== i)) {
    throw httpErr("A player is on more than one job this round", 409);
  }

  const stmts = [
    flexi.prepare(`DELETE FROM game_day_allocations WHERE season_year = ?1 AND round_name = ?2`).bind(season, round),
    flexi
      .prepare(
        `INSERT INTO game_day_round_type (season_year, round_name, venue_type, saved_at)
           VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT (season_year, round_name) DO UPDATE SET venue_type = excluded.venue_type, saved_at = CURRENT_TIMESTAMP`
      )
      .bind(season, round, venue),
  ];
  for (const r of rows) {
    stmts.push(
      flexi
        .prepare(
          `INSERT INTO game_day_allocations (season_year, round_name, grade, task_key, slot, member_id, player_name, saved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)`
        )
        .bind(season, round, r.grade, r.task_key, r.slot, r.member_id, r.name)
    );
  }
  await flexi.batch(stmts);
  return { ok: true, season, round, venue, assigned: rows.length };
}

// Running count of each person's allocations, per job, for one season.
async function getGameDayTally(flexi, season) {
  await ensureDutiesTable(flexi);
  const { results } = await flexi
    .prepare(
      `SELECT member_id, MAX(player_name) AS player_name, task_key, COUNT(*) AS n
         FROM game_day_allocations WHERE season_year = ?1 GROUP BY member_id, task_key`
    )
    .bind(season)
    .all();
  const byMember = new Map();
  for (const r of results) {
    const m = byMember.get(r.member_id) || { member_id: r.member_id, name: r.player_name, total: 0, by_task: {} };
    m.by_task[r.task_key] = r.n;
    m.total += r.n;
    byMember.set(r.member_id, m);
  }
  const members = [...byMember.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { season, tasks: DUTY_TASKS.map((t) => ({ key: t.key, label: t.label })), members };
}

function getDashboard() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>PlayHQ Admin</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root { --red: #b0193c; --blue: #0a3161; --blue-light: #1d4e89; --white: #ffffff; --offwhite: #f4f6f9; }
body {
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
background: var(--blue);
background-image: linear-gradient(180deg, var(--blue) 0%, var(--blue-light) 100%);
min-height: 100vh; padding: 20px; color: var(--blue);
}
.container { max-width: 640px; margin: 0 auto; }
header { text-align: center; color: var(--white); margin-bottom: 24px; border-bottom: 3px solid var(--red); padding-bottom: 14px; position: relative; }
header h1 { font-size: 24px; margin-bottom: 4px; letter-spacing: 0.5px; }
header p { font-size: 13px; opacity: 0.85; }
#logoutBtn { position: absolute; right: 0; top: 0; width: auto; padding: 6px 10px; font-size: 11px; background: rgba(255,255,255,.15); }
#backBtn { position: absolute; left: 0; top: 0; padding: 6px 10px; font-size: 11px; font-weight: 600; color: var(--white); text-decoration: none; background: rgba(255,255,255,.15); border-radius: 4px; }
#backBtn:hover { background: rgba(255,255,255,.28); }
.row { display: flex; gap: 16px; flex-wrap: wrap; }
.row .card { flex: 1 1 260px; }
.card { background: var(--white); padding: 16px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.25); margin-bottom: 16px; border-top: 4px solid var(--red); }
.card.blue-accent { border-top-color: var(--blue-light); }
.card h3 { color: var(--blue); font-size: 15px; margin-bottom: 6px; }
.card p { color: #555; font-size: 12px; margin-bottom: 12px; line-height: 1.4; }
select { width: 100%; padding: 9px; margin: 6px 0 10px; border: 1px solid #cbd3dc; border-radius: 4px; font-size: 13px; background: var(--offwhite); color: var(--blue); }
select:disabled { background: #e8ebef; color: #999; }
button { background: var(--red); color: var(--white); padding: 9px 14px; border: none; border-radius: 4px; cursor: pointer; width: 100%; font-weight: 600; font-size: 13px; letter-spacing: 0.3px; }
button:hover { background: #8f142f; }
button.secondary { background: var(--blue-light); }
button.secondary:hover { background: #163f6d; }
button.small { width: auto; padding: 6px 10px; font-size: 11px; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-row { display: flex; gap: 8px; margin-bottom: 10px; }
.btn-row button { flex: 1; }
.status { margin-top: 10px; padding: 8px 10px; border-radius: 4px; display: none; font-size: 12px; font-weight: 600; }
.status.show { display: block; }
.success { background: #dfeee2; color: #1b5e20; border-left: 4px solid var(--blue-light); }
.error { background: #fbdede; color: #8a1024; border-left: 4px solid var(--red); }
.results { margin-top: 10px; background: var(--offwhite); padding: 10px; border-radius: 4px; max-height: 360px; overflow-y: auto; display: none; font-size: 12px; border: 1px solid #dfe4ea; }
.results.show { display: block; }
.results h4 { font-size: 12px; margin: 10px 0 4px; color: var(--blue); }
.player-list { list-style: none; }
.player-list li { padding: 6px 8px; border-bottom: 1px solid #e4e8ed; display: flex; justify-content: space-between; }
.player-list li:last-child { border-bottom: none; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: var(--blue-light); color: var(--white); font-weight: 600; }
.badge.fillin { background: var(--red); }
.badge.captain { background: var(--blue); }
.pin-reveal { text-align: center; padding: 14px; background: var(--offwhite); border-radius: 6px; border: 1px dashed var(--blue-light); }
.pin-reveal .pin { font-size: 26px; font-weight: 700; letter-spacing: 4px; color: var(--red); margin: 6px 0; }
.pin-reveal .name { font-size: 13px; color: var(--blue); font-weight: 600; }
.game-pick { display: flex; justify-content: space-between; align-items: center; padding: 10px; border: 1px solid #e4e8ed; border-radius: 4px; margin-bottom: 8px; font-size: 12px; }
.game-pick button { width: auto; padding: 6px 12px; font-size: 11px; }
.kickoff { font-size: 11px; color: #777; }

/* Game day duties grid (matches the paper task sheet) */
.duties-card { width: min(980px, calc(100vw - 40px)); position: relative; left: 50%; transform: translateX(-50%); }
.duty-tabs { display: flex; overflow-x: auto; gap: 4px; background: #6b7a99; padding: 4px; border-radius: 4px; margin-bottom: 12px; }
.duty-tab { width: auto; flex: 0 0 auto; background: transparent; color: var(--white); padding: 6px 10px; font-size: 12px; }
.duty-tab:hover { background: rgba(255,255,255,.2); }
.duty-tab.active { background: var(--white); color: var(--blue); }
.duty-title { background: #c9d0da; color: #111; text-align: center; font: 700 14px Georgia, serif; padding: 8px; margin-bottom: 12px; letter-spacing: .03em; }
.duty-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.duty-block-head { text-align: center; font: 700 13px Georgia, serif; padding: 6px; border: 2px solid #111; color: #111; }
.duty-table { border-left: 2px solid #111; border-right: 2px solid #111; border-bottom: 2px solid #111; }
.duty-row { display: grid; grid-template-columns: 130px 1fr; border-top: 1px solid #111; font: 12px Georgia, serif; color: #111; background: #fff; }
.duty-row.duty-head { font-weight: 700; text-align: center; }
.duty-task { padding: 6px 8px; border-right: 1px solid #111; text-align: left; }
.duty-cells { display: grid; }
.duty-cell { position: relative; padding: 3px 4px; border-left: 1px solid #111; text-align: center; min-height: 30px; }
.duty-cells > .duty-cell:first-child { border-left: 0; }
.duty-input { width: 100%; border: none; background: transparent; text-align: center; font: 12px Georgia, serif; color: #111; padding: 5px 3px; }
.duty-input:focus { outline: 2px solid var(--blue-light); background: #eef4fb; }
.duty-suggest { position: absolute; left: 0; right: 0; top: 100%; z-index: 30; background: var(--white); border: 1px solid #444; box-shadow: 0 6px 14px rgba(0,0,0,.3); max-height: 200px; overflow-y: auto; text-align: left; }
.duty-suggest[hidden] { display: none; }
.duty-option { display: block; width: 100%; text-align: left; background: var(--white); color: #111; padding: 6px 8px; font-size: 12px; font-weight: 400; border-radius: 0; }
.duty-option:hover { background: #e8eefb; }
.duty-option span { color: #777; font-size: 11px; }
.duty-none { padding: 6px 8px; font-size: 12px; color: #777; }
@media (max-width: 720px) {
  .duty-grid { grid-template-columns: 1fr; }
  .duty-row { grid-template-columns: 96px 1fr; }
}

.duty-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.duty-actions button { width: auto; padding: 9px 16px; }
.duty-note { font-size: 12px; color: var(--red); font-weight: 600; }
.duty-tally-head { margin-top: 18px; }
.duty-tally { overflow-x: auto; }
.duty-tally table { width: 100%; border-collapse: collapse; font-size: 12px; }
.duty-tally th, .duty-tally td { border-bottom: 1px solid #e4e8ed; padding: 6px 8px; text-align: center; }
.duty-tally th { background: var(--offwhite); color: var(--blue); }
.duty-tally th:first-child, .duty-tally td:first-child { text-align: left; }

.duty-filter { width: 100%; padding: 8px 10px; margin-bottom: 8px; border: 1px solid #cbd3dc; border-radius: 4px; font-size: 13px; }

.duty-venue-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.duty-venue-row label { font-size: 12px; font-weight: 700; color: var(--blue); }
.duty-venue-row select { width: auto; margin: 0; padding: 6px 8px; }
.duty-src { display: block; font-family: Inter, -apple-system, sans-serif; font-size: 10px; font-weight: 400; color: #666; }
.duty-hint { font-size: 11px; color: #666; }
.duty-input:disabled { background: #f2f2f2; color: #999; }
.duty-input:disabled::placeholder { color: #aaa; }

.duty-legend { font-size: 12px; margin: 0 0 10px; }
.duty-key { padding: 0 4px; border-radius: 3px; }
.duty-key.dup-2, .duty-input.dup-2 { background: #c8f5cc; }
.duty-key.dup-3, .duty-input.dup-3 { background: #fff3a3; }
.duty-key.dup-4, .duty-input.dup-4 { background: #f7b5b5; }
/* Login screen */
#login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: linear-gradient(180deg, var(--blue) 0%, var(--blue-light) 100%); z-index: 100; }
#login .card { width: min(340px, 100%); text-align: center; }
#login input { width: 100%; padding: 12px; font-size: 22px; letter-spacing: .4em; text-align: center; border: 1px solid #cbd3dc; border-radius: 4px; margin: 8px 0 12px; background: var(--offwhite); color: var(--blue); }
#app { display: none; }
</style>
</head>
<body>
<div id="login">
<form class="card" id="loginForm">
<h3>PlayHQ Admin</h3>
<p>Enter the admin passcode.</p>
<input id="passInput" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
<button type="submit">Unlock</button>
<div class="status" id="status-login"></div>
</form>
</div>

<div class="container" id="app">
<header>
<a id="backBtn" href="https://clfc2027.clfc2027.workers.dev/">← Hub</a>
<h1>PlayHQ Admin</h1>
<p>Warriors Hub</p>
<button id="logoutBtn" type="button">Lock</button>
</header>

<div class="card">
<h3>Browse by Season / Team / Round</h3>
<p>Pick a year, team and round. Fixtures sync automatically the first time you open a team, and picking a round pulls that game's team sheet from PlayHQ and saves it.</p>
<div class="btn-row">
<button class="secondary" id="syncSeasonsBtn" type="button">🔄 Sync All Seasons</button>
<button id="refreshFixturesBtn" type="button" disabled>↻ Re-sync Team Fixtures</button>
</div>
<div class="status" id="status-seasons"></div>
<select id="seasonSelect"><option value="">Loading seasons...</option></select>
<select id="browseTeamSelect" disabled><option value="">Select a season first</option></select>
<select id="roundSelect" disabled><option value="">Select a team first</option></select>
<div id="gamesContainer"></div>
<div class="status" id="status-browse"></div>
<div class="results" id="results-browse"></div>
</div>

<div class="card">
<h3>Select Team (for sync actions below)</h3>
<select id="teamSelect"><option value="">Loading teams...</option></select>
</div>

<div class="row">
<div class="card">
<h3>📅 Fixture Sync</h3>
<p>Sync all fixtures for the selected team.</p>
<button onclick="syncFixtures()">Sync Fixtures</button>
<div class="status" id="status-fixtures"></div>
<div class="results" id="results-fixtures"></div>
</div>

<div class="card blue-accent">
<h3>👥 Weekly Player Sync</h3>
<p>Get this week's team sheet and store players.</p>
<button class="secondary" onclick="syncGame()">Sync Players</button>
<button onclick="syncAllUpcoming()" style="margin-top:8px;">Sync All Upcoming Team Sheets</button>
<div class="status" id="status-game"></div>
<div class="status" id="status-all-sync"></div>
</div>
</div>

<div class="card blue-accent" id="game-results-card" style="display:none;">
<h3>Current Team Sheet</h3>
<div class="results show" id="results-game"></div>
</div>

<div class="card duties-card">
<h3>📋 Game Day Duties</h3>
<p>Pick a round, then whether it is a home or away game. Names come from the coaches board saved for that round, so a duty shows "coach not named team" until that coach has saved the team. Nothing is saved until you press Save duties.</p>
<p class="duty-legend">Name colours: <span class="duty-key dup-2">green</span> 2nd duty this season, <span class="duty-key dup-3">yellow</span> 3rd, <span class="duty-key dup-4">red</span> 4th or more.</p>
<div class="duty-tabs" id="dutyTabs"></div>
<div class="duty-venue-row"><label for="dutyVenue">Round type</label><select id="dutyVenue"><option value="">Choose home or away</option><option value="home">Home game</option><option value="away">Away game</option></select></div>
<div class="duty-title" id="dutyTitle">CLFC GAME DAY DUTIES</div>
<div class="duty-grid" id="dutyGrid"></div>
<div class="duty-actions"><span class="duty-note" id="dutyNote"></span><span class="duty-hint" id="dutyVenueHint"></span><button type="button" id="dutyRandomBtn">🎲 Randomise</button><button type="button" id="dutySaveBtn" disabled>💾 Save duties</button></div>
<div class="status" id="status-duties"></div>
</div>

<div class="card">
<h3>🔑 Member PIN Lookup</h3>
<p>Select a member to reveal their PIN so you can forward it on.</p>
<select id="memberSelect"><option value="">Loading members...</option></select>
<button onclick="revealPin()">Reveal PIN</button>
<div class="status" id="status-pin"></div>
<div class="results" id="results-pin"></div>
</div>
</div>

<script>
// ---------- Passcode handling ----------
const KEY = 'clfcAdminPass';
let PASS = '';
try { PASS = sessionStorage.getItem(KEY) || ''; } catch (e) {}

const rawFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
opts.headers = Object.assign({}, opts.headers || {}, { 'x-admin-passcode': PASS });
const res = await rawFetch(url, opts);
if (res.status === 401 && !String(url).includes('/api/auth')) lock('Session expired — enter the passcode again.');
return res;
};

function lock(msg) {
PASS = '';
try { sessionStorage.removeItem(KEY); } catch (e) {}
document.getElementById('app').style.display = 'none';
document.getElementById('login').style.display = 'flex';
if (msg) showStatus('login', msg, 'error');
document.getElementById('passInput').value = '';
document.getElementById('passInput').focus();
}

async function tryUnlock(pass) {
PASS = pass;
const res = await fetch('/api/auth', { method: 'POST' });
if (!res.ok) {
lock(res.status === 401 ? 'Incorrect passcode.' : 'Admin passcode is not set up on the server.');
return false;
}
try { sessionStorage.setItem(KEY, PASS); } catch (e) {}
document.getElementById('login').style.display = 'none';
document.getElementById('app').style.display = 'block';
loadTeams();
loadMembers();
loadSeasons();
loadDutyRound('');
loadDutyTally();
return true;
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
e.preventDefault();
tryUnlock(document.getElementById('passInput').value.trim());
});
document.getElementById('logoutBtn').addEventListener('click', () => lock(''));

// ---------- Dashboard ----------
let teams = [];
let members = [];

async function loadTeams() {
const res = await fetch('/api/teams');
const data = await res.json();
teams = data.teams || [];
document.getElementById('teamSelect').innerHTML = teams.map(t =>
\`<option value="\${t.id}" data-uuid="\${t.playhq_team_id}">\${t.season_year ? t.season_year + ' — ' : ''}\${t.team_name}</option>\`
).join('');
}

async function loadMembers() {
const res = await fetch('/api/members');
const data = await res.json();
members = data.members || [];
document.getElementById('memberSelect').innerHTML = members.map(m =>
\`<option value="\${m.id}">\${m.last_name}, \${m.first_name}\${m.role ? ' (' + m.role + ')' : ''}</option>\`
).join('');
}

// ---------- Game day duties grid ----------
var DUTY_SEASON = 2027;
var DUTY_GRADES = [
  { key: 'colts', label: 'COLTS', colour: '#f5e04a' },
  { key: 'reserves', label: 'RESERVES', colour: '#f2a58f' },
  { key: 'league', label: 'LEAGUE', colour: '#9ed7a5' },
  { key: 'thirds', label: 'THIRDS', colour: '#d9a7e6' }
];
var DUTY_ROUND_COUNT = 25;
var MSG_NOT_NAMED_CLIENT = 'coach not named team';
var dutyRound = '';
var dutyData = null;
var dutyDirty = false;
var dutyCounts = {};

function dutyEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dutyLabelFor(list, key) {
  const hit = list.filter(function (x) { return x.key === key; })[0];
  return hit ? hit.label : key;
}

function dutyTaskFor(gradeKey, taskKey) {
  const grade = dutyData && dutyData.grades && dutyData.grades[gradeKey];
  if (!grade) return null;
  return grade.tasks.filter(function (t) { return t.key === taskKey; })[0] || null;
}

function setDutyDirty(flag) {
  dutyDirty = flag;
  document.getElementById('dutySaveBtn').disabled = !flag;
  document.getElementById('dutyNote').textContent = flag ? 'Unsaved changes' : '';
}

// Loads one round. venueOverride shows the grid as home or away without saving. markDirty flags it as unsaved.
async function loadDutyRound(round, venueOverride, markDirty) {
  if (dutyDirty && !window.confirm('Discard the unsaved changes for Round ' + dutyRound + '?')) {
    document.getElementById('dutyVenue').value = (dutyData && dutyData.venue) || '';
    return;
  }
  let query = '?season=' + DUTY_SEASON;
  if (round) query += '&round=' + encodeURIComponent(round);
  if (venueOverride) query += '&venue=' + encodeURIComponent(venueOverride);
  const res = await fetch('/api/game-day-duties' + query);
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) return showStatus('duties', data.error || 'Could not load game day duties', 'error');
  dutyData = data;
  dutyRound = data.round || '';
  setDutyDirty(!!markDirty);
  hideStatus('duties');
  document.getElementById('dutyVenue').value = data.venue || '';
  renderDutyTabs();
  renderDutyGrid();
}

function renderDutyTabs() {
  const saved = (dutyData.rounds || []).map(String);
  let html = '';
  for (let i = 1; i <= DUTY_ROUND_COUNT; i++) {
    const r = String(i);
    const cls = 'duty-tab' + (r === dutyRound ? ' active' : '');
    const title = saved.indexOf(r) >= 0 ? 'Has duties saved' : 'No duties yet';
    html += '<button type="button" class="' + cls + '" data-round="' + r + '" title="' + title + '">Rd ' + i + '</button>';
  }
  document.getElementById('dutyTabs').innerHTML = html;
}

function renderDutyGrid() {
  const venueSet = !!dutyData.venue;
  const venueWord = dutyData.venue === 'home' ? ' (Home)' : dutyData.venue === 'away' ? ' (Away)' : '';
  document.getElementById('dutyTitle').textContent = 'CLFC GAME DAY DUTIES' + (dutyRound ? ' - Round ' + dutyRound : '') + venueWord;
  document.getElementById('dutyVenueHint').textContent = dutyData.venue_source ? 'Round type ' + dutyData.venue_source : '';
  let html = '';
  DUTY_GRADES.forEach(function (g) {
    const grade = dutyData.grades[g.key];
    html += '<div class="duty-block">';
    html += '<div class="duty-block-head" style="background:' + g.colour + '">' + g.label + '</div>';
    html += '<div class="duty-table">';
    html += '<div class="duty-row duty-head"><div class="duty-task">Task</div><div class="duty-cells"><div class="duty-cell">Player</div></div></div>';
    grade.tasks.forEach(function (task) {
      const caption = !venueSet ? '' : task.required ? 'from ' + task.source_label + ' board' : 'not needed for away';
      html += '<div class="duty-row"><div class="duty-task">' + dutyEsc(task.label) +
        (caption ? '<span class="duty-src">' + dutyEsc(caption) + '</span>' : '') + '</div>';
      html += '<div class="duty-cells" style="grid-template-columns:repeat(' + task.slots.length + ',1fr)">';
      const enabled = venueSet && task.required;
      const placeholder = !venueSet ? 'Pick home or away' : task.required ? 'Type a name' : 'Not needed';
      for (let i = 0; i < task.slots.length; i++) {
        const s = task.slots[i];
        html += '<div class="duty-cell">';
        html += '<input type="text" class="duty-input" autocomplete="off" placeholder="' + placeholder + '"' + (enabled ? '' : ' disabled');
        html += ' data-grade="' + g.key + '" data-task="' + task.key + '" data-slot="' + i + '"';
        html += ' data-member-id="' + (s && enabled ? dutyEsc(s.member_id) : '') + '" value="' + dutyEsc(s && enabled ? s.name : '') + '">';
        html += '<div class="duty-suggest" hidden></div></div>';
      }
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  document.getElementById('dutyGrid').innerHTML = html;
  applyDutyHighlights();
}

// Typeahead: only the players on the board that supplies this duty. No board saved shows the message.
function showDutySuggestions(input) {
  const box = input.parentNode.querySelector('.duty-suggest');
  const task = dutyTaskFor(input.getAttribute('data-grade'), input.getAttribute('data-task'));
  const typed = input.value.trim().toLowerCase();
  if (!typed) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  if (!task || task.options.length === 0) {
    box.innerHTML = '<div class="duty-none">' + dutyEsc((task && task.message) || MSG_NOT_NAMED_CLIENT) + '</div>';
    box.hidden = false;
    return;
  }
  const parts = typed.split(' ').filter(Boolean);
  const hits = task.options.filter(function (o) {
    return parts.every(function (p) { return o.name.toLowerCase().indexOf(p) >= 0; });
  }).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map(function (o) {
        return '<button type="button" class="duty-option" data-id="' + o.member_id + '">' + dutyEsc(o.name) + '</button>';
      }).join('')
    : '<div class="duty-none">No match on the ' + dutyEsc(task.source_label) + ' board</div>';
  box.hidden = false;
}

// Picking a name only fills the slot. It is saved when the admin presses Save duties.
function pickDutyOption(btn) {
  const cell = btn.closest('.duty-cell');
  const input = cell.querySelector('.duty-input');
  const task = dutyTaskFor(input.getAttribute('data-grade'), input.getAttribute('data-task'));
  const id = String(btn.getAttribute('data-id'));
  const opt = task ? task.options.filter(function (o) { return String(o.member_id) === id; })[0] : null;
  if (!opt) return;
  input.value = opt.name;
  input.setAttribute('data-member-id', String(opt.member_id));
  cell.querySelector('.duty-suggest').hidden = true;
  setDutyDirty(true);
  applyDutyHighlights();
}

async function saveDutyRound() {
  if (!dutyRound) return showStatus('duties', 'Pick a round first', 'error');
  if (!dutyData.venue) return showStatus('duties', 'Choose home or away for this round first', 'error');
  const grades = {};
  for (let g = 0; g < DUTY_GRADES.length; g++) {
    const gradeKey = DUTY_GRADES[g].key;
    const tasks = {};
    const inputs = document.querySelectorAll('.duty-input[data-grade="' + gradeKey + '"]');
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (inp.disabled) continue;
      const text = inp.value.trim();
      if (!text) continue;
      const memberId = inp.getAttribute('data-member-id');
      if (!memberId) {
        return showStatus('duties', 'Pick "' + text + '" from the list, or clear the box, before saving', 'error');
      }
      const taskKey = inp.getAttribute('data-task');
      if (!tasks[taskKey]) tasks[taskKey] = [];
      tasks[taskKey][Number(inp.getAttribute('data-slot'))] = { member_id: Number(memberId) };
    }
    grades[gradeKey] = { tasks: tasks };
  }
  const btn = document.getElementById('dutySaveBtn');
  btn.disabled = true;
  showStatus('duties', 'Saving Round ' + dutyRound + '...', 'success');
  const res = await fetch('/api/game-day-duties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ season: DUTY_SEASON, round: dutyRound, venue: dutyData.venue, grades: grades })
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    btn.disabled = false;
    return showStatus('duties', data.error || 'Could not save', 'error');
  }
  if (dutyData.rounds.indexOf(dutyRound) < 0) dutyData.rounds.push(dutyRound);
  setDutyDirty(false);
  showStatus('duties', 'Saved Round ' + dutyRound + ' (' + (data.venue === 'home' ? 'home' : 'away') + ', ' + data.assigned + ' allocations)', 'success');
  await loadDutyRound(dutyRound);
  loadDutyTally();
}

async function loadDutyTally() {
  const res = await fetch('/api/game-day-tally?season=' + DUTY_SEASON);
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) return;
  dutyCounts = {};
  data.members.forEach(function (m) {
    dutyCounts[String(m.member_id)] = { total: m.total, by_task: m.by_task || {} };
  });
  applyDutyHighlights();
}

// Colours each name by how many duties that person has this season, counting this round's
// picks in the order they appear in the grid. 2nd = green, 3rd = yellow, 4th or more = red.
function applyDutyHighlights() {
  var inputs = document.querySelectorAll('.duty-input');
  var savedThisRound = {};
  if (dutyData && dutyData.grades) {
    DUTY_GRADES.forEach(function (g) {
      dutyData.grades[g.key].tasks.forEach(function (t) {
        t.slots.forEach(function (c) {
          if (c) savedThisRound[String(c.member_id)] = (savedThisRound[String(c.member_id)] || 0) + 1;
        });
      });
    });
  }
  var running = {};
  for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    inp.classList.remove('dup-2', 'dup-3', 'dup-4');
    inp.removeAttribute('title');
    if (inp.disabled) continue;
    var key = inp.getAttribute('data-member-id');
    if (!key) continue;
    var season = dutyCounts[key] ? dutyCounts[key].total : 0;
    var base = season - (savedThisRound[key] || 0);
    running[key] = (running[key] || 0) + 1;
    var n = base + running[key];
    if (n >= 4) inp.classList.add('dup-4');
    else if (n === 3) inp.classList.add('dup-3');
    else if (n === 2) inp.classList.add('dup-2');
    if (n >= 2) inp.setAttribute('title', 'Duty ' + n + ' this season');
  }
}

function dutyShuffle(list) {
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Fills every required slot from the boards that supply it, without repeating a person within a grade.
// People with the fewest duties so far this season are picked first (ties broken at random).
// A round that is already saved does not count its own picks against people.
// Fills the grid only; nothing is saved until Save duties is pressed.
function randomiseDuties() {
  if (!dutyRound) return showStatus('duties', 'Pick a round first', 'error');
  if (!dutyData || !dutyData.venue) return showStatus('duties', 'Choose home or away for this round first', 'error');

  var base = {};
  function baseOf(id) {
    var key = String(id);
    if (!base[key]) base[key] = { total: 0, by_task: {} };
    return base[key];
  }
  Object.keys(dutyCounts).forEach(function (key) {
    base[key] = { total: dutyCounts[key].total, by_task: Object.assign({}, dutyCounts[key].by_task) };
  });
  DUTY_GRADES.forEach(function (g) {
    dutyData.grades[g.key].tasks.forEach(function (t) {
      t.slots.forEach(function (card) {
        if (!card) return;
        var c = baseOf(card.member_id);
        c.total -= 1;
        c.by_task[t.key] = (c.by_task[t.key] || 0) - 1;
      });
    });
  });

  var short = [];
  // One map for the whole round: nobody gets two duties on the same day, across all grades.
  var used = {};
  var open = [];
  DUTY_GRADES.forEach(function (g) {
    var grade = dutyData.grades[g.key];
    grade.tasks.filter(function (t) { return t.required && t.options.length; }).forEach(function (task) {
      for (var i = 0; i < task.slots.length; i++) {
        var input = document.querySelector('.duty-input[data-grade="' + g.key + '"][data-task="' + task.key + '"][data-slot="' + i + '"]');
        if (!input) continue;
        open.push({ g: g, task: task, slot: i, input: input, options: dutyShuffle(task.options) });
      }
    });
  });
  function totalOf(memberId) { return baseOf(memberId).total; }
  // Largest set of people (at most one duty each) that can fill open duties, each matched to a duty they can do.
  function matchPeople(people) {
    var slotMatch = open.map(function () { return null; });
    function augment(p, seen) {
      for (var si = 0; si < open.length; si++) {
        if (seen[si] || !open[si].options.some(function (o) { return o.member_id === p.member_id; })) continue;
        seen[si] = true;
        if (!slotMatch[si] || augment(slotMatch[si], seen)) { slotMatch[si] = p; return true; }
      }
      return false;
    }
    people.forEach(function (p) { augment(p, []); });
    var out = [];
    open.forEach(function (s, si) { if (slotMatch[si]) out.push({ slot: s, pick: slotMatch[si] }); });
    return out;
  }
  // Everyone gets one duty before anyone gets a second: work up from zero duties, giving each
  // level as many duties as it can take before moving to the next. Duties are the same whatever the job.
  var level = 0;
  while (open.length) {
    var eligible = {};
    open.forEach(function (s) {
      s.options.forEach(function (c) {
        if (!used[c.member_id] && totalOf(c.member_id) === level) eligible[c.member_id] = c;
      });
    });
    var matched = Object.keys(eligible).length ? matchPeople(dutyShuffle(Object.keys(eligible).map(function (k) { return eligible[k]; }))) : [];
    if (!matched.length) {
      var more = open.some(function (s) {
        return s.options.some(function (c) { return !used[c.member_id] && totalOf(c.member_id) > level; });
      });
      if (!more) break;
      level++;
      continue;
    }
    matched.forEach(function (m) {
      var pick = m.pick, s = m.slot;
      used[pick.member_id] = true;
      var c = baseOf(pick.member_id);
      c.total += 1;
      c.by_task[s.task.key] = (c.by_task[s.task.key] || 0) + 1;
      s.input.value = pick.name;
      s.input.setAttribute('data-member-id', String(pick.member_id));
      s.input.parentNode.querySelector('.duty-suggest').hidden = true;
    });
    open = open.filter(function (s) { return !matched.some(function (m) { return m.slot === s; }); });
  }
  open.forEach(function (s) {
    short.push(s.g.label + ' ' + s.task.label + ' ' + (s.slot + 1));
    s.input.value = '';
    s.input.setAttribute('data-member-id', '');
    s.input.parentNode.querySelector('.duty-suggest').hidden = true;
  });
  setDutyDirty(true);
  applyDutyHighlights();
  if (short.length) showStatus('duties', 'Not enough players on the boards for: ' + short.join(', '), 'error');
  else showStatus('duties', 'Randomised Round ' + dutyRound + ' (fewest duties first). Review, then press Save duties.', 'success');
}

document.getElementById('dutyRandomBtn').addEventListener('click', randomiseDuties);
document.getElementById('dutyTabs').addEventListener('click', function (e) {
  const r = e.target.getAttribute('data-round');
  if (r) loadDutyRound(r, null, false);
});
document.getElementById('dutyVenue').addEventListener('change', function (e) {
  const v = e.target.value;
  if (!dutyRound) {
    e.target.value = '';
    return showStatus('duties', 'Pick a round first', 'error');
  }
  if (!v) return;
  loadDutyRound(dutyRound, v, true);
});
document.getElementById('dutyGrid').addEventListener('input', function (e) {
  const t = e.target;
  if (!t.classList.contains('duty-input')) return;
  t.setAttribute('data-member-id', '');
  setDutyDirty(true);
  applyDutyHighlights();
  showDutySuggestions(t);
});
document.getElementById('dutyGrid').addEventListener('click', function (e) {
  const opt = e.target.closest ? e.target.closest('.duty-option') : null;
  if (opt) pickDutyOption(opt);
});
document.getElementById('dutySaveBtn').addEventListener('click', saveDutyRound);

function getSelected() {
const sel = document.getElementById('teamSelect');
const opt = sel.options[sel.selectedIndex];
return { id: sel.value, uuid: opt?.dataset?.uuid, name: opt?.text };
}

function showStatus(id, msg, type) {
const el = document.getElementById('status-' + id);
el.innerHTML = msg;
el.className = 'status show ' + type;
}

function hideStatus(id) {
document.getElementById('status-' + id).className = 'status';
}

function showResults(id, html) {
const el = document.getElementById('results-' + id);
el.innerHTML = html;
el.classList.add('show');
}

function hideResults(id) {
document.getElementById('results-' + id).classList.remove('show');
}

async function syncFixtures() {
const { id } = getSelected();
if (!id) return alert('Select a team first');
showStatus('fixtures', 'Syncing...', 'success');
try {
const res = await fetch('/api/sync-fixtures', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ teamId: id })
});
const data = await res.json();
if (!res.ok) throw new Error(data.error);
showStatus('fixtures', '✅ ' + data.message, 'success');
showResults('fixtures', '<pre>' + JSON.stringify(data, null, 2) + '</pre>');
} catch (e) {
showStatus('fixtures', '❌ ' + e.message, 'error');
}
}

async function syncGame() {
const { id } = getSelected();
if (!id) return alert('Select a team first');
showStatus('game', 'Fetching team sheet...', 'success');
try {
const res = await fetch('/api/sync-game', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ teamId: id })
});
const data = await res.json();
if (!res.ok) throw new Error(data.error);
const playersHTML = \`
<p><strong>\${data.round}</strong> — \${data.date} vs \${data.opponent} (\${data.status})</p>
<p>\${data.playerCount} players</p>
<ul class="player-list">
\${data.players.sort((a,b) => a.number - b.number).map(p => \`
<li>
<span>#\${p.number} \${p.name}</span>
<span>
\${p.captain ? '<span class="badge captain">C</span>' : ''}
\${p.isFillIn ? '<span class="badge fillin">Fill-in</span>' : ''}
\${p.isEmergency ? '<span class="badge">EMG</span>' : ''}
</span>
</li>\`).join('')}
</ul>\`;
showStatus('game', '✅ Team sheet synced!', 'success');
document.getElementById('game-results-card').style.display = 'block';
showResults('game', playersHTML);
} catch (e) {
showStatus('game', '❌ ' + e.message, 'error');
}
}

async function syncAllUpcoming() {
showStatus('all-sync', 'Checking every team in the current season...', 'success');
try {
const res = await fetch('/api/sync-all-upcoming', { method: 'POST' });
const data = await res.json();
if (!res.ok) throw new Error(data.error);
const errors = data.errors?.length ? ' Errors: ' + data.errors.map(e => e.team + ': ' + e.error).join('; ') : '';
showStatus('all-sync', '✅ Checked ' + data.teams + ' teams and ' + data.gamesChecked + ' upcoming games; updated ' + data.updated + ', unchanged ' + data.unchanged + ', no team sheet ' + data.noTeamSheet + '. Current rounds set: ' + (data.currentRounds ?? 0) + '.' + errors, data.errors?.length ? 'error' : 'success');
} catch (e) {
showStatus('all-sync', '❌ ' + e.message, 'error');
}
}

async function revealPin() {
const id = document.getElementById('memberSelect').value;
if (!id) return alert('Select a member first');
showStatus('pin', 'Looking up...', 'success');
try {
const res = await fetch('/api/members/' + id + '/pin');
const data = await res.json();
if (!res.ok) throw new Error(data.error);
showStatus('pin', '✅ PIN found', 'success');
showResults('pin', \`
<div class="pin-reveal">
<div class="name">\${data.first_name} \${data.last_name}</div>
<div class="pin">\${data.pin}</div>
</div>\`);
} catch (e) {
showStatus('pin', '❌ ' + e.message, 'error');
}
}

// ---------- Season / Team / Round browser ----------
async function loadSeasons(keepYear) {
const res = await fetch('/api/seasons');
const data = await res.json();
const sel = document.getElementById('seasonSelect');
sel.innerHTML = '<option value="">Select season...</option>' + (data.seasons || []).map(s =>
\`<option value="\${s.season_year}">\${s.season_year}</option>\`
).join('');
if (keepYear) sel.value = keepYear;
}

document.getElementById('syncSeasonsBtn').addEventListener('click', async (e) => {
const btn = e.currentTarget;
btn.disabled = true;
showStatus('seasons', 'Pulling every season and Cockburn Lakes team from PlayHQ...', 'success');
try {
const res = await fetch('/api/sync-seasons', { method: 'POST' });
const data = await res.json();
if (!res.ok) throw new Error(data.error);
const list = data.seasons.map(s => '<strong>' + s.year + '</strong>: ' + (s.teams.join(', ') || 'no teams')).join('<br>');
const errs = data.errors?.length ? '<br>Errors: ' + data.errors.map(x => x.year + ': ' + x.error).join('; ') : '';
showStatus('seasons', '✅ ' + data.seasons.length + ' seasons, ' + data.teamsTotal + ' teams (' + data.teamsAdded + ' new).<br>' + list + errs, data.errors?.length ? 'error' : 'success');
await loadSeasons(document.getElementById('seasonSelect').value);
await loadTeams();
} catch (err) {
showStatus('seasons', '❌ ' + err.message, 'error');
} finally {
btn.disabled = false;
}
});

function resetBelowSeason() {
document.getElementById('gamesContainer').innerHTML = '';
hideStatus('browse');
hideResults('browse');
}

document.getElementById('seasonSelect').addEventListener('change', async (e) => {
const year = e.target.value;
const teamSel = document.getElementById('browseTeamSelect');
const roundSel = document.getElementById('roundSelect');
resetBelowSeason();
document.getElementById('refreshFixturesBtn').disabled = true;
roundSel.innerHTML = '<option value="">Select a team first</option>';
roundSel.disabled = true;
if (!year) {
teamSel.innerHTML = '<option value="">Select a season first</option>';
teamSel.disabled = true;
return;
}
teamSel.innerHTML = '<option value="">Loading teams...</option>';
teamSel.disabled = true;
const res = await fetch(\`/api/seasons/\${year}/teams\`);
const data = await res.json();
teamSel.innerHTML = '<option value="">Select team...</option>' + (data.teams || []).map(t =>
\`<option value="\${t.id}">\${t.grade_name ? t.grade_name + ' — ' : ''}\${t.team_name}</option>\`
).join('');
teamSel.disabled = false;
});

async function syncTeamFixtures(teamId) {
const res = await fetch('/api/sync-fixtures', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ teamId })
});
const data = await res.json();
if (!res.ok) throw new Error(data.error);
return data;
}

async function loadRounds(teamId) {
const roundSel = document.getElementById('roundSelect');
roundSel.innerHTML = '<option value="">Loading rounds...</option>';
roundSel.disabled = true;
const res = await fetch(\`/api/teams/\${teamId}/rounds\`);
const data = await res.json();
const rounds = data.rounds || [];
roundSel.innerHTML = '<option value="">Select round...</option>' + rounds.map(r =>
\`<option value="\${r.round_id}">\${r.round_name}\${r.is_final_round ? ' (Final)' : ''}</option>\`
).join('');
roundSel.disabled = false;
return rounds;
}

document.getElementById('browseTeamSelect').addEventListener('change', async (e) => {
const teamId = e.target.value;
const roundSel = document.getElementById('roundSelect');
const refreshBtn = document.getElementById('refreshFixturesBtn');
resetBelowSeason();
refreshBtn.disabled = !teamId;
if (!teamId) {
roundSel.innerHTML = '<option value="">Select a team first</option>';
roundSel.disabled = true;
return;
}
let rounds = await loadRounds(teamId);
if (!rounds.length) {
showStatus('browse', 'No fixtures stored for this team yet — syncing from PlayHQ...', 'success');
try {
const data = await syncTeamFixtures(teamId);
rounds = await loadRounds(teamId);
showStatus('browse', '✅ ' + data.message, 'success');
} catch (err) {
showStatus('browse', '❌ ' + err.message, 'error');
}
}
});

document.getElementById('refreshFixturesBtn').addEventListener('click', async (e) => {
const teamId = document.getElementById('browseTeamSelect').value;
if (!teamId) return;
const btn = e.currentTarget;
btn.disabled = true;
resetBelowSeason();
showStatus('browse', 'Re-syncing fixtures from PlayHQ...', 'success');
try {
const data = await syncTeamFixtures(teamId);
await loadRounds(teamId);
showStatus('browse', '✅ ' + data.message, 'success');
} catch (err) {
showStatus('browse', '❌ ' + err.message, 'error');
} finally {
btn.disabled = false;
}
});

document.getElementById('roundSelect').addEventListener('change', async (e) => {
const roundId = e.target.value;
const teamId = document.getElementById('browseTeamSelect').value;
const container = document.getElementById('gamesContainer');
resetBelowSeason();
if (!roundId || !teamId) return;
const res = await fetch(\`/api/teams/\${teamId}/rounds/\${roundId}\`);
const data = await res.json();
const games = data.games || [];
container.innerHTML = games.map(g => \`
<div class="game-pick">
<span>
\${g.our_team_name} vs \${g.opponent_name || 'TBC'} (\${g.status || 'SCHEDULED'})<br>
<span class="kickoff">\${g.game_date || 'TBC'} \${g.game_time || ''} \${g.timezone || ''}</span>
</span>
<button onclick="openGame('\${g.playhq_game_id}')">RE-SYNC</button>
</div>\`).join('') || '<p style="font-size:12px;color:#777;">No games found for this round (bye?).</p>';
// Selecting a round syncs it straight away.
if (games.length) openGame(games[0].playhq_game_id);
});

function playerRows(list) {
return list.map(p => \`
<li>
<span>\${p.number ? '#' + p.number + ' ' : ''}\${p.name}</span>
<span>
\${p.captain ? '<span class="badge captain">C</span>' : ''}
\${p.isFillIn ? '<span class="badge fillin">Fill-in</span>' : ''}
\${p.isEmergency ? '<span class="badge">EMG</span>' : ''}
</span>
</li>\`).join('');
}

async function openGame(playhqGameId) {
showStatus('browse', 'Syncing game from PlayHQ...', 'success');
try {
const res = await fetch(\`/api/game/\${playhqGameId}\`);
const data = await res.json();
if (!res.ok) throw new Error(data.error);
const saved = data.savedPlayers ? ' — saved ' + data.savedPlayers + ' to team sheet' : ' — no team sheet on PlayHQ';
showStatus('browse', \`✅ \${data.homeTeam} vs \${data.awayTeam} — \${data.status}\${saved}\`, 'success');
const players = data.players.filter(p => p.roleType === 'Player')
.sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
const ours = players.filter(p => p.isOurTeam);
const theirs = players.filter(p => !p.isOurTeam);
showResults('browse', \`
<p><strong>\${data.season} \${data.roundName}</strong> — \${data.gameDate} — \${data.grade || ''}</p>
<p>\${data.venue || ''}</p>
<p class="kickoff">Kickoff (UTC): \${data.kickoffUtc || 'TBC'}</p>
<h4>\${data.homeTeam} (\${ours.length})</h4>
<ul class="player-list">\${playerRows(ours)}</ul>
\${theirs.length ? \`<h4>\${data.awayTeam || 'Opposition'} (\${theirs.length})</h4><ul class="player-list">\${playerRows(theirs)}</ul>\` : ''}\`);
} catch (e) {
showStatus('browse', '❌ ' + e.message, 'error');
}
}

// Auto-unlock if this tab already entered the passcode
if (PASS) tryUnlock(PASS);
<\/script>
</body>
</html>`;
}

export default {
async scheduled(event, env, ctx) {
// Saturday 8am Perth (00:00 UTC Sat) and Friday 10pm Perth (14:00 UTC Fri)
if (event.cron === "0 0 * * 6" || event.cron === "0 14 * * 5") {
ctx.waitUntil(syncAllUpcomingTeamSheets(env.DB, env.PLAYHQ_API_KEY));
}
},

async fetch(request, env) {
const url = new URL(request.url);
const path = url.pathname;

// The login page itself is public; it contains no data.
if (path === "/") {
return new Response(getDashboard(), {
headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
});
}

// Everything under /api needs the passcode.
if (path.startsWith("/api/")) {
if (!env.ADMIN_PASSCODE) return json({ error: "ADMIN_PASSCODE secret is not set" }, 503);
if (!(await passcodeOk(request, env))) {
await new Promise((r) => setTimeout(r, 800)); // slow down guessing
return json({ error: "Unauthorised" }, 401);
}
}

if (path === "/api/auth" && request.method === "POST") {
return json({ ok: true });
}

if (path === "/api/teams" && request.method === "GET") {
return json({ teams: await getTeams(env.DB) });
}

if (path === "/api/members" && request.method === "GET") {
try {
return json({ members: await getMembers(env.DB) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

let m;
if ((m = path.match(/^\/api\/members\/(\d+)\/pin$/)) && request.method === "GET") {
try {
const member = await getMemberPin(env.DB, m[1]);
if (!member) throw new Error("Member not found");
return json(member);
} catch (e) {
return json({ error: e.message }, 400);
}
}

if (path === "/api/sync-seasons" && request.method === "POST") {
try {
return json({ success: true, ...(await syncAllSeasons(env.DB, env.PLAYHQ_API_KEY, env.PLAYHQ_ORG_ID || DEFAULT_ORG_ID)) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if (path === "/api/seasons" && request.method === "GET") {
try {
return json({ seasons: await getSeasons(env.DB) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/seasons\/([^/]+)\/teams$/)) && request.method === "GET") {
try {
return json({ teams: await getTeamsForSeason(env.DB, m[1]) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/teams\/(\d+)\/upcoming$/)) && request.method === "GET") {
try {
const limit = Number(url.searchParams.get("limit")) || 5;
return json({ games: await getUpcomingGames(env.DB, m[1], limit) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/teams\/(\d+)\/rounds\/([^/]+)$/)) && request.method === "GET") {
try {
return json({ games: await getRoundGames(env.DB, m[1], m[2]) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/teams\/(\d+)\/rounds$/)) && request.method === "GET") {
try {
return json({ rounds: await getRoundsForTeam(env.DB, m[1]) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/game\/([^/]+)\/players$/)) && request.method === "GET") {
try {
return json({ gameId: m[1], players: await getGamePlayersOnly(env.DB, m[1]) });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if ((m = path.match(/^\/api\/game\/([^/]+)$/)) && request.method === "GET") {
try {
return json(await getGameDetail(env.DB, env.PLAYHQ_API_KEY, m[1]));
} catch (e) {
return json({ error: e.message }, 400);
}
}

if (path === "/api/sync-fixtures" && request.method === "POST") {
try {
const { teamId } = await request.json();
const team = await env.DB.prepare(`SELECT * FROM teams WHERE id = ?`).bind(teamId).first();
if (!team) throw new Error("Team not found");
const count = await syncFixtures(env.DB, env.PLAYHQ_API_KEY, team.playhq_team_id, team.id, team.season_id);
return json({ success: true, message: `Synced ${count} fixtures for ${team.team_name}` });
} catch (e) {
return json({ error: e.message }, 400);
}
}

if (path === "/api/sync-all-upcoming" && request.method === "POST") {
try {
const result = await syncAllUpcomingTeamSheets(env.DB, env.PLAYHQ_API_KEY);
return json({ success: true, ...result });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if (path === "/api/sync-game" && request.method === "POST") {
try {
const { teamId } = await request.json();
const team = await env.DB.prepare(`SELECT * FROM teams WHERE id = ?`).bind(teamId).first();
if (!team) throw new Error("Team not found");
return json(await syncGamePlayers(env.DB, env.PLAYHQ_API_KEY, team.playhq_team_id, team.id));
} catch (e) {
return json({ error: e.message }, 400);
}
}

if (path === "/api/link-players" && request.method === "POST") {
try {
await linkMembersToPlayhq(env.DB);
const { results } = await env.DB.prepare(`
SELECT first_name, last_name, playhq_player_id
FROM member_directory
WHERE playhq_player_id IS NOT NULL
ORDER BY last_name
`).all();
return json({ success: true, linked: results.length, members: results });
} catch (e) {
return json({ error: e.message }, 500);
}
}

if (path === "/api/game-day-duties" && request.method === "GET") {
try {
const venue = url.searchParams.get("venue");
return json(
  await getGameDayDuties(
    needFlexi(env),
    url.searchParams.get("round"),
    seasonOf(url.searchParams.get("season")),
    venue === "home" || venue === "away" ? venue : null
  )
);
} catch (e) {
return json({ error: e.message }, e.status || 500);
}
}

if (path === "/api/game-day-duties" && request.method === "POST") {
try {
return json(await saveGameDayRound(needFlexi(env), await request.json()));
} catch (e) {
return json({ error: e.message }, e.status || 500);
}
}

if (path === "/api/game-day-tally" && request.method === "GET") {
try {
return json(await getGameDayTally(needFlexi(env), seasonOf(url.searchParams.get("season"))));
} catch (e) {
return json({ error: e.message }, e.status || 500);
}
}

return json({ error: "Not found" }, 404);
}
};

