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
const heroName = hero.querySelector('#tech-text-root');
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
  heroEffectEnd = Math.max(0, heroName.getBoundingClientRect().bottom - rect.top);
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

const generatorStage = document.querySelector('#generator-stage');
const generatorFrontRotor = document.querySelector('#generator-front-rotor');
const generatorAssemblyRotor = document.querySelector('#generator-assembly-rotor');
const generatorCrank = document.querySelector('#generator-crank');
const generatorCrankHit = document.querySelector('#generator-crank-hit');
const generatorStatus = document.querySelector('#generator-status');
const generatorHint = document.querySelector('#generator-hint');
const generatorVoltage = document.querySelector('#generator-voltage');
const generatorFrequency = document.querySelector('#generator-frequency');
const generatorVoltageLine = document.querySelector('#generator-voltage-line');
const generatorMeter = document.querySelector('.generator-meter');
const generatorGearPlane = document.querySelector('#generator-gear-plane');
const generatorLightning = document.querySelector('#generator-lightning');
const generatorViewButtons = [...generatorStage.querySelectorAll('[data-generator-view]')];
const generatorCrankCenter = { x: 88, y: 0 };
let generatorAngle = 0, generatorSpeed = 0, generatorDragging = false, generatorPointerAngle = 0, generatorPointerTime = 0;
let generatorFrame = 0, generatorLastFrame = 0, generatorFrontAngle = 0, generatorLastKeyTurn = 0;
let generatorMeterTimer = 0, generatorLightningTimer = 0;
const maxCrankSpeed = 30 * Math.PI * 2;
function pulseGeneratorLightning() {
  if (reduced.matches || generatorStage.dataset.view !== 'rotor' || document.hidden) return;
  const coils = document.querySelectorAll('#generator-front-coils use');
  const coilIndex = Math.floor(Math.random() * coils.length);
  const coilMatrix = coils[coilIndex].transform.baseVal.consolidate().matrix;
  const origin = new DOMPoint((Math.random() - .5) * 36, 20 + Math.random() * 8).matrixTransform(coilMatrix);
  const startX = origin.x, startY = origin.y;
  const radius = Math.hypot(startX - 280, startY - 245);
  const dx = (startX - 280) / radius, dy = (startY - 245) / radius;
  generatorLightning.dataset.coilIndex = String(coilIndex);
  generatorLightning.querySelector('.generator-cloud').setAttribute('d', 'M' + (startX - 38) + ' ' + startY + 'q35-22 76 0');
  const points = [[startX, startY]];
  for (let i = 1; i <= 11; i++) {
    const jitter = (Math.random() - .5) * 25;
    points.push([startX + dx * i * 9 - dy * jitter, startY + dy * i * 9 + dx * jitter]);
  }
  let path = points.map(([x,y], index) => (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const fork = points[4];
  path += 'M' + fork[0] + ' ' + fork[1] + 'l' + (dx * 23 - dy * 22) + ' ' + (dy * 23 + dx * 22) + 'l' + dx * 19 + ' ' + dy * 19;
  generatorLightning.classList.remove('is-flashing');
  generatorLightning.querySelectorAll('[pathLength]').forEach(bolt => bolt.setAttribute('d', path));
  void generatorLightning.getBoundingClientRect();
  generatorLightning.classList.add('is-flashing');
}
function scheduleGeneratorLightning() {
  clearTimeout(generatorLightningTimer);
  generatorLightningTimer = 0;
  if (reduced.matches || generatorStage.dataset.view !== 'rotor' || document.hidden) return;
  generatorLightningTimer = setTimeout(() => { pulseGeneratorLightning(); scheduleGeneratorLightning(); }, 1800 + Math.random() * 2400);
}
function gearPath(teeth, rootRadius, tipRadius) {
  const points = [];
  for (let i = 0; i < teeth; i++) {
    const angle = i * Math.PI * 2 / teeth;
    for (const [offset, radius] of [[0, rootRadius], [.18, rootRadius], [.27, tipRadius], [.73, tipRadius], [.82, rootRadius], [1, rootRadius]]) {
      const a = angle + offset * Math.PI * 2 / teeth;
      points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
  }
  return points.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ') + 'Z';
}
// The opposite gear's tooth clears each root at the 88-unit center distance.
document.querySelector('.generator-small-gear-path').setAttribute('d', gearPath(14, 18, 25));
document.querySelector('.generator-large-gear-path').setAttribute('d', gearPath(42, 62, 69));
function updateGeneratorVoltage() {
  // shortcut: scales linearly from the report's single 25 Hz test point, update when a measured speed/output curve is available.
  const frequency = Math.min(30, Math.abs(generatorSpeed) / (Math.PI * 2));
  const voltage = 2.72 * frequency / 25;
  const visibleCycles = Math.max(2, frequency * .1);
  generatorVoltage.value = voltage.toFixed(2) + ' V';
  generatorFrequency.value = frequency.toFixed(1) + ' Hz';
  generatorVoltageLine.setAttribute('d', Array.from({ length: 129 }, (_, index) => {
    const x = 35 + index / 128 * 277;
    const sample = voltage * Math.sin(index / 128 * visibleCycles * Math.PI * 2 + generatorAngle * 12);
    const y = 64 - sample / 3.3 * 44;
    return (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' '));
}
function scheduleGeneratorMeter() {
  clearInterval(generatorMeterTimer);
  generatorMeterTimer = 0;
  if (generatorStage.dataset.view === 'assembly' && !document.hidden) generatorMeterTimer = setInterval(updateGeneratorVoltage, 100);
}
function renderGenerator() {
  const crankDegrees = generatorAngle * 180 / Math.PI;
  const rotorDegrees = -crankDegrees * 3;
  generatorFrontRotor.setAttribute('transform', 'rotate(' + generatorFrontAngle + ' 280 245)');
  generatorAssemblyRotor.setAttribute('transform', 'rotate(' + rotorDegrees + ')');
  document.querySelector('#generator-small-gear').setAttribute('transform', 'rotate(' + (rotorDegrees + 180 / 14) + ')');
  document.querySelector('#generator-large-gear').setAttribute('transform', 'rotate(' + crankDegrees + ' ' + generatorCrankCenter.x + ' ' + generatorCrankCenter.y + ')');
  generatorCrank.setAttribute('transform', 'rotate(' + crankDegrees + ' ' + generatorCrankCenter.x + ' ' + generatorCrankCenter.y + ')');
}
function animateGenerator(now) {
  generatorFrame = 0;
  const elapsed = generatorLastFrame ? Math.min(.05, (now - generatorLastFrame) / 1000) : 0;
  generatorLastFrame = now;
  if (generatorStage.dataset.view === 'rotor') {
    if (!reduced.matches) {
      generatorFrontAngle = (generatorFrontAngle + elapsed * 360 * .28) % 360;
      generatorFrontRotor.setAttribute('transform', 'rotate(' + generatorFrontAngle + ' 280 245)');
      generatorFrame = requestAnimationFrame(animateGenerator);
    }
    return;
  }
  if (!generatorDragging && Math.abs(generatorSpeed) > .025) {
    generatorAngle += generatorSpeed * elapsed;
    generatorSpeed *= Math.exp(-elapsed / 2);
  } else if (!generatorDragging) generatorSpeed = 0;
  renderGenerator();
  if (generatorDragging || Math.abs(generatorSpeed) > .025) generatorFrame = requestAnimationFrame(animateGenerator);
}
function scheduleGenerator() {
  if (!generatorFrame) {
    generatorLastFrame = performance.now();
    generatorFrame = requestAnimationFrame(animateGenerator);
  }
}
function setGeneratorView(view) {
  if (view !== 'rotor' && view !== 'assembly') return;
  if (generatorStage.dataset.view === view) return;
  const crankHadFocus = document.activeElement === generatorCrank;
  generatorStage.dataset.view = view;
  generatorMeter.hidden = view !== 'assembly';
  scheduleGeneratorLightning();
  scheduleGeneratorMeter();
  generatorViewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.generatorView === view)));
  document.querySelector('#generator-rotor-view').setAttribute('aria-hidden', String(view !== 'rotor'));
  const assembly = document.querySelector('#generator-assembly-view');
  assembly.setAttribute('aria-hidden', String(view !== 'assembly'));
  generatorCrank.setAttribute('tabindex', view === 'assembly' ? '0' : '-1');
  generatorHint.textContent = view === 'assembly'
    ? 'drag the handle to generate electricity or press Enter'
    : 'Press Full assembly or V to reveal the gears and hand crank.';
  if (view === 'rotor') {
    generatorDragging = false;
    generatorSpeed = 0;
    if (crankHadFocus) generatorViewButtons.find(button => button.dataset.generatorView === 'rotor').focus();
  }
  generatorStatus.textContent = view === 'assembly' ? 'Full assembly view. Turn the crank to update the estimated output voltage.' : 'Rotor view. Press V or choose Full assembly to reveal the drivetrain.';
  renderGenerator();
  scheduleGenerator();
}
function pointerCrankAngle(event) {
  const matrix = generatorGearPlane.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return Math.atan2(point.y - generatorCrankCenter.y, point.x - generatorCrankCenter.x);
}
generatorViewButtons.forEach(button => button.addEventListener('click', () => setGeneratorView(button.dataset.generatorView)));
generatorCrankHit.addEventListener('pointerdown', event => {
  if (generatorStage.dataset.view !== 'assembly' || event.button !== 0) return;
  const angle = pointerCrankAngle(event);
  if (angle === null) return;
  generatorDragging = true;
  generatorPointerAngle = angle;
  generatorPointerTime = performance.now();
  generatorSpeed = 0;
  generatorCrank.focus();
  try { generatorCrankHit.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
  scheduleGenerator();
});
generatorCrankHit.addEventListener('pointermove', event => {
  if (!generatorDragging) return;
  const angle = pointerCrankAngle(event);
  if (angle === null) return;
  const now = performance.now();
  const delta = Math.atan2(Math.sin(angle - generatorPointerAngle), Math.cos(angle - generatorPointerAngle));
  const elapsed = Math.max(.008, (now - generatorPointerTime) / 1000);
  generatorAngle = (generatorAngle + delta) % (Math.PI * 2);
  generatorSpeed = Math.max(-maxCrankSpeed, Math.min(maxCrankSpeed, generatorSpeed * .35 + delta / elapsed * .65));
  generatorPointerAngle = angle;
  generatorPointerTime = now;
  scheduleGenerator();
});
function releaseGeneratorPointer() {
  if (!generatorDragging) return;
  generatorDragging = false;
  scheduleGenerator();
}
generatorCrankHit.addEventListener('pointerup', releaseGeneratorPointer);
generatorCrankHit.addEventListener('pointercancel', releaseGeneratorPointer);
generatorCrank.addEventListener('keydown', event => {
  if (event.repeat) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    accelerateGenerator();
    return;
  }
  const now = performance.now();
  const step = event.key === 'ArrowRight' ? Math.PI / 12 : event.key === 'ArrowLeft' ? -Math.PI / 12 : event.key === ' ' ? Math.PI * 2 : 0;
  if (!step) return;
  event.preventDefault();
  const elapsed = generatorLastKeyTurn ? Math.max(.14, (now - generatorLastKeyTurn) / 1000) : .14;
  generatorAngle = (generatorAngle + step) % (Math.PI * 2);
  generatorSpeed = Math.max(-maxCrankSpeed, Math.min(maxCrankSpeed, step / elapsed));
  generatorLastKeyTurn = now;
  scheduleGenerator();
});
function accelerateGenerator() {
  generatorAngle = (generatorAngle + Math.PI / 6) % (Math.PI * 2);
  generatorSpeed = Math.min(maxCrankSpeed, Math.abs(generatorSpeed) + Math.PI * 2);
  generatorLastKeyTurn = performance.now();
  scheduleGenerator();
}
window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const interactiveTarget = event.target instanceof Element && event.target.closest('button,a,summary,[role="button"],input,select,textarea');
  if (event.key === 'Enter' && generatorStage.dataset.view === 'assembly' && event.target !== generatorCrank && !interactiveTarget) {
    event.preventDefault();
    accelerateGenerator();
    return;
  }
  if (event.key.toLowerCase() !== 'v') return;
  setGeneratorView(generatorStage.dataset.view === 'rotor' ? 'assembly' : 'rotor');
});
reduced.addEventListener('change', () => {
  if (generatorStage.dataset.view === 'rotor' && !reduced.matches) scheduleGenerator();
  scheduleGeneratorLightning();
});
document.addEventListener('visibilitychange', () => {
  scheduleGeneratorLightning();
  scheduleGeneratorMeter();
});
generatorCrank.setAttribute('tabindex', '-1');
document.querySelector('#generator-rotor-view').setAttribute('aria-hidden', 'false');
renderGenerator();
updateGeneratorVoltage();
scheduleGeneratorLightning();
scheduleGenerator();

