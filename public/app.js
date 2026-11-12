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
