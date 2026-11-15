// club-gate Worker: every page on cockburnlakes.com sits behind a member PIN.
//
// D1 binding DB    -> playhq-warriors (member_directory: PIN check only)
// D1 binding FLEXI -> clfc2026-flexi (gate_pin_attempts: lockout table)
// Service bindings -> HUB (clfc2027), FINES, GAMEDAY, COACHES, PLAYERS, FGK, ADMIN
// Secret SESSION_SECRET (dashboard, never in the repo) signs the session cookie.
//
// Session: a 30-day signed cookie, set after a correct member PIN.
// ADMIN is outside the gate: it has its own passcode.

import { heroBytes } from "./hero.js";
import { confirmBytes } from "./confirm.js";

const COOKIE = "clfc_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_REQUEST_SMS = "sms:+61451612744?body=CLFC%20pin%20request%20-%20";

// Tool prefixes (on the club domain) and the service that serves each.
// Everything else goes to the hub.
const TOOLS = [
  { prefix: "/fines", binding: "FINES" },
  { prefix: "/fgk", binding: "FGK" },
  { prefix: "/players", binding: "PLAYERS" },
  { prefix: "/coaches", binding: "COACHES" },
  { prefix: "/league", binding: "GAMEDAY" },
  { prefix: "/colts", binding: "GAMEDAY" },
  { prefix: "/reserves", binding: "GAMEDAY" },
  { prefix: "/thirds", binding: "GAMEDAY" },
];

