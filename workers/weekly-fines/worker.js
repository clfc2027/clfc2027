// weekly-fines Worker: public weekly fine nominations, tallied per name.
//
// D1 binding DB    -> playhq-warriors (member_directory, read only: PIN check)
// D1 binding FLEXI -> clfc2026-flexi (weekly_fines, fines_pin_attempts; shared with coaches-board)
// Secret ADMIN_PASSCODE (dashboard, never in the repo)
//
// Public:  GET /, GET /nominate, GET /admin, GET /wallpaper-fine, GET /api/fines, POST /api/fines
// Admin:   POST /api/admin/fines (list, nominator names shown), POST /api/admin/fines/:id/paid,
//          POST /api/admin/fines/:id/reopen, POST /api/admin/fines/:id/delete
//
// Rules: $2 per fine. One nomination per member per week (weeks start Monday, Perth time).
// A nominator's identity is stored as playhq_player_id and never returned by any public route.

import { passcodeState } from "../../shared/auth.js";
import { INDEX_HTML, NOMINATE_HTML, ADMIN_HTML } from "./pages.js";

export const FINE_CENTS = 200;
export const MAX_WORDS = 49; // "less than 50 words"
const MAX_REASON_CHARS = 400;
const MAX_NAME_CHARS = 60;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

// ---------- helpers ----------

export function perthDate(date = new Date()) {
  return new Date(date.getTime() + PERTH_OFFSET_MS).toISOString().slice(0, 10);
}

// Monday of the Perth week containing `date`, as YYYY-MM-DD.
export function perthWeekStart(date = new Date()) {
  const p = new Date(date.getTime() + PERTH_OFFSET_MS);
  const daysSinceMonday = (p.getUTCDay() + 6) % 7;
  p.setUTCDate(p.getUTCDate() - daysSinceMonday);
  return p.toISOString().slice(0, 10);
}

