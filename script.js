'use strict';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const urlDefaults = { display: 'rings', quota: 'normal', sweep: '0', scanner: '0', contribution: '0' };
function updateURL(key, value) {
  const url = new URL(window.location.href);
  if (value === null || String(value) === urlDefaults[key]) url.searchParams.delete(key);
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
let scanProgress = 0, scanTarget = 0, scanFrame = 0, scanLastTime = 0;
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
  weeklyRing: document.querySelector('#weekly-ring'),
  weeklyNumber: document.querySelector('#weekly-number'),
  weeklyTitle: document.querySelector('#weekly-title'),
  weeklyReadout: document.querySelector('#readout-weekly'),
  weeklyFill: document.querySelector('#readout-weekly-fill'),
  status: document.querySelector('#demo-status')
};
const quotaStyle = getComputedStyle(codexDemo);
const rgbFromHex = hex => hex.trim().replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16));
const quotaGreen = rgbFromHex(quotaStyle.getPropertyValue('--demo-accent'));
const quotaRed = rgbFromHex(quotaStyle.getPropertyValue('--demo-warning'));
let quotaValue = 72, quotaWeeklyValue = 54, quotaTarget = 72, quotaWeeklyTarget = 54;
let quotaState = 'normal', quotaModeValue = 72, quotaIsRecharged = false, quotaFrame = 0;
function renderQuota(value, weekly = 54 + (value - 72) * .175) {
  quotaValue = value;
  quotaWeeklyValue = weekly;
  const rounded = Math.round(value);
  const stale = quotaState === 'stale';
  const prefix = stale ? '~' : '';
  // Color follows the displayed value, not the clicked button. Blend from
  // green at 20% to red at 12%, and reverse the same path as quota recovers.
  const warning = Math.max(0, Math.min(1, (20 - value) / 8));
  const blend = warning * warning * (3 - 2 * warning);
  const color = 'rgb(' + quotaGreen.map((channel, i) => Math.round(channel + (quotaRed[i] - channel) * blend)).join(', ') + ')';
  quotaUI.ring.setAttribute('stroke-dasharray', value >= 100 ? 'none' : value.toFixed(3) + ' 100');
  quotaUI.ring.style.stroke = color;
  quotaUI.fill.style.transform = 'scaleX(' + value / 100 + ')';
  quotaUI.fill.style.backgroundColor = color;
  quotaUI.number.textContent = prefix + rounded;
  quotaUI.readout.textContent = prefix + rounded + '%';
  quotaUI.title.textContent = '5-hour window: ' + rounded + ' percent remaining' + (stale ? ', last known reading' : '');
  // Demo assumption: one full 5-hour allowance is 17.5% of a weekly allowance.
  // Midpoint of the user-supplied 15–20% range, not an asserted plan limit.
  // Both windows derive from the same animated value, including reversals.
  const weeklyLabel = String(Math.round(weekly));
  quotaUI.weeklyRing.setAttribute('stroke-dasharray', weekly >= 100 ? 'none' : weekly.toFixed(3) + ' 100');
  quotaUI.weeklyFill.style.transform = 'scaleX(' + weekly / 100 + ')';
  quotaUI.weeklyNumber.textContent = prefix + weeklyLabel;
  quotaUI.weeklyReadout.textContent = prefix + weeklyLabel + '%';
  quotaUI.weeklyTitle.textContent = 'Weekly window: ' + weeklyLabel + ' percent remaining' + (stale ? ', last known reading' : '');
}
function finishQuota() {
  cancelAnimationFrame(quotaFrame);
  quotaFrame = 0;
  renderQuota(quotaTarget, quotaWeeklyTarget);
  codexDemo.classList.remove('is-recharging');
  if (quotaIsRecharged) quotaUI.status.textContent = 'Both usage windows are full in this example.';
}
function setQuota(state, sync = true, recharge = false) {
  if (!['normal', 'low', 'stale'].includes(state)) state = 'normal';
  const wasAnimating = quotaFrame !== 0, wasRecharged = quotaIsRecharged;
  cancelAnimationFrame(quotaFrame);
  quotaFrame = 0;
  if (state !== 'stale') quotaModeValue = state === 'low' ? 12 : 72;
  if (recharge && wasRecharged && !wasAnimating) {
    quotaValue = quotaModeValue;
    quotaWeeklyValue = 54 + (quotaModeValue - 72) * .175;
  }
  quotaState = state;
  // Last known freezes the selected example reading, not the temporary recharge.
  quotaTarget = recharge ? 100 : state === 'stale' && wasRecharged ? quotaModeValue : state === 'stale' ? quotaValue : state === 'low' ? 12 : 72;
  quotaWeeklyTarget = recharge ? 100 : 54 + (quotaTarget - 72) * .175;
  quotaIsRecharged = recharge;
  if (recharge) codexDemo.classList.add('is-recharging');
  else codexDemo.classList.remove('is-recharging');
  const startValue = quotaValue, startWeekly = quotaWeeklyValue;
  renderQuota(startValue, startWeekly);
  quotaUI.status.textContent = recharge ? 'Recharging both usage windows.' : state === 'low'
    ? '12% remains in the 5-hour window. A warning appears below 20%.'
    : state === 'stale' ? 'Last-known values stay visible when a refresh fails.' : 'Two windows. One glance.';
  for (const button of quotaButtons) button.setAttribute('aria-pressed', String(button.dataset.quota === state));
  if (sync) {
    updateURL('quota', state);
    updateURL('quotaValue', state === 'stale' && !recharge ? quotaTarget : null);
  }
  // Loading a shared state is immediate. User-triggered changes animate from
  // the current frame, even when a previous transition is interrupted.
  if ((!sync && !recharge) || reduced.matches || (!recharge && Math.abs(quotaTarget - startValue) < .001)) {
    finishQuota();
    return;
  }
  const startTime = performance.now();
  const duration = recharge ? 920 : Math.max(420, 1300 * Math.abs(quotaTarget - startValue) / 60);
  const target = quotaTarget, weeklyTarget = quotaWeeklyTarget;
  function tick(now) {
    const progress = Math.max(0, Math.min(1, (now - startTime) / duration));
    const eased = recharge ? 1 - (1 - progress) ** 3 : progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    renderQuota(startValue + (target - startValue) * eased, startWeekly + (weeklyTarget - startWeekly) * eased);
    if (progress < 1) quotaFrame = requestAnimationFrame(tick);
    else {
      quotaFrame = 0;
      renderQuota(target, weeklyTarget);
      codexDemo.classList.remove('is-recharging');
      if (recharge) quotaUI.status.textContent = 'Both usage windows are full in this example.';
    }
  }
  quotaFrame = requestAnimationFrame(tick);
}
document.querySelector('.recharge-button').addEventListener('click', () => setQuota(quotaState, false, true));
for (const button of displayButtons) button.addEventListener('click', () => setDisplay(button.dataset.display));
for (const button of quotaButtons) button.addEventListener('click', () => setQuota(button.dataset.quota));
function restoreURLState() {
  const params = new URL(window.location.href).searchParams;
  setDisplay(params.get('display'), false);
  const savedValue = Number(params.get('quotaValue')?.trim() || NaN);
  quotaIsRecharged = false;
  quotaValue = params.get('quota') === 'stale' && Number.isFinite(savedValue) && savedValue >= 0 && savedValue <= 100
    ? savedValue : 72;
  quotaWeeklyValue = 54 + (quotaValue - 72) * .175;
  quotaModeValue = quotaValue;
  setQuota(params.get('quota'), false);
  const rawSweep = params.get('sweep');
  const sweep = rawSweep === null ? 0 : Number(rawSweep);
  slider.value = Number.isFinite(sweep) ? Math.max(0, Math.min(360, Math.round(sweep))) : 0;
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

// Sections render at full opacity from first paint; animate only user interactions.
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    finishQuota();
    settleScan();
    for (const disclosure of disclosures) disclosure.settle(disclosure.expanded);
  }
  queueHero();
});
