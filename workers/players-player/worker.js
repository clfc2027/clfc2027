// players-player Worker (v6)
import { passcodeState } from "../../shared/auth.js";
// D1 binding DB      -> playhq-warriors (d0e2a120-9971-4341-9960-9a6fa2d636be)
// R2 binding ASSETS  -> bucket clfc-assets (logos only, two keys)
// Secret ADMIN_PASSCODE
// Routes: GET /, GET /assets/<key>, POST /login, /vote, /admin/teams, /admin/not-voted, /admin/tally
// current_round and team_sheet_players are written by the playhq-admin weekly cron. This Worker never calls PlayHQ.

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const CLUB_NAME = 'Cockburn Lakes';
const MULTI_SHEET_MSG = 'You are listed on more than one team sheet this round, so we cannot tell which team you played for. Please contact the club admin.';

const ASSET_KEYS = [
  'club-logo/clfc-player-player-logo.png',
  'club-logo/clfc-footer.png',
];

function notPlayed(member) {
  return "You didn't play this week " + member.first_name + " " + member.last_name + ". See you on the track Tuesday!";
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };
const ok = (data) => new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
const fail = (error, status = 400) => new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS });

function perthDate(date = new Date()) {
  return new Date(date.getTime() + PERTH_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Voting round: round_key (the game Saturday) through the following Wednesday, Perth time.
function windowFor(roundKey) {
  const today = perthDate();
  const closes = addDays(roundKey, 4);
  const open = today >= roundKey && today <= closes;
  return {
    open,
    text: open ? 'Voting closes Wednesday ' + closes + ', 11:59pm (Perth time).' : 'Voting is closed for this round.',
  };
}


const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

function validPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

function checkAdmin(env, body) {
  return passcodeState(body.adminPin, env); // shared/auth.js
}

async function activeSeasonId(db) {
  const r = await db.prepare(
    "SELECT id FROM seasons WHERE status = 'active' ORDER BY season_year DESC LIMIT 1"
  ).first();
  return r ? r.id : null;
}

// This week's game for each Cockburn Lakes team in the active season. Other clubs are never read.
async function cockburnRounds(db) {
  const seasonId = await activeSeasonId(db);
  if (!seasonId) return { seasonId: null, rounds: [] };
  const { results } = await db.prepare(`
    SELECT cr.season_id, cr.team_id, cr.playhq_game_id AS game_id, cr.round_date AS round_key,
           t.team_name, t.grade_name
    FROM current_round cr
    JOIN teams t ON t.id = cr.team_id
    WHERE cr.season_id = ? AND t.season_id = ? AND t.club_name = ?`)
    .bind(seasonId, seasonId, CLUB_NAME).all();
  return { seasonId, rounds: results };
}

// Players on one team sheet (one game). Coaches are excluded.
async function gamePlayers(db, gameId) {
  const { results } = await db.prepare(`
    SELECT playhq_player_id, first_name, last_name
    FROM team_sheet_players
    WHERE game_id = ?
      AND role_type = 'Player'
      AND playhq_player_id NOT IN (
        SELECT playhq_player_id FROM member_directory
        WHERE role = 'coach' AND playhq_player_id IS NOT NULL)
    ORDER BY last_name, first_name`).bind(gameId).all();
  return results;
}

async function findMemberByPin(db, pin) {
  return db.prepare(
    'SELECT id, first_name, last_name, playhq_player_id FROM member_directory WHERE pin = ?'
  ).bind(pin).first();
}

// The member is on a sheet if their PlayHQ ID matches, or, when they have no ID, their name matches.
function isSamePerson(p, member) {
  if (member.playhq_player_id) return p.playhq_player_id === member.playhq_player_id;
  return sameName(p.first_name, member.first_name) && sameName(p.last_name, member.last_name);
}

// Every Cockburn Lakes sheet this round that the member is listed on.
async function findPlayerSheets(db, member, rounds) {
  const hits = [];
  for (const round of rounds) {
    const players = await gamePlayers(db, round.game_id);
    const me = players.find(p => isSamePerson(p, member));
    if (me) hits.push({ round, players, me });
  }
  return hits;
}

// Returns { hit } for the one sheet the member is on, or { failure } with the response to send back.
async function resolvePlayerSheet(db, member) {
  const { rounds } = await cockburnRounds(db);
  const hits = await findPlayerSheets(db, member, rounds);
  if (hits.length === 0) return { failure: fail(notPlayed(member), 403) };
  if (hits.length > 1) return { failure: fail(MULTI_SHEET_MSG, 409) };
  return { hit: hits[0] };
}

async function handleLogin(env, body) {
  if (!validPin(body.pin)) return fail('Enter a 4-digit PIN.');

  const member = await findMemberByPin(env.DB, body.pin);
  if (!member) return fail('PIN not recognised.', 401);

  const { hit, failure } = await resolvePlayerSheet(env.DB, member);
  if (failure) return failure;

  const { round, players, me } = hit;
  const existing = await env.DB.prepare(
    'SELECT 1 FROM players_player_votes WHERE round_key = ? AND voter_member_id = ?'
  ).bind(round.round_key, member.id).first();
  const win = windowFor(round.round_key);

  return ok({
    member: { first_name: member.first_name, last_name: member.last_name },
    team: { team_name: round.team_name, grade_name: round.grade_name },
    game: { game_id: round.game_id, match_date: round.round_key },
    players: players.filter(p => p !== me),
    voted: !!existing,
    window_open: win.open,
    window_text: win.text,
  });
}

async function handleVote(env, body) {
  if (!validPin(body.pin)) return fail('Enter a 4-digit PIN.');

  const member = await findMemberByPin(env.DB, body.pin);
  if (!member) return fail('PIN not recognised.', 401);

  const { hit, failure } = await resolvePlayerSheet(env.DB, member);
  if (failure) return failure;
  const { round, players, me } = hit;

  const candidate = body.candidate_playhq_player_id;
  if (typeof candidate !== 'string' || !candidate) return fail('Please select a player.');
  if (!windowFor(round.round_key).open) return fail('Voting is closed for this round.', 403);
  if (candidate === me.playhq_player_id) return fail('You cannot vote for yourself.');
  if (!players.some(p => p.playhq_player_id === candidate)) {
    return fail("That player is not on your team sheet.");
  }

  // UNIQUE(round_key, voter_member_id) makes a second vote a no-op
  const res = await env.DB.prepare(`
    INSERT OR IGNORE INTO players_player_votes
      (season_id, round_key, grade_name, game_id, team_id, voter_member_id, voter_playhq_player_id, candidate_playhq_player_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(round.season_id, round.round_key, round.grade_name, round.game_id, round.team_id,
      member.id, me.playhq_player_id, candidate)
    .run();

  if (res.meta.changes === 0) return fail('You have already voted this round.', 409);
  return ok({});
}

async function handleAdminTeams(env, body) {
  const state = checkAdmin(env, body);
  if (state === 'not-set') return fail('Admin PIN is not set up on the server.', 500);
  if (state === 'wrong') return fail('Incorrect admin PIN.', 401);

  const seasonId = await activeSeasonId(env.DB);
  if (!seasonId) return fail('No active season.', 404);

  const { results } = await env.DB.prepare(
    'SELECT id, team_name, grade_name FROM teams WHERE season_id = ? AND club_name = ? ORDER BY grade_name, team_name'
  ).bind(seasonId, CLUB_NAME).all();
  return ok({ teams: results });
}

async function handleAdminNotVoted(env, body) {
  const state = checkAdmin(env, body);
  if (state === 'not-set') return fail('Admin PIN is not set up on the server.', 500);
  if (state === 'wrong') return fail('Incorrect admin PIN.', 401);

  const seasonId = await activeSeasonId(env.DB);
  const teamId = parseInt(body.team_id, 10);
  if (!seasonId || !teamId) return fail('Choose a team.');

  const round = await env.DB.prepare(`
    SELECT cr.playhq_game_id AS game_id, cr.round_date AS round_key, t.team_name, t.grade_name
    FROM current_round cr JOIN teams t ON t.id = cr.team_id
    WHERE cr.season_id = ? AND cr.team_id = ? AND t.club_name = ?`).bind(seasonId, teamId, CLUB_NAME).first();
  if (!round) return fail('No current round is set for this team yet.', 404);

  const players = await gamePlayers(env.DB, round.game_id);
  const { results: votes } = await env.DB.prepare(
    'SELECT voter_playhq_player_id FROM players_player_votes WHERE round_key = ? AND team_id = ?'
  ).bind(round.round_key, teamId).all();
  const voted = new Set(votes.map(v => v.voter_playhq_player_id));

  return ok({
    team: { team_name: round.team_name, grade_name: round.grade_name },
    round_date: round.round_key,
    not_voted: players
      .filter(p => !voted.has(p.playhq_player_id))
      .map(p => ({ first_name: p.first_name, last_name: p.last_name })),
  });
}

// Tally of votes received per player for one team. Optional round_key limits it to one round;
// without it the tally covers the whole season so far. Returns the rounds that have votes for the dropdown.
async function handleAdminTally(env, body) {
  const state = checkAdmin(env, body);
  if (state === 'not-set') return fail('Admin PIN is not set up on the server.', 500);
  if (state === 'wrong') return fail('Incorrect admin PIN.', 401);

  const seasonId = await activeSeasonId(env.DB);
  const teamId = parseInt(body.team_id, 10);
  if (!seasonId || !teamId) return fail('Choose a team.');

  const team = await env.DB.prepare(
    'SELECT id, team_name, grade_name FROM teams WHERE id = ? AND season_id = ? AND club_name = ?'
  ).bind(teamId, seasonId, CLUB_NAME).first();
  if (!team) return fail('Team not found.', 404);

  const roundKey = body.round_key ? String(body.round_key) : null;
  if (roundKey && !/^\d{4}-\d{2}-\d{2}$/.test(roundKey)) return fail('Invalid round date.');
  const scope = roundKey ? ' AND round_key = ?' : '';
  const args = roundKey ? [seasonId, teamId, roundKey] : [seasonId, teamId];

  const { results: rounds } = await env.DB.prepare(
    'SELECT DISTINCT round_key FROM players_player_votes WHERE season_id = ? AND team_id = ? ORDER BY round_key DESC'
  ).bind(seasonId, teamId).all();

  const { results: counts } = await env.DB.prepare(`
    SELECT candidate_playhq_player_id AS player_id, COUNT(*) AS votes
    FROM players_player_votes
    WHERE season_id = ? AND team_id = ?${scope}
    GROUP BY candidate_playhq_player_id
    ORDER BY votes DESC`).bind(...args).all();

  // Names come from the team sheets the votes were cast on, then from the member directory.
  const { results: sheetNames } = await env.DB.prepare(`
    SELECT DISTINCT playhq_player_id AS player_id, first_name, last_name
    FROM team_sheet_players
    WHERE game_id IN (
      SELECT DISTINCT game_id FROM players_player_votes
      WHERE season_id = ? AND team_id = ?${scope})`).bind(...args).all();
  const names = new Map(sheetNames.map(p => [p.player_id, p]));

  const tally = [];
  for (const c of counts) {
    let name = names.get(c.player_id);
    if (!name) {
      name = await env.DB.prepare(
        'SELECT first_name, last_name FROM member_directory WHERE playhq_player_id = ? LIMIT 1'
      ).bind(c.player_id).first();
    }
    tally.push({
      first_name: name ? name.first_name : 'Unknown',
      last_name: name ? name.last_name : '(' + c.player_id + ')',
      votes: c.votes,
    });
  }

  return ok({
    team: { team_name: team.team_name, grade_name: team.grade_name },
    round_date: roundKey,
    rounds: rounds.map(r => r.round_key),
    total_votes: tally.reduce((n, t) => n + t.votes, 0),
    tally,
  });
}

const PAGE = `<!DOCTYPE html>
                                                                                                                                                                                                                                                                                                                                                                                                             <html lang="en-AU">
                                                                                                                                                                                                                                                                                                                                                                                                             <head>
                                                                                                                                                                                                                                                                                                                                                                                                             <meta charset="UTF-8">
                                                                                                                                                                                                                                                                                                                                                                                                             <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                                                                                                                                                                                                                                                                                                                                                                                             <meta name="robots" content="noindex, nofollow">
                                                                                                                                                                                                                                                                                                                                                                                                             <title>Players' Player | Cockburn Lakes FC</title>
                                                                                                                                                                                                                                                                                                                                                                                                             <link rel="preconnect" href="https://fonts.googleapis.com">
                                                                                                                                                                                                                                                                                                                                                                                                             <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                                                                                                                                                                                                                                                                                                                                                                                                             <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Oswald:wght@500;700&display=swap" rel="stylesheet">
                                                                                                                                                                                                                                                                                                                                                                                                             <style>
                                                                                                                                                                                                                                                                                                                                                                                                               :root {
                                                                                                                                                                                                                                                                                                                                                                                                                   --navy: #0a1220; --navy2: #0f2245; --navy3: #0c1c3a;
                                                                                                                                                                                                                                                                                                                                                                                                                       --blue: #163d84; --blue2: #1c4fa8;
                                                                                                                                                                                                                                                                                                                                                                                                                           --red: #d4283a; --red2: #a91f2e;
                                                                                                                                                                                                                                                                                                                                                                                                                               --gold: #ffd34d; --green: #7fe0a0; --pink: #ff8a93;
                                                                                                                                                                                                                                                                                                                                                                                                                                   --grey: #b8c2d4; --muted: #6b7a90; --off: #f4f5f8;
                                                                                                                                                                                                                                                                                                                                                                                                                                       --display: Oswald, "Arial Narrow", sans-serif;
                                                                                                                                                                                                                                                                                                                                                                                                                                         }
                                                                                                                                                                                                                                                                                                                                                                                                                                           * { box-sizing: border-box; }
                                                                                                                                                                                                                                                                                                                                                                                                                                             body {
                                                                                                                                                                                                                                                                                                                                                                                                                                                 margin: 0; min-height: 100vh; color: var(--off);
                                                                                                                                                                                                                                                                                                                                                                                                                                                     font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                                                                                                                                                                                                                                                                                                                                                                                                                                                         background:
                                                                                                                                                                                                                                                                                                                                                                                                                                                               radial-gradient(900px 500px at 50% -120px, rgba(22,61,132,.9), transparent 70%),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                     linear-gradient(180deg, var(--navy2) 0%, var(--navy) 100%);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                         display: flex; flex-direction: column; align-items: center;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                           }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                             .top {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 width: 100%; padding: 34px 16px 26px; text-align: center;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     background: rgba(10,18,32,.55); border-bottom: 3px solid var(--red);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         .h-back {
display: inline-block; margin-top: 14px; padding: 8px 16px; border-radius: 999px;
font: 600 13px/1 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase;
color: var(--gold); text-decoration: none; border: 1px solid rgba(255,211,77,.35);
background: rgba(255,211,77,.08);
}
.h-back:hover { background: rgba(255,211,77,.18); }
.logo {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             width: min(320px, 78vw); height: auto; display: block; margin: 0 auto;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 border-radius: 18px; box-shadow: 0 18px 40px rgba(0,0,0,.55), 0 0 0 2px rgba(255,211,77,.25);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     .h-title {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         font-family: var(--display); font-weight: 700; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             letter-spacing: .08em; font-size: 28px; margin: 12px 0 0; color: #fff;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 .h-sub {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         color: var(--gold); margin-top: 6px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             main { width: 100%; max-width: 440px; padding: 4px 16px 40px; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               .card {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   background: linear-gradient(180deg, var(--navy2), var(--navy3));
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       border: 1px solid rgba(184,194,212,.14); border-top: 4px solid var(--red);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           border-radius: 14px; padding: 22px; margin-top: 18px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               box-shadow: 0 14px 34px rgba(0,0,0,.35);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   .card h2 {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       font-family: var(--display); font-weight: 700; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           letter-spacing: .06em; font-size: 22px; margin: 0 0 6px; color: #fff;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               .lead { color: var(--grey); font-size: 14px; margin: 0 0 14px; line-height: 1.5; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 label {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     display: block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         color: var(--grey); margin: 14px 0 6px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             input, select {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 width: 100%; padding: 14px; font-size: 16px; border-radius: 10px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     border: 1px solid var(--blue2); background: #0a1730; color: #fff; outline: none;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         font-family: inherit;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             input:focus, select:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(255,211,77,.18); }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               .pin-input {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   font-family: var(--display); font-size: 28px; letter-spacing: .5em;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       text-align: center; padding: 12px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           button {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               width: 100%; margin-top: 16px; padding: 15px; border: none; border-radius: 10px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   background: linear-gradient(180deg, var(--red), var(--red2)); color: #fff;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       font-family: var(--display); font-weight: 700; font-size: 18px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           letter-spacing: .12em; text-transform: uppercase; cursor: pointer;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               box-shadow: 0 8px 18px rgba(212,40,58,.32);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   button:disabled { opacity: .5; cursor: default; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     button.ghost {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         background: transparent; border: 1px solid var(--blue2); box-shadow: none;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             font-family: Inter, sans-serif; font-weight: 600; font-size: 13px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 letter-spacing: .04em; text-transform: none;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     .pills { margin: 4px 0 10px; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       .pill {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           display: inline-block; padding: 6px 12px; margin: 4px 6px 4px 0; border-radius: 999px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               background: rgba(255,211,77,.1); color: var(--gold); border: 1px solid rgba(255,211,77,.35);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       .welcome {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           font-family: var(--display); font-size: 28px; text-transform: uppercase;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               letter-spacing: .04em; margin: 0 0 8px; color: #fff; line-height: 1.1;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   .window { color: var(--grey); font-size: 13px; margin: 6px 0 0; line-height: 1.5; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     .msg { margin-top: 14px; font-size: 14px; line-height: 1.5; min-height: 1em; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       .msg.err { color: var(--pink); }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         .msg.ok { color: var(--green); }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           .tick {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               width: 68px; height: 68px; margin: 8px auto 14px; border-radius: 50%;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   display: flex; align-items: center; justify-content: center;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       background: rgba(127,224,160,.12); border: 2px solid var(--green);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           color: var(--green); font-size: 34px;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               .hidden { display: none !important; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 .admin-wrap { text-align: center; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   .admin-toggle {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       background: none; border: none; color: var(--muted); text-decoration: underline;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           font-size: 12px; width: auto; margin-top: 26px; padding: 6px; box-shadow: none;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               font-family: Inter, sans-serif; font-weight: 400; letter-spacing: 0; text-transform: none;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ul.nv { list-style: none; padding: 0; margin: 10px 0 0; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     ul.nv li { padding: 10px 12px; border-bottom: 1px solid rgba(184,194,212,.12); }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       .foot {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           margin-top: 30px; font-size: 10px; letter-spacing: .18em;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               text-transform: uppercase; color: var(--muted); text-align: center;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   .footer-logo { max-width: 180px; max-height: 70px; display: block; margin: 0 auto 10px; opacity: .9; }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   </style>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   </head>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <body>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <header class="top">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     <img class="logo" src="/assets/club-logo/clfc-player-player-logo.png" alt="Cockburn Lakes Football Club" onerror="this.style.display='none'">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       <div class="h-title">Players' Player</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <div class="h-sub">Cockburn Lakes Football Club</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <a class="h-back" href="https://clfc2027.clfc2027.workers.dev/">&larr; Return to Hub</a>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         </header>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <main>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           <section id="pin-section" class="card">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               <h2>Enter your PIN</h2>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <p class="lead">Use the 4-digit PIN you were given by the club.</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       <input id="pin" class="pin-input" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="····">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           <button id="pin-btn">Continue</button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               <div id="pin-msg" class="msg err"></div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 </section>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <section id="vote-section" class="card hidden">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       <div id="done" class="hidden">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             <div class="tick">&#10003;</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <h2 style="text-align:center">Vote recorded</h2>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <p class="lead" style="text-align:center">Thanks for voting. Results are kept private until the end of the season.</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 <div id="ballot">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       <div class="welcome" id="welcome"></div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             <div class="pills" id="team-pills"></div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <p class="window" id="window-info"></p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <div id="vote-form">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 <label for="candidate">Your Players' Player</label>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <select id="candidate"></select>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 <button id="vote-btn">Cast vote</button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             <div id="vote-msg" class="msg"></div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   </section>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     <div class="admin-wrap">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         <button class="ghost admin-toggle" id="admin-toggle">Admin</button>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           </div>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             <section id="admin-section" class="card hidden">
<h2>Admin</h2>
<div id="admin-login">
<label for="admin-pin">Admin PIN</label>
<input id="admin-pin" class="pin-input" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off">
<button id="admin-login-btn">Unlock</button>
</div>
<div id="admin-tools" class="hidden">
<label for="admin-team">Team</label>
<select id="admin-team"></select>
<label for="admin-round">Round</label>
<select id="admin-round"></select>
<button id="admin-tally-btn">Show vote tally</button>
<div id="admin-tally" class="msg"></div>
<button id="admin-check-btn">Show who has not voted</button>
<div id="admin-result" class="msg"></div>
</div>
<div id="admin-msg" class="msg err"></div>
</section>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   <div class="foot">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       <img class="footer-logo" src="/assets/club-logo/clfc-footer.png" alt="" onerror="this.style.display='none'">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           <div>Warriors Hub &middot; 2027</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             </main>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             <script>
(function () {
var session = null;
var adminPass = '';

function $(id) { return document.getElementById(id); }

function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) { d.ok = false; d.error = d.error || 'Something went wrong. Please try again.'; }
      return d;
    });
  }).catch(function () {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  });
}

function setMsg(el, text, cls) {
  el.className = 'msg ' + cls;
  el.textContent = text;
}

// ---- Step 1: PIN ----
function login() {
  $('pin-msg').textContent = '';
  var raw = $('pin').value;
  var pin = raw.normalize('NFKC').replace(/[^0-9]/g, '');
  if (!/^[0-9]{4}$/.test(pin)) {
    var codes = raw.split('').map(function (c) { return c.charCodeAt(0); }).join(' ');
    setMsg($('pin-msg'), 'Please enter a 4-digit PIN. Characters received (codes): ' + (codes || 'none'), 'err');
    return;
  }

  $('pin-btn').disabled = true;
  api('/login', { pin: pin }).then(function (d) {
    $('pin-btn').disabled = false;
    if (!d.ok) { setMsg($('pin-msg'), d.error || 'PIN not recognised.', 'err'); return; }
    session = { pin: pin, member: d.member, players: d.players || [], voted: !!d.voted };
    $('pin-section').classList.add('hidden');
    renderVote(d);
    $('vote-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function addPill(parent, text) {
  var s = document.createElement('span');
  s.className = 'pill';
  s.textContent = text;
  parent.appendChild(s);
}

function renderVote(d) {
  $('welcome').textContent = 'Welcome, ' + session.member.first_name + ' ' + session.member.last_name;

  var pills = $('team-pills');
  pills.innerHTML = '';
  if (d.team) addPill(pills, d.team.team_name);
  if (d.game && d.game.match_date) addPill(pills, 'Round ' + d.game.match_date);

  $('window-info').textContent = d.window_text || '';

  var sel = $('candidate');
  sel.innerHTML = '';
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a player';
  sel.appendChild(placeholder);

  session.players.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.playhq_player_id;
    o.textContent = p.first_name + ' ' + p.last_name;
    sel.appendChild(o);
  });

  var canVote = d.window_open && !session.voted && session.players.length > 0;
  $('vote-form').classList.toggle('hidden', !canVote);

  if (session.voted) { showDone(); return; }
  if (!d.window_open) setMsg($('vote-msg'), 'Voting is closed for this round.', 'err');
  else $('vote-msg').textContent = '';
}

function showDone() {
  $('ballot').classList.add('hidden');
  $('done').classList.remove('hidden');
}

// ---- Step 2: Vote ----
function submitVote() {
  $('vote-msg').textContent = '';
  var candidate = $('candidate').value;
  if (!candidate) { setMsg($('vote-msg'), 'Please select a player.', 'err'); return; }

  $('vote-btn').disabled = true;
  api('/vote', { pin: session.pin, candidate_playhq_player_id: candidate }).then(function (d) {
    $('vote-btn').disabled = false;
    if (!d.ok) { setMsg($('vote-msg'), d.error || 'Vote not recorded.', 'err'); return; }
    session.voted = true;
    showDone();
  });
}

// ---- Admin ----
function adminUnlock() {
  $('admin-msg').textContent = '';
  var pass = $('admin-pin').value.replace(/[^0-9]/g, '');
  if (!/^[0-9]{4,12}$/.test(pass)) { setMsg($('admin-msg'), 'Enter the admin PIN (digits only).', 'err'); return; }

  api('/admin/teams', { adminPin: pass }).then(function (d) {
    if (!d.ok) { setMsg($('admin-msg'), d.error || 'Could not unlock.', 'err'); return; }
    adminPass = pass;
    var sel = $('admin-team');
    sel.innerHTML = '';
    (d.teams || []).forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.grade_name + ' - ' + t.team_name;
      sel.appendChild(o);
    });
    $('admin-login').classList.add('hidden');
    $('admin-tools').classList.remove('hidden');
    adminTally(false);
  });
}

// Loads the tally. When keepRounds is false the round dropdown is rebuilt from the rounds that have votes.
function adminTally(keepRounds) {
  var teamId = $('admin-team').value;
  if (!teamId) return;
  $('admin-msg').textContent = '';
  var body = { adminPin: adminPass, team_id: teamId };
  var roundKey = $('admin-round').value;
  if (roundKey) body.round_key = roundKey;

  api('/admin/tally', body).then(function (d) {
    if (!d.ok) { setMsg($('admin-msg'), d.error || 'Could not load the tally.', 'err'); return; }
    if (!keepRounds) fillRounds(d.rounds || []);
    renderTally(d);
  });
}

function fillRounds(rounds) {
  var sel = $('admin-round');
  sel.innerHTML = '';
  var all = document.createElement('option');
  all.value = '';
  all.textContent = 'All rounds (season to date)';
  sel.appendChild(all);
  rounds.forEach(function (r) {
    var o = document.createElement('option');
    o.value = r;
    o.textContent = 'Round ' + r;
    sel.appendChild(o);
  });
}

function renderTally(d) {
  var box = $('admin-tally');
  box.innerHTML = '';
  box.className = 'msg';

  var head = document.createElement('div');
  head.className = 'lead';
  head.textContent = d.team.grade_name + ' - ' + d.team.team_name + ' | ' +
    (d.round_date ? 'Round ' + d.round_date : 'All rounds') + ' | Total votes: ' + d.total_votes;
  box.appendChild(head);

  if (!d.tally.length) {
    var none = document.createElement('div');
    none.textContent = 'No votes recorded yet.';
    box.appendChild(none);
    return;
  }

  var ul = document.createElement('ul');
  ul.className = 'nv';
  d.tally.forEach(function (t) {
    var li = document.createElement('li');
    li.textContent = t.first_name + ' ' + t.last_name + ' - ' + t.votes + (t.votes === 1 ? ' vote' : ' votes');
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

function adminCheck() {
  $('admin-msg').textContent = '';
  var result = $('admin-result');
  result.className = 'msg';
  result.textContent = 'Loading...';
  api('/admin/not-voted', { adminPin: adminPass, team_id: $('admin-team').value }).then(function (d) {
    if (!d.ok) { setMsg(result, d.error || 'Could not load.', 'err'); return; }
    result.textContent = '';
    var head = document.createElement('div');
    head.className = 'lead';
    head.textContent = d.team.grade_name + ' - ' + d.team.team_name + ' | Round ' + d.round_date +
      ' | ' + d.not_voted.length + ' not yet voted';
    result.appendChild(head);
    var ul = document.createElement('ul');
    ul.className = 'nv';
    d.not_voted.forEach(function (p) {
      var li = document.createElement('li');
      li.textContent = p.first_name + ' ' + p.last_name;
      ul.appendChild(li);
    });
    result.appendChild(ul);
  });
}

$('pin-btn').addEventListener('click', login);
$('pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
$('vote-btn').addEventListener('click', submitVote);
$('admin-toggle').addEventListener('click', function () { $('admin-section').classList.toggle('hidden'); });
$('admin-login-btn').addEventListener('click', adminUnlock);
$('admin-team').addEventListener('change', function () {
  $('admin-round').value = '';
  $('admin-result').textContent = '';
  adminTally(false);
});
$('admin-round').addEventListener('change', function () { adminTally(true); });
$('admin-tally-btn').addEventListener('click', function () { adminTally(true); });
$('admin-check-btn').addEventListener('click', adminCheck);
})();
</script>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               </body>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               </html>`;

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
      });
    }
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const key = url.pathname.slice("/assets/".length);
      if (!ASSET_KEYS.includes(key) || !env.ASSETS) return new Response("Not found", { status: 404 });
      const obj = await env.ASSETS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "image/png",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }
    if (request.method !== "POST") return fail("Method not allowed.", 405);
    const path = url.pathname.replace(/^\/api\/players-player/, "");
    let body;
    try {
      body = await request.json() || {};
    } catch {
      return fail("Bad request.");
    }
    try {
      if (path === "/login") return await handleLogin(env, body);
      if (path === "/vote") return await handleVote(env, body);
      if (path === "/admin/teams") return await handleAdminTeams(env, body);
      if (path === "/admin/not-voted") return await handleAdminNotVoted(env, body);
      if (path === "/admin/tally") return await handleAdminTally(env, body);
      return fail("Not found.", 404);
    } catch (err) {
      console.error(err);
      return fail("Server error. Please try again.", 500);
    }
  }
};
export {
  worker_default as default
};