const battlebotViewer = document.querySelector('#battlebot-model');
const explodeButton = document.querySelector('#battlebot-explode');
const drivetrainButton = document.querySelector('#drivetrain-button');
const battlebotStatus = document.querySelector('#battlebot-status');
const DRIVETRAIN_RAMP_MS = 1500;
let animationsReady = false, assemblyExploded = false, assemblyTransition = false, assemblyTarget = false, assemblyReturnFocus = false, drivetrainRunning = false;
let drivetrainTransition = false, drivetrainRampFrame = 0;
function updateBattleBotControls() {
  explodeButton.disabled = !animationsReady || assemblyTransition || drivetrainRunning || drivetrainTransition;
  drivetrainButton.disabled = !animationsReady || assemblyTransition || assemblyExploded || drivetrainTransition || reduced.matches;
  drivetrainButton.textContent = drivetrainTransition ? (drivetrainRunning ? 'Starting drivetrain…' : 'Coasting…') : drivetrainRunning ? 'Stop drivetrain' : 'Run drivetrain';
  drivetrainButton.setAttribute('aria-pressed', String(drivetrainRunning));
}
function failBattleBotPreview() {
  stopDrivetrain();
  animationsReady = false;
  updateBattleBotControls();
  battlebotStatus.textContent = '3D preview unavailable. Open the Onshape source to inspect the CAD.';
}
function stopDrivetrain() {
  if (!drivetrainRunning && !drivetrainTransition) return;
  cancelAnimationFrame(drivetrainRampFrame);
  drivetrainRampFrame = 0;
  drivetrainTransition = false;
  battlebotViewer.pause();
  battlebotViewer.timeScale = 1;
  drivetrainRunning = false;
  updateBattleBotControls();
}
function finishAssemblyTransition() {
  if (!assemblyTransition) return;
  battlebotViewer.pause();
  assemblyExploded = assemblyTarget;
  assemblyTransition = false;
  const restoreFocus = assemblyReturnFocus && document.activeElement === document.body;
  assemblyReturnFocus = false;
  explodeButton.textContent = assemblyExploded ? 'Reassemble assembly' : 'Explode assembly';
  explodeButton.setAttribute('aria-pressed', String(assemblyExploded));
  battlebotStatus.textContent = assemblyExploded ? 'Exploded view: replaceable armor and cover lifted, body lowered, wheels out to both sides.' : 'Assembly restored.';
  updateBattleBotControls();
  if (restoreFocus) explodeButton.focus();
}
function setAssemblyExploded(next) {
  if (!animationsReady || assemblyTransition || drivetrainRunning || drivetrainTransition || next === assemblyExploded) return;
  const clip = next ? 'Explode' : 'Assemble';
  if (!battlebotViewer.availableAnimations.includes(clip)) {
    battlebotStatus.textContent = 'The assembly animation is unavailable. Open the Onshape source to inspect the CAD.';
    return;
  }
  stopDrivetrain();
  assemblyTarget = next;
  assemblyReturnFocus = document.activeElement === explodeButton;
  assemblyTransition = true;
  updateBattleBotControls();
  battlebotStatus.textContent = next ? 'Lifting the replaceable armor and separating the cover, body, and wheels…' : 'Reassembling the parts…';
  battlebotViewer.animationName = clip;
  battlebotViewer.timeScale = 1;
  battlebotViewer.currentTime = 0;
  if (reduced.matches) {
    battlebotViewer.play({ repetitions: 1 });
    requestAnimationFrame(() => {
      if (!assemblyTransition) return;
      battlebotViewer.currentTime = 1;
      battlebotViewer.pause();
      finishAssemblyTransition();
    });
  } else battlebotViewer.play({ repetitions: 1 });
}
function setDrivetrainRunning(running) {
  if (!animationsReady || assemblyTransition || assemblyExploded || drivetrainTransition || running === drivetrainRunning) return;
  if (running && reduced.matches) {
    battlebotStatus.textContent = 'Drivetrain motion is paused by your reduced-motion setting.';
    return;
  }
  if (running && !battlebotViewer.availableAnimations.includes('Drivetrain')) {
    battlebotStatus.textContent = 'The drivetrain animation is unavailable.';
    return;
  }
  if (running) {
    if (battlebotViewer.animationName !== 'Drivetrain') {
      battlebotViewer.animationName = 'Drivetrain';
      battlebotViewer.currentTime = 0;
    }
    battlebotViewer.timeScale = 0;
    battlebotViewer.play();
  }
  drivetrainRunning = running;
  drivetrainTransition = true;
  const startScale = battlebotViewer.timeScale;
  const targetScale = running ? 1 : 0;
  const started = performance.now();
  updateBattleBotControls();
  battlebotStatus.textContent = running ? 'Drivetrain accelerating…' : 'Drivetrain coasting to a stop…';
  function ramp(now) {
    const progress = Math.min(1, (now - started) / DRIVETRAIN_RAMP_MS);
    const eased = progress * progress * (3 - 2 * progress);
    battlebotViewer.timeScale = startScale + (targetScale - startScale) * eased;
    if (progress < 1) drivetrainRampFrame = requestAnimationFrame(ramp);
    else {
      drivetrainRampFrame = 0;
      drivetrainTransition = false;
      if (!running) battlebotViewer.pause();
      updateBattleBotControls();
      battlebotStatus.textContent = running ? 'Concept drivetrain running.' : 'Drivetrain stopped.';
    }
  }
  drivetrainRampFrame = requestAnimationFrame(ramp);
}
explodeButton.addEventListener('click', () => setAssemblyExploded(!assemblyExploded));
drivetrainButton.addEventListener('click', () => setDrivetrainRunning(!drivetrainRunning));
battlebotViewer.addEventListener('load', () => {
  animationsReady = ['Explode', 'Assemble', 'Drivetrain'].every(name => battlebotViewer.availableAnimations.includes(name));
  updateBattleBotControls();
  battlebotStatus.textContent = animationsReady ? 'Model ready. Lift the replaceable armor or run the concept drivetrain.' : 'The model loaded without all preview animations.';
});
battlebotViewer.addEventListener('error', failBattleBotPreview);
document.querySelector('#model-viewer-loader').addEventListener('error', failBattleBotPreview, { once: true });
battlebotViewer.addEventListener('finished', finishAssemblyTransition);
if (battlebotViewer.availableAnimations?.length) battlebotViewer.dispatchEvent(new Event('load'));
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    if (assemblyTransition) {
      battlebotViewer.currentTime = 1;
      battlebotViewer.pause();
      finishAssemblyTransition();
    }
    stopDrivetrain();
  }
  updateBattleBotControls();
});
