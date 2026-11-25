// HTML for the training-days Worker. Client scripts avoid backticks and dollar-brace
// sequences so they can sit safely inside these template strings.

var BASE_CSS = `
  :root { --red: #e0301e; --blue: #1f6fd6; --gold: #d4af37; --ink: #111; --paper: #fff; --muted: #666; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); background: #f4f4f4; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.6rem; margin: 0 0 12px; }
  h2 { font-size: 1.1rem; margin: 24px 0 8px; }
  input, select { font: inherit; padding: 10px 12px; border: 1px solid #bbb; border-radius: 8px; }
  button { font: inherit; padding: 10px 14px; border: 0; border-radius: 8px; background: var(--ink); color: #fff; cursor: pointer; }
  button.alt { background: #ddd; color: var(--ink); }
  button:disabled { opacity: .5; cursor: default; }
  .card { background: var(--paper); border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 12px; }
  .muted { color: var(--muted); font-size: .9rem; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; background: var(--paper); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; font-size: .95rem; }
  tr.click { cursor: pointer; }
  tr.click:hover { background: #f7f7f7; }
  .note { min-height: 1.2em; margin: 8px 0; font-size: .95rem; }
  .ok { color: #137a2b; }
  .warn { color: #a15a00; }
  .bad { color: var(--red); }
`;

var WHEEL_CSS = `
  .wheel-caption { font-weight: 600; margin: 8px 0; }
  .wheel { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .slot { min-height: 44px; border-radius: 8px; border: 3px solid; padding: 6px; font-size: .85rem; display: flex; align-items: center; justify-content: center; text-align: center; word-break: break-word; }
  .slot.empty { background: #fff; }
  .slot.filled { background: #fff; color: var(--ink); }
  .slot.c0 { border-color: var(--red); }
  .slot.c1 { border-color: #cfcfcf; }
  .slot.c2 { border-color: var(--blue); }
`;

var TIER_CSS = `
  .m { display: flex; justify-content: space-between; padding: 8px 4px; border-bottom: 1px solid #eee; list-style: none; }
  .m .c { color: var(--muted); font-variant-numeric: tabular-nums; }
  .t-red .n { color: var(--red); text-shadow: 0 0 6px rgba(224,48,30,.7); font-weight: 600; }
  .t-blue .n { color: var(--blue); text-shadow: 0 0 6px rgba(31,111,214,.7); font-weight: 600; }
  .t-white .n { color: #111; background: #fff; text-shadow: 0 0 8px rgba(255,255,255,.95), 0 0 2px #999; font-weight: 700; padding: 0 4px; }
  .t-gold .n { color: var(--gold); text-shadow: 0 0 8px rgba(212,175,55,.9); font-weight: 700; }
  ul { padding: 0; margin: 0; }
  .empty { color: var(--muted); padding: 8px 4px; list-style: none; }
`;

export var SCAN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Training check-in</title>
<style>${BASE_CSS}
  .big { font-size: 1.1rem; }
</style></head>
<body><main>
  <h1>Training check-in</h1>
  <div class="card">
    <form id="f">
      <label for="pin" class="muted">Enter your PIN</label>
      <div class="row" style="margin-top:6px">
        <input id="pin" type="tel" inputmode="numeric" autocomplete="off" required style="flex:1">
        <button type="submit">Check in</button>
      </div>
    </form>
    <p id="out" class="note big" aria-live="polite"></p>
  </div>
  <p class="muted">Tuesdays and Thursdays, 5:15pm to 7:00pm.</p>
  <img src="__BASE__/rego.jpg" alt="Training check-in" style="display:block;width:100%;height:auto;margin-top:16px;border-radius:12px">
