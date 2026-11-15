// Run from the repo root: node --test workers/fgk/test/fgk.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runSync } from "../worker.js";

const TEAM_PHQ = "team-b-2027";

function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const api = {
        bind(...p) { params = p; return api; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { stmt.run(...params); return { success: true }; },
      };
      return api;
    },
  };
}

function newDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, season_year INTEGER);
    CREATE TABLE teams (id INTEGER PRIMARY KEY, season_id INTEGER, team_name TEXT, playhq_team_id TEXT);
    CREATE TABLE fixtures (season_id INTEGER, team_id INTEGER, playhq_game_id TEXT, round_id TEXT, round_name TEXT,
      is_final_round INTEGER, game_date TEXT, game_time TEXT, timezone TEXT, opponent_team_id TEXT, opponent_name TEXT,
      venue_id TEXT, venue_name TEXT, venue_surface TEXT, status TEXT, PRIMARY KEY (team_id, playhq_game_id));
    CREATE TABLE team_sheet_players (game_id TEXT, playhq_player_id TEXT, first_name TEXT, last_name TEXT,
      player_number TEXT, player_position TEXT, captain_role TEXT, is_fill_in INTEGER, is_emergency INTEGER,
      role_type TEXT, PRIMARY KEY (game_id, playhq_player_id));
    CREATE TABLE wheel_players (team_id INTEGER, game_id TEXT, playhq_player_id TEXT, player_name TEXT, is_spun INTEGER DEFAULT 0,
      PRIMARY KEY (team_id, game_id, playhq_player_id));
    CREATE TABLE wheel_state (team_id INTEGER PRIMARY KEY, game_id TEXT, grade_name TEXT, player_count INTEGER,
      synced_at TEXT, is_test INTEGER DEFAULT 0);
    INSERT INTO seasons (id, season_year) VALUES (1, 2027);
    INSERT INTO teams (id, season_id, team_name, playhq_team_id) VALUES (1, 1, 'Cockburn Lakes (B)', '${TEAM_PHQ}');
  `);
  return db;
}

// Fake PlayHQ: one upcoming game for the team; the team sheet is whatever the test passes in.
function fakePlayHQ(appearances) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes(`/teams/${TEAM_PHQ}/fixture`)) {
      return new Response(JSON.stringify({ data: [{
        id: "game-1", status: "UNPLAYED",
        competitors: [{ id: TEAM_PHQ, name: "Cockburn Lakes" }, { id: "opp", name: "Opponents" }],
        round: { id: "r1", name: "Round 1", isFinalRound: false },
        schedule: { date: "2027-03-06", time: "13:00", timezone: "Australia/Perth" },
        venue: { id: "v1", name: "Anning Park", surfaceName: "Grass" },
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/games/game-1/summary")) {
      return new Response(JSON.stringify({ data: { appearances } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not mocked", { status: 500 });
  };
}

function players(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, firstName: `First${i}`, lastName: `Last${i}`, playerNumber: String(i + 1),
    position: "Midfield", roleType: "Player", teamId: TEAM_PHQ,
  }));
}

test("empty team sheet is reported as no_synced_team_sheet and leaves no wheel behind", async () => {
  const raw = newDb();
  fakePlayHQ([]);
  const results = await runSync({ DB: makeD1(raw), PLAYHQ_API_KEY: "test" });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "no_synced_team_sheet");
  assert.equal(results[0].gameId, "game-1");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM wheel_state").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM wheel_players").get().n, 0);
});

test("published team sheet is synced into the wheel", async () => {
  const raw = newDb();
  fakePlayHQ(players(21));
  const results = await runSync({ DB: makeD1(raw), PLAYHQ_API_KEY: "test" });
  assert.equal(results[0].status, "synced");
  assert.equal(results[0].playerCount, 21);
  assert.equal(raw.prepare("SELECT player_count FROM wheel_state WHERE team_id = 1").get().player_count, 21);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM wheel_players WHERE team_id = 1").get().n, 21);
});

test("players who are not on the field list as Player are not put on the wheel", async () => {
  const raw = newDb();
  const list = players(20).concat([{ id: "c1", firstName: "Coach", lastName: "Person", roleType: "Coach", teamId: TEAM_PHQ }]);
  fakePlayHQ(list);
  const results = await runSync({ DB: makeD1(raw), PLAYHQ_API_KEY: "test" });
  assert.equal(results[0].status, "synced");
  assert.equal(results[0].playerCount, 20);
});
