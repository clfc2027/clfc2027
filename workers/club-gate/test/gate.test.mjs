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

function req(path, { method = "GET", form, cookie, ip } = {}) {
  const headers = { "CF-Connecting-IP": ip || `10.1.0.${++ipN}` };
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  }
  return new Request("https://cockburnlakes.com" + path, init);
}

async function signedInCookie() {
  return `clfc_session=${await makeSessionToken(SECRET)}`;
}

test("signed-out visitors get the PIN page with the request-PIN button, on every path", async () => {
  const { env } = newEnv();
  for (const p of ["/", "/fines", "/league", "/app.js"]) {
    const r = await worker.fetch(req(p), env);
    assert.equal(r.status, 401);
    const html = await r.text();
    assert.match(html, /Members only/);
    assert.match(html, /sms:\+61451612744\?body=CLFC%20pin%20request%20-%20/);
    assert.match(html, /Request your PIN with your name/);
  }
});

test("sign-in form posts the PIN to /gate/login without a script", async () => {
  const { env } = newEnv();
  const html = await (await worker.fetch(req("/"), env)).text();
  assert.match(html, /<form id="form" method="post" action="\/gate\/login"/);
  assert.match(html, /<input id="pin" name="pin"/);
  assert.doesNotMatch(html, /<script>/);
});

test("signed-out API calls get JSON, not the page", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/fines/api/fines"), env);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).ok, false);
});

test("wrong PIN is refused on the page and five misses lock that IP", async () => {
  const { env } = newEnv();
  const ip = "192.0.2.77";
  for (let i = 0; i < 5; i++) {
    const r = await worker.fetch(req("/gate/login", { method: "POST", form: { pin: "9999" }, ip }), env);
    assert.equal(r.status, 401);
    assert.match(await r.text(), /PIN not recognised/);
  }
  const locked = await worker.fetch(req("/gate/login", { method: "POST", form: { pin: "1111" }, ip }), env);
  assert.equal(locked.status, 429);
  assert.match(await locked.text(), /Too many wrong PINs/);
});

test("correct PIN sets a secure 30-day cookie and redirects to the welcome page", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/gate/login", { method: "POST", form: { pin: "1111" } }), env);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "/gate/welcome");
  const cookie = r.headers.get("Set-Cookie");
  assert.match(cookie, /^clfc_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=2592000/);
});

test("the cookie from a correct PIN lets the member straight into the hub", async () => {
  const { env } = newEnv();
  const login = await worker.fetch(req("/gate/login", { method: "POST", form: { pin: "1111" } }), env);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const r = await worker.fetch(req("/", { cookie }), env);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "HUB:/");
});

test("welcome page is public and sends the member on to the hub", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/gate/welcome"), env);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /You are in/);
  assert.match(html, /content="2;url=\/"/);
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
  assert.equal(targetBinding("/training"), "TRAINING");
  assert.equal(targetBinding("/training/api/board"), "TRAINING");
  assert.equal(targetBinding("/trainingx"), "HUB");
  assert.equal(targetBinding("/"), "HUB");
});

test("gate artwork is public and served as a JPEG", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/gate/hero.jpg"), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "image/jpeg");
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
});

test("confirmation image is public and served as a JPEG", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/gate/confirm.jpg"), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "image/jpeg");
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
});

test("install files are public and come from the hub's static assets", async () => {
  const { env, seen } = newEnv();
  for (const p of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/icon-512.png"]) {
    const r = await worker.fetch(req(p), env);
    assert.equal(r.status, 200, p);
    assert.equal(await r.text(), `HUB:${p}`);
  }
  assert.deepEqual(seen, ["HUB", "HUB", "HUB", "HUB"]);
});

test("sign-in page links the app manifest and icons", async () => {
  const { env } = newEnv();
  const r = await worker.fetch(req("/"), env);
  const html = await r.text();
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
});

test("other hub files stay behind the gate", async () => {
  const { env } = newEnv();
  for (const p of ["/manifest.json", "/install.js", "/app.js"]) {
    const r = await worker.fetch(req(p), env);
    assert.equal(r.status, 401, p);
  }
});