export function targetBinding(pathname) {
  for (const t of TOOLS) {
    if (pathname === t.prefix || pathname.startsWith(t.prefix + "/")) return t.binding;
  }
  return "HUB";
}

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSessionToken(secret, now = Date.now()) {
  const exp = String(now + SESSION_MS);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function sessionValid(secret, token, now = Date.now()) {
  if (!secret || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) <= now) return false;
  return constantTimeEqual(sig, await hmacHex(secret, exp));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function gatePage(message = "") {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Members | Cockburn Lakes FC</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #14213d; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d1d1f; padding: 16px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 12px; padding: 24px; width: 100%; max-width: 360px; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  h1 { margin: 0 0 6px; font-size: 1.3rem; color: #14213d; }
  p { margin: 0 0 14px; color: #5b6270; font-size: .95rem; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  input { width: 100%; font: inherit; font-size: 1.2rem; letter-spacing: 6px; text-align: center; padding: 10px; border: 1px solid #c9ced8; border-radius: 8px; box-sizing: border-box; }
  button { width: 100%; margin-top: 14px; background: #14213d; color: #fff; border: 0; border-radius: 8px; padding: 12px; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; }
  .msg { min-height: 1.2em; margin-top: 10px; color: #b42318; font-weight: 600; font-size: .95rem; }
  .hero { display: block; width: 100%; height: auto; border-radius: 8px; margin: -8px 0 14px; }
  .request-hint { margin: 22px 0 0; padding-top: 16px; border-top: 1px solid #e3e6ec; text-align: center; }
  .request-btn { display: block; box-sizing: border-box; width: 100%; margin-top: 10px; background: #fff; color: #14213d; border: 2px solid #14213d; border-radius: 8px; padding: 12px; font: inherit; font-weight: 700; text-align: center; text-decoration: none; }
</style>
</head>
<body>
<main class="card">
  <img class="hero" src="/gate/hero.jpg?v=2" alt="Cockburn Lakes FC">
  <h1>Members only</h1>
  <p>Enter your 4-digit PIN to open the club hub.</p>
  <form id="form" autocomplete="off">
    <label for="pin">Your PIN</label>
    <input id="pin" type="tel" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required>
    <button id="submit" type="submit">Enter</button>
    <div class="msg" id="msg" role="status">${message}</div>
  </form>
  <p class="request-hint">Don't have a PIN yet?</p>
  <a class="request-btn" href="${PIN_REQUEST_SMS}">Request your PIN with your name</a>
</main>
<script>
(function () {
  var form = document.getElementById("form");
  var msg = document.getElementById("msg");
  var btn = document.getElementById("submit");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.textContent = "";
    var pin = document.getElementById("pin").value.replace(/[^0-9]/g, "");
    if (!/^[0-9]{4}$/.test(pin)) { msg.textContent = "Enter your 4-digit PIN."; return; }
    btn.disabled = true;
    fetch("/gate/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pin }),
      credentials: "same-origin"
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          document.querySelector("main.card").innerHTML = '<img class="hero" src="/gate/confirm.jpg?v=1" alt=""><h1>You\'re in</h1><p>Opening the club hub...</p>';
          setTimeout(function () { location.reload(); }, 2000);
          return;
        }
        msg.textContent = res.d.error || "Something went wrong. Try again.";
        btn.disabled = false;
      })
      .catch(function () {
        msg.textContent = "Could not reach the club hub. Try again.";
        btn.disabled = false;
      });
  });
})();
</script>
</body>
</html>`;
}

async function assertNotLocked(flexi, ip) {
  const row = await flexi.prepare(`SELECT fails, window_start FROM gate_pin_attempts WHERE ip = ?1`).bind(ip).first();
  if (!row) return;
  const inWindow = Date.now() - Date.parse(row.window_start) < PIN_LOCK_MS;
  if (inWindow && row.fails >= PIN_MAX_FAILS) {
    const err = new Error("Too many wrong PINs. Try again in 15 minutes.");
    err.status = 429;
    throw err;
  }
}

async function recordFailure(flexi, ip) {
  const row = await flexi.prepare(`SELECT fails, window_start FROM gate_pin_attempts WHERE ip = ?1`).bind(ip).first();
  const now = Date.now();
  const inWindow = !!row && now - Date.parse(row.window_start) < PIN_LOCK_MS;
  const fails = inWindow ? row.fails + 1 : 1;
  const start = inWindow ? row.window_start : new Date(now).toISOString();
  await flexi
    .prepare(
      `INSERT INTO gate_pin_attempts (ip, fails, window_start) VALUES (?1, ?2, ?3)
         ON CONFLICT (ip) DO UPDATE SET fails = ?2, window_start = ?3`
    )
    .bind(ip, fails, start)
    .run();
}

async function ensureSchema(flexi) {
  await flexi
    .prepare(`CREATE TABLE IF NOT EXISTS gate_pin_attempts (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL, window_start TEXT NOT NULL)`)
    .run();
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{4}$/.test(pin)) return json({ ok: false, error: "Enter your 4-digit PIN." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await ensureSchema(env.FLEXI);
  await assertNotLocked(env.FLEXI, ip);
  const member = await env.DB.prepare(`SELECT id FROM member_directory WHERE pin = ?1`).bind(pin).first();
  if (!member) {
    await recordFailure(env.FLEXI, ip);
    return json({ ok: false, error: "PIN not recognised. Request your PIN below if you don't have one." }, 401);
  }
  await env.FLEXI.prepare(`DELETE FROM gate_pin_attempts WHERE ip = ?1`).bind(ip).run();
  const token = await makeSessionToken(env.SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_MS / 1000) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Gate artwork is public: it is the picture on the sign-in page itself.
    if (path === "/gate/confirm.jpg") {
      return new Response(confirmBytes(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
    }
    if (path === "/gate/hero.jpg") {
      return new Response(heroBytes(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
    }

    // Admin keeps its own passcode and sits outside the member gate.
    if (path === "/admin" || path.startsWith("/admin/")) {
      return env.ADMIN.fetch(request);
    }

    if (path === "/gate/login" && request.method === "POST") {
      try {
        return await login(request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "Server error" }, err.status || 500);
      }
    }
    if (path === "/gate/logout" && request.method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }

    const token = readCookie(request, COOKIE);
    const signedIn = await sessionValid(env.SESSION_SECRET, token);
    if (!signedIn) {
      if (path.includes("/api/")) return json({ ok: false, error: "Members only. Enter your PIN." }, 401);
      return new Response(gatePage(), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }

    return env[targetBinding(path)].fetch(request);
  },
};
