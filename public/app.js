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

      const venue = data.venue === 'home' ? ' (home)' : data.venue === 'away' ? ' (away)' : '';
      const first = (data.name || '').split(' ')[0];
      if (!data.round) return show('Hi ' + first + ', no game day duties have been allocated yet.', false);
      if (!data.duties.length) {
        return show('Hi ' + first + ', you are not on game day duty in Round ' + data.round + venue + '.', false);
      }
      const p = show('Hi ' + first + ', you are on game day duty in Round ' + data.round + venue + ':', false);
      const list = document.createElement('ul');
      data.duties.forEach(function (d) {
        const li = document.createElement('li');
        li.textContent = d.grade + ' · ' + d.duty;
        list.appendChild(li);
      });
      result.appendChild(list);
    } catch (err) {
      show('Could not check right now. Try again shortly.', true);
    }
  });
})();
