const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');

if (menuToggle && siteNav) {
  menuToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  siteNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      siteNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

document.querySelectorAll('.grade-card[href="#coming-soon"]').forEach((card) => {
  card.addEventListener('click', (event) => {
    event.preventDefault();
    const grade = card.dataset.grade || 'grade';
    window.location.hash = 'coming-soon';
    window.setTimeout(() => {
      const heading = document.querySelector('#coming-soon h2');
      if (heading) heading.setAttribute('data-selected-grade', grade);
    }, 0);
  });
});

const intro = document.querySelector('#club-intro');
const introVideo = document.querySelector('#club-intro-video');
const introSkip = document.querySelector('#intro-skip');
let introClosed = false;

if (intro && introVideo) {
  const closeIntro = () => {
    if (introClosed) return;
    introClosed = true;
    intro.classList.add('is-closing');
    document.body.classList.remove('intro-lock');
    window.setTimeout(() => intro.remove(), 720);
  };

  introSkip?.addEventListener('click', closeIntro);
  introVideo.addEventListener('ended', closeIntro, { once: true });
  window.setTimeout(closeIntro, 4800);
  introVideo.play().catch(() => {});
}

// Game day duty checker: member enters their PIN and sees their duty for the latest round.
(function () {
  const form = document.getElementById('dutyCheckForm');
  const result = document.getElementById('dutyCheckResult');
  if (!form || !result) return;
  const API = 'https://cockburnlakes.com/coaches/api/duties/check';

  // "Reserves", "Reserves and Thirds", "Colts, Reserves and Thirds"
  function joinNames(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function show(message, isError) {
    result.innerHTML = '';
    result.className = 'duty-check-result' + (isError ? ' err' : '');
    const p = document.createElement('p');
    p.textContent = message;
    result.appendChild(p);
    return p;
  }

  // Check automatically once all four digits are entered; Enter also submits.
  document.getElementById('dutyPin').addEventListener('input', function (e) {
    if (/^[0-9]{4}$/.test(e.target.value)) form.requestSubmit();
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const pin = document.getElementById('dutyPin').value.trim();
    if (!/^[0-9]{4}$/.test(pin)) return show('Enter your 4-digit PIN.', true);
    show('Checking...', false);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) return show(data.error || 'Could not check right now. Try again shortly.', true);

      const first = (data.name || '').split(' ')[0];
      const named = data.named || [];
      const duties = data.duties || [];
      // Nobody named and no duty: keep showing up.
      if (!named.length && !duties.length) {
        return show('Hello ' + first + ', all you can do is keep showing up. See you on the track Tuesday.', false);
      }
      const namedList = joinNames(named);
      const dutyText = duties.map(function (d) {
        return 'you are on ' + d.duty.toLowerCase() + ' duty for the ' + d.grade + ' game';
      }).join(' and ');
      const findSomeone = " If you can't do this job, find someone to do it for you.";
      // Named and on duty.
      if (named.length && duties.length) {
        return show('Hello ' + first + ', this week you are playing ' + namedList + ' and ' + dutyText + '.' + findSomeone, false);
      }
      // On duty but not named (should be rare).
      if (duties.length) {
        return show('Hello ' + first + ', this week ' + dutyText + '.' + findSomeone, false);
      }
      // Named, duties not yet allocated.
      if (!data.dutiesOut) {
        return show('Hello ' + first + '. You are named in ' + namedList + ' this week. Game day duties haven\'t been allocated yet.', false);
      }
      // Named, allocated, no duty.
      return show('Hello ' + first + '. You are named in ' + namedList + ' this week. You don\'t have any game day duties this week.', false);
    } catch (err) {
      show('Could not check right now. Try again shortly.', true);
    }
  });
})();

// Weekly fines total on the hub card. Read from the fines Worker when the page loads.
(function () {
  var el = document.getElementById("fines-total");
  if (!el) return;
  fetch("https://cockburnlakes.com/fines/api/fines", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) throw new Error(d.error || "fines unavailable");
      el.textContent = "$" + (d.total_cents / 100).toFixed(d.total_cents % 100 ? 2 : 0);
    })
    .catch(function () { el.textContent = "unavailable"; });
})();

// Change PIN: the member proves their current PIN, then sets a new one. The server changes their own
// member row, so their name, duties and history stay attached to them. The left half of the banner is
// the Request PIN SMS link (handled in index.html); this is the right half.
(function () {
  const openBtn = document.getElementById('changePinOpen');
  const dialog = document.getElementById('change-pin-dialog');
  const form = document.getElementById('changePinForm');
  if (!openBtn || !dialog || !form) return;
  const API = 'https://cockburnlakes.com/coaches/api/pin/change';
  const msg = document.getElementById('changePinMsg');
  const submit = document.getElementById('changePinSubmit');
  const cancel = document.getElementById('changePinCancel');

  function say(text, isError) {
    msg.textContent = text;
    msg.style.color = isError ? '#ff6b6b' : '#ffd400';
  }

  openBtn.addEventListener('click', function () {
    form.reset();
    say('', false);
    dialog.showModal();
  });
  cancel.addEventListener('click', function () { dialog.close(); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const currentPin = document.getElementById('curPin').value.trim();
    const newPin = document.getElementById('newPin').value.trim();
    const repeatPin = document.getElementById('newPin2').value.trim();
    if (!/^[0-9]{4}$/.test(currentPin)) return say('Enter your current 4-digit PIN.', true);
    if (!/^[0-9]{4}$/.test(newPin)) return say('Your new PIN must be 4 digits.', true);
    if (newPin !== repeatPin) return say('The new PINs do not match.', true);
    if (newPin === currentPin) return say('Choose a PIN different from your current one.', true);

    submit.disabled = true;
    say('Saving...', false);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin: currentPin, newPin: newPin })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) return say(data.error || 'Could not change your PIN right now. Try again shortly.', true);
      form.reset();
      say('Done. Use your new PIN from now on.', false);
      window.setTimeout(function () { dialog.close(); }, 1800);
    } catch (err) {
      say('Could not reach the hub. Check your connection and try again.', true);
    } finally {
      submit.disabled = false;
    }
  });
})();

