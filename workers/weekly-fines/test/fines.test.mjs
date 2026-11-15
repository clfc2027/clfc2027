// Run from the repo root: node --test workers/weekly-fines/test
// Uses node:sqlite as a stand-in for D1 so the Worker's real SQL runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { perthWeekStart, countWords } from "../worker.js";

function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const api = {
        bind(...p) {
          params = p;
          return api;
        },
        async first() {
          return stmt.get(...params) ?? null;
        },
        async all() {
          return { results: stmt.all(...params) };
        },
        async run() {
          const info = stmt.run(...params);
          return { meta: { changes: Number(info.changes) } };
        },
      };
      return api;
    },
  };
}

const MEMBERS = [
  { id: 1, first_name: "Gav", last_name: "Caporn", pin: "1111", playhq_player_id: "PH-GAV" },
  { id: 2, first_name: "Mick", last_name: "Jones", pin: "2222", playhq_player_id: "PH-MICK" },
  { id: 3, first_name: "Tom", last_name: "Smith", pin: "3333", playhq_player_id: "PH-TOM" },
  { id: 4, first_name: "No", last_name: "Link", pin: "4444", playhq_player_id: null },
];

function newEnv({ passcode = "letmein" } = {}) {
  const dbMembers = new DatabaseSync(":memory:");
  dbMembers.exec(
    `CREATE TABLE member_directory (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, pin TEXT, playhq_player_id TEXT)`
  );
  const ins = dbMembers.prepare(`INSERT INTO member_directory VALUES (?, ?, ?, ?, ?)`);
  MEMBERS.forEach((m) => ins.run(m.id, m.first_name, m.last_name, m.pin, m.playhq_player_id));
  const env = {
    DB: makeD1(dbMembers),
    FLEXI: makeD1(new DatabaseSync(":memory:")),
  };
  if (passcode) env.ADMIN_PASSCODE = passcode;
  return env;
}

let ipCounter = 0;
function call(env, method, path, body, ip) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip || `10.0.0.${++ipCounter}` };
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(`https://weekly-fines.test${path}`, init), env);
}

const nominate = (env, pin, target_name, reason, ip) =>
  call(env, "POST", "/api/fines", { pin, target_name, reason }, ip);
const publicList = async (env) => (await call(env, "GET", "/api/fines")).json();
const adminList = (env, adminPin = "letmein") => call(env, "POST", "/api/admin/fines", { adminPin });

const fiftyWords = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
const fortyNineWords = Array.from({ length: 49 }, (_, i) => `w${i}`).join(" ");

test("two different members nominating Sean gives $4 for Sean", async () => {
  const env = newEnv();
  const a = await nominate(env, "1111", "Sean", "Late to training");
  const b = await nominate(env, "2222", "Sean", "Forgot the oranges");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const list = await publicList(env);
  assert.equal(list.total_cents, 400);
  assert.equal(list.people.length, 1);
  assert.equal(list.people[0].name, "Sean");
  assert.equal(list.people[0].owed_cents, 400);
  assert.equal(list.people[0].count, 2);
});

test("names group regardless of case and extra spaces", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "One");
  await nominate(env, "2222", "  sean   ", "Two");
  const list = await publicList(env);
  assert.equal(list.people.length, 1);
  assert.equal(list.people[0].owed_cents, 400);
});

test("a member can nominate only once per Perth week", async () => {
  const env = newEnv();
  assert.equal((await nominate(env, "1111", "Sean", "First")).status, 200);
  const second = await nominate(env, "1111", "Tom", "Second");
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /already nominated/);
});

test("reasons of 49 words pass and 50 words fail", async () => {
  const env = newEnv();
  assert.equal((await nominate(env, "1111", "Sean", fortyNineWords)).status, 200);
  const over = await nominate(env, "2222", "Sean", fiftyWords);
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /49 words or fewer/);
});

test("public list never exposes the nominator or their PIN", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "Reason text here");
  const raw = await (await call(env, "GET", "/api/fines")).text();
  assert.ok(!raw.includes("PH-GAV"), "playhq id leaked");
  assert.ok(!raw.includes("1111"), "PIN leaked");
  assert.ok(!raw.includes("Gav"), "nominator name leaked");
  assert.ok(!raw.includes("nominated_by"), "nominator column leaked");
});

test("a member with no PlayHQ id is refused, not recorded anonymously", async () => {
  const env = newEnv();
  const res = await nominate(env, "4444", "Sean", "Reason");
  assert.equal(res.status, 409);
  assert.equal((await publicList(env)).total_cents, 0);
});

