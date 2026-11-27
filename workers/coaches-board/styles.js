export const CSS = `:root {
  --navy: #0a1730;
  --navy-2: #0f2245;
  --red: #d4283a;
  --red-dark: #a91f2e;
  --silver: #b8c2d4;
  --glow: rgba(70, 120, 220, .35);
  --ink: #0a1220;
  --paper: #f4f5f8;
  --line: rgba(255,255,255,.14);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(circle at 15% 0%, var(--navy-2), var(--navy) 55%) fixed;
  color: #fff;
  min-height: 100vh;
}
h1, h2, h3, .display { font-family: "Oswald", "Arial Narrow", sans-serif; text-transform: uppercase; letter-spacing: .02em; }
button { font-family: inherit; cursor: pointer; border: 0; }
input, select { font-family: inherit; }

#app { max-width: 1180px; margin: 0 auto; padding: 20px 18px 60px; }

.masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border: 1px solid var(--line); background: linear-gradient(100deg, rgba(10,23,48,.9), rgba(15,34,69,.7)); margin-bottom: 18px; box-shadow: 0 16px 40px rgba(0,0,0,.3); }
.masthead .brand { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(160deg, var(--red), var(--red-dark)); display: grid; place-items: center; font: 900 16px/1 "Oswald", sans-serif; box-shadow: 0 0 0 3px rgba(255,255,255,.08), 0 0 24px var(--glow); }
.masthead h1 { font-size: 20px; letter-spacing: .06em; }
.masthead .sub { color: var(--silver); font-size: 11px; letter-spacing: .1em; }
.present-toggle { background: rgba(255,255,255,.08); color: #fff; padding: 9px 16px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; border: 1px solid var(--line); }
.present-toggle:hover { background: rgba(255,255,255,.16); }

.controls-bar { display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: 10px; margin-bottom: 16px; }
.controls-bar .field { display: flex; flex-direction: column; gap: 4px; }
.controls-bar label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--silver); }
.controls-bar select, .controls-bar input { padding: 10px 11px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: #fff; font-size: 13px; }
.controls-bar select option { color: #000; }
.controls-bar input::placeholder { color: rgba(255,255,255,.35); }
.round-list-wrap { position: relative; }
.round-suggest { position: absolute; top: 100%; left: 0; right: 0; background: #101f3f; border: 1px solid var(--line); z-index: 20; max-height: 160px; overflow: auto; }
.round-suggest div { padding: 8px 11px; font-size: 12px; cursor: pointer; }
.round-suggest div:hover { background: rgba(255,255,255,.08); }
.action-buttons { display: flex; align-items: flex-end; gap: 8px; }
.action-buttons button { padding: 10px 14px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
.btn-primary { background: var(--red); color: #fff; }
.btn-primary:hover { background: var(--red-dark); }
.btn-ghost { background: rgba(255,255,255,.08); color: #fff; border: 1px solid var(--line); }
.btn-ghost:hover { background: rgba(255,255,255,.16); }

.team-banner { text-align: center; padding: 18px; border: 1px solid var(--line); background: rgba(255,255,255,.03); margin-bottom: 18px; }
.team-banner .club { font-size: 12px; letter-spacing: .18em; color: var(--silver); }
.team-banner .grade { font: 900 52px/1 "Oswald", sans-serif; margin: 6px 0; text-transform: uppercase; letter-spacing: .06em; color: #fff; text-shadow: 0 0 4px #fff, 0 0 12px var(--red), 0 0 26px var(--red), 0 0 44px var(--red); }
.team-banner .round { font-size: 13px; color: var(--silver); letter-spacing: .08em; margin-bottom: 6px; }
.team-banner .versus { display: flex; align-items: center; justify-content: center; gap: 14px; font: 700 18px "Oswald", sans-serif; }
.team-banner .versus .vs { color: var(--red); font-size: 12px; letter-spacing: .2em; }

.board-layout { display: grid; grid-template-columns: 1fr 220px; gap: 18px; }
.oval-wrap { position: relative; aspect-ratio: 4 / 5; background:
    radial-gradient(ellipse at center, #1c5c33 0%, #164a29 70%, #123f22 100%);
  border-radius: 50% / 42%;
  border: 3px solid rgba(255,255,255,.5);
  box-shadow: inset 0 0 60px rgba(0,0,0,.4), 0 20px 50px rgba(0,0,0,.4);
  overflow: hidden;
}
/* 50m arcs, top (defensive) and bottom (forward) */
.oval-wrap::before, .oval-wrap::after {
  content: ""; position: absolute; left: 15%; right: 15%; height: 34%;
  border: 1px dashed rgba(255,255,255,.35); border-bottom: 0; border-radius: 50% 50% 0 0;
}
.oval-wrap::before { top: 6%; }
.oval-wrap::after { bottom: 6%; transform: rotate(180deg); }

/* Lines separating backs / middle third / forwards, matching guernsey structure */
.third-line { position: absolute; left: 4%; right: 4%; height: 0; border-top: 1px dashed rgba(255,255,255,.3); }
.third-line.top { top: 33%; }
.third-line.bottom { top: 67%; }

/* Centre square housing ruck / ruck-rover / centre / rover */
.centre-square { position: absolute; left: 28%; right: 28%; top: 36%; height: 30%; border: 1px solid rgba(255,255,255,.4); }
.centre-circle { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 1px solid rgba(255,255,255,.5); border-radius: 50%; }

.arc-label { position: absolute; font: 700 13px "Oswald", sans-serif; color: rgba(255,255,255,.55); letter-spacing: .04em; }
.arc-label.top { top: 3%; right: 4%; }
.arc-label.bottom { bottom: 3%; left: 4%; }
.line-label { position: absolute; left: -2px; font: 700 9px "Oswald", sans-serif; letter-spacing: .12em; color: rgba(255,255,255,.4); writing-mode: vertical-rl; text-orientation: mixed; }
.line-label.backs { top: 6%; }
.line-label.forwards { bottom: 6%; }

.slot { position: absolute; transform: translate(-50%, -50%); width: 88px; text-align: center; z-index: 5; }
.slot-card { cursor: pointer; transition: transform .12s ease; user-select: none; padding-bottom: 2px; }
.slot-card:hover { transform: translateY(-2px); }
.slot-card.dragover .jumper { outline: 2px solid #fff; }
.slot-card .jumper { font: 900 13px "Oswald", sans-serif; color: #fff; padding: 3px 4px; line-height: 1.1; }
.slot-card .pname { font-size: 10px; font-weight: 700; color: #fff; padding: 3px 4px; line-height: 1.2; margin-top: 1px; }
.slot-card .pos-label { font-size: 8px; letter-spacing: .07em; color: rgba(255,255,255,.85); text-transform: uppercase; margin-top: 3px; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.slot-card[data-line="back"] .jumper, .slot-card[data-line="back"] .pname { background: var(--red); }
.slot-card[data-line="back"] .pname { background: var(--red-dark); }
.slot-card[data-line="mid"] .jumper { background: #1c4fa8; }
.slot-card[data-line="mid"] .pname { background: #163d84; }
.slot-card[data-line="forward"] .jumper { background: #1c7a3c; }
.slot-card[data-line="forward"] .pname { background: #155c2d; }
.slot-card.empty .jumper, .slot-card.empty .pname { background: rgba(255,255,255,.08); border: 1px dashed rgba(255,255,255,.3); color: rgba(255,255,255,.55); }
.slot-card.empty .pname { font-weight: 400; }
.slot-card .remove-x { position: absolute; top: -7px; right: -7px; width: 17px; height: 17px; border-radius: 50%; background: var(--red); font-size: 11px; line-height: 17px; display: none; z-index: 6; }
.slot-card:hover .remove-x { display: block; }
/* Board name-only cards (2027 board) */
.slot-card .pname.solo { font-size: 11px; padding: 6px 4px; line-height: 1.15; margin-top: 0; }
.slot-card[data-line="back"] .pname.solo { background: var(--red); }
.slot-card[data-line="mid"] .pname.solo { background: #1c4fa8; }
.slot-card[data-line="forward"] .pname.solo { background: #1c7a3c; }
.slot-card.empty .pname.solo { background: rgba(255,255,255,.08); }
.interchange-slot .pname.ic-name { font-size: 13px; padding: 0; background: none; }

.interchange-panel { border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 14px; height: fit-content; }
.interchange-panel h3 { font-size: 12px; letter-spacing: .1em; margin-bottom: 10px; color: var(--silver); }
.interchange-slot { position: relative; margin-bottom: 8px; }
.interchange-slot .slot-card { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; padding: 8px; }
.interchange-slot .num { font: 900 11px "Oswald"; color: var(--silver); width: 14px; }

.selector-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(4,10,22,.8); display: none; align-items: center; justify-content: center; padding: 20px; }
.selector-overlay.show { display: flex; }
.selector-modal { width: min(380px, 100%); background: #0f2245; border: 1px solid var(--line); border-top: 4px solid var(--red); padding: 18px; }
.selector-modal h4 { font-size: 12px; letter-spacing: .1em; color: var(--silver); margin-bottom: 10px; }
.selector-modal input { width: 100%; padding: 11px; background: rgba(255,255,255,.08); border: 1px solid var(--line); color: #fff; font-size: 14px; margin-bottom: 8px; }
.selector-results div { padding: 9px 8px; font-size: 13px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,.06); }
.selector-results div:hover { background: rgba(255,255,255,.08); }
.selector-results .empty { color: rgba(255,255,255,.4); cursor: default; }
.selector-close { margin-top: 10px; width: 100%; padding: 9px; background: rgba(255,255,255,.08); color: #fff; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }

.status-line { margin-top: 14px; font-size: 11px; color: var(--silver); text-align: center; min-height: 16px; }
.status-line.err { color: #ff8a93; }
.status-line.ok { color: #7fe0a0; }

.presenting .controls-bar, .presenting .action-buttons, .presenting .interchange-panel h3 { }
body.presenting .controls-bar, body.presenting .action-buttons-wrap, body.presenting .save-row, body.presenting .present-toggle span.edit-label { display: none; }
body.presenting .slot-card .remove-x { display: none !important; }
body.presenting #app { max-width: 720px; }

/* Back to hub */
.back-btn { display: inline-flex; align-items: center; gap: 6px; color: #fff; text-decoration: none; background: rgba(255,255,255,.08); border: 1px solid var(--line); padding: 9px 14px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.back-btn:hover { background: rgba(255,255,255,.16); }
.masthead-right { display: flex; gap: 8px; align-items: center; }
body.presenting .back-btn { display: none; }

/* 2026 compare bar */
.compare-bar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); background: rgba(255,255,255,.03); margin-bottom: 16px; }
.compare-bar .field { display: flex; flex-direction: column; gap: 4px; min-width: 200px; flex: 1; }
.compare-bar label.flabel { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--silver); }
.compare-bar select { padding: 10px 11px; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: #fff; font-size: 13px; }
.compare-bar select option { color: #000; }
.compare-bar .hint { font-size: 12px; color: var(--silver); align-self: center; }
.toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; align-self: center; user-select: none; }
.toggle input { display: none; }
.toggle .track { width: 42px; height: 22px; border-radius: 11px; background: rgba(255,255,255,.15); position: relative; transition: background .15s; }
.toggle .knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.toggle input:checked + .track { background: var(--red); }
.toggle input:checked + .track .knob { left: 23px; }
.toggle .tlabel { font: 700 14px "Oswald", sans-serif; letter-spacing: .06em; text-transform: uppercase; }
body.presenting .compare-bar { display: none; }

/* 2026 compare pop-up */
.cmp-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(4,10,22,.85); display: flex; align-items: flex-start; justify-content: center; padding: 20px; overflow: auto; }
.cmp-modal { width: min(980px, 100%); background: #0c1c3a; border: 1px solid var(--line); border-top: 4px solid var(--silver); padding: 16px; position: relative; }
.cmp-close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; background: rgba(255,255,255,.1); color: #fff; font-size: 18px; }
.cmp-close:hover { background: var(--red); }
.cmp-head { text-align: center; margin-bottom: 14px; padding-right: 30px; padding-left: 30px; }
.cmp-head .tag { display: inline-block; background: var(--silver); color: var(--navy); font: 700 11px "Oswald", sans-serif; letter-spacing: .14em; padding: 3px 10px; margin-bottom: 6px; }
.cmp-head .grade { font: 900 24px/1.1 "Oswald", sans-serif; text-transform: uppercase; }
.cmp-head .round { font-size: 12px; color: var(--silver); letter-spacing: .08em; margin: 4px 0 6px; text-transform: uppercase; }
.cmp-head .versus { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; font: 700 16px "Oswald", sans-serif; text-transform: uppercase; }
.cmp-head .versus .vs { color: var(--red); font-size: 11px; letter-spacing: .2em; }
.cmp-modal .board-layout { grid-template-columns: 1fr 220px; }
.cmp-modal .oval-wrap { max-width: 560px; width: 100%; margin: 0 auto; }
.cmp-modal .oval-wrap { filter: saturate(.75); }
.slot-card.cmp { cursor: default; }
.slot-card.cmp:hover { transform: none; }
.slot-card.cmp.match .jumper { box-shadow: inset 0 0 0 2px #ffd34d; }
.slot-card.cmp.match .pname::after { content: " \\2605"; color: #ffd34d; }
.cmp-side h3 { font-size: 12px; letter-spacing: .1em; margin: 0 0 8px; color: var(--silver); }
.cmp-side .ic-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; margin-bottom: 6px; background: rgba(255,255,255,.05); font-size: 12px; }
.cmp-side .ic-row .jn { font: 900 13px "Oswald", sans-serif; min-width: 30px; }
.cmp-side .ic-row.match { box-shadow: inset 3px 0 0 #ffd34d; }
.cmp-side .ic-row.emg { opacity: .75; }
.cmp-side .panel { border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 12px; margin-bottom: 12px; }
.cmp-summary { font-size: 12px; color: var(--silver); line-height: 1.5; }
.cmp-summary strong { color: #ffd34d; }
.cmp-empty { text-align: center; padding: 40px 10px; color: var(--silver); font-size: 14px; }
.scoreline { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; max-width: 620px; margin: 8px auto 0; }
.scoreline .team { text-transform: uppercase; }
.scoreline .us { text-align: right; }
.scoreline .them { text-align: left; }
.scoreline .tname { font: 700 15px "Oswald", sans-serif; letter-spacing: .04em; }
.scoreline .tscore { font: 900 26px/1.1 "Oswald", sans-serif; margin-top: 2px; }
.scoreline .vs { color: var(--red); font-size: 11px; letter-spacing: .2em; }
.outcome { display: inline-block; padding: 5px 10px; font: 700 12px "Oswald", sans-serif; letter-spacing: .14em; }
.outcome.won { background: #1c7a3c; }
.outcome.lost { background: var(--red); }
.outcome.draw { background: #6b7a90; }
.opp-panel { margin-top: 16px; border: 1px solid var(--line); background: rgba(255,255,255,.03); padding: 12px; }
.opp-panel h3 { font-size: 12px; letter-spacing: .1em; margin-bottom: 10px; color: var(--silver); text-transform: uppercase; }
.opp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.opp-row { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: rgba(255,255,255,.05); font-size: 12px; }
.opp-row .jn { font: 900 13px "Oswald", sans-serif; min-width: 30px; color: var(--silver); }
.opp-row.emg { opacity: .7; }
.opp-row .on { flex: 1; }
.opp-row.match27 { background: rgba(255,140,40,.18); box-shadow: inset 3px 0 0 #ff8c28; opacity: 1; }
.opp-row.match27 .on { font-weight: 700; }
.tag27 { background: #ff8c28; color: #1a0e02; font: 700 10px "Oswald", sans-serif; letter-spacing: .06em; padding: 2px 6px; white-space: nowrap; }
.up-note { font-size: 12px; color: var(--silver); margin: -4px 0 10px; line-height: 1.45; }
.up-note.hit strong { color: #ff8c28; font-size: 14px; }
@media (max-width: 560px) { .scoreline .tname { font-size: 12px; } .scoreline .tscore { font-size: 20px; } }
.cmp-reopen { padding: 10px 14px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; background: rgba(255,255,255,.08); color: #fff; border: 1px solid var(--line); white-space: nowrap; }
.cmp-reopen:hover { background: rgba(255,255,255,.16); }
.cmp-reopen:disabled { opacity: .6; cursor: wait; }
.cmp-resync { position: absolute; top: 10px; left: 10px; padding: 8px 10px; font-size: 10px; }
@media (max-width: 860px) { .cmp-resync { position: static; margin-bottom: 10px; } }

@media (max-width: 860px) {
  .board-layout, .cmp-modal .board-layout { grid-template-columns: 1fr; }
  .masthead { flex-wrap: wrap; }
  .compare-bar .field { min-width: 0; flex-basis: 100%; }
  .controls-bar { grid-template-columns: 1fr 1fr; }
  .action-buttons { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; }
  .slot { width: 76px; }
  .slot-card .pname { font-size: 9px; }
}

.gate-card { max-width: 420px; margin: 48px auto; padding: 28px 24px; background: #ffffff; color: var(--navy, #0a1730); border-radius: 10px; text-align: center; box-shadow: 0 8px 28px rgba(0,0,0,0.18); }
.gate-card h3 { margin: 4px 0 8px; font: 900 24px/1.1 "Oswald", sans-serif; text-transform: uppercase; }
.gate-card p { margin: 0 0 16px; font-size: 14px; }
.gate-form { display: flex; flex-direction: column; gap: 14px; justify-content: center; align-items: center; }
.gate-form .unlock-btn { width: 100%; padding: 16px 20px; font: 900 22px/1 "Oswald", sans-serif; letter-spacing: .1em; text-transform: uppercase; box-shadow: 0 0 0 0 var(--glow), 0 6px 18px rgba(200,16,46,.35); }
.gate-form input { width: 130px; font-size: 24px; letter-spacing: 8px; text-align: center; padding: 8px; }
.gate-error { min-height: 1.3em; margin-top: 12px; color: #b00020; font-size: 13px; }
`;
.save-row { display: flex; justify-content: flex-end; margin: 4px 0 16px; }
.save-btn { width: 120px; height: 120px; border-radius: 0; padding: 10px; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; line-height: 1.2; white-space: normal; }
