import { passcodeState } from "../../shared/auth.js";
import { loadAttendanceCredit } from "../../shared/training-credit.js";
import { SCAN_PAGE, WALL_PAGE, ADMIN_PAGE } from "./pages.js";

// Training check-in Worker (Tuesday and Thursday sessions, Perth time).
// Bindings: DB -> playhq-warriors (member_directory, PIN check only)
//           FLEXI -> clfc2026-flexi (all training_* tables)
// Secret: ADMIN_PASSCODE (shared admin passcode, fails closed if missing).
// Attendance credit is computed in shared/training-credit.js, so the duty randomiser reads the same rule.
// Cron: "45 9 * * 4" UTC = Thursday 5:45pm Perth. Runs the count.

var TZ_OFFSET_MS = 8 * 3600 * 1000; // Perth, UTC+8, no daylight saving
var TRAINING_DOWS = [2, 4]; // Tuesday, Thursday (Date.getUTCDay values)
var WINDOW_OPEN = 17 * 60 + 15; // 5:15pm, QR goes live
var WINDOW_CLOSE = 19 * 60; // 7:00pm, QR closes
var COUNT_TIME = 17 * 60 + 45; // 5:45pm Thursday count, late scans roll to next week
var MSG_PLAY_TIME = 17 * 60 + 45; // "Train how you play" from 5:45pm
var MSG_WATER_TIME = 18 * 60 + 15; // "water bottles" from 6:15pm
var WHEEL_SIZE = 20;
var MILESTONE = 6;
var PIN_MAX_FAILS = 5;
var PIN_LOCK_MS = 15 * 60 * 1000;
var DEFAULT_SEASON_START = "2026-11-24"; // Tuesday. Admin can change it.
var TIERS = [
  { min: 20, name: "gold" },
  { min: 15, name: "white" },
  { min: 10, name: "blue" },
  { min: 5, name: "red" }
];
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

var SCHEMA = [
  "CREATE TABLE IF NOT EXISTS training_settings (key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS training_sessions (session_date TEXT PRIMARY KEY, window_start TEXT NOT NULL, window_end TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS training_checkins (session_date TEXT NOT NULL, member_id INTEGER NOT NULL, scanned_at TEXT NOT NULL, PRIMARY KEY (session_date, member_id))",
  "CREATE TABLE IF NOT EXISTS training_absences (session_date TEXT NOT NULL, member_id INTEGER NOT NULL, posted_at TEXT NOT NULL, PRIMARY KEY (session_date, member_id))",
  "CREATE TABLE IF NOT EXISTS training_wheel_rounds (round INTEGER PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, spun_at TEXT, winner_member_id INTEGER)",
  "CREATE TABLE IF NOT EXISTS training_wheel_entries (round INTEGER NOT NULL, slot INTEGER NOT NULL, member_id INTEGER NOT NULL, run_start TEXT NOT NULL, milestone INTEGER NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (round, slot), UNIQUE (member_id, run_start, milestone))",
  "CREATE TABLE IF NOT EXISTS training_pin_attempts (ip TEXT NOT NULL, attempted_at TEXT NOT NULL, ok INTEGER NOT NULL)"
];

var schemaReady = false;