export function cleanName(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function cleanReason(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch (e) {
    return {};
  }
}

// ---------- schema (created on first use, as the coaches board does) ----------

// Remembered per binding object, so a fresh database always gets its tables.
const schemaReady = new WeakSet();

async function ensureSchema(flexi) {
  if (schemaReady.has(flexi)) return;
  await flexi
    .prepare(
      `CREATE TABLE IF NOT EXISTS weekly_fines (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         target_name TEXT NOT NULL,
         target_key TEXT NOT NULL,
         reason TEXT NOT NULL,
         amount_cents INTEGER NOT NULL DEFAULT 200,
         nominated_by TEXT NOT NULL,
         week_start TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
         created_at TEXT NOT NULL,
         paid_at TEXT
       )`
    )
    .run();
  await flexi
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_fines_one_per_week
         ON weekly_fines (nominated_by, week_start)`
    )
    .run();
  await flexi
    .prepare(`CREATE INDEX IF NOT EXISTS idx_weekly_fines_open ON weekly_fines (status, target_key)`)
    .run();
  await flexi
    .prepare(
      `CREATE TABLE IF NOT EXISTS fines_pin_attempts (
         ip TEXT PRIMARY KEY,
         fails INTEGER NOT NULL,
         window_start TEXT NOT NULL
       )`
    )
    .run();
  schemaReady.add(flexi);
}

// ---------- PIN check with per-IP lockout ----------

async function assertNotLocked(flexi, ip) {
  const row = await flexi
    .prepare(`SELECT fails, window_start FROM fines_pin_attempts WHERE ip = ?1`)
    .bind(ip)
    .first();
  if (!row) return;
  const inWindow = Date.now() - Date.parse(row.window_start) < PIN_LOCK_MS;
  if (inWindow && row.fails >= PIN_MAX_FAILS) {
    const err = new Error("Too many wrong PINs. Try again in 15 minutes.");
    err.status = 429;
    throw err;
  }
}

async function recordFailure(flexi, ip) {
  const row = await flexi
    .prepare(`SELECT fails, window_start FROM fines_pin_attempts WHERE ip = ?1`)
    .bind(ip)
    .first();
  const now = Date.now();
  const inWindow = !!row && now - Date.parse(row.window_start) < PIN_LOCK_MS;
  const fails = inWindow ? row.fails + 1 : 1;
  const start = inWindow ? row.window_start : new Date(now).toISOString();
  await flexi
    .prepare(
      `INSERT INTO fines_pin_attempts (ip, fails, window_start) VALUES (?1, ?2, ?3)
         ON CONFLICT (ip) DO UPDATE SET fails = ?2, window_start = ?3`
    )
    .bind(ip, fails, start)
    .run();
}

async function findMemberByPin(env, ip, pin) {
  await assertNotLocked(env.FLEXI, ip);
  const member = await env.DB.prepare(
    `SELECT id, first_name, last_name, playhq_player_id FROM member_directory WHERE pin = ?1`
  )
    .bind(pin)
    .first();
  if (!member) {
    await recordFailure(env.FLEXI, ip);
    const err = new Error("PIN not recognised.");
    err.status = 401;
    throw err;
  }
  await env.FLEXI.prepare(`DELETE FROM fines_pin_attempts WHERE ip = ?1`).bind(ip).run();
  return member;
}

// ---------- public ----------

async function listOpenFines(flexi) {
  const { results } = await flexi
    .prepare(
      `SELECT target_name, target_key, reason, created_at
         FROM weekly_fines WHERE status = 'open'
         ORDER BY created_at ASC`
    )
    .all();
  const people = new Map();
  for (const row of results) {
    if (!people.has(row.target_key)) {
      people.set(row.target_key, { name: row.target_name, owed_cents: 0, count: 0, fines: [] });
    }
    const p = people.get(row.target_key);
    p.owed_cents += FINE_CENTS;
    p.count += 1;
    p.fines.push({ reason: row.reason, date: perthDate(new Date(row.created_at)) });
  }
  const list = [...people.values()].sort(
    (a, b) => b.owed_cents - a.owed_cents || a.name.localeCompare(b.name)
  );
  const total_cents = list.reduce((sum, p) => sum + p.owed_cents, 0);
  return { ok: true, fine_cents: FINE_CENTS, total_cents, people: list };
}

async function nominate(request, env) {
  const body = await readJson(request);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{4}$/.test(pin)) return fail("Enter your 4-digit PIN.");

  await ensureSchema(env.FLEXI);
  const member = await findMemberByPin(env, ip, pin);
  if (!member.playhq_player_id) {
    return fail("Your profile is not linked to PlayHQ yet. Ask the club admin to fix this before nominating.", 409);
  }

  const name = cleanName(body.target_name);
  if (name.length < 2) return fail("Enter the name of the person being fined.");
  if (name.length > MAX_NAME_CHARS) return fail(`Keep the name under ${MAX_NAME_CHARS} characters.`);

  const reason = cleanReason(body.reason);
  if (!reason) return fail("Write a reason for the fine.");
  if (reason.length > MAX_REASON_CHARS) return fail("That reason is too long.");
  const words = countWords(reason);
  if (words > MAX_WORDS) return fail(`Keep the reason to ${MAX_WORDS} words or fewer (you have ${words}).`);

  const now = new Date().toISOString();
  const weekStart = perthWeekStart(new Date(now));
  try {
    await env.FLEXI.prepare(
      `INSERT INTO weekly_fines
         (target_name, target_key, reason, amount_cents, nominated_by, week_start, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7)`
    )
      .bind(name, name.toLowerCase(), reason, FINE_CENTS, member.playhq_player_id, weekStart, now)
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) {
      return fail(`You have already nominated someone this week (week starting ${weekStart}, Perth time).`, 409);
    }
    throw err;
  }

  const tally = await env.FLEXI.prepare(
    `SELECT COUNT(*) AS n FROM weekly_fines WHERE status = 'open' AND target_key = ?1`
  )
    .bind(name.toLowerCase())
    .first();
  return json({
    ok: true,
    message: `Nomination recorded. The fine total for this name is now $${(tally.n * FINE_CENTS) / 100}.`,
  });
}

// ---------- admin ----------

function checkAdmin(env, body) {
  const state = passcodeState(body.adminPin, env);
  if (state === "not-set") {
    const err = new Error("Admin passcode is not set up on the server.");
    err.status = 500;
    throw err;
  }
  if (state === "wrong") {
    const err = new Error("Incorrect admin passcode.");
    err.status = 401;
    throw err;
  }
}

async function adminList(env) {
  await ensureSchema(env.FLEXI);
  const { results: members } = await env.DB.prepare(
    `SELECT playhq_player_id, first_name, last_name FROM member_directory WHERE playhq_player_id IS NOT NULL`
  ).all();
  const nominatorName = new Map(
    members.map((m) => [m.playhq_player_id, `${m.first_name} ${m.last_name}`.trim()])
  );
  const { results } = await env.FLEXI.prepare(
    `SELECT id, target_name, reason, nominated_by, week_start, status, created_at, paid_at
       FROM weekly_fines ORDER BY created_at DESC`
  ).all();
  return {
    ok: true,
    fines: results.map((r) => ({
      id: r.id,
      target_name: r.target_name,
      reason: r.reason,
      nominator: nominatorName.get(r.nominated_by) || "(unknown member)",
      week_start: r.week_start,
      status: r.status,
      created_at: r.created_at,
      paid_at: r.paid_at,
    })),
  };
}

async function adminChangeFine(env, id, action) {
  await ensureSchema(env.FLEXI);
  let sql;
  if (action === "paid") {
    sql = `UPDATE weekly_fines SET status = 'paid', paid_at = ?2 WHERE id = ?1 AND status = 'open'`;
  } else if (action === "reopen") {
    sql = `UPDATE weekly_fines SET status = 'open', paid_at = NULL WHERE id = ?1 AND status = 'paid'`;
  } else {
    sql = `DELETE FROM weekly_fines WHERE id = ?1`;
  }
  const stmt = env.FLEXI.prepare(sql);
  const bound = action === "paid" ? stmt.bind(id, new Date().toISOString()) : stmt.bind(id);
  const res = await bound.run();
  const changes = res && res.meta ? res.meta.changes : 0;
  if (!changes) {
    const err = new Error("No matching fine to change (it may already be in that state).");
    err.status = 409;
    throw err;
  }
  return { ok: true };
}

// ---------- routing ----------

const ADMIN_ACTION = /^\/api\/admin\/fines\/(\d+)\/(paid|reopen|delete)$/;

function page(request, html) {
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

// Serves an object from R2 (used for the wallpaper).
async function serveR2(bucket, key, cacheControl) {
  if (!bucket) return new Response("Not found", { status: 404 });
  const obj = await bucket.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg";
  return new Response(obj.body, { headers: { "Content-Type": type, "Cache-Control": cacheControl } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Served at /fines on the club domain and at the workers.dev root; both map to the same routes.
    const pathname = url.pathname.replace(/^\/fines(?=\/|$)/, "") || "/";
    const method = request.method;

    try {
      if ((method === "GET" || method === "HEAD") && pathname === "/") {
        return page(request, INDEX_HTML);
      }
      if ((method === "GET" || method === "HEAD") && pathname === "/nominate") {
        return page(request, NOMINATE_HTML);
      }
      if ((method === "GET" || method === "HEAD") && pathname === "/admin") {
        return page(request, ADMIN_HTML);
      }
      if ((method === "GET" || method === "HEAD") && pathname === "/wallpaper-fine") {
        return serveR2(env.CLFC_ASSETS, "wallpaper-fine.jpg", "public, max-age=3600");
      }

      if (pathname === "/api/fines" && method === "GET") {
        await ensureSchema(env.FLEXI);
        // Public, read-only totals: the club hub reads this from another origin.
        return json(await listOpenFines(env.FLEXI), 200, { "Access-Control-Allow-Origin": "*" });
      }
      if (pathname === "/api/fines" && method === "POST") {
        return await nominate(request, env);
      }

      if (pathname === "/api/admin/fines" && method === "POST") {
        const body = await readJson(request);
        checkAdmin(env, body);
        return json(await adminList(env));
      }
      const action = pathname.match(ADMIN_ACTION);
      if (action && method === "POST") {
        const body = await readJson(request);
        checkAdmin(env, body);
        return json(await adminChangeFine(env, Number(action[1]), action[2]));
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (err) {
      return json({ ok: false, error: err.message || "Server error" }, err.status || 500);
    }
  },
};