</main>
<script>
var QR_TOKEN = '__QR_TOKEN__';
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var pin = document.getElementById('pin').value.trim();
  var out = document.getElementById('out');
  out.className = 'note big';
  out.textContent = 'Checking...';
  try {
    var r = await fetch('__BASE__/api/scan',{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: pin, t: QR_TOKEN }) });
    var d = await r.json();
    if (d.name) {
      out.innerHTML = '';
      var who = document.createElement('div');
      who.textContent = d.name;
      who.style.fontWeight = '600';
      var msg = document.createElement('div');
      msg.textContent = d.message;
      out.appendChild(who);
      out.appendChild(msg);
    } else {
      out.textContent = d.message || 'Something went wrong.';
    }
    out.className = 'note big ' + ((d.status === 'ok' || d.status === 'duplicate') ? 'ok' : 'warn');
    if (d.status === 'ok' || d.status === 'duplicate') document.getElementById('pin').value = '';
  } catch (err) {
    out.textContent = 'Something went wrong. Try again.';
    out.className = 'note big bad';
  }
});
</script>
</body></html>`;

// Players training Noticeboard (/). The design image is the background. The PIN box, SUBMIT
// button, session label and name list are placed over it using the image's own proportions
// (941 x 1673), so they line up at any phone width. Sizes use container units (cqw).
export var NOTICEBOARD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Players training Noticeboard</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1a3a; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  .board { position: relative; width: 100%; max-width: 520px; margin: 0 auto; aspect-ratio: 941 / 1673; background: #0b1a3a url('__BASE__/noticeboard.png') center / 100% 100% no-repeat; container-type: inline-size; overflow: hidden; }
  .abs { position: absolute; }
  .postform { left: 0; top: 0; width: 100%; height: 100%; margin: 0; pointer-events: none; }
  #pin { position: absolute; pointer-events: auto; left: 40.9%; top: 32.1%; width: 27.6%; height: 4.7%; border: 0; border-radius: 0; background: transparent; color: #0b2a6b; font: inherit; font-size: 5cqw; font-weight: 700; padding: 0 3cqw; outline: none; }
  #submit { position: absolute; pointer-events: auto; left: 71.4%; top: 31.5%; width: 25.5%; height: 5.4%; border: 0; border-radius: 0; padding: 0; background: transparent; color: transparent; cursor: pointer; }
  #submit:disabled { cursor: default; }
  #sessionLabel { position: absolute; left: 50.7%; top: 39.4%; width: 46.5%; height: 4.8%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 4.4cqw; text-align: center; white-space: nowrap; overflow: hidden; }
  #rows { position: absolute; left: 3.2%; top: 44.2%; width: 93.9%; height: 45.7%; overflow-y: auto; background: #fff; }
  .r { display: grid; grid-template-columns: 49.8% 50.2%; height: 5.2cqw; }
  .r:nth-child(odd) { background: #ffffff; }
  .r:nth-child(even) { background: #d7e5f7; }
  .c { display: flex; align-items: center; padding: 0 3cqw; color: #0b2a6b; font-size: 4.2cqw; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c.none { color: #5b6b8c; font-weight: 400; font-style: italic; }
  .msg { max-width: 520px; min-height: 1.3em; margin: 12px auto 0; padding: 0 14px; color: #fff; text-align: center; font-size: 16px; }
  .msg.ok { color: #9ff0b4; }
  .msg.bad { color: #ffb3a8; }
  .hub-link { display: block; max-width: 520px; margin: 16px auto 24px; padding: 12px 14px; text-align: center; border-radius: 8px; background: #fff; color: #0b2a6b; font-weight: 700; font-size: 16px; text-decoration: none; }
</style></head>
<body>
<div class="board">
  <form id="postForm" class="abs postform" autocomplete="off">
    <input id="pin" type="tel" inputmode="numeric" autocomplete="off" aria-label="PIN">
    <button id="submit" type="submit" aria-label="Submit">Submit</button>
  </form>
  <div id="sessionLabel"></div>
  <div id="rows"></div>
</div>
<p id="msg" class="msg" aria-live="polite"></p>
<a class="hub-link" href="https://cockburnlakes.com/">Return to hub</a>
<script>
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function say(msg, cls) { var n = $('msg'); n.textContent = msg || ''; n.className = 'msg ' + (cls || ''); }
function renderBoard(d) {
  $('sessionLabel').textContent = d.sessionLabel || '';
  var rows = d.entries || [];
  var html = '';
  if (!rows.length) {
    html = '<div class="r"><div class="c none">Nobody has posted yet.</div><div class="c"></div></div>';
  } else {
    rows.forEach(function (e) {
      html += '<div class="r"><div class="c">' + esc(e.name) + '</div><div class="c"></div></div>';
    });
  }
  $('rows').innerHTML = html;
}
async function loadBoard() {
  try {
    var r = await fetch('__BASE__/api/board',{ cache: 'no-store' });
    renderBoard(await r.json());
  } catch (err) { /* keep the board already on screen */ }
}
$('postForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var pin = $('pin').value.trim();
  if (!pin) { say('Enter your PIN.', 'bad'); return; }
  var btn = $('submit');
  btn.disabled = true;
  say('Posting...', '');
  try {
    var r = await fetch('__BASE__/api/absence',{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: pin }) });
    var d = await r.json().catch(function () { return {}; });
    say(d.message || 'Something went wrong.', d.status === 'ok' ? 'ok' : 'bad');
    if (d.status === 'ok') { $('pin').value = ''; await loadBoard(); }
  } catch (err) {
    say('Something went wrong. Try again.', 'bad');
  }
  btn.disabled = false;
});
loadBoard();
setInterval(loadBoard, 60000);
</script>
</body></html>`;