// ---------- responses ----------

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function page(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// ---------- Perth time helpers ----------

function perthParts(date) {
  var d = new Date(date.getTime() + TZ_OFFSET_MS);
  return { ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function addDays(ymd, n) {
  return new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
function dowOf(ymd) {
  return new Date(ymd + "T00:00:00Z").getUTCDay();
}
function mondayOf(ymd) {
  var back = (dowOf(ymd) + 6) % 7;
  return addDays(ymd, -back);
}
// A Perth wall-clock time on a given date, as a UTC Date.
function atPerth(ymd, minutes) {
  return new Date(Date.parse(ymd + "T00:00:00Z") + minutes * 60000 - TZ_OFFSET_MS);
}
function sessionWindow(ymd) {
  return { start: atPerth(ymd, WINDOW_OPEN).toISOString(), end: atPerth(ymd, WINDOW_CLOSE).toISOString() };
}
function isOpen(p) {
  return TRAINING_DOWS.indexOf(p.dow) !== -1 && p.minutes >= WINDOW_OPEN && p.minutes < WINDOW_CLOSE;
}
function nextSessionDate(now) {
  var p = perthParts(now);
  for (var i = 0; i < 14; i++) {
    var ymd = addDays(p.ymd, i);
    if (TRAINING_DOWS.indexOf(dowOf(ymd)) === -1) continue;
    if (now < atPerth(ymd, WINDOW_CLOSE)) return ymd;
  }
  return null;
}
function prettyDate(ymd) {
  var parts = ymd.split("-").map(Number);
  return DAY_NAMES[dowOf(ymd)] + " " + parts[2] + " " + MONTH_NAMES[parts[1] - 1];
}
function scanMessage(minutes) {
  if (minutes >= MSG_WATER_TIME) return "Maybe as well do the team thing and get some water bottles";
  if (minutes >= MSG_PLAY_TIME) return "Train how you play";
  return "Lead by example";
}

// ---------- schema and settings ----------

async function ensureSchema(env) {
  if (schemaReady) return;
  for (var i = 0; i < SCHEMA.length; i++) {
    await env.FLEXI.prepare(SCHEMA[i]).run();
  }
  await env.FLEXI.prepare("INSERT OR IGNORE INTO training_settings (key, value) VALUES ('season_start', ?1)")
    .bind(DEFAULT_SEASON_START).run();
  schemaReady = true;
}
async function getSettings(env) {
  var res = await env.FLEXI.prepare("SELECT key, value FROM training_settings").all();
  var out = {};
  res.results.forEach(function (r) { out[r.key] = r.value; });
  return out;
}
async function setSetting(env, key, value) {
  await env.FLEXI.prepare("INSERT INTO training_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value).run();
}
async function runAll(env, stmts) {
  for (var i = 0; i < stmts.length; i += 50) {
    await env.FLEXI.batch(stmts.slice(i, i + 50));
  }
}

// Creates a session row for every Tuesday and Thursday from the season start up to today.
// Sessions exist so that a missed session can be detected.
async function ensureSessions(env, now) {
  var settings = await getSettings(env);
  var start = settings.season_start;
  if (!start) return;
  var today = perthParts(now).ymd;
  var stmts = [];
  for (var ymd = start; ymd <= today; ymd = addDays(ymd, 1)) {
    if (TRAINING_DOWS.indexOf(dowOf(ymd)) === -1) continue;
    var w = sessionWindow(ymd);
    stmts.push(env.FLEXI.prepare("INSERT OR IGNORE INTO training_sessions (session_date, window_start, window_end, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(ymd, w.start, w.end, now.toISOString()));
  }
  if (stmts.length) await runAll(env, stmts);
}

// ---------- members ----------

async function findMember(env, pin) {
  if (!pin) return null;
  return env.DB.prepare("SELECT id, first_name, last_name FROM member_directory WHERE pin = ?1").bind(pin).first();
}
async function memberNames(env) {
  var res = await env.DB.prepare("SELECT id, first_name, last_name FROM member_directory").all();
  var map = new Map();
  res.results.forEach(function (m) { map.set(m.id, (m.first_name + " " + m.last_name).trim()); });
  return map;
}

// ---------- PIN attempts (per IP lockout) ----------

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
async function pinLocked(env, ip, now) {
  var since = new Date(now.getTime() - PIN_LOCK_MS).toISOString();
  var r = await env.FLEXI.prepare("SELECT COUNT(*) AS n FROM training_pin_attempts WHERE ip = ?1 AND ok = 0 AND attempted_at >= ?2")
    .bind(ip, since).first();
  return r.n >= PIN_MAX_FAILS;
}
async function logPinAttempt(env, ip, ok, now) {
  await env.FLEXI.prepare("INSERT INTO training_pin_attempts (ip, attempted_at, ok) VALUES (?1, ?2, ?3)")
    .bind(ip, now.toISOString(), ok ? 1 : 0).run();
  await env.FLEXI.prepare("DELETE FROM training_pin_attempts WHERE attempted_at < ?1")
    .bind(new Date(now.getTime() - PIN_LOCK_MS).toISOString()).run();
}

async function readPin(request) {
  var body = await request.json().catch(function () { return {}; });
  return String(body.pin || "").trim();
}

// ---------- scan and absence ----------

async function handleScan(request, env, now) {
  var ip = clientIp(request);
  if (await pinLocked(env, ip, now)) {
    return json({ status: "locked", message: "Too many attempts. Try again in 15 minutes." }, 429);
  }
  var p = perthParts(now);
  if (!isOpen(p)) {
    return json({ status: "closed", message: "Check-in is open Tuesdays and Thursdays, 5:15pm to 7:00pm." });
  }
  var pin = await readPin(request);
  var member = await findMember(env, pin);
  await logPinAttempt(env, ip, !!member, now);
  if (!member) {
    return json({ status: "bad_pin", message: "PIN not recognised." }, 401);
  }
  var w = sessionWindow(p.ymd);
  await env.FLEXI.prepare("INSERT OR IGNORE INTO training_sessions (session_date, window_start, window_end, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(p.ymd, w.start, w.end, now.toISOString()).run();
  var res = await env.FLEXI.prepare("INSERT OR IGNORE INTO training_checkins (session_date, member_id, scanned_at) VALUES (?1, ?2, ?3)")
    .bind(p.ymd, member.id, now.toISOString()).run();
  var name = (member.first_name + " " + member.last_name).trim();
  var duplicate = res.meta.changes === 0;
  return json({
    status: duplicate ? "duplicate" : "ok",
    name: name,
    message: duplicate ? "You are already checked in for today." : scanMessage(p.minutes)
  });
}

async function handleAbsence(request, env, now) {
  var ip = clientIp(request);
  if (await pinLocked(env, ip, now)) {
    return json({ status: "locked", message: "Too many attempts. Try again in 15 minutes." }, 429);
  }
  var pin = await readPin(request);
  var member = await findMember(env, pin);
  await logPinAttempt(env, ip, !!member, now);
  if (!member) {
    return json({ status: "bad_pin", message: "PIN not recognised." }, 401);
  }
  var target = nextSessionDate(now);
  if (!target) {
    return json({ status: "none", message: "No upcoming session to post an absence for." });
  }
  var name = (member.first_name + " " + member.last_name).trim();
  var checked = await env.FLEXI.prepare("SELECT 1 AS x FROM training_checkins WHERE session_date = ?1 AND member_id = ?2")
    .bind(target, member.id).first();
  if (checked) {
    return json({ status: "already_in", name: name, message: "You are already checked in for " + prettyDate(target) + "." });
  }
  var w = sessionWindow(target);
  await env.FLEXI.prepare("INSERT OR IGNORE INTO training_sessions (session_date, window_start, window_end, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(target, w.start, w.end, now.toISOString()).run();
  await env.FLEXI.prepare("INSERT OR IGNORE INTO training_absences (session_date, member_id, posted_at) VALUES (?1, ?2, ?3)")
    .bind(target, member.id, now.toISOString()).run();
  return json({ status: "ok", name: name, message: "Noted. You are down as not attending " + prettyDate(target) + "." });
}

// ---------- streaks and attendance ----------

async function loadEndedSessions(env, before) {
  var res = await env.FLEXI.prepare("SELECT session_date FROM training_sessions WHERE window_end < ?1 ORDER BY session_date")
    .bind(before).all();
  return res.results.map(function (r) { return r.session_date; });
}
async function loadCheckins(env, before) {
  var res = await env.FLEXI.prepare("SELECT session_date, member_id, scanned_at FROM training_checkins WHERE scanned_at < ?1")
    .bind(before).all();
  return res.results;
}
// Consecutive runs of attended sessions, in date order. Only ended sessions are passed in.
function buildRuns(sessions, attended) {
  var runs = [];
  var cur = null;
  sessions.forEach(function (s) {
    if (attended.has(s)) {
      if (!cur) { cur = { start: s, dates: [] }; runs.push(cur); }
      cur.dates.push(s);
    } else {
      cur = null;
    }
  });
  return runs;
}
function currentStreak(sessions, attended) {
  var n = 0;
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (attended.has(sessions[i])) n++; else break;
  }
  return n;
}
function tierFor(streak) {
  for (var i = 0; i < TIERS.length; i++) {
    if (streak >= TIERS[i].min) return TIERS[i].name;
  }
  return null;
}

async function wheelView(env, names) {
  var rounds = await env.FLEXI.prepare("SELECT round, status, spun_at, winner_member_id FROM training_wheel_rounds ORDER BY round DESC LIMIT 3").all();
  var list = rounds.results.slice().reverse();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var entries = await env.FLEXI.prepare("SELECT slot, member_id FROM training_wheel_entries WHERE round = ?1 ORDER BY slot")
      .bind(r.round).all();
    var slots = [];
    for (var s = 1; s <= WHEEL_SIZE; s++) {
      var hit = entries.results.find(function (e) { return e.slot === s; });
      slots.push(hit ? (names.get(hit.member_id) || "Unknown") : null);
    }
    out.push({
      round: r.round,
      status: r.status,
      slots: slots,
      winner: r.winner_member_id ? (names.get(r.winner_member_id) || "Unknown") : null,
      spun_at: r.spun_at
    });
  }
  return out;
}

async function computeAttendance(env, now) {
  await ensureSessions(env, now);
  var nowIso = now.toISOString();
  var sessions = await loadEndedSessions(env, nowIso);
  var checkins = await loadCheckins(env, nowIso);
  var names = await memberNames(env);
  var attended = new Map();
  checkins.forEach(function (c) {
    if (!attended.has(c.member_id)) attended.set(c.member_id, new Set());
    attended.get(c.member_id).add(c.session_date);
  });
  var members = [];
  attended.forEach(function (set, id) {
    var streak = currentStreak(sessions, set);
    members.push({
      id: id,
      name: names.get(id) || "Unknown",
      sessions: set.size,
      streak: streak,
      tier: tierFor(streak)
    });
  });
  members.sort(function (a, b) {
    return (b.sessions - a.sessions) || a.name.localeCompare(b.name);
  });
  return { members: members, wheel: await wheelView(env, names) };
}

function publicView(att) {
  return {
    members: att.members.map(function (m) { return { name: m.name, sessions: m.sessions, tier: m.tier }; }),
    wheel: att.wheel
  };
}

// ---------- wheel and the Thursday count ----------

// The filling round that new names go into. Creates one when none is open.
async function openRound(env, now) {
  var row = await env.FLEXI.prepare("SELECT round FROM training_wheel_rounds WHERE status = 'filling' ORDER BY round DESC LIMIT 1").first();
  var round;
  if (row) {
    round = row.round;
  } else {
    var max = await env.FLEXI.prepare("SELECT COALESCE(MAX(round), 0) AS m FROM training_wheel_rounds").first();
    round = max.m + 1;
    await env.FLEXI.prepare("INSERT INTO training_wheel_rounds (round, status, created_at) VALUES (?1, 'filling', ?2)")
      .bind(round, now.toISOString()).run();
  }
  var cnt = await env.FLEXI.prepare("SELECT COUNT(*) AS n FROM training_wheel_entries WHERE round = ?1").bind(round).first();
  return { round: round, count: cnt.n };
}

// Idempotent. Looks at every consecutive run of attended sessions that has ended before `now`,
// and adds a wheel entry for each 6-session milestone not already on the wheel.
// Check-ins scanned at or after `now` are left for the next run (late Thursday scans).
async function runCount(env, now) {
  await ensureSessions(env, now);
  var cutoff = now.toISOString();
  var sessions = await loadEndedSessions(env, cutoff);
  var checkins = await loadCheckins(env, cutoff);
  var attended = new Map();
  checkins.forEach(function (c) {
    if (!attended.has(c.member_id)) attended.set(c.member_id, new Set());
    attended.get(c.member_id).add(c.session_date);
  });

  var candidates = [];
  attended.forEach(function (set, memberId) {
    buildRuns(sessions, set).forEach(function (run) {
      for (var k = MILESTONE; k <= run.dates.length; k += MILESTONE) {
        candidates.push({ member_id: memberId, run_start: run.start, milestone: k, reached: run.dates[k - 1] });
      }
    });
  });

  var existing = await env.FLEXI.prepare("SELECT member_id, run_start, milestone FROM training_wheel_entries").all();
  var have = new Set(existing.results.map(function (e) { return e.member_id + "|" + e.run_start + "|" + e.milestone; }));
  var fresh = candidates.filter(function (c) {
    return !have.has(c.member_id + "|" + c.run_start + "|" + c.milestone);
  });
  fresh.sort(function (a, b) {
    return (a.reached < b.reached ? -1 : a.reached > b.reached ? 1 : 0) || (a.member_id - b.member_id);
  });

  var open = null;
  for (var i = 0; i < fresh.length; i++) {
    var c = fresh[i];
    if (!open) open = await openRound(env, now);
    var slot = open.count + 1;
    await env.FLEXI.prepare("INSERT INTO training_wheel_entries (round, slot, member_id, run_start, milestone, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(open.round, slot, c.member_id, c.run_start, c.milestone, cutoff).run();
    open.count = slot;
    if (open.count >= WHEEL_SIZE) {
      await env.FLEXI.prepare("UPDATE training_wheel_rounds SET status = 'ready' WHERE round = ?1").bind(open.round).run();
      open = null;
    }
  }
  await setSetting(env, "last_count_run", cutoff);
  return { added: fresh.length };
}

async function spinRound(env, round, now) {
  var r = await env.FLEXI.prepare("SELECT status FROM training_wheel_rounds WHERE round = ?1").bind(round).first();
  if (!r) throw httpError("No such wheel", 404);
  if (r.status !== "ready") throw httpError("This wheel is not full yet", 409);
  var entries = await env.FLEXI.prepare("SELECT member_id FROM training_wheel_entries WHERE round = ?1 ORDER BY slot").bind(round).all();
  if (!entries.results.length) throw httpError("No names on this wheel", 409);
  var buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  var winner = entries.results[buf[0] % entries.results.length].member_id;
  await env.FLEXI.prepare("UPDATE training_wheel_rounds SET status = 'spun', spun_at = ?2, winner_member_id = ?3 WHERE round = ?1 AND status = 'ready'")
    .bind(round, now.toISOString(), winner).run();
  var names = await memberNames(env);
  return { winner_member_id: winner, winner: names.get(winner) || "Unknown" };
}

// ---------- attendance credit (rule lives in shared/training-credit.js) ----------

async function creditView(env, now) {
  var credit = await loadAttendanceCredit(env.FLEXI, now);
  var names = await memberNames(env);
  var settings = await getSettings(env);
  var rows = [];
  credit.forEach(function (state, id) {
    var last = state.weeks.length ? state.weeks[state.weeks.length - 1] : null;
    rows.push({
      name: names.get(id) || "Unknown",
      credit: state.credit,
      credited_chores: state.creditedWeeks.length,
      last_credited_week: state.lastCreditedWeek,
      last_week: last ? { week: last.week, pct: last.pct, accountable: last.accountable } : null
    });
  });
  rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { enabled: !!settings.week_one, week_one: settings.week_one || null, rows: rows };
}

// ---------- admin ----------

function httpError(message, status) {
  var err = new Error(message);
  err.status = status;
  return err;
}
function validYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return !isNaN(Date.parse(value + "T00:00:00Z"));
}

async function handleAdmin(request, env, url, now) {
  var state = passcodeState(request.headers.get("x-admin-passcode") || "", env);
  if (state === "not-set") return json({ error: "ADMIN_PASSCODE is not set on the server" }, 500);
  if (state !== "ok") return json({ error: "Unauthorised" }, 401);

  var path = url.pathname;
  var method = request.method;

  if (method === "GET" && path === "/api/admin/state") {
    var settings = await getSettings(env);
    var attendance = await computeAttendance(env, now);
    var sess = await env.FLEXI.prepare(
      "SELECT s.session_date AS date, COUNT(c.member_id) AS scans FROM training_sessions s LEFT JOIN training_checkins c ON c.session_date = s.session_date GROUP BY s.session_date ORDER BY s.session_date DESC LIMIT 60"
    ).all();
    return json({ settings: settings, attendance: attendance, sessions: sess.results, nextSession: nextSessionDate(now) });
  }

  if (method === "GET" && path === "/api/admin/session") {
    var date = url.searchParams.get("date") || "";
    if (!validYmd(date)) return json({ error: "Bad date" }, 400);
    var rows = await env.FLEXI.prepare("SELECT member_id, scanned_at FROM training_checkins WHERE session_date = ?1 ORDER BY scanned_at")
      .bind(date).all();
    var names = await memberNames(env);
    return json({
      date: date,
      checkins: rows.results.map(function (r) {
        return { member_id: r.member_id, name: names.get(r.member_id) || "Unknown", scanned_at: r.scanned_at };
      })
    });
  }

  if (method === "POST" && path === "/api/admin/remove-checkin") {
    var body = await request.json().catch(function () { return {}; });
    if (!validYmd(body.date) || !Number.isInteger(body.member_id)) return json({ error: "Bad request" }, 400);
    await env.FLEXI.prepare("DELETE FROM training_checkins WHERE session_date = ?1 AND member_id = ?2")
      .bind(body.date, body.member_id).run();
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/admin/settings") {
    var b = await request.json().catch(function () { return {}; });
    if (b.season_start !== undefined) {
      if (!validYmd(b.season_start)) return json({ error: "Season start must be a date" }, 400);
      await setSetting(env, "season_start", b.season_start);
    }
    if (b.week_one !== undefined) {
      if (b.week_one === "") {
        await setSetting(env, "week_one", "");
      } else {
        if (!validYmd(b.week_one)) return json({ error: "Week one must be a date" }, 400);
        await setSetting(env, "week_one", b.week_one);
      }
    }
    return json({ ok: true, settings: await getSettings(env) });
  }

  if (method === "POST" && path === "/api/admin/run-count") {
    var result = await runCount(env, now);
    return json({ ok: true, added: result.added });
  }

  if (method === "POST" && path === "/api/admin/spin") {
    var sb = await request.json().catch(function () { return {}; });
    if (!Number.isInteger(sb.round)) return json({ error: "Bad round" }, 400);
    return json({ ok: true, result: await spinRound(env, sb.round, now) });
  }

  if (method === "GET" && path === "/api/admin/credit") {
    return json(await creditView(env, now));
  }

  return json({ error: "Not found" }, 404);
}

// ---------- entry point ----------

export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env);
      var url = new URL(request.url);
      var path = url.pathname;
      var method = request.method;
      var now = new Date();

      if (method === "GET" && (path === "/" || path === "/scan")) return page(SCAN_PAGE);
      if (method === "GET" && path === "/attendance") return page(WALL_PAGE);
      if (method === "GET" && path === "/admin") return page(ADMIN_PAGE);
      if (method === "GET" && path === "/api/attendance") return json(publicView(await computeAttendance(env, now)));
      if (method === "POST" && path === "/api/scan") return handleScan(request, env, now);
      if (method === "POST" && path === "/api/absence") return handleAbsence(request, env, now);
      if (path.indexOf("/api/admin/") === 0) return handleAdmin(request, env, url, now);
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500);
    }
  },

  async scheduled(event, env) {
    await ensureSchema(env);
    await runCount(env, new Date());
  }
};