// Spin & Win: opened by tapping the warrior head in the hero. There is no button or hint for it.
// The server picks the winner and marks that name as out; the wheel only animates to that result.
(function () {
  const head = document.getElementById('warriorHead');
  const dialog = document.getElementById('spin-dialog');
  const svg = document.getElementById('spinWheel');
  if (!head || !dialog || !svg) return;
  const API = 'https://cockburnlakes.com/coaches/api/spin';
  const NS = 'http://www.w3.org/2000/svg';
  const result = document.getElementById('spinResult');
  const count = document.getElementById('spinCount');
  const go = document.getElementById('spinGo');
  const closeBtn = document.getElementById('spinClose');
  const lever = document.getElementById('spinLever');
  const SPIN_MS = 5000;
  let members = [];
  let rotation = 0;
  let spinning = false;

  function setRotation(deg, animate) {
    svg.style.transition = animate ? 'transform ' + SPIN_MS + 'ms cubic-bezier(.15,.7,.1,1)' : 'none';
    svg.style.transform = 'rotate(' + deg + 'deg)';
  }

  function drawWheel() {
    svg.innerHTML = '';
    const n = members.length;
    setRotation(rotation, false);
    if (!n) return;
    const cx = 200, cy = 200, r = 196;
    const slice = 360 / n;
    const fontSize = Math.max(4, Math.min(13, (2 * Math.PI * 150 / n) * 0.6));
    for (let i = 0; i < n; i++) {
      const a0 = (i * slice - 90) * Math.PI / 180;
      const a1 = ((i + 1) * slice - 90) * Math.PI / 180;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const light = i % 2 === 1;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + cx + ' ' + cy + ' L' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
        ' A' + r + ' ' + r + ' 0 ' + (slice > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z');
      path.setAttribute('fill', light ? '#ffffff' : '#0b2a6b');
      path.setAttribute('stroke', '#0b2a6b');
      path.setAttribute('stroke-width', '0.5');
      svg.appendChild(path);

      const mid = (i + 0.5) * slice - 90;
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('transform', 'rotate(' + mid + ' ' + cx + ' ' + cy + ')');
      label.setAttribute('x', cx + 186);
      label.setAttribute('y', cy + fontSize * 0.35);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', fontSize.toFixed(2));
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', light ? '#0b2a6b' : '#ffffff');
      const name = members[i].name;
      label.textContent = name.length > 20 ? name.slice(0, 19) + '…' : name;
      svg.appendChild(label);
    }
    const hub = document.createElementNS(NS, 'circle');
    hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', 22);
    hub.setAttribute('fill', '#ffd400'); hub.setAttribute('stroke', '#0b2a6b'); hub.setAttribute('stroke-width', '4');
    svg.appendChild(hub);
  }

  function setSpinEnabled(on) {
    go.disabled = !on;
    lever.disabled = !on;
  }

  function updateCount() {
    count.textContent = members.length + (members.length === 1 ? ' name' : ' names') + ' left on the wheel';
    setSpinEnabled(members.length > 0);
    if (!members.length) result.textContent = 'Everyone has had their spin.';
  }

  async function load() {
    result.textContent = '';
    try {
      const res = await fetch(API + '/board', { cache: 'no-store' });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { members = []; result.textContent = data.error || 'The wheel is not available right now.'; }
      else members = data.members || [];
    } catch (err) {
      members = [];
      result.textContent = 'Could not reach the hub. Check your connection.';
    }
    drawWheel();
    updateCount();
  }

  async function spin() {
    if (spinning || !members.length) return;
    spinning = true;
    setSpinEnabled(false);
    result.textContent = '';
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { result.textContent = data.error || 'The wheel is not available right now.'; return; }

      const winner = data.winner;
      const n = members.length;
      const idx = members.findIndex(function (m) { return m.id === winner.id; });
      if (idx >= 0) {
        const slice = 360 / n;
        // Rotation that puts the winner's slice centre under the pointer at the top, with a little
        // jitter inside the slice so the stop point looks natural.
        const target = (360 - ((idx + 0.5) * slice) % 360) % 360;
        const jitter = (Math.random() - 0.5) * slice * 0.8;
        rotation = Math.floor(rotation / 360) * 360 + 360 * 5 + target + jitter;
        setRotation(rotation, true);
        await new Promise(function (resolve) { window.setTimeout(resolve, SPIN_MS + 150); });
      }

      members = members.filter(function (m) { return m.id !== winner.id; });
      result.textContent = winner.name + ' is out!';
      drawWheel();
      updateCount();
    } catch (err) {
      result.textContent = 'Could not reach the hub. Check your connection.';
    } finally {
      spinning = false;
      setSpinEnabled(members.length > 0);
    }
  }

  head.addEventListener('click', function () {
    if (!dialog.open) dialog.showModal();
    load();
  });
  closeBtn.addEventListener('click', function () { if (!spinning) dialog.close(); });
  go.addEventListener('click', spin);
  lever.addEventListener('click', spin);
})();
