// Page templates for the weekly-fines Worker.
// Edit the HTML here: this file is the only copy (no static assets, so nothing extra to upload).
// The wallpaper is the R2 object "wallpaper-fine.jpg" in the clfc-assets bucket, served at /fines/wallpaper-fine.

const BACK_BUTTONS = `
  <div class="topbar">
    <a class="btn light" href="/fines">&larr; Back to fines</a>
    <a class="btn light" href="/">&larr; Return to hub</a>
  </div>`;

export const INDEX_HTML = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Fines | Cockburn Lakes FC</title>
<style>
  :root { --navy: #14213d; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #1d1d1f; }
  .topbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: space-between; align-items: center; max-width: 600px; margin: 0 auto; padding: 12px 12px 0; }
  .btn { display: inline-block; background: var(--navy); color: #fff; text-decoration: none; font-weight: 600; padding: 9px 14px; border-radius: 6px; font-size: .95rem; }
  .btn.light { background: #eef0f4; color: var(--navy); }
  .stage { position: relative; max-width: 600px; margin: 12px auto 0; aspect-ratio: 1024 / 1536; background: url("/fines/wallpaper-fine") center / 100% 100% no-repeat; }
  .wall { position: absolute; left: 13%; top: 6%; width: 74%; height: 74%; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px; }
  .wall-empty { margin: auto; background: rgba(255,255,255,.9); padding: 8px 12px; border-radius: 8px; font-weight: 600; text-align: center; font-size: .95rem; }
  .card { position: relative; flex: 0 0 auto; width: 100%; aspect-ratio: 1536 / 1024; background: url("/fines/fine-card") center / 100% 100% no-repeat; }
  .card-text { position: absolute; left: 14%; right: 14%; top: 17%; bottom: 15%; display: flex; flex-direction: column; justify-content: center; overflow: hidden; color: #fff; text-align: center; }
  .card-name { margin: 0 0 .3em; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; word-break: break-word; }
  .card-reason { margin: 0; line-height: 1.3; word-break: break-word; }
  .card-meta { margin-top: .4em; font-size: .75em; opacity: .85; }
  .fine-btn { position: absolute; left: 51.2%; top: 86.8%; width: 44.2%; height: 10.2%; border-radius: 12px; }
  .fine-btn:hover { background: rgba(255,255,255,.12); }
  .fine-btn:focus-visible { outline: 3px solid #fca311; outline-offset: 3px; }
  .footer { max-width: 600px; margin: 0 auto; padding: 12px; text-align: center; font-size: .9rem; }
  .footer a { color: var(--navy); }
</style>
</head>
<body>
  <div class="topbar">
    <a class="btn light" href="/">&larr; Return to hub</a>
  </div>
  <main class="stage">
    <div class="wall" id="wall"><p class="wall-empty">Loading…</p></div>
    <a class="fine-btn" href="/fines/nominate" aria-label="Fine someone"></a>
  </main>
  <p class="footer"><a href="/fines/admin">Admin</a></p>

<script>
(function () {
  var BASE = location.pathname.indexOf("/fines") === 0 ? "/fines" : "";
  var wall = document.getElementById("wall");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Shrink the text until it fits inside the card.
  function fit(box) {
    var size = 18;
    box.style.fontSize = size + "px";
    while (size > 6 && box.scrollHeight > box.clientHeight) {
      size -= 1;
      box.style.fontSize = size + "px";
    }
  }

  function render(people) {
    var cards = [];
    people.forEach(function (p) {
      p.fines.forEach(function (f) {
        cards.push({ name: p.name, reason: f.reason, date: f.date, at: f.created_at });
      });
    });
    cards.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    wall.textContent = "";
    if (!cards.length) {
      wall.appendChild(el("p", "wall-empty", "No fines on the wall right now."));
      return;
    }
    cards.forEach(function (c) {
      var card = el("div", "card");
      var text = el("div", "card-text");
      text.appendChild(el("p", "card-name", c.name));
      text.appendChild(el("p", "card-reason", c.reason));
      text.appendChild(el("div", "card-meta", c.date));
      card.appendChild(text);
      wall.appendChild(card);
      fit(text);
    });
  }

  fetch(BASE + "/api/fines", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) throw new Error(d.error || "unavailable");
      render(d.people);
    })
    .catch(function () {
      wall.textContent = "";
      wall.appendChild(el("p", "wall-empty", "Could not load the fines. Refresh to try again."));
    });
})();
</script>
</body>
</html>
`;

export const NOMINATE_HTML = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fine someone | Cockburn Lakes FC</title>
<style>
  :root { --navy: #14213d; --gold: #fca311; --ink: #1d1d1f; --muted: #5b6270; --line: #e3e6ec; --red: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: linear-gradient(rgba(255,255,255,.9), rgba(255,255,255,.9)), url("/fines/wallpaper-fine") center / cover fixed no-repeat, #ffffff; min-height: 100vh; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  .topbar { display: flex; gap: 8px; flex-wrap: wrap; justify-content: space-between; align-items: center; max-width: 760px; margin: 0 auto; padding: 12px 16px 0; }
  .btn { display: inline-block; background: var(--navy); color: #fff; text-decoration: none; font-weight: 600; padding: 9px 14px; border-radius: 6px; font-size: .95rem; }
  .btn.light { background: #fff; color: var(--navy); border: 1px solid var(--line); }
  section { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  h1 { margin: 0 0 12px; font-size: 1.3rem; color: var(--navy); }
  .rules { color: var(--muted); font-size: .9rem; margin: 0 0 12px; }
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
</style>
</head>
<body>
${BACK_BUTTONS}
<main>
  <section>
    <h1>Fine someone</h1>
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
${BACK_BUTTONS}

<script>
(function () {
  var BASE = location.pathname.indexOf("/fines") === 0 ? "/fines" : "";
  var MAX_WORDS = 49;
  var $ = function (id) { return document.getElementById(id); };

  function countWords(text) {
    var t = text.trim();
    return t ? t.split(/\\s+/).length : 0;
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
      })
      .catch(function () {
        msg.textContent = "Could not reach the server. Try again.";
        msg.className = "msg err";
      })
      .then(function () {
        $("submit").disabled = countWords($("reason").value) > MAX_WORDS;
      });
  });
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
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: linear-gradient(rgba(245,246,248,.88), rgba(245,246,248,.88)), url("/fines/wallpaper-fine") center / cover fixed no-repeat, var(--bg); }
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
<header><h1>Weekly Fines admin</h1></header>
<main>
  <div class="filters">
    <a class="hub-btn" href="/fines">&larr; Back to fines</a>
    <a class="hub-btn" href="/">&larr; Return to hub</a>
  </div>

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
