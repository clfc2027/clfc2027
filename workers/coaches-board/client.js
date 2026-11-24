export const JS = `const POSITIONS = window.__POSITIONS__;
const IC_COUNT = window.__INTERCHANGE_COUNT__;
const HUB_URL = window.__HUB_URL__ || "/";
// Under the club domain the board is served at /coaches; API calls must keep that prefix.
const BASE = location.pathname.indexOf("/coaches") === 0 ? "/coaches" : "";
const app = document.getElementById("app");
const PIN_KEY = "coachesBoardPin";
const CMP_YEAR = window.__COMPARE_YEAR__;

let state = {
  grades: [],
  gradeId: "",
  round: "",
  opponent: "",
  matchDate: "",
  matchTime: "",
  venue: "",
  positions: {},
  interchange: Array(IC_COUNT).fill(null),
  activeSlot: null, // { type: 'field'|'interchange', slot, index }
  presenting: false,
  unlocked: false,
  pin: "",
  busy: false,
  gateError: "",
  cmp: { on: false, rounds: [], gameId: "", data: null, open: false, loading: false, syncing: false, progress: "", error: "" },
};

// Same rule as the server: surname, with the first name where two or more players share a surname.
function surnameOf(full) {
  const p = String(full || "").trim().split(/\\s+/);
  return p[p.length - 1] || "";
}
function firstNameOf(full) {
  const p = String(full || "").trim().split(/\\s+/);
  return p.length > 1 ? p.slice(0, -1).join(" ") : "";
}
function displayNames(names) {
  const counts = {};
  for (const n of names) {
    const key = surnameOf(n).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return names.map((n) => {
    const s = surnameOf(n);
    const f = firstNameOf(n);
    return counts[s.toLowerCase()] > 1 && f ? f + " " + s : s;
  });
}
function refreshDisplay() {
  const cards = [...Object.values(state.positions), ...state.interchange].filter(Boolean);
  const shown = displayNames(cards.map((c) => c.name));
  cards.forEach((c, i) => { c.display = shown[i]; });
}

function currentGrade() {
  return state.grades.find((g) => String(g.grade_id) === String(state.gradeId));
}

function allSelectedIds() {
  return [
    ...Object.values(state.positions).map((p) => p && p.member_id).filter(Boolean),
    ...state.interchange.map((p) => p && p.member_id).filter(Boolean),
  ];
}

function setStatus(msg, kind) {
  const el = document.getElementById("statusLine");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status-line" + (kind ? " " + kind : "");
}

// Every request carries the coaches PIN once it is unlocked. The server checks it.
async function api(path, opts) {
  opts = Object.assign({}, opts || {});
  const headers = Object.assign({}, opts.headers || {});
  if (state.pin) headers["x-coach-pin"] = state.pin;
  opts.headers = headers;
  const res = await fetch(BASE + path, opts);
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

function postJson(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Checks the coaches PIN. On success the board opens and the PIN is kept for this tab only.
async function unlock(pin, silent) {
  state.busy = true;
  state.gateError = "";
  try {
    await postJson("/api/coach/verify", { pin: pin });
    state.pin = pin;
    state.unlocked = true;
    sessionStorage.setItem(PIN_KEY, pin);
  } catch (e) {
    state.pin = "";
    state.unlocked = false;
    sessionStorage.removeItem(PIN_KEY);
    if (!silent) state.gateError = e.message;
  }
  state.busy = false;
}

function lockBoard() {
  sessionStorage.removeItem(PIN_KEY);
  state.unlocked = false;
  state.pin = "";
  state.gateError = "";
  resetBoard();
}

// Clears the board when the grade changes.
function resetBoard() {
  state.positions = {};
  state.interchange = Array(IC_COUNT).fill(null);
  state.round = "";
  state.opponent = "";
  state.matchDate = "";
  state.matchTime = "";
  state.venue = "";
}

async function init() {
  render();
  try {
    const { grades } = await api("/api/grades");
    state.grades = grades;
    if (grades.length) state.gradeId = String(grades[0].grade_id);
    const stored = sessionStorage.getItem(PIN_KEY);
    if (stored) await unlock(stored, true);
  } catch (e) {
    state.gateError = "Could not load boards: " + e.message;
  }
  render();
}

function gateHtml() {
  const disabled = state.busy ? " disabled" : "";
  return \`
    <div class="gate-card">
      <div class="club">COACHES ONLY</div>
      <h3>Enter coaches PIN</h3>
      <p>Enter the 4-digit PIN to open the coaches board.</p>
      <form id="gateForm" class="gate-form">
        <input id="gatePin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"\${disabled}>
        <button class="btn-primary" type="submit"\${disabled}>\${state.busy ? "Checking…" : "Unlock"}</button>
      </form>
      <div class="gate-error">\${escapeHtml(state.gateError)}</div>
    </div>\`;
}

function render() {
  refreshDisplay();
  document.body.classList.toggle("presenting", state.presenting);
  const grade = currentGrade();
  const header = \`
    <header class="masthead">
      <div class="brand">
        <div class="brand-mark">CL</div>
        <div>
          <h1>Cockburn Lakes Coaches Board</h1>
          <div class="sub">CLFC 2027 Season</div>
        </div>
      </div>
      <div class="masthead-right">
        <a class="back-btn" href="\${escapeAttr(HUB_URL)}">&larr; Back to Hub</a>
        <button class="present-toggle" id="presentBtn">
          <span class="edit-label">\${state.presenting ? "Exit Present" : "Present"}</span>
          \${state.presenting ? "" : "&nbsp;&middot; Present Mode"}
        </button>
      </div>
    </header>\`;

  if (!state.unlocked) {
    app.innerHTML = header + gateHtml();
    bindEvents();
    return;
  }

  app.innerHTML = header + \`
    <div class="controls-bar">
      <div class="field">
        <label>Grade</label>
        <select id="gradeSelect"\${state.grades.length ? "" : " disabled"}>
          \${state.grades.length
            ? state.grades
                .map((g) => \`<option value="\${g.grade_id}" \${String(g.grade_id) === String(state.gradeId) ? "selected" : ""}>\${g.grade_name}</option>\`)
                .join("")
            : '<option value="">No boards yet</option>'}
        </select>
      </div>
      <div class="field round-list-wrap">
        <label>Round</label>
        <input id="roundInput" placeholder="e.g. Round 7" value="\${escapeAttr(state.round)}" autocomplete="off">
        <div class="round-suggest" id="roundSuggest" style="display:none"></div>
      </div>
      <div class="field">
        <label>Opponent</label>
        <input id="opponentInput" placeholder="Opponent club" value="\${escapeAttr(state.opponent)}">
      </div>
      <div class="field">
        <label>Match date</label>
        <input id="dateInput" type="date" value="\${escapeAttr(state.matchDate)}">
      </div>
      <div class="field">
        <label>Match time</label>
        <input id="timeInput" type="time" value="\${escapeAttr(state.matchTime)}">
      </div>
      <div class="action-buttons action-buttons-wrap">
        <button class="btn-ghost" id="loadBtn">Load</button>
        <button class="btn-ghost" id="clearBtn">Clear</button>
        <button class="btn-ghost" id="lockBtn">Lock</button>
        <button class="btn-primary" id="saveBtn">Save Team</button>
      </div>
    </div>

    \${cmpBarHtml()}

    <div class="team-banner">
      <div class="club">COCKBURN LAKES FOOTBALL CLUB</div>
      <div class="grade">\${grade ? grade.grade_name : "SELECT A GRADE"}</div>
      <div class="round">\${state.round ? state.round.toUpperCase() : "ROUND —"}\${state.venue ? " · " + state.venue : ""}</div>
      <div class="versus">
        <span>COCKBURN LAKES</span>
        <span class="vs">VS</span>
        <span>\${state.opponent ? state.opponent.toUpperCase() : "OPPONENT"}</span>
      </div>
    </div>

    <div class="board-layout">
      <div class="oval-wrap" id="oval">
        <div class="arc-label top">50</div>
        <div class="arc-label bottom">50</div>
        <div class="line-label backs">BACKS</div>
        <div class="line-label forwards">FORWARDS</div>
        <div class="third-line top"></div>
        <div class="third-line bottom"></div>
        <div class="centre-square"></div>
        <div class="centre-circle"></div>
        \${POSITIONS.map((pos) => renderSlot(pos)).join("")}
      </div>
      <div class="interchange-panel">
        <h3>Interchange</h3>
        \${Array.from({ length: IC_COUNT })
          .map((_, i) => renderInterchangeSlot(i))
          .join("")}
      </div>
    </div>

    <div class="status-line" id="statusLine"></div>

    <div class="selector-overlay" id="selectorOverlay">
      <div class="selector-modal">
        <h4>Select Player</h4>
        <input id="playerSearch" placeholder="Start typing name…" autocomplete="off">
        <div class="selector-results" id="selectorResults"></div>
        <button class="selector-close" id="selectorClose">Cancel</button>
      </div>
    </div>
    \${cmpModalHtml()}
  \`;

  bindEvents();
}

function bindEvents() {
  document.getElementById("presentBtn").onclick = () => {
    state.presenting = !state.presenting;
    render();
  };

  const gateForm = document.getElementById("gateForm");
  if (gateForm) {
    gateForm.onsubmit = async (e) => {
      e.preventDefault();
      const pin = document.getElementById("gatePin").value.trim();
      if (!/^\\d{4}$/.test(pin)) {
        state.gateError = "Enter the 4-digit PIN.";
        render();
        return;
      }
      await unlock(pin, false);
      render();
    };
  }

  if (!state.unlocked) return;

  const gradeSelect = document.getElementById("gradeSelect");
  if (gradeSelect) {
    gradeSelect.onchange = (e) => {
      state.gradeId = e.target.value;
      resetBoard();
      render();
      if (state.cmp.on) cmpLoadRounds();
    };
  }

  const roundInput = document.getElementById("roundInput");
  if (roundInput) {
    roundInput.oninput = (e) => {
      state.round = e.target.value;
    };
    roundInput.onfocus = loadRoundSuggestions;
    roundInput.onblur = () => setTimeout(() => {
      const s = document.getElementById("roundSuggest");
      if (s) s.style.display = "none";
    }, 150);
  }

  const opponentInput = document.getElementById("opponentInput");
  if (opponentInput) opponentInput.oninput = (e) => (state.opponent = e.target.value);

  const dateInput = document.getElementById("dateInput");
  if (dateInput) dateInput.oninput = (e) => (state.matchDate = e.target.value);
  const timeInput = document.getElementById("timeInput");
  if (timeInput) timeInput.oninput = (e) => (state.matchTime = e.target.value);

  const loadBtn = document.getElementById("loadBtn");
  if (loadBtn) loadBtn.onclick = loadSelection;

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.onclick = () => {
    if (!confirm("Clear the board? Unsaved changes will be lost.")) return;
    state.positions = {};
    state.interchange = Array(IC_COUNT).fill(null);
    render();
  };

  const lockBtn = document.getElementById("lockBtn");
  if (lockBtn) lockBtn.onclick = () => {
    lockBoard();
    render();
  };

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.onclick = saveSelection;

  const cmpToggleEl = document.getElementById("cmpToggle");
  if (cmpToggleEl) cmpToggleEl.onchange = (e) => cmpToggle(e.target.checked);
  const cmpRoundEl = document.getElementById("cmpRound");
  if (cmpRoundEl) cmpRoundEl.onchange = (e) => cmpSelectRound(e.target.value);
  const cmpSyncEl = document.getElementById("cmpSync");
  if (cmpSyncEl) cmpSyncEl.onclick = () => cmpSelectRound(state.cmp.gameId, true);
  const cmpReopenEl = document.getElementById("cmpReopen");
  if (cmpReopenEl) cmpReopenEl.onclick = () => { state.cmp.open = true; render(); };
  const cmpCloseEl = document.getElementById("cmpClose");
  if (cmpCloseEl) cmpCloseEl.onclick = () => { state.cmp.open = false; render(); };
  const cmpResyncEl = document.getElementById("cmpResync");
  if (cmpResyncEl) cmpResyncEl.onclick = () => cmpSelectRound(state.cmp.gameId, true);
  const cmpOverlayEl = document.getElementById("cmpOverlay");
  if (cmpOverlayEl) cmpOverlayEl.onclick = (e) => { if (e.target === cmpOverlayEl) { state.cmp.open = false; render(); } };

  document.querySelectorAll(".slot-card").forEach((card) => {
    card.addEventListener("click", () => openSelector(card.dataset.type, card.dataset.slot));
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: card.dataset.type, slot: card.dataset.slot }));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("dragover");
    });
    card.addEventListener("dragleave", () => card.classList.remove("dragover"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("dragover");
      const from = JSON.parse(e.dataTransfer.getData("text/plain"));
      const to = { type: card.dataset.type, slot: card.dataset.slot };
      swapSlots(from, to);
    });
  });

  document.querySelectorAll("[data-remove-slot]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromSlot(btn.dataset.removeType, btn.dataset.removeSlot);
    });
  });

  const selectorClose = document.getElementById("selectorClose");
  if (selectorClose) selectorClose.onclick = closeSelector;
  const overlay = document.getElementById("selectorOverlay");
  if (overlay) overlay.onclick = (e) => { if (e.target === overlay) closeSelector(); };
}

function renderSlot(pos) {
  const card = state.positions[pos.id];
  return \`
    <div class="slot" style="left:\${pos.x}%; top:\${pos.y}%;">
      <div class="slot-card \${card ? "" : "empty"}" data-slot="\${pos.id}" data-type="field" data-line="\${pos.line}" draggable="\${card ? "true" : "false"}">
        \${card ? '<div class="remove-x" data-remove-slot="' + pos.id + '" data-remove-type="field">\\xD7</div>' : ""}
        \${card ? \`<div class="pname solo">\${escapeHtml(card.display || card.name)}</div>\` : \`<div class="pname solo">Tap to add</div>\`}
        <div class="pos-label">\${pos.label}</div>
      </div>
    </div>\`;
}

function renderInterchangeSlot(i) {
  const card = state.interchange[i];
  return \`
    <div class="interchange-slot">
      <div class="slot-card \${card ? "" : "empty"}" data-slot="\${i}" data-type="interchange" draggable="\${card ? "true" : "false"}">
        \${card ? '<div class="remove-x" data-remove-slot="' + i + '" data-remove-type="interchange">\\xD7</div>' : ""}
        <div class="num">\${i + 1}</div>
        \${card ? \`<div class="pname ic-name">\${escapeHtml(card.display || card.name)}</div>\` : '<div class="pname">Add player</div>'}
      </div>
    </div>\`;
}

function initialLastName(fullName) {
  const parts = fullName.trim().split(" ");
  const last = parts.pop();
  const first = parts.join(" ");
  return (first ? first[0] + ". " : "") + last;
}

function escapeAttr(v) {
  return (v || "").replace(/"/g, "&quot;");
}

function getSlotValue(type, slot) {
  return type === "interchange" ? state.interchange[Number(slot)] : state.positions[slot];
}
function setSlotValue(type, slot, value) {
  if (type === "interchange") state.interchange[Number(slot)] = value;
  else state.positions[slot] = value;
}

function swapSlots(from, to) {
  if (from.type === to.type && from.slot === to.slot) return;
  const a = getSlotValue(from.type, from.slot);
  const b = getSlotValue(to.type, to.slot);
  setSlotValue(from.type, from.slot, b);
  setSlotValue(to.type, to.slot, a);
  render();
}

function removeFromSlot(type, slot) {
  setSlotValue(type, slot, null);
  render();
}

function openSelector(type, slot) {
  state.activeSlot = { type, slot };
  document.getElementById("selectorOverlay").classList.add("show");
  const input = document.getElementById("playerSearch");
  input.value = "";
  input.focus();
  document.getElementById("selectorResults").innerHTML = "";
  let t;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => runPlayerSearch(input.value), 250);
  };
}

function closeSelector() {
  document.getElementById("selectorOverlay").classList.remove("show");
  state.activeSlot = null;
}

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}



// ---------- 2026 compare ----------
// "2026-04-11" -> "Sat 11 Apr", in Perth time.
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(String(d).slice(0, 10) + "T12:00:00+08:00");
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Perth" });
}

function cmpInitial(name) {
  const parts = String(name || "").trim().split(/\\s+/);
  if (parts.length < 2) return name || "";
  return parts[0][0] + ". " + parts.slice(1).join(" ");
}

function cmpIsOnBoard(p) {
  const cards = [...Object.values(state.positions), ...state.interchange].filter(Boolean);
  const pname = String(p.name || "").trim().toLowerCase();
  return cards.some((c) =>
    (p.playhq_player_id && c.playhq_player_id === p.playhq_player_id) ||
    (pname && String(c.name || "").trim().toLowerCase() === pname)
  );
}

function cmpRoundTag(r) {
  if (r.outcome == null && r.our_score == null) return "";
  const o = String(r.outcome || "").toUpperCase();
  const letter = o === "WON" ? "W" : o === "LOST" ? "L" : o.startsWith("DR") ? "D" : "";
  const score = r.our_score != null && r.opp_score != null ? " " + r.our_score + "–" + r.opp_score : "";
  return " · " + (letter + score).trim();
}

function cmpFmtScore(t) {
  if (!t || t.score == null) return "—";
  return (t.goals != null && t.behinds != null ? t.goals + "." + t.behinds + " " : "") + "(" + t.score + ")";
}

// Pre-picks the 2026 round whose opponent matches the opponent typed on this board.
function cmpRoundForOpponent(rounds) {
  const opp = (state.opponent || "").trim().toLowerCase();
  if (!opp) return null;
  return rounds.find((r) => String(r.opponent_name || "").trim().toLowerCase() === opp) || null;
}

async function cmpLoadRounds() {
  const c = state.cmp;
  c.rounds = [];
  c.gameId = "";
  c.data = null;
  c.open = false;
  c.error = "";
  if (!c.on || !state.gradeId) { render(); return; }
  c.loading = true;
  render();
  try {
    const data = await api("/api/compare/rounds?grade_id=" + encodeURIComponent(state.gradeId));
    c.rounds = data.rounds || [];
    const match = cmpRoundForOpponent(c.rounds);
    c.loading = false;
    if (match) { await cmpSelectRound(match.game_id); return; }
  } catch (e) {
    c.error = "Could not load " + CMP_YEAR + " rounds: " + e.message;
  }
  c.loading = false;
  render();
}

async function cmpToggle(on) {
  state.cmp.on = on;
  if (!on) {
    state.cmp.rounds = [];
    state.cmp.gameId = "";
    state.cmp.data = null;
    state.cmp.open = false;
    state.cmp.error = "";
    render();
    return;
  }
  await cmpLoadRounds();
}

// Picking a round that has no saved result pulls it from PlayHQ first, then opens the team sheet.
async function cmpSelectRound(gameId, force) {
  const c = state.cmp;
  c.gameId = gameId;
  c.error = "";
  c.progress = "";
  if (!gameId) { c.data = null; c.open = false; render(); return; }
  const round = c.rounds.find((r) => r.game_id === gameId);
  const needsSync = !!(force || (round && !round.has_result));
  c.data = null;
  c.syncing = needsSync;
  c.loading = !needsSync;
  if (needsSync) c.progress = "Pulling " + (round ? round.round_name : "game") + " from PlayHQ…";
  render();
  try {
    if (needsSync) {
      const res = await postJson("/api/compare/sync-game", { grade_id: state.gradeId, game_id: gameId });
      if (round) {
        round.players = res.players;
        round.has_result = res.has_result;
        round.no_sheet = res.status === "NO_TEAM_SHEET";
      }
    }
    c.data = await api("/api/compare/sheet?grade_id=" + encodeURIComponent(state.gradeId) + "&game_id=" + encodeURIComponent(gameId));
    if (round && c.data.result) {
      round.has_result = 1;
      round.outcome = c.data.result.outcome;
      round.our_score = c.data.result.our.score;
      round.opp_score = c.data.result.opp.score;
    }
    c.open = true;
  } catch (e) {
    c.error = (needsSync ? "Sync failed: " : "Could not load team sheet: ") + e.message;
  } finally {
    c.loading = false;
    c.syncing = false;
    c.progress = "";
    render();
  }
}

function cmpBarHtml() {
  const c = state.cmp;
  let h = '<div class="compare-bar">' +
    '<label class="toggle"><input type="checkbox" id="cmpToggle"' + (c.on ? " checked" : "") + '>' +
    '<span class="track"><span class="knob"></span></span><span class="tlabel">' + CMP_YEAR + ' Season</span></label>';
  if (!c.on) {
    return h + '<span class="hint">Switch on to see the ' + CMP_YEAR + ' team and result against this week\\'s opponent.</span></div>';
  }
  h += '<div class="field"><label class="flabel">' + CMP_YEAR + ' Round</label><select id="cmpRound"' + (c.rounds.length ? "" : " disabled") + ">" +
    '<option value="">' + (c.rounds.length ? "Select round…" : "No " + CMP_YEAR + " rounds for this grade") + "</option>" +
    c.rounds.map((r) =>
      '<option value="' + escapeAttr(r.game_id) + '"' + (r.game_id === c.gameId ? " selected" : "") + ">" +
      escapeHtml(r.round_name) + (r.opponent_name ? " — vs " + escapeHtml(r.opponent_name) : "") +
      cmpRoundTag(r) + "</option>"
    ).join("") + "</select></div>";
  if (c.data) h += '<button class="cmp-reopen" id="cmpReopen">View ' + CMP_YEAR + ' Side</button>';
  if (c.gameId) h += '<button class="cmp-reopen" id="cmpSync"' + (c.syncing ? " disabled" : "") + ">" + (c.syncing ? "Syncing…" : "↻ Re-sync from PlayHQ") + "</button>";
  if (c.progress) h += '<span class="hint">' + escapeHtml(c.progress) + "</span>";
  if (c.loading) h += '<span class="hint">Loading…</span>';
  if (c.error) h += '<span class="hint" style="color:#ff8a93">' + escapeHtml(c.error) + "</span>";
  return h + "</div>";
}

function cmpModalHtml() {
  const c = state.cmp;
  if (!c.open || !c.data) return "";
  const g = c.data.game;
  const listed = c.data.players.filter((p) => !p.emergency);
  const emergencies = c.data.players.filter((p) => p.emergency);
  const field = listed.slice(0, POSITIONS.length);
  const bench = listed.slice(POSITIONS.length);
  const onBoard = c.data.players.filter(cmpIsOnBoard).length;
  const meta = [g.round_name, fmtDate(g.game_date), g.venue_name].filter(Boolean).map(escapeHtml).join(" · ");

  const slots = POSITIONS.map((pos, i) => {
    const p = field[i];
    const on = p && cmpIsOnBoard(p);
    const cls = "slot-card cmp" + (p ? "" : " empty") + (on ? " match" : "");
    const inner = p
      ? '<div class="jumper">#' + escapeHtml(p.jumper || "-") + '</div><div class="pname">' + escapeHtml(cmpInitial(p.name)) + "</div>"
      : '<div class="jumper">&nbsp;</div><div class="pname">—</div>';
    return '<div class="slot" style="left:' + pos.x + "%; top:" + pos.y + '%;"><div class="' + cls + '" data-line="' + pos.line + '">' + inner + "</div></div>";
  }).join("");

  const row = (p, extra) =>
    '<div class="ic-row' + (cmpIsOnBoard(p) ? " match" : "") + (extra ? " " + extra : "") + '">' +
    '<span class="jn">#' + escapeHtml(p.jumper || "-") + "</span><span>" +
    (p.name ? escapeHtml(p.name) : '<em style="opacity:.6">Name hidden on PlayHQ</em>') +
    (p.captain ? " (" + escapeHtml(p.captain) + ")" : "") + (p.fill_in ? " · fill-in" : "") + "</span></div>";

  const body = c.data.players.length
    ? '<div class="board-layout"><div class="oval-wrap">' +
        '<div class="arc-label top">50</div><div class="arc-label bottom">50</div>' +
        '<div class="line-label backs">BACKS</div><div class="line-label forwards">FORWARDS</div>' +
        '<div class="third-line top"></div><div class="third-line bottom"></div>' +
        '<div class="centre-square"></div><div class="centre-circle"></div>' + slots + "</div>" +
        '<div class="cmp-side">' +
          '<div class="panel"><h3>Interchange</h3>' + (bench.length ? bench.map((p) => row(p)).join("") : '<div class="cmp-summary">None listed</div>') + "</div>" +
          (emergencies.length ? '<div class="panel"><h3>Emergencies</h3>' + emergencies.map((p) => row(p, "emg")).join("") + "</div>" : "") +
          '<div class="panel cmp-summary">' + c.data.players.length + " players named in " + CMP_YEAR + ". Positions follow jumper order, not where they played.<br><br>" +
            "<strong>★ " + onBoard + "</strong> of them " + (onBoard === 1 ? "is" : "are") + " on your " + (CMP_YEAR + 1) + " board.</div>" +
        "</div></div>"
    : '<div class="cmp-empty">' + (c.data.result ? "PlayHQ has no Cockburn Lakes team sheet for this game." : "No team sheet has been synced for this game yet.") + "</div>";

  const res = c.data.result;
  const outcome = String((res && res.outcome) || "").toUpperCase();
  const outCls = outcome === "WON" ? "won" : outcome === "LOST" ? "lost" : outcome ? "draw" : "";
  const oppName = g.opponent_name || (res && res.opp && res.opp.name) || "Opponent";
  const versus = res
    ? '<div class="scoreline">' +
        '<div class="team us"><div class="tname">Cockburn Lakes</div><div class="tscore">' + escapeHtml(cmpFmtScore(res.our)) + "</div></div>" +
        '<div class="mid">' + (outcome ? '<span class="outcome ' + outCls + '">' + escapeHtml(outcome) + "</span>" : '<span class="vs">VS</span>') + "</div>" +
        '<div class="team them"><div class="tname">' + escapeHtml(oppName) + '</div><div class="tscore">' + escapeHtml(cmpFmtScore(res.opp)) + "</div></div>" +
      "</div>"
    : '<div class="versus"><span>Cockburn Lakes</span><span class="vs">VS</span><span>' + escapeHtml(oppName) + "</span></div>" +
      '<div class="cmp-summary" style="margin-top:6px">Result not synced yet. Use Re-sync from PlayHQ.</div>';

  const opp = c.data.opposition || [];
  const oppPanel = '<div class="opp-panel"><h3>' + escapeHtml(oppName) + (opp.length ? " · " + opp.length + " players" : "") + "</h3>" +
    (opp.length
      ? '<div class="opp-grid">' + opp.map((p) =>
          '<div class="opp-row' + (p.emergency ? " emg" : "") + '"><span class="jn">#' + escapeHtml(p.jumper || "-") + '</span><span class="on">' +
          (p.name ? escapeHtml(p.name) : '<em style="opacity:.6">Name hidden on PlayHQ</em>') +
          (p.captain ? " (" + escapeHtml(p.captain) + ")" : "") + (p.emergency ? " · emg" : "") + "</span></div>"
        ).join("") + "</div>"
      : '<div class="cmp-summary">PlayHQ has no team sheet for the opposition in this game.</div>') +
    "</div>";

  return '<div class="cmp-overlay" id="cmpOverlay"><div class="cmp-modal">' +
    '<button class="cmp-close" id="cmpClose" title="Close">×</button>' +
    '<button class="cmp-reopen cmp-resync" id="cmpResync"' + (c.syncing ? " disabled" : "") + ">" + (c.syncing ? "Syncing…" : "↻ Re-sync from PlayHQ") + "</button>" +
    '<div class="cmp-head"><div class="tag">' + CMP_YEAR + ' TEAM SHEET</div>' +
      '<div class="grade">' + escapeHtml(g.team_name || "") + "</div>" +
      '<div class="round">' + meta + "</div>" + versus +
    "</div>" + body + oppPanel + "</div></div>";
}

async function runPlayerSearch(q) {
  const box = document.getElementById("selectorResults");
  if (!q || q.trim().length < 2) {
    box.innerHTML = '<div class="empty">Keep typing… (2+ letters)</div>';
    return;
  }
  try {
    const { players } = await api("/api/players?grade_id=" + encodeURIComponent(state.gradeId) + "&search=" + encodeURIComponent(q.trim()));
    const already = allSelectedIds();
    const filtered = players.filter((p) => !already.includes(p.member_id));
    if (!filtered.length) {
      box.innerHTML = '<div class="empty">No matching, available players</div>';
      return;
    }
    box.innerHTML = filtered
      .map((p) => \`<div data-mid="\${p.member_id}">\${escapeHtml(p.name)}</div>\`)
      .join("");
    box.querySelectorAll("[data-mid]").forEach((row, i) => {
      row.onclick = () => {
        const player = filtered[i];
        // Stores the full name. The board shows the surname, with the first name where needed.
        setSlotValue(state.activeSlot.type, state.activeSlot.slot, {
          member_id: player.member_id,
          playhq_player_id: player.playhq_player_id,
          name: player.name,
          jumper: null,
        });
        closeSelector();
        render();
      };
    });
  } catch (e) {
    box.innerHTML = '<div class="empty">Search failed: ' + escapeHtml(e.message) + "</div>";
  }
}

async function loadRoundSuggestions() {
  if (!state.gradeId) return;
  try {
    const { rounds } = await api("/api/rounds?grade_id=" + encodeURIComponent(state.gradeId));
    const box = document.getElementById("roundSuggest");
    if (!rounds.length) return;
    box.innerHTML = rounds
      .map((r) => \`<div data-round="\${escapeAttr(r.round_name)}" data-opp="\${escapeAttr(r.opponent_name || "")}" data-date="\${escapeAttr((r.match_date || "").slice(0, 10))}" data-time="\${escapeAttr((r.match_time || "").slice(0, 5))}" data-venue="\${escapeAttr(r.venue_name || "")}">\${escapeHtml(r.round_name)}\${r.opponent_name ? " · " + escapeHtml(r.opponent_name) : ""}</div>\`)
      .join("");
    box.style.display = "block";
    box.querySelectorAll("[data-round]").forEach((row) => {
      row.onclick = () => {
        state.round = row.dataset.round;
        state.opponent = row.dataset.opp || state.opponent;
        state.matchDate = row.dataset.date || "";
        state.matchTime = row.dataset.time || "";
        state.venue = row.dataset.venue || state.venue;
        box.style.display = "none";
        render();
      };
    });
  } catch (e) {
    // silent — suggestions are optional
  }
}

async function loadSelection() {
  if (!state.gradeId || !state.round.trim()) {
    setStatus("Choose a grade and round first.", "err");
    return;
  }
  try {
    const data = await api("/api/team?grade_id=" + encodeURIComponent(state.gradeId) + "&round=" + encodeURIComponent(state.round.trim()));
    if (!data.selection) {
      setStatus("No saved team found for that round yet.", "");
      return;
    }
    state.opponent = data.selection.opponent_name || "";
    state.matchDate = (data.selection.match_date || "").slice(0, 10);
    state.matchTime = (data.selection.match_time || "").slice(0, 5);
    state.venue = data.selection.venue_name || "";
    state.positions = data.positions || {};
    state.interchange = Array(IC_COUNT).fill(null).map((_, i) => data.interchange[i] || null);
    render();
    if (state.cmp.on) cmpLoadRounds();
    setStatus("Loaded saved team.", "ok");
  } catch (e) {
    setStatus("Could not load team: " + e.message, "err");
  }
}

async function saveSelection() {
  if (!state.gradeId || !state.round.trim()) {
    setStatus("Grade and round are required before saving.", "err");
    return;
  }
  try {
    await postJson("/api/team", {
      grade_id: state.gradeId,
      round_name: state.round.trim(),
      opponent_name: state.opponent.trim() || null,
      match_date: state.matchDate || null,
      match_time: state.matchTime || null,
      venue_name: state.venue || null,
      status: "saved",
      positions: state.positions,
      interchange: state.interchange,
    });
    setStatus("Team saved.", "ok");
  } catch (e) {
    setStatus("Save failed: " + e.message, "err");
  }
}

init();
`;