export var WALL_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Training attendance</title>
<style>${BASE_CSS}${TIER_CSS}${WHEEL_CSS}</style></head>
<body><main>
  <h1>Training attendance</h1>
  <div class="card"><ul id="list"><li class="empty">Loading...</li></ul></div>
  <div class="card key">
    <ul>
      <li class="m t-red"><span class="n">5 Sessions Straight</span></li>
      <li class="m t-blue"><span class="n">10 Sessions Straight</span></li>
      <li class="m t-white"><span class="n">15 Sessions Straight</span></li>
      <li class="m t-gold"><span class="n">20 Sessions Straight</span></li>
    </ul>
  </div>
  <h2>The wheel</h2>
  <div class="card" id="wheel"></div>
</main>
<script>
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function renderWheel(wheel) {
  var box = document.getElementById('wheel');
  if (!wheel || !wheel.length) { box.innerHTML = '<p class="muted">The wheel is not open yet.</p>'; return; }
  var cur = wheel[wheel.length - 1];
  var slots = cur.status === 'spun' ? new Array(20).fill(null) : cur.slots;
  var caption;
  if (cur.status === 'spun') {
    caption = 'Last winner: ' + esc(cur.winner || 'Unknown') + '. Next wheel starts filling.';
  } else if (cur.status === 'ready') {
    caption = 'Wheel is full. Admin will announce the spin.';
  } else {
    caption = '6 consecutive training session log ins get your name on the wheel';
  }
  var html = '<p class="wheel-caption">' + caption + '</p><div class="wheel">';
  slots.forEach(function (name, i) {
    html += '<div class="slot ' + (name ? 'filled' : 'empty') + ' c' + (i % 3) + '">' + (name ? esc(name) : '') + '</div>';
  });
  html += '</div>';
  box.innerHTML = html;
}
async function load() {
  try {
    var r = await fetch('__BASE__/api/attendance');
    var d = await r.json();
    var list = d.members.map(function (m) {
      return '<li class="m t-' + (m.tier || 'none') + '"><span class="n">' + esc(m.name) + '</span><span class="c">' + m.sessions + '</span></li>';
    }).join('');
    document.getElementById('list').innerHTML = list || '<li class="empty">No sessions logged yet.</li>';
    renderWheel(d.wheel);
  } catch (err) {
    document.getElementById('list').innerHTML = '<li class="empty">Could not load attendance.</li>';
  }
}
load();
setInterval(load, 60000);
</script>
</body></html>`;

export var ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Training admin</title>
<style>${BASE_CSS}${TIER_CSS}${WHEEL_CSS}
  td.r { text-align: right; font-variant-numeric: tabular-nums; }
</style></head>
<body><main>
  <h1>Training admin</h1>

  <div id="login" class="card">
    <form id="loginForm" class="row">
      <input id="passcode" type="password" placeholder="Admin passcode" autocomplete="current-password" required style="flex:1">
      <button type="submit">Open</button>
    </form>
    <p id="loginNote" class="note bad"></p>
  </div>

  <div id="app" hidden>
    <p id="note" class="note" aria-live="polite"></p>

    <div class="card">
      <h2 style="margin-top:0">Dates</h2>
      <div class="row" style="margin-bottom:8px">
        <label class="muted" style="width:120px">Season start</label>
        <input id="season_start" type="date">
      </div>
      <div class="row" style="margin-bottom:8px">
        <label class="muted" style="width:120px">Week one</label>
        <input id="week_one" type="date">
        <span class="muted">Rewards start in the week containing this date.</span>
      </div>
      <div class="row">
        <button id="saveDates">Save dates</button>
      </div>
      <p class="muted">Last Thursday count: <span id="lastRun">never</span></p>
      <div class="row">
        <button id="runCount" class="alt">Run Thursday count now</button>
      </div>
    </div>

    <h2>Wheel</h2>
    <div class="card" id="wheelAdmin"></div>

    <h2>Members</h2>
    <table>
      <thead><tr><th>Name</th><th class="r">Sessions</th><th class="r">Run</th><th>Colour</th></tr></thead>
      <tbody id="members"></tbody>
    </table>

    <h2>Noticeboard</h2>
    <p class="muted">Names posted for the next session. Remove hides a name from the board only. Their absence still counts for credit. Clear board hides everything posted so far.</p>
    <div class="card">
      <div id="boardSession" class="muted"></div>
      <table>
        <thead><tr><th>Name</th><th></th></tr></thead>
        <tbody id="board"></tbody>
      </table>
      <div class="row" style="margin-top:8px"><button id="clearBoard" class="alt">Clear board now</button></div>
    </div>

    <h2>Sessions</h2>
    <p class="muted">Tap a session to see check-ins and remove a wrong one.</p>
    <table>
      <thead><tr><th>Date</th><th class="r">Scans</th></tr></thead>
      <tbody id="sessions"></tbody>
    </table>
    <div id="sessionDetail"></div>


  </div>
</main>
<script>
var pass = sessionStorage.getItem('tdpass') || '';
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function say(msg, cls) { var n = $('note'); n.textContent = msg || ''; n.className = 'note ' + (cls || ''); }
async function api(path, method, body) {
  var opts = { method: method || 'GET', headers: { 'x-admin-passcode': pass, 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var r = await fetch('__BASE__' + path, opts);
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
  return d;
}
function tierLabel(t) { return t ? t : '-'; }

function renderWheelAdmin(wheel) {
  var box = $('wheelAdmin');
  if (!wheel.length) { box.innerHTML = '<p class="muted">No wheel yet.</p>'; return; }
  var html = '';
  wheel.forEach(function (r) {
    var filled = r.slots.filter(function (s) { return s; }).length;
    html += '<div class="row" style="justify-content:space-between;margin-bottom:6px">';
    html += '<span>Wheel ' + r.round + ' &middot; ' + esc(r.status) + ' &middot; ' + filled + ' of 20</span>';
    if (r.status === 'ready') html += '<button data-spin="' + r.round + '">Spin</button>';
    if (r.status === 'spun') html += '<span class="ok">Winner: ' + esc(r.winner || 'Unknown') + '</span>';
    html += '</div>';
    html += '<div class="wheel" style="margin-bottom:12px">';
    r.slots.forEach(function (name, i) {
      html += '<div class="slot ' + (name ? 'filled' : 'empty') + ' c' + (i % 3) + '">' + (name ? esc(name) : '') + '</div>';
    });
    html += '</div>';
  });
  box.innerHTML = html;
}

async function load() {
  var d = await api('/api/admin/state');
  $('login').hidden = true;
  $('app').hidden = false;
  $('season_start').value = d.settings.season_start || '';
  $('week_one').value = d.settings.week_one || '';
  $('lastRun').textContent = d.settings.last_count_run ? new Date(d.settings.last_count_run).toLocaleString('en-AU', { timeZone: 'Australia/Perth' }) : 'never';

  renderWheelAdmin(d.attendance.wheel);
  renderBoardAdmin(d.board);

  $('members').innerHTML = d.attendance.members.map(function (m) {
    return '<tr><td>' + esc(m.name) + '</td><td class="r">' + m.sessions + '</td><td class="r">' + m.streak + '</td><td>' + esc(tierLabel(m.tier)) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="muted">No check-ins yet.</td></tr>';

  $('sessions').innerHTML = d.sessions.map(function (s) {
    return '<tr class="click" data-date="' + esc(s.date) + '"><td>' + esc(s.date) + '</td><td class="r">' + s.scans + '</td></tr>';
  }).join('') || '<tr><td colspan="2" class="muted">No sessions yet.</td></tr>';
}

async function showSession(date) {
  var d = await api('/api/admin/session?date=' + encodeURIComponent(date));
  var html = '<h2>' + esc(date) + '</h2><table><thead><tr><th>Name</th><th>Scanned (Perth)</th><th></th></tr></thead><tbody>';
  d.checkins.forEach(function (c) {
    var when = new Date(c.scanned_at).toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', hour: 'numeric', minute: '2-digit' });
    html += '<tr><td>' + esc(c.name) + '</td><td>' + when + '</td><td><button class="alt" data-remove="1" data-date="' + esc(date) + '" data-member="' + c.member_id + '">Remove</button></td></tr>';
  });
  if (!d.checkins.length) html += '<tr><td colspan="3" class="muted">No check-ins.</td></tr>';
  html += '</tbody></table>';
  $('sessionDetail').innerHTML = html;
}

$('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  pass = $('passcode').value;
  try {
    await load();
    sessionStorage.setItem('tdpass', pass);
    $('loginNote').textContent = '';
  } catch (err) {
    pass = '';
    $('loginNote').textContent = err.message;
  }
});

$('saveDates').addEventListener('click', async function () {
  try {
    await api('/api/admin/settings', 'POST', { season_start: $('season_start').value, week_one: $('week_one').value });
    say('Dates saved.', 'ok');
    await load();
  } catch (err) { say(err.message, 'bad'); }
});

$('runCount').addEventListener('click', async function () {
  try {
    var d = await api('/api/admin/run-count', 'POST', {});
    say('Count run. ' + d.added + ' new wheel entries.', 'ok');
    await load();
  } catch (err) { say(err.message, 'bad'); }
});

function renderBoardAdmin(b) {
  $('boardSession').textContent = b.sessionLabel ? 'Next session: ' + b.sessionLabel : 'No upcoming session.';
  var html = '';
  (b.entries || []).forEach(function (e) {
    html += '<tr><td>' + esc(e.name) + '</td><td><button class="alt" data-board-remove="1" data-date="' + esc(b.session) + '" data-member="' + e.member_id + '">Remove</button></td></tr>';
  });
  $('board').innerHTML = html || '<tr><td colspan="2" class="muted">Nobody has posted yet.</td></tr>';
}

$('clearBoard').addEventListener('click', async function () {
  if (!confirm('Clear the noticeboard now? Names are hidden, absences still count for credit.')) return;
  try {
    await api('/api/admin/board/clear', 'POST', {});
    say('Noticeboard cleared.', 'ok');
    await load();
  } catch (err) { say(err.message, 'bad'); }
});


document.addEventListener('click', async function (e) {
  var t = e.target;
  try {
    if (t.getAttribute && t.getAttribute('data-spin')) {
      if (!confirm('Spin wheel ' + t.getAttribute('data-spin') + ' now?')) return;
      var s = await api('/api/admin/spin', 'POST', { round: Number(t.getAttribute('data-spin')) });
      say('Winner: ' + s.result.winner, 'ok');
      await load();
      return;
    }
    if (t.getAttribute && t.getAttribute('data-board-remove')) {
      await api('/api/admin/board/remove', 'POST', { session_date: t.getAttribute('data-date'), member_id: Number(t.getAttribute('data-member')) });
      say('Name removed from the board.', 'ok');
      await load();
      return;
    }
    if (t.getAttribute && t.getAttribute('data-remove')) {
      await api('/api/admin/remove-checkin', 'POST', { date: t.getAttribute('data-date'), member_id: Number(t.getAttribute('data-member')) });
      say('Check-in removed.', 'ok');
      await showSession(t.getAttribute('data-date'));
      await load();
      return;
    }
    var row = t.closest ? t.closest('tr.click') : null;
    if (row) await showSession(row.getAttribute('data-date'));
  } catch (err) { say(err.message, 'bad'); }
});

if (pass) { load().catch(function () { sessionStorage.removeItem('tdpass'); pass = ''; }); }
</script>
</body></html>`;
