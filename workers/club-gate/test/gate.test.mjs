// Run from the repo root: node --test workers/club-gate/test/gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { targetBinding, makeSessionToken, sessionValid } from "../worker.js";

function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const api = {
        bind(...p) { params = p; return api; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { const i = stmt.run(...params); return { meta: { changes: Number(i.changes) } }; },
      };
      return api;
    },
  };
}

const SECRET = "test-secret-not-real";
let ipN = 0;

function newEnv() {
  const members = new DatabaseSync(":memory:");
  members.exec(`CREATE TABLE member_directory (id INTEGER PRIMARY KEY, pin TEXT)`);
  members.prepare(`INSERT INTO member_directory VALUES (1, '1111')`).run();
  const seen = [];
  const svc = (name) => ({ fetch: async (req) => { seen.push(name); return new Response(`${name}:${new URL(req.url).pathname}`); } });
  return {
    seen,
    env: {
      DB: makeD1(members),
      FLEXI: makeD1(new DatabaseSync(":memory:")),
      SESSION_SECRET: SECRET,
      HUB: svc("HUB"), FINES: svc("FINES"), GAMEDAY: svc("GAMEDAY"), COACHES: svc("COACHES"),
      PLAYERS: svc("PLAYERS"), FGK: svc("FGK"), ADMIN: svc("ADMIN"),
    },
  };
}

function req(path, { method = "GET", body, cookie, ip } = {}) {
  const headers = { "CF-Connecting-IP": ip || `10.1.0.${++ipN}` };
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  return new Request("https://cockburnlakes.com" + path, init);
}

async function signedInCookie() {
  return `clfc_session=${await makeSessionToken(SECRET)}`;
}

test("signed-out visitors get the PIN page with the request-PIN link, on every path", async () => {
  const { env } = newEnv();
  for (const p of ["/", "/fines", "/league", "/app.js"]) {
    const r = await worker.fetch(req(p), env);
    assert.equal(r.status, 401);
    const html = await r.text();
    assert.match(html, /Members only/);
    assert.match(html, /sms:\+61451612744\?body=CLFC%20pin%20request%20-%20/);
  }
});

test("signed-out API calls get JSON, not the page", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/fines/api/fines"), env);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).ok, false);
});

test("wrong PIN is refused and five misses lock that IP", async () => {
  const { env } = newEnv();
  const ip = "192.0.2.77";
  for (let i = 0; i < 5; i++) {
    const r = await worker.fetch(req("/gate/login", { method: "POST", body: { pin: "9999" }, ip }), env);
    assert.equal(r.status, 401);
  }
  const locked = await worker.fetch(req("/gate/login", { method: "POST", body: { pin: "1111" }, ip }), env);
  assert.equal(locked.status, 429);
});

test("correct PIN sets a secure, HttpOnly, 30-day cookie", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/gate/login", { method: "POST", body: { pin: "1111" } }), env);
  assert.equal(r.status, 200);
  const cookie = r.headers.get("Set-Cookie");
  assert.match(cookie, /^clfc_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=2592000/);
});

test("signed-in members reach each tool through the right service", async () => {
  const { env, seen } = newEnv();
  const cookie = await signedInCookie();
  const cases = [
    ["/", "HUB"], ["/app.js", "HUB"], ["/fines", "FINES"], ["/fines/api/fines", "FINES"],
    ["/league", "GAMEDAY"], ["/colts", "GAMEDAY"], ["/reserves/x", "GAMEDAY"], ["/thirds", "GAMEDAY"],
    ["/coaches/api/grades", "COACHES"], ["/players", "PLAYERS"], ["/fgk/api/grades", "FGK"],
  ];
  for (const [path, name] of cases) {
    const r = await worker.fetch(req(path, { cookie }), env);
    assert.equal(r.status, 200, path);
    assert.equal(await r.text(), `${name}:${path}`);
  }
  assert.equal(seen.length, cases.length);
});

test("admin is reachable without a member session", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/admin/api/teams"), env);
  assert.equal(await r.text(), "ADMIN:/admin/api/teams");
});

test("tampered, expired and malformed cookies are refused", async () => {
  const { env } = newEnv();
  const good = await makeSessionToken(SECRET);
  const [exp, sig] = good.split(".");
  const tampered = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
  const expired = await makeSessionToken(SECRET, Date.now() - 60 * 24 * 60 * 60 * 1000);
  const wrongSecret = await makeSessionToken("some-other-secret");
  for (const c of [tampered, expired, wrongSecret, "garbage"]) {
    const r = await worker.fetch(req("/fines", { cookie: `clfc_session=${c}` }), env);
    assert.equal(r.status, 401, c);
  }
});

test("sessions stop being valid after 30 days", async () => {
  const token = await makeSessionToken(SECRET, Date.now() - 31 * 24 * 60 * 60 * 1000);
  assert.equal(await sessionValid(SECRET, token), false);
  assert.equal(await sessionValid(SECRET, await makeSessionToken(SECRET)), true);
});

test("path to service mapping is exact on tool prefixes", () => {
  assert.equal(targetBinding("/fines"), "FINES");
  assert.equal(targetBinding("/finesx"), "HUB");
  assert.equal(targetBinding("/league"), "GAMEDAY");
  assert.equal(targetBinding("/leaguex"), "HUB");
  assert.equal(targetBinding("/"), "HUB");
});
