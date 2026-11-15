// "Add to Home Screen" button for the CLFC 2027 Players Hub.
(function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return; // already installed — no button

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  let deferredPrompt = null;

  // ---- styles ----
  const css = `
  .a2hs-btn{display:inline-flex;align-items:center;gap:.5em;padding:.7em 1.2em;border:0;border-radius:999px;
    background:#ffd400;color:#070b14;font-family:inherit;font-weight:800;font-size:.85rem;line-height:1;letter-spacing:.08em;text-transform:uppercase;
    cursor:pointer;box-shadow:0 6px 20px rgba(255,212,0,.25)}
  .a2hs-btn:hover{filter:brightness(1.08)}
  .a2hs-btn[hidden]{display:none}
  .a2hs-btn img{width:22px;height:22px;border-radius:6px}
  .a2hs-float{position:fixed;right:16px;bottom:16px;z-index:9999}
  .a2hs-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;justify-content:center;
    background:rgba(0,0,0,.6);padding:16px}
  .a2hs-card{background:#0d1a3a;color:#fff;border:1px solid #1f3a7a;border-radius:18px;max-width:420px;width:100%;
    padding:22px;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .a2hs-card header{display:flex;gap:12px;align-items:center;margin-bottom:14px}
  .a2hs-card header img{width:56px;height:56px;border-radius:13px}
  .a2hs-card h3{margin:0;font-size:1.05rem}
  .a2hs-card ol{margin:0 0 16px;padding-left:1.2em;line-height:1.7}
  .a2hs-card .a2hs-btn{width:100%;justify-content:center}
  .a2hs-share{display:inline-block;width:1.1em;height:1.1em;vertical-align:-.2em}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- button ----
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'a2hs-btn';
  btn.innerHTML = '<img src="/icons/icon-192.png" alt=""> Add to Home Screen';

  // Put it in a spot with id="a2hs-slot" if the page has one, otherwise float it bottom-right.
  const slot = document.getElementById('a2hs-slot');
  if (slot) slot.appendChild(btn);
  else { btn.classList.add('a2hs-float'); document.body.appendChild(btn); }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => btn.remove());

  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') btn.remove();
      return;
    }
    showHelp();
  });

  function showHelp(installNow) {
    const share =
      '<svg class="a2hs-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    const steps = isIOS
      ? `<li>Tap the <b>Share</b> button ${share} in Safari's toolbar</li>
         <li>Scroll down and tap <b>Add to Home Screen</b></li>
         <li>Tap <b>Add</b></li>`
      : `<li>Open your browser menu <b>⋮</b></li>
         <li>Tap <b>Add to Home screen</b> or <b>Install app</b></li>
         <li>Tap <b>Add</b> / <b>Install</b></li>`;
    const m = document.createElement('div');
    m.className = 'a2hs-modal';
    m.innerHTML = `<div class="a2hs-card" role="dialog" aria-modal="true">
        <header><img src="/icons/icon-192.png" alt=""><div><h3>Add the Players Hub</h3>
        <small>Open it like an app from your home screen</small></div></header>
        ${installNow ? '' : `<ol>${steps}</ol>`}
        <button type="button" class="a2hs-btn" data-act="install" ${installNow ? '' : 'hidden'}>Add to Home Screen</button>
        <button type="button" class="a2hs-btn" data-act="close">${installNow ? 'Not now' : 'Got it'}</button></div>`;
    m.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'install' && installNow) installNow();
      if (e.target === m || act) m.remove();
    });
    document.body.appendChild(m);
  }

  // ---- open the install card by itself, once per device ----
  // Browsers only show the native install dialog after a tap, so the card does the
  // opening: on Android/desktop Chrome it appears when the browser says the app can
  // be installed, and its button then opens the native dialog; on iPhone/iPad it
  // shows the Share-menu steps.
  const SEEN = 'clfc-install-card-seen';
  function alreadySeen() { try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return false; } }
  function markSeen() { try { localStorage.setItem(SEEN, '1'); } catch (e) {} }

  function runInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(({ outcome }) => {
      deferredPrompt = null;
      if (outcome === 'accepted') btn.remove();
    });
  }

  if (!standalone && !alreadySeen()) {
    // Chrome fires beforeinstallprompt shortly after load if the app is installable.
    window.addEventListener('beforeinstallprompt', () => setTimeout(() => {
      if (deferredPrompt && !alreadySeen()) { markSeen(); showHelp(runInstall); }
    }, 1500));
    if (isIOS) setTimeout(() => { if (!alreadySeen()) { markSeen(); showHelp(); } }, 1500);
  }
})();
