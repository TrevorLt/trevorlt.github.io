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
const scanTurns = 6, scanLanes = 4, scanSamples = scanTurns * 96;
let scanProgress = .5, scanTarget = .5, scanFrame = 0, scanLastTime = 0;
// Four adjacent helical sampling tracks are an illustrative reveal, not a
// claim that the single-sensor prototype captures four physical rows at once.
function scanPoint(t, lane) {
  const row = t * 24 + lane;
  const u = row / 27;
  const radius = 82 + 30 * Math.sin(u * Math.PI) + 14 * Math.cos(u * Math.PI * 2);
  const angle = t * scanTurns * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: row * 10 - 105, z: Math.sin(angle) * radius };
}
const scanCloud = Array.from({ length: (scanSamples + 1) * scanLanes }, (_, i) => {
  const t = Math.floor(i / scanLanes) / scanSamples;
  return { ...scanPoint(t, i % scanLanes), t };
});
function drawScan() {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.closest('.scanner-stage').classList.add('is-interactive');
  const w = canvas.width, h = canvas.height, p = scanProgress;
  const project = ({ x, y, z }) => ({ x: w * .5 + (x * .89 - z * .46) * 1.25, y: h * .55 + (x * .22 + z * .4 - y) * 1.25, depth: x * .46 + z * .89 });
  ctx.clearRect(0, 0, w, h);
  // Ground plane stays still; the sampling head winds upward around the object.
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#80936c'; ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const a = i / 120 * Math.PI * 2;
    const q = project({ x: Math.cos(a) * 185, y: -128, z: Math.sin(a) * 185 });
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  }
  ctx.stroke();
  const items = scanCloud.map(point => ({ ...project(point), point, kind: 'point' }));
  // Short, fading tracks make the spiral legible without covering the cloud.
  if (p > 0) for (let lane = 0; lane < scanLanes; lane++) {
    const start = Math.max(0, p - 1.15 / scanTurns);
    const steps = Math.max(1, Math.ceil((p - start) * 900));
    for (let i = 0; i < steps; i++) {
      const t = start + (p - start) * i / steps;
      const a = project(scanPoint(t, lane));
      const b = project(scanPoint(start + (p - start) * (i + 1) / steps, lane));
      items.push({ kind: 'trail', depth: (a.depth + b.depth) / 2, a, b, alpha: .12 + .55 * i / steps });
    }
  }
  const angle = p * scanTurns * Math.PI * 2;
  const center = scanPoint(p, 1.5);
  const tip = project(center);
  const sensor = project({ x: Math.cos(angle) * 180, y: center.y, z: Math.sin(angle) * 180 });
  items.push({ kind: 'needle', depth: (sensor.depth + tip.depth) / 2, sensor, tip });
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) {
    const front = item.depth > 0;
    if (item.kind === 'point') {
      const captured = p > 0 && item.point.t <= p;
      const edge = captured ? Math.max(0, 1 - (p - item.point.t) * 75) : 0;
      ctx.fillStyle = captured ? `rgba(218,250,156,${(front ? .84 : .38) + edge * .14})` : `rgba(139,151,125,${front ? .28 : .13})`;
      ctx.beginPath(); ctx.arc(item.x, item.y, captured ? 2 + edge * .8 : 1.25, 0, Math.PI * 2); ctx.fill();
    } else if (item.kind === 'trail') {
      ctx.strokeStyle = `rgba(218,250,156,${item.alpha * (front ? 1 : .4)})`;
      ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(item.a.x, item.a.y); ctx.lineTo(item.b.x, item.b.y); ctx.stroke();
    } else {
      ctx.globalAlpha = front ? 1 : .5;
      // The whole needle follows the head's angle AND height, including its base.
      ctx.strokeStyle = '#dafa9c'; ctx.lineWidth = 2.5; ctx.beginPath();
      ctx.moveTo(sensor.x, sensor.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.save(); ctx.translate(sensor.x, sensor.y); ctx.rotate(Math.atan2(tip.y - sensor.y, tip.x - sensor.x));
      ctx.fillStyle = '#dafa9c'; ctx.fillRect(-7, -7, 14, 14); ctx.restore();
      for (let lane = 0; lane < scanLanes; lane++) {
        const q = project(scanPoint(p, lane));
        ctx.fillStyle = '#edffc9'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  angleLabel.textContent = Math.round(p * 100) + '% scanned';
}
function settleScan() {
  cancelAnimationFrame(scanFrame); scanFrame = 0; scanLastTime = 0;
  scanProgress = scanTarget; drawScan();
}
function animateScan(now) {
  const dt = scanLastTime ? Math.min(40, now - scanLastTime) : 16;
  scanLastTime = now;
  scanProgress += (scanTarget - scanProgress) * (1 - Math.exp(-dt / 65));
  if (Math.abs(scanTarget - scanProgress) < .00008) { settleScan(); return; }
  drawScan(); scanFrame = requestAnimationFrame(animateScan);
}
function updateScan(animate = true) {
  scanTarget = Number(slider.value) / 360;
  slider.setAttribute('aria-valuetext', Math.round(scanTarget * 100) + ' percent scanned; six spiral turns, four rows at a time');
  if (!animate || reduced.matches) settleScan();
  else if (!scanFrame) { scanLastTime = 0; scanFrame = requestAnimationFrame(animateScan); }
}
slider.addEventListener('input', () => updateScan());
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
const quotaUI = {
  ring: document.querySelector('#five-hour-ring'),
  number: document.querySelector('#five-hour-number'),
  title: document.querySelector('#five-hour-title'),
  readout: document.querySelector('#readout-five-hour'),
  fill: document.querySelector('#readout-fill'),
  status: document.querySelector('#demo-status')
};
const quotaStyle = getComputedStyle(codexDemo);
const rgbFromHex = hex => hex.trim().replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16));
const quotaGreen = rgbFromHex(quotaStyle.getPropertyValue('--demo-accent'));
const quotaRed = rgbFromHex(quotaStyle.getPropertyValue('--demo-warning'));
let quotaValue = 72, quotaTarget = 72, quotaState = 'normal', quotaFrame = 0;
function renderQuota(value) {
  quotaValue = value;
  const rounded = Math.round(value);
  const stale = quotaState === 'stale';
  const prefix = stale ? '~' : '';
  // Color follows the displayed value, not the clicked button. Blend from
  // green at 20% to red at 12%, and reverse the same path as quota recovers.
  const warning = Math.max(0, Math.min(1, (20 - value) / 8));
  const blend = warning * warning * (3 - 2 * warning);
  const color = 'rgb(' + quotaGreen.map((channel, i) => Math.round(channel + (quotaRed[i] - channel) * blend)).join(', ') + ')';
  quotaUI.ring.setAttribute('stroke-dasharray', value.toFixed(3) + ' 100');
  quotaUI.ring.style.stroke = color;
  quotaUI.fill.style.transform = 'scaleX(' + value / 100 + ')';
  quotaUI.fill.style.backgroundColor = color;
  quotaUI.number.textContent = prefix + rounded;
  quotaUI.readout.textContent = prefix + rounded + '%';
  quotaUI.title.textContent = '5-hour window: ' + rounded + ' percent remaining' + (stale ? ', last known reading' : '');
}
function finishQuota() {
  cancelAnimationFrame(quotaFrame);
  quotaFrame = 0;
  renderQuota(quotaTarget);
}
function setQuota(state, sync = true) {
  if (!['normal', 'low', 'stale'].includes(state)) state = 'normal';
  cancelAnimationFrame(quotaFrame);
  quotaFrame = 0;
  quotaState = state;
  quotaTarget = state === 'low' ? 12 : 72;
  const startValue = quotaValue;
  renderQuota(startValue);
  quotaUI.status.textContent = state === 'low'
    ? '12% remains in the 5-hour window. A warning appears below 20%.'
    : state === 'stale' ? 'Last-known values stay visible when a refresh fails.' : 'Two windows. One glance.';
  for (const button of quotaButtons) button.setAttribute('aria-pressed', String(button.dataset.quota === state));
  if (sync) updateURL('quota', state);
  // Loading a shared state is immediate. User-triggered changes animate from
  // the current frame, even when a previous transition is interrupted.
  if (!sync || reduced.matches || Math.abs(quotaTarget - startValue) < .001) {
    finishQuota();
    settleScan();
    return;
  }
  const startTime = performance.now();
  const duration = Math.max(420, 1300 * Math.abs(quotaTarget - startValue) / 60);
  const target = quotaTarget;
  function tick(now) {
    const progress = Math.max(0, Math.min(1, (now - startTime) / duration));
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    renderQuota(startValue + (target - startValue) * eased);
    if (progress < 1) quotaFrame = requestAnimationFrame(tick);
    else {
      quotaFrame = 0;
      renderQuota(target);
    }
  }
  quotaFrame = requestAnimationFrame(tick);
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
  updateScan(false);
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
      // Content visible on arrival must never restart an entrance after paint.
      if (entry.target.dataset.scrollEntrance === 'true') entrance(entry.target,
        [{ opacity: .55 }, { opacity: 1 }],
        { duration: 920, easing: 'cubic-bezier(.16,1,.3,1)', delay: Number(entry.target.dataset.delay || 0) }
      );
      observer.unobserve(entry.target);
    }
  }, { threshold: .1 });
  document.querySelectorAll('.platform-photo,.demo-heading,.demo-styles,.quota-window,.demo-scenarios,.demo-status,.section-intro h2,.section-intro>p,.project-index a,.project-copy h3,.project-subtitle,.project-copy>p:not(.project-subtitle),.project-facts,.project-link,.scanner-stage,.codex-demo,.about-columns p,.contact h2,.contact-row p,.contact-row a,.footer-name').forEach((el, i) => {
    el.dataset.delay = String((i % 3) * 65);
    el.dataset.scrollEntrance = String(el.getBoundingClientRect().top >= window.innerHeight);
    observer.observe(el);
  });
}
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    finishQuota();
    settleScan();
    for (const disclosure of disclosures) disclosure.settle(disclosure.expanded);
    for (const animation of motionAnimations) animation.cancel();
    motionAnimations.clear();
  }
  queueHero();
});
