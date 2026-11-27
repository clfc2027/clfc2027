// Standalone spinning wheel (stand-in page).
// Public wheel at /, admin at /admin (PIN-gated), entries stored in KV binding WHEEL.
// Secrets (dashboard, not in this file): ADMIN_PIN
// Bindings: WHEEL (KV), REGO (R2, centre-of-wheel photo), CLFC_ASSETS (R2, wallpaper.jpg)

const ENTRIES_KEY = "entries";
const MAX_NAME_LENGTH = 40;
const MAX_ENTRIES = 200;
const HUB_KEY = "wheel-hub.jpg";
const WALLPAPER_KEY = "wallpaper.jpg";

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Fails closed: if the ADMIN_PIN secret is not set, nobody can pass the check.
function pinOk(pin, env) {
  if (!env.ADMIN_PIN) return false;
  return typeof pin === "string" && constantTimeEqual(pin, env.ADMIN_PIN);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function html(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function loadEntries(env) {
  const raw = await env.WHEEL.get(ENTRIES_KEY, "json");
  return Array.isArray(raw) ? raw : [];
}

async function saveEntries(env, entries) {
  await env.WHEEL.put(ENTRIES_KEY, JSON.stringify(entries));
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

// Server picks the winner so the animation on the client cannot decide the result.
function randomIndex(count) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % count;
}

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
    const path = url.pathname;
    const method = request.method;

    if (!env.WHEEL) {
      return json({ error: "KV binding WHEEL is not configured" }, 500);
    }

    if (method === "GET" && path === "/") return html(WHEEL_PAGE);
    if (method === "GET" && path === "/wallpaper.jpg") {
      return serveR2(env.CLFC_ASSETS, WALLPAPER_KEY, "public, max-age=3600");
    }
    if (method === "GET" && path === "/wheel-hub.jpg") {
      return serveR2(env.REGO, HUB_KEY, "public, max-age=3600");
    }
    if (method === "GET" && path === "/admin") return html(ADMIN_PAGE);

    if (method === "GET" && path === "/wheel.js") {
      return new Response(WHEEL_JS, {
        headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    if (method === "GET" && path === "/api/wheel") {
      return json({ entries: await loadEntries(env) });
    }

    if (method === "POST" && path === "/api/spin") {
      const body = await request.json().catch(() => ({}));
      const entries = await loadEntries(env);
      if (!entries.length) return json({ ok: false, reason: "empty" }, 409);
      const index = randomIndex(entries.length);
      return json({ ok: true, index, winner: entries[index].text, entries });
    }

    if (method === "POST" && path.startsWith("/api/admin/")) {
      const body = await request.json().catch(() => ({}));
      if (!pinOk(body.pin, env)) return json({ ok: false, reason: "bad_pin" }, 403);

      if (path === "/api/admin/check") {
        return json({ ok: true });
      }

      if (path === "/api/admin/add") {
        const text = cleanName(body.name);
        if (!text) return json({ ok: false, reason: "empty_name" }, 400);
        const entries = await loadEntries(env);
        if (entries.length >= MAX_ENTRIES) return json({ ok: false, reason: "full" }, 400);
        entries.push({ id: crypto.randomUUID(), text });
        await saveEntries(env, entries);
        return json({ ok: true, entries });
      }

      if (path === "/api/admin/remove") {
        const entries = (await loadEntries(env)).filter((e) => e.id !== body.id);
        await saveEntries(env, entries);
        return json({ ok: true, entries });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// Shared client script: WheelSpinner (from the FGK wheel) + colour assignment.
const WHEEL_JS = `
var WHEEL_PALETTE = [
  { color: "#0a3161", textColor: "#ffffff" },
  { color: "#b0193c", textColor: "#ffffff" },
  { color: "#ffffff", textColor: "#0a3161" }
];

// Alternates navy / red / white, and keeps the last slice from matching the first.
function wheelItems(entries) {
  var n = entries.length;
  var idx = [];
  for (var i = 0; i < n; i++) idx.push(i % 3);
  if (n > 2 && idx[n - 1] === idx[0]) {
    for (var p = 0; p < 3; p++) {
      if (p !== idx[0] && p !== idx[n - 2]) { idx[n - 1] = p; break; }
    }
  }
  return entries.map(function (e, i) {
    var pal = WHEEL_PALETTE[idx[i]];
    return { text: e.text, color: pal.color, textColor: pal.textColor };
  });
}

function WheelSpinner(canvas, options) {
  this.canvas = canvas;
  this.ctx = canvas.getContext("2d");
  this.items = [];
  this.rotation = 0;
  this.options = Object.assign({
    size: 440,
    padding: 10,
    textColor: "#ffffff",
    textFont: "Arial, Helvetica, sans-serif",
    textWeight: "700",
    textInset: 22,
    duration: 4500,
    extraRotations: [10, 14]
  }, options || {});
  this.setCanvasSize(this.options.size);
}

WheelSpinner.prototype.setCanvasSize = function (size) {
  this.options.size = size;
  this.canvas.width = size;
  this.canvas.height = size;
};

WheelSpinner.prototype.setItems = function (items) {
  this.items = items.map(function (i) { return Object.assign({}, i); });
  this.draw();
};

WheelSpinner.prototype.draw = function () {
  var ctx = this.ctx, canvas = this.canvas, items = this.items, o = this.options;
  var count = items.length;
  var center = canvas.width / 2;
  var radius = center - o.padding;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (count === 0) return;

  var slice = (Math.PI * 2) / count;
  var baseSize = count > 20 ? 13 : count > 16 ? 15 : count > 12 ? 17 : count > 8 ? 20 : 24;
  var maxTextWidth = radius - o.textInset - 30;

  items.forEach(function (item, index) {
    var angle = index * slice;

    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    var text = item.text || "";
    var size = baseSize;
    ctx.font = o.textWeight + " " + size + "px " + o.textFont;
    while (ctx.measureText(text).width > maxTextWidth && size > 9) {
      size--;
      ctx.font = o.textWeight + " " + size + "px " + o.textFont;
    }
    while (ctx.measureText(text).width > maxTextWidth && text.length > 1) {
      text = text.slice(0, -1);
    }
    if (text !== (item.text || "")) text = text.replace(/\s+$/, "") + "...";

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle + slice / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = item.textColor || o.textColor;
    ctx.fillText(text, radius - o.textInset, 0);
    ctx.restore();
  });
};

`;

// Main page: the wheel, the lever (anyone can pull it), the names list and admin set-up.
const WHEEL_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Wheel</title>
<style>
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 16px 12px 40px; box-sizing: border-box; background: #0a3161 url('/wallpaper.jpg') center / cover no-repeat fixed; }
  .draw-row { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; width: 100%; }
  .wheel-wrap { position: relative; width: 100%; max-width: 446px; flex: 1 1 340px; }
  .ticker { position: absolute; top: -26px; left: 50%; width: 0; height: 0; margin-left: -18px; border-left: 18px solid transparent; border-right: 18px solid transparent; border-top: 34px solid #ffd84d; filter: drop-shadow(0 3px 4px rgba(0,0,0,.5)); z-index: 3; transform-origin: 50% 0; }
  .ticker.active { animation: tick .18s ease-in-out infinite alternate; }
  @keyframes tick { from { transform: rotate(-12deg); } to { transform: rotate(8deg); } }
  .spinner { position: relative; width: 100%; }
  .spinner canvas { display: block; width: 100%; height: auto; border-radius: 50%; box-shadow: 0 0 0 6px #1d4fd8, 0 6px 14px rgba(0,0,0,.35); }
  .hub { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; box-shadow: 0 0 0 6px #1d4fd8, 0 6px 14px rgba(0,0,0,.35); pointer-events: none; }
  .lever-col { display: flex; flex-direction: column; align-items: center; }
  .lever { position: relative; width: 70px; height: 190px; background: none; border: none; padding: 0; cursor: pointer; }
  .lever-base { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 64px; height: 26px; border-radius: 8px; background: #b0193c; box-shadow: 0 4px 0 #7a0d24; }
  .lever-arm { position: absolute; bottom: 18px; left: 50%; width: 12px; height: 130px; margin-left: -6px; background: linear-gradient(90deg, #dfe5ee, #8a94a6); border-radius: 6px; transform-origin: bottom center; transform: rotate(-25deg); transition: transform .3s; }
  .lever:hover .lever-arm { transform: rotate(-35deg); }
  .lever.pulled .lever-arm { transform: rotate(28deg); }
  .lever-ball { position: absolute; top: -21px; left: 50%; width: 42px; height: 42px; margin-left: -21px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ff6b7a, #e0202f 60%, #7a0d24); box-shadow: 0 0 12px rgba(224,32,47,.8); }
  .lever-label { font-size: 13px; font-weight: 900; letter-spacing: 1px; color: #ffd84d; margin-top: 6px; text-shadow: 0 1px 3px #000; }
  .msg { font-size: 14px; color: #ffd84d; min-height: 20px; margin-top: 10px; text-align: center; text-shadow: 0 1px 3px #000; }
  .winner { display: none; margin: 14px auto 0; max-width: 420px; padding: 16px; border-radius: 10px; background: linear-gradient(180deg, #e0202f, #b0193c); box-shadow: 0 0 0 3px #fff; text-align: center; }
  .winner.show { display: block; }
  .winner .label { font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
  .winner .name { font-size: 26px; font-weight: 900; margin-top: 6px; word-break: break-word; }
  .reg-wrap { width: 100%; max-width: 560px; margin-top: 22px; }
  .reg-title { text-align: center; font-size: 20px; font-weight: 900; letter-spacing: 1px; color: #ffd84d; margin: 0 0 10px; text-shadow: 0 1px 3px #000; }
  .reg-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .reg-list li { background: #fff; color: #0a3161; border-radius: 8px; padding: 10px 12px; font-size: 15px; font-weight: 700; word-break: break-word; }
  .admin-link { background: none; border: none; color: #9fc3ff; text-decoration: underline; font-size: 13px; cursor: pointer; width: auto; padding: 4px; margin: 0; text-shadow: 0 1px 3px #000; }
  .admin-box { display: none; margin-top: 10px; width: 100%; max-width: 360px; }
  .admin-box.show { display: block; }
  .admin-box input { width: 100%; padding: 10px; font-size: 15px; border: 1px solid #cbd3dc; border-radius: 6px; box-sizing: border-box; margin-bottom: 8px; text-align: center; color: #0a3161; }
  .admin-box button#adminGo { background: #1d4fd8; color: #fff; border: none; border-radius: 6px; padding: 10px; font-weight: 700; width: 100%; cursor: pointer; }
</style>
</head>
<body>
<div class="draw-row">
  <div class="wheel-wrap">
    <div class="ticker" id="ticker"></div>
    <div class="spinner" id="spinner">
      <canvas id="wheel"></canvas>
      <img class="hub" src="/wheel-hub.jpg" alt="" onerror="this.style.display='none'">
    </div>
  </div>
  <div class="lever-col">
    <button class="lever" id="lever" aria-label="Pull the lever to spin the wheel">
      <span class="lever-base"></span>
      <span class="lever-arm"><span class="lever-ball"></span></span>
    </button>
    <div class="lever-label">PULL TO SPIN</div>
  </div>
</div>

<div class="msg" id="msg"></div>
<div class="winner" id="winner">
  <div class="label">Winner</div>
  <div class="name" id="winnerName"></div>
</div>

<div class="reg-wrap">
  <h2 class="reg-title">REGISTERED AND IN THE DRAW</h2>
  <ul class="reg-list" id="regList"></ul>
</div>
<div style="margin-top: 12px;"><button class="admin-link" id="adminToggle">Admin</button></div>
<div class="admin-box" id="adminBox">
  <input type="password" id="adminPin" placeholder="Admin PIN" autocomplete="off">
  <button id="adminGo">Go to admin</button>
  <div class="msg" id="adminMsg"></div>
</div>
<script src="/wheel.js"></script>
<script>
  var canvas = document.getElementById('wheel');
  var spinner = document.getElementById('spinner');
  var msg = document.getElementById('msg');
  var lever = document.getElementById('lever');
  var ticker = document.getElementById('ticker');
  var winnerBox = document.getElementById('winner');
  var winnerName = document.getElementById('winnerName');
  var regList = document.getElementById('regList');
  var wheel = new WheelSpinner(canvas, { size: 446, padding: 4 });
  var spinning = false;
  var lastJson = '';

  function show(list) {
    var json = JSON.stringify(list);
    if (json !== lastJson) {
      lastJson = json;
      wheel.setItems(wheelItems(list));
      regList.textContent = '';
      list.forEach(function (e) {
        var li = document.createElement('li');
        li.textContent = e.text;
        regList.appendChild(li);
      });
    }
    if (!spinning) msg.textContent = list.length ? '' : 'No names on the wheel yet. Check back soon.';
  }

  function refresh() {
    if (spinning) return;
    fetch('/api/wheel')
      .then(function (r) { return r.json(); })
      .then(function (d) { show(d.entries); })
      .catch(function () { if (!spinning) msg.textContent = 'Could not load the wheel. Refresh to try again.'; });
  }
  refresh();
  setInterval(refresh, 4000);

  // Turns the wheel so that index lands under the top pointer, slowing to a stop.
  function spinTo(index, duration) {
    return new Promise(function (resolve) {
      var count = wheel.items.length;
      var slice = 360 / count;
      var target = 270 - index * slice - slice / 2;
      var turns = 4 + Math.floor(Math.random() * 3);
      var current = ((wheel.rotation % 360) + 360) % 360;
      var alignment = ((target - current) + 360) % 360;
      var start = wheel.rotation;
      var end = start + turns * 360 + alignment;
      var t0 = performance.now();
      function frame(now) {
        var p = Math.min((now - t0) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 4);
        wheel.rotation = start + (end - start) * eased;
        spinner.style.transform = 'rotate(' + wheel.rotation + 'deg)';
        if (p < 1) {
          requestAnimationFrame(frame);
        } else {
          wheel.rotation = end;
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function pull() {
    if (spinning) return;
    spinning = true;
    lever.classList.add('pulled');
    ticker.classList.add('active');
    winnerBox.classList.remove('show');
    msg.textContent = '';
    fetch('/api/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) {
          msg.textContent = 'There are no names on the wheel yet.';
          return;
        }
        show(d.entries);
        return spinTo(d.index, 10000).then(function () {
          winnerName.textContent = d.winner;
          winnerBox.classList.add('show');
        });
      })
      .catch(function () { msg.textContent = 'Something went wrong. Try again.'; })
      .then(function () {
        spinning = false;
        lever.classList.remove('pulled');
        ticker.classList.remove('active');
      });
  }
  lever.addEventListener('click', pull);

  var adminBox = document.getElementById('adminBox');
  var adminPin = document.getElementById('adminPin');
  var adminMsg = document.getElementById('adminMsg');
  document.getElementById('adminToggle').addEventListener('click', function () {
    adminBox.classList.toggle('show');
    if (adminBox.classList.contains('show')) adminPin.focus();
  });
  function goAdmin() {
    var pinValue = adminPin.value.trim();
    if (!pinValue) { adminMsg.textContent = 'Enter the PIN.'; return; }
    fetch('/api/admin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinValue })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { adminMsg.textContent = 'Incorrect PIN.'; adminPin.value = ''; return; }
        sessionStorage.setItem('wheelPin', pinValue);
        window.location.href = '/admin';
      })
      .catch(function () { adminMsg.textContent = 'Could not reach the server.'; });
  }
  document.getElementById('adminGo').addEventListener('click', goAdmin);
  adminPin.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') goAdmin(); });
</script>
</body>
</html>
`;

const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wheel Admin</title>
<style>
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #0a3161; color: #0a3161; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 24px 12px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 12px; padding: 22px; width: 100%; max-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,.35); box-sizing: border-box; }
  h1 { margin: 0 0 12px; font-size: 22px; text-align: center; }
  .hidden { display: none !important; }
  input[type=password], input[type=text] { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #cbd3dc; border-radius: 6px; box-sizing: border-box; margin-bottom: 10px; }
  button { background: #b0193c; color: #fff; border: none; border-radius: 6px; padding: 12px; font-weight: 700; font-size: 14px; width: 100%; cursor: pointer; margin-bottom: 8px; }
  button.small { width: auto; padding: 6px 10px; font-size: 12px; margin: 0; background: #1d4fd8; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  canvas#preview { width: 260px; height: 260px; display: block; margin: 10px auto 4px; border-radius: 50%; box-shadow: 0 0 0 4px #1d4fd8; }
  .sub { text-align: center; color: #667; font-size: 14px; margin-bottom: 12px; }
  .msg { font-size: 14px; min-height: 20px; margin: 4px 0 10px; color: #b0193c; text-align: center; }
  .msg.ok { color: #0a7a3a; }
  ul { list-style: none; padding: 0; margin: 12px 0 0; border-top: 1px solid #e3e8ef; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 8px 2px; border-bottom: 1px solid #e3e8ef; font-size: 15px; gap: 10px; }
  li span { word-break: break-word; }
  .note { font-size: 12px; color: #667; margin-top: 10px; line-height: 1.4; }
</style>
</head>
<body>
<div class="card">
  <h1>Wheel Admin</h1>

  <div id="gate">
    <input type="password" id="pin" placeholder="Admin PIN" autocomplete="off">
    <button id="unlockBtn">Unlock</button>
    <div class="msg" id="gateMsg"></div>
  </div>

  <div id="panel" class="hidden">
    <canvas id="preview"></canvas>
    <div class="sub" id="count"></div>
    <input type="text" id="name" maxlength="40" placeholder="Name to add" autocomplete="off">
    <button id="addBtn">Add to wheel &amp; save</button>
    <div class="msg" id="msg"></div>
    <ul id="list"></ul>
    <div class="note">Every name has an equal slice, so with N names each has a 1 in N chance. Changes go live on the public wheel within about a minute.</div>
  </div>
</div>
<script src="/wheel.js"></script>
<script>
  var pin = '';
  var gate = document.getElementById('gate');
  var panel = document.getElementById('panel');
  var pinInput = document.getElementById('pin');
  var gateMsg = document.getElementById('gateMsg');
  var nameInput = document.getElementById('name');
  var addBtn = document.getElementById('addBtn');
  var msg = document.getElementById('msg');
  var list = document.getElementById('list');
  var countEl = document.getElementById('count');
  var wheel = new WheelSpinner(document.getElementById('preview'), { size: 260 });

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function render(entries) {
    wheel.setItems(wheelItems(entries));
    countEl.textContent = entries.length === 1
      ? '1 name on the wheel (100% chance)'
      : entries.length + ' names on the wheel' + (entries.length ? ' (each ' + (100 / entries.length).toFixed(1) + '%)' : '');
    list.innerHTML = '';
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = e.text;
      var btn = document.createElement('button');
      btn.className = 'small';
      btn.textContent = 'Remove';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        api('/api/admin/remove', { pin: pin, id: e.id }).then(function (d) {
          if (d.ok) { render(d.entries); setMsg('Removed and saved.', true); }
          else { btn.disabled = false; setMsg('Could not remove. Try again.', false); }
        });
      });
      li.appendChild(label);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function setMsg(text, ok) {
    msg.textContent = text;
    msg.className = ok ? 'msg ok' : 'msg';
  }

  function load() {
    return fetch('/api/wheel').then(function (r) { return r.json(); }).then(function (d) { render(d.entries); });
  }

  document.getElementById('unlockBtn').addEventListener('click', function () {
    var attempt = pinInput.value.trim();
    api('/api/admin/check', { pin: attempt }).then(function (d) {
      if (!d.ok) { gateMsg.textContent = 'Incorrect PIN.'; pinInput.value = ''; return; }
      pin = attempt;
      gate.classList.add('hidden');
      panel.classList.remove('hidden');
      load();
      nameInput.focus();
    }).catch(function () { gateMsg.textContent = 'Could not reach the server.'; });
  });
  pinInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') document.getElementById('unlockBtn').click(); });

  function addName() {
    var name = nameInput.value.trim();
    if (!name) { setMsg('Type a name first.', false); return; }
    addBtn.disabled = true;
    api('/api/admin/add', { pin: pin, name: name }).then(function (d) {
      if (!d.ok) {
        setMsg(d.reason === 'full' ? 'The wheel is full.' : 'Could not add that name.', false);
        return;
      }
      nameInput.value = '';
      render(d.entries);
      setMsg('Added and saved: ' + name, true);
    }).catch(function () { setMsg('Could not reach the server.', false); })
      .then(function () { addBtn.disabled = false; nameInput.focus(); });
  }

  addBtn.addEventListener('click', addName);
  nameInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') addName(); });

  (function autoUnlock() {
    var saved = sessionStorage.getItem('wheelPin');
    if (!saved) return;
    api('/api/admin/check', { pin: saved }).then(function (d) {
      if (!d.ok) { sessionStorage.removeItem('wheelPin'); return; }
      pin = saved;
      gate.classList.add('hidden');
      panel.classList.remove('hidden');
      load();
      nameInput.focus();
    });
  })();
</script>
</body>
</html>`;
