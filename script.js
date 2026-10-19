'use strict';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const urlDefaults = { display: 'rings', quota: 'normal', sweep: '180', scanner: '0', contribution: '0' };
function updateURL(key, value) {
  const url = new URL(window.location.href);
  if (String(value) === urlDefaults[key]) url.searchParams.delete(key);
  else url.searchParams.set(key, String(value));
  if (url.href !== window.location.href) history.replaceState(history.state, '', url);
}

// Preserve native details/summary semantics and no-script behavior. Height is
// animated here because the disclosure needs to move subsequent content in flow.
class Disclosure {
  constructor(element, key) {
    this.element = element;
    this.summary = element.querySelector('summary');
    this.content = element.querySelector('.project-detail');
    this.key = key;
    this.expanded = element.open;
    this.animation = null;
    this.settle(this.expanded);
    this.summary.addEventListener('click', event => {
      event.preventDefault();
      this.set(!this.expanded);
    });
    element.addEventListener('toggle', () => {
      if (!this.animation && element.open !== this.expanded) this.settle(element.open);
    });
  }
  settle(open) {
    if (this.animation) {
      this.animation.onfinish = null;
      this.animation.cancel();
      this.animation = null;
    }
    this.expanded = open;
    this.element.open = open;
    this.summary.setAttribute('aria-expanded', String(open));
    this.content.inert = !open;
    this.content.setAttribute('aria-hidden', String(!open));
    this.element.style.removeProperty('height');
    this.element.style.removeProperty('overflow');
  }
  set(open, { animate = true, sync = true } = {}) {
    if (sync) updateURL(this.key, open ? '1' : '0');
    if (this.expanded === open && !this.animation) return;
    if (!animate || reduced.matches || !this.element.animate) {
      this.settle(open);
      return;
    }
    // Read the current animated height before canceling, so rapid reversals
    // continue from the exact visible position instead of jumping to an endpoint.
    const start = this.element.getBoundingClientRect().height;
    if (this.animation) {
      this.animation.onfinish = null;
      this.animation.cancel();
    }
    this.element.style.height = start + 'px';
    this.element.style.overflow = 'hidden';
    this.element.open = true;
    this.expanded = open;
    this.summary.setAttribute('aria-expanded', String(open));
    this.content.inert = !open;
    this.content.setAttribute('aria-hidden', String(!open));
    const collapsed = this.summary.getBoundingClientRect().height;
    const expanded = collapsed + this.content.getBoundingClientRect().height;
    const end = open ? expanded : collapsed;
    const duration = Math.max(160, Math.min(420, Math.abs(end - start) / Math.max(1, expanded - collapsed) * 420));
    this.animation = this.element.animate(
      [{ height: start + 'px' }, { height: end + 'px' }],
      { duration, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
    this.animation.onfinish = () => this.settle(open);
  }
}
const disclosures = [...document.querySelectorAll('details')].map((element, i) => new Disclosure(element, i === 0 ? 'scanner' : 'contribution'));
window.addEventListener('resize', () => {
  for (const disclosure of disclosures) if (disclosure.animation) disclosure.settle(disclosure.expanded);
}, { passive: true });

const canvas = document.querySelector('#scan-canvas');
const slider = document.querySelector('#sweep');
const angleLabel = document.querySelector('#scan-angle');
function drawScan() {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.closest('.scanner-stage').classList.add('is-interactive');
  const w = canvas.width, h = canvas.height;
  const sweep = Number(slider.value);
  ctx.clearRect(0, 0, w, h);
  const project = (x, y, z) => [w * .5 + (x * .89 - z * .46) * 1.25, h * .55 + (x * .22 + z * .4 - y) * 1.25];
  // Illustrative sampling geometry, not recordings from the hardware.
  for (let row = 0; row < 25; row++) {
    const y = row * 11 - 95;
    const radius = 82 + 30 * Math.sin(row / 24 * Math.PI) + 14 * Math.cos(row / 24 * Math.PI * 2);
    for (let deg = 0; deg < 360; deg += 7.5) {
      const rad = deg * Math.PI / 180;
      const [px, py] = project(Math.cos(rad) * radius, y, Math.sin(rad) * radius);
      ctx.fillStyle = deg <= sweep ? '#dafa9c' : '#62695c';
      ctx.beginPath(); ctx.arc(px, py, deg <= sweep ? 2.5 : 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.lineWidth = 2; ctx.strokeStyle = '#9aab87'; ctx.beginPath();
  for (let deg = 0; deg <= 360; deg += 3) {
    const rad = deg * Math.PI / 180;
    const [x, y] = project(Math.cos(rad) * 185, -120, Math.sin(rad) * 185);
    deg ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  const rad = sweep * Math.PI / 180;
  const [sx, sy] = project(Math.cos(rad) * 185, 10, Math.sin(rad) * 185);
  const [ex, ey] = project(Math.cos(rad) * 108, 10, Math.sin(rad) * 108);
  ctx.strokeStyle = '#dafa9c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = '#dafa9c'; ctx.fillRect(sx - 10, sy - 10, 20, 20);
  angleLabel.textContent = sweep + '° sweep';
  slider.setAttribute('aria-valuetext', sweep + ' degree sweep');
}
slider.addEventListener('input', drawScan);
slider.addEventListener('change', () => updateURL('sweep', slider.value));

// The display study uses example values; it never reads account data.
const codexDemo = document.querySelector('.codex-demo');
codexDemo.classList.add('is-interactive');
const displayButtons = [...document.querySelectorAll('[data-display]')];
const quotaButtons = [...document.querySelectorAll('[data-quota]')];
function setDisplay(mode, sync = true) {
  const rings = mode !== 'readout';
  document.querySelector('#quota-rings').hidden = !rings;
  document.querySelector('#quota-readout').hidden = rings;
  for (const button of displayButtons) button.setAttribute('aria-pressed', String(button.dataset.display === (rings ? 'rings' : 'readout')));
  if (sync) updateURL('display', rings ? 'rings' : 'readout');
}
function setQuota(state, sync = true) {
  if (!['normal', 'low', 'stale'].includes(state)) state = 'normal';
  const low = state === 'low';
  const value = low ? 12 : 72;
  const prefix = state === 'stale' ? '~' : '';
  codexDemo.classList.toggle('is-low', low);
  document.querySelector('#five-hour-ring').setAttribute('stroke-dasharray', value + ' 100');
  document.querySelector('#five-hour-number').textContent = prefix + value;
  document.querySelector('#five-hour-title').textContent = '5-hour window: ' + value + ' percent remaining' + (state === 'stale' ? ', last known reading' : '');
  document.querySelector('#readout-five-hour').textContent = prefix + value + '%';
  document.querySelector('#readout-fill').style.transform = 'scaleX(' + value / 100 + ')';
  document.querySelector('#demo-status').textContent = low
    ? '12% remains in the 5-hour window. A warning appears below 20%.'
    : state === 'stale' ? 'Last-known values stay visible when a refresh fails.' : 'Two windows. One glance.';
  for (const button of quotaButtons) button.setAttribute('aria-pressed', String(button.dataset.quota === state));
  if (sync) updateURL('quota', state);
}
for (const button of displayButtons) button.addEventListener('click', () => setDisplay(button.dataset.display));
for (const button of quotaButtons) button.addEventListener('click', () => setQuota(button.dataset.quota));
function restoreURLState() {
  const params = new URL(window.location.href).searchParams;
  setDisplay(params.get('display'), false);
  setQuota(params.get('quota'), false);
  const rawSweep = params.get('sweep');
  const sweep = rawSweep === null ? 180 : Number(rawSweep);
  slider.value = Number.isFinite(sweep) ? Math.max(0, Math.min(360, Math.round(sweep))) : 180;
  drawScan();
  for (const disclosure of disclosures) disclosure.set(params.get(disclosure.key) === '1', { animate: false, sync: false });
}
restoreURLState();
window.addEventListener('popstate', restoreURLState);

// Move only the dark field above a permanent white hero background. Stop
// updating after the name passes; never expose dark bands behind the intro.
// Geometry is cached on resize, never read in scroll work.
const hero = document.querySelector('.hero');
let heroTop = 0, heroEffectEnd = 1, scrollFrame = 0, lastShift = null;
function paintHero() {
  scrollFrame = 0;
  const travel = Math.max(0, Math.min(heroEffectEnd, window.scrollY - heroTop));
  const shift = reduced.matches ? 0 : -travel * .72;
  if (shift !== lastShift) {
    hero.style.setProperty('--hero-shift', shift + 'px');
    lastShift = shift;
  }
}
function queueHero() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(paintHero);
}
function measureHero() {
  const rect = hero.getBoundingClientRect();
  heroTop = rect.top + window.scrollY;
  heroEffectEnd = Math.max(0, hero.querySelector('h1').getBoundingClientRect().bottom - rect.top);
  queueHero();
}
window.addEventListener('scroll', queueHero, { passive: true });
window.addEventListener('resize', measureHero, { passive: true });
window.addEventListener('pageshow', measureHero);
measureHero();
document.fonts.ready.then(measureHero);

// The page stays readable before JavaScript. Entrances are short and optional.
const motionAnimations = new Set();
function entrance(element, frames, options) {
  if (reduced.matches) return;
  const animation = element.animate(frames, options);
  motionAnimations.add(animation);
  animation.finished.then(() => motionAnimations.delete(animation), () => motionAnimations.delete(animation));
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entrance(entry.target,
        [{ transform: 'translateY(22px)', opacity: .55 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 920, easing: 'cubic-bezier(.16,1,.3,1)', delay: Number(entry.target.dataset.delay || 0) }
      );
      observer.unobserve(entry.target);
    }
  }, { threshold: .1 });
  document.querySelectorAll('.platform-photo,.demo-heading,.demo-styles,.quota-window,.demo-scenarios,.demo-status,.section-intro h2,.section-intro>p,.project-index a,.project-copy h3,.project-subtitle,.project-copy>p:not(.project-subtitle),.project-facts,.project-link,.scanner-stage,.codex-demo,.about-columns p,.contact h2,.contact-row p,.contact-row a,.footer-name').forEach((el, i) => {
    el.dataset.delay = String((i % 3) * 65);
    observer.observe(el);
  });
}
document.querySelectorAll('.hero h1 span').forEach((el, i) => entrance(el,
  [{ transform: 'translateY(75px)' }, { transform: 'translateY(0)' }],
  { duration: 900, delay: i * 90, easing: 'cubic-bezier(.16,1,.3,1)' }
));
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    for (const disclosure of disclosures) disclosure.settle(disclosure.expanded);
    for (const animation of motionAnimations) animation.cancel();
    motionAnimations.clear();
  }
  queueHero();
});
