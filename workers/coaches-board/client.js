export const JS = `const POSITIONS = window.__POSITIONS__;
const IC_COUNT = window.__INTERCHANGE_COUNT__;
const HUB_URL = window.__HUB_URL__ || "/";
const app = document.getElementById("app");

// The hub asks for the coaches PIN before the board opens, so the board itself has no gate.
let state = {
  grades: [],
  gradeId: "",
  round: "",
  opponent: "",
  matchDate: "",
  venue: "",
  positions: {},
  interchange: Array(IC_COUNT).fill(null),
  activeSlot: null, // { type: 'field'|'interchange', slot, index }
  presenting: false,
};

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

async function api(path, opts) {
  opts = Object.assign({}, opts || {});
  const res = await fetch(path, opts);
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

// Clears the board when the grade changes.
function resetBoard() {
  state.positions = {};
  state.interchange = Array(IC_COUNT).fill(null);
  state.round = "";
  state.opponent = "";
  state.matchDate = "";
  state.venue = "";
}

async function init() {
  render();
  try {
    const { grades } = await api("/api/grades");
    state.grades = grades;
    if (grades.length) state.gradeId = String(grades[0].grade_id);
  } catch (e) {
    setStatus("Could not load boards: " + e.message, "err");
  }
  render();
}

function render() {
  document.body.classList.toggle("presenting", state.presenting);
  const grade = currentGrade();
  app.innerHTML = \`
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
    </header>

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
      <div class="action-buttons action-buttons-wrap">
        <button class="btn-ghost" id="loadBtn">Load</button>
        <button class="btn-ghost" id="clearBtn">Clear</button>
        <button class="btn-primary" id="saveBtn">Save Team</button>
      </div>
    </div>

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
  \`;

  bindEvents();
}

function bindEvents() {
  document.getElementById("presentBtn").onclick = () => {
    state.presenting = !state.presenting;
    render();
  };

  const gradeSelect = document.getElementById("gradeSelect");
  if (gradeSelect) {
    gradeSelect.onchange = (e) => {
      state.gradeId = e.target.value;
      resetBoard();
      render();
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

  const loadBtn = document.getElementById("loadBtn");
  if (loadBtn) loadBtn.onclick = loadSelection;

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.onclick = () => {
    if (!confirm("Clear the board? Unsaved changes will be lost.")) return;
    state.positions = {};
    state.interchange = Array(IC_COUNT).fill(null);
    render();
  };

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.onclick = saveSelection;

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
        \${card ? \`<div class="pname solo">\${escapeHtml(card.name)}</div>\` : \`<div class="pname solo">Tap to add</div>\`}
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
        \${card ? \`<div class="pname ic-name">\${escapeHtml(card.name)}</div>\` : '<div class="pname">Add player</div>'}
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
      .map((p) => \`<div data-mid="\${p.member_id}">\${escapeHtml(p.name)}\${p.jumper ? " — #" + escapeHtml(p.jumper) : ""}</div>\`)
      .join("");
    box.querySelectorAll("[data-mid]").forEach((row, i) => {
      row.onclick = () => {
        const player = filtered[i];
        setSlotValue(state.activeSlot.type, state.activeSlot.slot, {
          member_id: player.member_id,
          playhq_player_id: player.playhq_player_id,
          name: player.name,
          jumper: player.jumper,
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
      .map((r) => \`<div data-round="\${escapeAttr(r.round_name)}" data-opp="\${escapeAttr(r.opponent_name || "")}" data-date="\${escapeAttr((r.match_date || "").slice(0, 10))}" data-venue="\${escapeAttr(r.venue_name || "")}">\${escapeHtml(r.round_name)}\${r.opponent_name ? " · " + escapeHtml(r.opponent_name) : ""}</div>\`)
      .join("");
    box.style.display = "block";
    box.querySelectorAll("[data-round]").forEach((row) => {
      row.onclick = () => {
        state.round = row.dataset.round;
        state.opponent = row.dataset.opp || state.opponent;
        state.matchDate = row.dataset.date || "";
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
    state.venue = data.selection.venue_name || "";
    state.positions = data.positions || {};
    state.interchange = Array(IC_COUNT).fill(null).map((_, i) => data.interchange[i] || null);
    render();
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
