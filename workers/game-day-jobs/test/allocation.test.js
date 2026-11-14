import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobSpecs, allocateRound, fairnessViolations } from "../allocation.js";

const player = (key) => ({ key, name: key, member_id: null, playhq_player_id: key });
const pool = (prefix, n) => Array.from({ length: n }, (_, i) => player(`${prefix}${i}`));

test("home game: pair supplies water and scoreboard, own grade does jumpers and changeroom", () => {
  const specs = buildJobSpecs({ league: { home: true }, colts: { home: true }, reserves: { home: true }, thirds: { home: true } });
  const league = specs.filter((s) => s.game === "league");
  assert.deepEqual([...new Set(league.filter((s) => s.type.startsWith("water")).map((s) => s.supplier[0]))], ["colts"]);
  assert.deepEqual(league.find((s) => s.type === "scoreboard").supplier, ["colts"]);
  assert.deepEqual(league.find((s) => s.type === "jumpers").supplier, ["league"]);
  assert.deepEqual(league.find((s) => s.type === "changeroom").supplier, ["league"]);
  assert.equal(specs.filter((s) => s.game === "thirds" && s.type === "scoreboard")[0].supplier[0], "reserves");
});

test("away game: no scoreboard or changeroom; jumpers still apply", () => {
  const specs = buildJobSpecs({ colts: { home: false } });
  assert.equal(specs.some((s) => s.type === "scoreboard" || s.type === "changeroom"), false);
  assert.ok(specs.some((s) => s.type === "jumpers" && s.supplier[0] === "colts"));
});

test("three grades away together share away water between them", () => {
  const specs = buildJobSpecs({ league: { home: false }, colts: { home: false }, reserves: { home: false } });
  assert.deepEqual(specs.find((s) => s.game === "colts" && s.type === "water1").supplier, ["league", "colts", "reserves"]);
});

test("thirds away sorts its own water", () => {
  const specs = buildJobSpecs({ thirds: { home: false } });
  assert.deepEqual(specs.find((s) => s.type === "water1").supplier, ["thirds"]);
});

test("no player is given two jobs in one round", () => {
  const specs = buildJobSpecs({ league: { home: true }, colts: { home: true }, reserves: { home: true }, thirds: { home: true } });
  const pools = { league: pool("L", 9), colts: pool("C", 9), reserves: pool("R", 9), thirds: pool("T", 9) };
  const { assignments } = allocateRound({ specs, pools, seed: 42 });
  const keys = Object.values(assignments).filter(Boolean).map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("lowest season count is picked first", () => {
  const specs = buildJobSpecs({ colts: { home: false } }).filter((s) => s.type === "water1");
  const pools = { colts: [player("a"), player("b"), player("c")] };
  const counts = new Map([["a", { total: 5, byType: {} }], ["b", { total: 0, byType: {} }], ["c", { total: 0, byType: {} }]]);
  const { assignments } = allocateRound({ specs, pools, counts, seed: 1 });
  assert.ok(["b", "c"].includes(assignments[specs[0].id].key));
  assert.ok(["b", "c"].includes(assignments[specs[1].id].key));
});

test("unfilled slot is null when pool is too small", () => {
  const specs = buildJobSpecs({ colts: { home: false } }).filter((s) => s.type === "water1");
  const { assignments } = allocateRound({ specs, pools: { colts: [player("a")] }, seed: 1 });
  assert.equal(assignments[specs[1].id], null);
});

test("fairness check flags a player more than one job from the average", () => {
  const pools = { colts: pool("C", 3) };
  const counts = new Map([["C0", { total: 4, byType: {} }]]);
  assert.equal(fairnessViolations(counts, pools, 1).length, 3);
});
