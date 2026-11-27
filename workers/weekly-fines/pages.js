// Page templates for the weekly-fines Worker.
// Edit the HTML here: this file is the only copy (no static assets, so nothing extra to upload).

export const INDEX_HTML = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Fines | Cockburn Lakes FC</title>
<style>
  :root { --navy: #14213d; --gold: #fca311; --ink: #1d1d1f; --muted: #5b6270; --line: #e3e6ec; --bg: #f5f6f8; --red: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: linear-gradient(rgba(245,246,248,.88), rgba(245,246,248,.88)), url("/fines/wallpaper.jpg") center / cover fixed no-repeat, var(--bg); }
  header { background: var(--navy); color: #fff; padding: 20px 16px; }
  header h1 { margin: 0; font-size: 1.4rem; }
  header p { margin: 6px 0 0; opacity: .85; font-size: .95rem; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  h2 { margin: 0 0 12px; font-size: 1.15rem; color: var(--navy); }
  .total { font-size: 1.1rem; margin-bottom: 12px; }
  .person { border-top: 1px solid var(--line); padding: 12px 0; }
  .person:first-of-type { border-top: 0; }
  .person-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .person-name { font-weight: 700; font-size: 1.05rem; }
  .owed { font-weight: 700; color: var(--red); white-space: nowrap; }
  .fine { margin: 6px 0 0 0; padding-left: 12px; border-left: 3px solid var(--gold); color: var(--ink); font-size: .95rem; }
  .fine small { color: var(--muted); display: block; margin-top: 2px; }
  .empty { color: var(--muted); margin: 0; }
  label { display: block; font-weight: 600; margin: 12px 0 4px; }
  input, textarea { width: 100%; font: inherit; padding: 10px; border: 1px solid #c9ced8; border-radius: 6px; }
  textarea { min-height: 110px; resize: vertical; }
  .hint { color: var(--muted); font-size: .85rem; margin-top: 4px; }
  .hint.over { color: var(--red); font-weight: 600; }
  button { margin-top: 16px; background: var(--navy); color: #fff; border: 0; padding: 12px 18px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .msg { margin-top: 12px; font-weight: 600; }
  .msg.ok { color: #067647; }
  .msg.err { color: var(--red); }
  .admin-btn { display: inline-block; margin-top: 10px; color: #fff; border: 1px solid #fff; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: .9rem; }
  .rules { color: var(--muted); font-size: .9rem; margin: 0 0 12px; }
  .hub-btn { display: inline-block; margin: 10px 0 0 8px; background: #fff; color: var(--navy); text-decoration: none; font-weight: 700; padding: 6px 12px; border-radius: 6px; font-size: .9rem; }
</style>
</head>
<body>
<header>
  <h1>Weekly Fines</h1>
  <p>Cockburn Lakes FC. Each fine is $2. Nominations are anonymous.</p>
  <a class="admin-btn" href="/fines/admin">Admin</a>
  <a class="hub-btn" href="/">&larr; Return to hub</a>
</header>
<main>
  <section>
    <h2>Who owes</h2>
    <p class="total" id="total"></p>
    <div id="people"><p class="empty">Loading…</p></div>
  </section>

  <section>
    <h2>Nominate someone</h2>
    <p class="rules">Enter your PIN, the name of the person being fined and a reason of 49 words or fewer. You can nominate one person per week (weeks start Monday). Your name is not shown.</p>
    <form id="form" autocomplete="off">
      <label for="pin">Your PIN</label>
      <input id="pin" type="tel" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required>

      <label for="target">Name of the person being fined</label>
      <input id="target" type="text" maxlength="60" required>

      <label for="reason">Why?</label>
      <textarea id="reason" required></textarea>
      <div class="hint" id="count">0 / 49 words</div>

      <button id="submit" type="submit">Submit nomination</button>
      <div class="msg" id="msg" role="status"></div>
    </form>
  </section>
</main>

<script>
(function () {
  var BASE = location.pathname.indexOf("/fines") === 0 ? "/fines" : "";
  var MAX_WORDS = 49;
  var FINE_CENTS = 200;
  var money = function (cents) { return "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0); };
  var $ = function (id) { return document.getElementById(id); };

  function countWords(text) {
    var t = text.trim();
    return t ? t.split(/\\s+/).length : 0;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderTally(data) {
    $("total").textContent = "Total owed: " + money(data.total_cents);
    var box = $("people");
    box.textContent = "";
    if (!data.people.length) {
      box.appendChild(el("p", "empty", "Nobody owes anything right now."));
      return;
    }
    data.people.forEach(function (p) {
      var wrap = el("div", "person");
      var head = el("div", "person-head");
      head.appendChild(el("span", "person-name", p.name + " (" + p.count + (p.count === 1 ? " fine" : " fines") + ")"));
      head.appendChild(el("span", "owed", money(p.owed_cents)));
      wrap.appendChild(head);
      p.fines.forEach(function (f) {
        var line = el("p", "fine", f.reason);
        line.appendChild(el("small", null, f.date));
        wrap.appendChild(line);
      });
      box.appendChild(wrap);
    });
  }

  function loadTally() {
    fetch(BASE + "/api/fines", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error);
        renderTally(d);
      })
      .catch(function () {
        $("people").textContent = "";
        $("people").appendChild(el("p", "empty", "Could not load the list. Refresh to try again."));
      });
  }

  $("reason").addEventListener("input", function () {
    var n = countWords(this.value);
    var hint = $("count");
    hint.textContent = n + " / " + MAX_WORDS + " words";
    hint.className = "hint" + (n > MAX_WORDS ? " over" : "");
    $("submit").disabled = n > MAX_WORDS;
  });

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("msg");
    msg.textContent = "";
    msg.className = "msg";
    var pin = $("pin").value.replace(/[^0-9]/g, "");
    if (!/^[0-9]{4}$/.test(pin)) {
      msg.textContent = "Enter your 4-digit PIN.";
      msg.className = "msg err";
      return;
    }
    $("submit").disabled = true;
    fetch(BASE + "/api/fines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pin, target_name: $("target").value, reason: $("reason").value })
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
      .then(function (res) {
        if (!res.body.ok) {
          msg.textContent = res.body.error || "Something went wrong.";
          msg.className = "msg err";
          return;
        }
        msg.textContent = res.body.message;
        msg.className = "msg ok";
        $("target").value = "";
        $("reason").value = "";
        $("pin").value = "";
        $("count").textContent = "0 / " + MAX_WORDS + " words";
        loadTally();
      })
      .catch(function () {
        msg.textContent = "Could not reach the server. Try again.";
        msg.className = "msg err";
      })
      .then(function () {
        $("submit").disabled = countWords($("reason").value) > MAX_WORDS;
      });
  });

  loadTally();
})();
</script>
</body>
</html>
`;

export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Fines admin | Cockburn Lakes FC</title>
<style>
  :root { --navy: #14213d; --ink: #1d1d1f; --muted: #5b6270; --line: #e3e6ec; --bg: #f5f6f8; --red: #b42318; --green: #067647; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: linear-gradient(rgba(245,246,248,.88), rgba(245,246,248,.88)), url("/fines/wallpaper.jpg") center / cover fixed no-repeat, var(--bg); }
  header { background: var(--navy); color: #fff; padding: 16px; }
  header h1 { margin: 0; font-size: 1.3rem; }
  main { max-width: 1000px; margin: 0 auto; padding: 16px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  input { font: inherit; padding: 9px; border: 1px solid #c9ced8; border-radius: 6px; width: 220px; }
  button { font: inherit; border: 0; padding: 7px 12px; border-radius: 6px; cursor: pointer; background: var(--navy); color: #fff; font-weight: 600; }
  button.secondary { background: #eef0f4; color: var(--ink); }
  button.danger { background: var(--red); }
  button:disabled { opacity: .5; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  .status-open { color: var(--red); font-weight: 600; }
  .status-paid { color: var(--green); font-weight: 600; }
  .muted { color: var(--muted); }
  .msg { margin-top: 10px; font-weight: 600; }
  .msg.err { color: var(--red); }
  .msg.ok { color: var(--green); }
  .filters { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .hub-btn { display: inline-block; margin: 0 0 12px 0; background: #fff; color: var(--navy); text-decoration: none; font-weight: 700; padding: 6px 12px; border-radius: 6px; font-size: .9rem; }
</style>
</head>
<body>
<header><h1>Weekly Fines admin</h1><a class="hub-btn" href="/">&larr; Return to hub</a></header>
<main>
  <section id="login">
    <label for="pass">Admin passcode</label>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <input id="pass" type="password" inputmode="numeric" autocomplete="off">
      <button id="load" type="button">Load fines</button>
    </div>
    <div class="msg err" id="login-msg"></div>
  </section>

  <section id="list" hidden>
    <div class="filters">
      <button class="secondary" id="show-open" type="button">Open</button>
      <button class="secondary" id="show-paid" type="button">Paid</button>
      <button class="secondary" id="show-all" type="button">All</button>
      <button class="secondary" id="refresh" type="button">Refresh</button>
      <span class="muted" id="summary"></span>
    </div>
    <table>
      <thead>
        <tr><th>Fined</th><th>Reason</th><th>Nominated by</th><th>Week</th><th>Status</th><th>Actions</th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="msg" id="msg" role="status"></div>
  </section>
</main>

<script>
(function () {
  var BASE = location.pathname.indexOf("/fines") === 0 ? "/fines" : "";
  var $ = function (id) { return document.getElementById(id); };
  var passcode = "";
  var fines = [];
  var filter = "open";

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function post(path, body) {
    body.adminPin = passcode;
    return fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || !d.ok) throw new Error(d.error || "Request failed");
        return d;
      });
    });
  }

  function render() {
    var rows = $("rows");
    rows.textContent = "";
    var shown = fines.filter(function (f) {
      return filter === "all" || f.status === filter;
    });
    shown.forEach(function (f) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", f.target_name));
      tr.appendChild(el("td", f.reason));
      tr.appendChild(el("td", f.nominator, "muted"));
      tr.appendChild(el("td", f.week_start));
      tr.appendChild(el("td", f.status === "open" ? "Open" : "Paid " + (f.paid_at || "").slice(0, 10),
        f.status === "open" ? "status-open" : "status-paid"));

      var actions = el("td");
      var box = el("div", null, "actions");
      if (f.status === "open") {
        box.appendChild(actionButton("Mark paid", "paid", f.id));
      } else {
        box.appendChild(actionButton("Reopen", "reopen", f.id, "secondary"));
      }
      box.appendChild(actionButton("Delete", "delete", f.id, "danger"));
      actions.appendChild(box);
      tr.appendChild(actions);
      rows.appendChild(tr);
    });
    if (!shown.length) {
      var empty = document.createElement("tr");
      empty.appendChild(el("td", "No fines in this view.", "muted"));
      empty.firstChild.colSpan = 6;
      rows.appendChild(empty);
    }
    var open = fines.filter(function (f) { return f.status === "open"; });
    var owed = open.length * 2;
    $("summary").textContent = open.length + " open ($" + owed + " owed), " +
      (fines.length - open.length) + " paid";
  }

  function actionButton(label, action, id, cls) {
    var b = el("button", label, cls || null);
    b.type = "button";
    b.addEventListener("click", function () {
      if (action === "delete" && !confirm("Delete this fine permanently? Use this only for mistakes.")) return;
      b.disabled = true;
      post("/api/admin/fines/" + id + "/" + action, {})
        .then(function () { return load(); })
        .catch(function (err) {
          $("msg").textContent = err.message;
          $("msg").className = "msg err";
          b.disabled = false;
        });
    });
    return b;
  }

  function load() {
    $("msg").textContent = "";
    return post("/api/admin/fines", {})
      .then(function (d) {
        fines = d.fines;
        $("login").hidden = true;
        $("list").hidden = false;
        render();
      })
      .catch(function (err) {
        $("login-msg").textContent = err.message;
      });
  }

  $("load").addEventListener("click", function () {
    passcode = $("pass").value;
    $("login-msg").textContent = "";
    load();
  });
  $("pass").addEventListener("keydown", function (e) {
    if (e.key === "Enter") $("load").click();
  });
  $("show-open").addEventListener("click", function () { filter = "open"; render(); });
  $("show-paid").addEventListener("click", function () { filter = "paid"; render(); });
  $("show-all").addEventListener("click", function () { filter = "all"; render(); });
  $("refresh").addEventListener("click", function () { load(); });
})();
</script>
</body>
</html>
`;
