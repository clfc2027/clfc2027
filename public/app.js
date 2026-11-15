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
  const API = 'https://coaches-board.clfc2027.workers.dev/api/duties/check';

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