test("wrong PIN is rejected and five misses lock the PIN for everyone from that IP", async () => {
  const env = newEnv();
  const ip = "192.0.2.50";
  for (let i = 0; i < 5; i++) {
    assert.equal((await nominate(env, "9999", "Sean", "x", ip)).status, 401);
  }
  const locked = await nominate(env, "1111", "Sean", "Correct PIN, locked IP", ip);
  assert.equal(locked.status, 429);
  assert.equal((await publicList(env)).total_cents, 0);
});

test("short name and empty reason are refused", async () => {
  const env = newEnv();
  assert.equal((await nominate(env, "1111", "S", "Reason")).status, 400);
  assert.equal((await nominate(env, "2222", "Sean", "   ")).status, 400);
});

test("admin marks a fine paid, it leaves the public list, and the admin keeps the record", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "Paid later");
  const admin = await (await adminList(env)).json();
  assert.equal(admin.fines.length, 1);
  assert.equal(admin.fines[0].nominator, "Gav Caporn");
  const id = admin.fines[0].id;

  const paid = await call(env, "POST", `/api/admin/fines/${id}/paid`, { adminPin: "letmein" });
  assert.equal(paid.status, 200);
  assert.equal((await publicList(env)).total_cents, 0);
  const after = await (await adminList(env)).json();
  assert.equal(after.fines[0].status, "paid");
  assert.ok(after.fines[0].paid_at);

  const again = await call(env, "POST", `/api/admin/fines/${id}/paid`, { adminPin: "letmein" });
  assert.equal(again.status, 409);

  const reopen = await call(env, "POST", `/api/admin/fines/${id}/reopen`, { adminPin: "letmein" });
  assert.equal(reopen.status, 200);
  assert.equal((await publicList(env)).total_cents, 200);
});

test("paying one of two fines for the same name leaves $2 owed", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "First");
  await nominate(env, "2222", "Sean", "Second");
  const ids = (await (await adminList(env)).json()).fines.map((f) => f.id);
  await call(env, "POST", `/api/admin/fines/${ids[0]}/paid`, { adminPin: "letmein" });
  const list = await publicList(env);
  assert.equal(list.people[0].owed_cents, 200);
});

test("admin delete frees that member's weekly slot", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "Mistake");
  const id = (await (await adminList(env)).json()).fines[0].id;
  const del = await call(env, "POST", `/api/admin/fines/${id}/delete`, { adminPin: "letmein" });
  assert.equal(del.status, 200);
  assert.equal((await nominate(env, "1111", "Tom", "Try again")).status, 200);
});

test("admin endpoints refuse a wrong passcode and fail closed when none is set", async () => {
  const env = newEnv();
  assert.equal((await adminList(env, "nope")).status, 401);
  assert.equal((await adminList(env, "")).status, 401);
  const noSecret = newEnv({ passcode: null });
  const res = await adminList(noSecret, "anything");
  assert.equal(res.status, 500);
});

test("admin paid/reopen/delete refuse a wrong passcode", async () => {
  const env = newEnv();
  await nominate(env, "1111", "Sean", "Reason");
  const res = await call(env, "POST", "/api/admin/fines/1/paid", { adminPin: "wrong" });
  assert.equal(res.status, 401);
  assert.equal((await publicList(env)).total_cents, 200);
});

test("public fines list allows cross-origin reads from the hub", async () => {
  const env = newEnv();
  const res = await call(env, "GET", "/api/fines");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal((await res.json()).total_cents, 0);
});

test("public and admin pages are served by the Worker", async () => {
  const env = newEnv();
  const home = await call(env, "GET", "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(await home.text(), /Nominate someone/);
  const admin = await call(env, "GET", "/admin");
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Weekly Fines admin/);
});

test("perthWeekStart uses Monday start in Perth time", () => {
  // Sunday 15 Nov 2026 23:59 Perth (15:59 UTC) is still the week starting Monday 9 Nov.
  assert.equal(perthWeekStart(new Date("2026-11-15T15:59:00Z")), "2026-11-09");
  // Monday 16 Nov 2026 00:01 Perth (Sunday 16:01 UTC) starts the week of 16 Nov.
  assert.equal(perthWeekStart(new Date("2026-11-15T16:01:00Z")), "2026-11-16");
});

test("countWords counts whitespace-separated words", () => {
  assert.equal(countWords("one  two\nthree"), 3);
  assert.equal(countWords(""), 0);
});
