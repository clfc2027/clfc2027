// Game Day jobs allocation rules for CLFC.
// Pure functions only (no I/O) so the rules can be tested with `node --test`.

export const GRADES = ["league", "colts", "reserves", "thirds"];

// Home games: the grade that supplies water and scoreboard for each home game.
export const HOME_SUPPLIER = {
  league: "colts",
  colts: "league",
  reserves: "thirds",
  thirds: "reserves",
};

// These three always play together, so their away jobs are shared between them.
export const AWAY_TRIO = ["league", "colts", "reserves"];

// Number of people per job for each game.
export const JOB_SLOTS = { water1: 2, water2: 2, scoreboard: 1, jumpers: 1, changeroom: 1 };

export const JOB_LABELS = {
  water1: "Water 1st Half",
  water2: "Water 2nd Half",
  scoreboard: "Scoreboard",
  jumpers: "Jumpers",
  changeroom: "Changeroom Sweep",
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// games: { [grade]: { home: boolean } } for every grade playing this round.
// Returns one spec per job slot, with the grades whose boards can supply it.
export function buildJobSpecs(games) {
  const specs = [];
  const awayTrioTogether = AWAY_TRIO.every((g) => games[g] && !games[g].home);

  for (const game of GRADES.filter((g) => games[g])) {
    const home = games[game].home;
    let water;
    if (home) water = [HOME_SUPPLIER[game]];
    else if (game === "thirds") water = ["thirds"];
    else if (awayTrioTogether) water = [...AWAY_TRIO];
    else water = [game];

    addSpecs(specs, game, "water1", water, home);
    addSpecs(specs, game, "water2", water, home);
    if (home) addSpecs(specs, game, "scoreboard", [HOME_SUPPLIER[game]], home);
    addSpecs(specs, game, "jumpers", [game], home);
    if (home) addSpecs(specs, game, "changeroom", [game], home);
  }
  return specs;
}

function addSpecs(specs, game, type, supplier, home) {
  for (let slot = 1; slot <= JOB_SLOTS[type]; slot++) {
    specs.push({ id: `${game}|${type}|${slot}`, game, type, slot, supplier: [...supplier], home });
  }
}

// players: { key, name, member_id, playhq_player_id }
// pools: { [grade]: player[] } saved boards for this round.
// counts: Map(key -> { total, byType }) season-to-date before this round.
// taken: Set(key) already assigned in this round.
export function allocateRound({ specs, pools, counts = new Map(), taken = new Set(), seed, maxTries = 25, margin = 1 }) {
  const base = seed >>> 0;
  let best = null;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const trySeed = (base + attempt * 7919) >>> 0;
    const run = runOnce(specs, pools, counts, taken, trySeed);
    const violations = fairnessViolations(run.counts, pools, margin);
    const candidate = { assignments: run.assignments, seed: trySeed, fair: violations.length === 0, violations };
    if (!best || violations.length < best.violations.length) best = candidate;
    if (candidate.fair) break;
  }
  return best;
}

function runOnce(specs, pools, counts, taken, seed) {
  const rand = mulberry32(seed);
  const localCounts = cloneCounts(counts);
  const localTaken = new Set(taken);
  const assignments = {};

  for (const spec of specs) {
    const candidates = dedupe(spec.supplier.flatMap((g) => pools[g] || [])).filter((p) => !localTaken.has(p.key));
    if (!candidates.length) {
      assignments[spec.id] = null;
      continue;
    }
    const ranked = candidates
      .map((p) => {
        const c = localCounts.get(p.key) || { total: 0, byType: {} };
        return { p, total: c.total, typed: c.byType[spec.type] || 0, r: rand() };
      })
      .sort((a, b) => a.total - b.total || a.typed - b.typed || a.r - b.r);

    const chosen = ranked[0].p;
    assignments[spec.id] = chosen;
    localTaken.add(chosen.key);
    bump(localCounts, chosen.key, spec.type);
  }
  return { assignments, counts: localCounts };
}

// A player whose season total is more than `margin` away from their board's average fails the check.
export function fairnessViolations(counts, pools, margin = 1) {
  const violations = [];
  for (const [grade, players] of Object.entries(pools)) {
    if (!players.length) continue;
    const totals = players.map((p) => (counts.get(p.key) || { total: 0 }).total);
    const avg = totals.reduce((s, n) => s + n, 0) / totals.length;
    players.forEach((p, i) => {
      if (Math.abs(totals[i] - avg) > margin) violations.push({ key: p.key, grade, total: totals[i], avg });
    });
  }
  return violations;
}

function bump(counts, key, type) {
  const c = counts.get(key) || { total: 0, byType: {} };
  counts.set(key, { total: c.total + 1, byType: { ...c.byType, [type]: (c.byType[type] || 0) + 1 } });
}

function cloneCounts(counts) {
  const out = new Map();
  for (const [k, v] of counts) out.set(k, { total: v.total, byType: { ...v.byType } });
  return out;
}

function dedupe(players) {
  const seen = new Set();
  return players.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
}
