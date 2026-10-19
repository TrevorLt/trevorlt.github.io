'use strict';
const canvas = document.querySelector('#scan-canvas');
const slider = document.querySelector('#sweep');
const angleLabel = document.querySelector('#scan-angle');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
function drawScan() {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const sweep = Number(slider.value);
  ctx.clearRect(0, 0, w, h);
  const project = (x, y, z) => [w * .5 + (x * .89 - z * .46) * 1.25, h * .55 + (x * .22 + z * .4 - y) * 1.25];
  // A deliberately illustrative vessel. Points describe the proposed sampling
  // geometry; they are not recordings from the hardware.
  for (let row = 0; row < 25; row++) {
    const y = row * 11 - 95;
    const radius = 82 + 30 * Math.sin(row / 24 * Math.PI) + 14 * Math.cos(row / 24 * Math.PI * 2);
    for (let deg = 0; deg < 360; deg += 7.5) {
      const rad = deg * Math.PI / 180;
      const [px, py] = project(Math.cos(rad) * radius, y, Math.sin(rad) * radius);
      ctx.fillStyle = deg <= sweep ? '#dafa9c' : '#62695c';
      ctx.beginPath();ctx.arc(px, py, deg <= sweep ? 2.5 : 1.4, 0, Math.PI * 2);ctx.fill();
    }
  }
  // The orbit shows the platform's rotation, not dimensional accuracy.
  ctx.lineWidth = 2;ctx.strokeStyle = '#9aab87';ctx.beginPath();
  for(let deg=0;deg<=360;deg+=3){const rad=deg*Math.PI/180;const [x,y]=project(Math.cos(rad)*185,-120,Math.sin(rad)*185);deg?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();
  const rad = sweep * Math.PI / 180;
  const [sx,sy]=project(Math.cos(rad)*185,10,Math.sin(rad)*185);
  const [ex,ey]=project(Math.cos(rad)*108,10,Math.sin(rad)*108);
  ctx.strokeStyle='#dafa9c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
  ctx.fillStyle='#dafa9c';ctx.fillRect(sx-10,sy-10,20,20);
  angleLabel.textContent = sweep + '° sweep';
}
slider?.addEventListener('input', drawScan);
drawScan();
// A portfolio display study with example values; no account data is read.
const codexDemo = document.querySelector('.codex-demo');
codexDemo?.classList.add('is-interactive');
const displayButtons = [...document.querySelectorAll('[data-display]')];
const quotaButtons = [...document.querySelectorAll('[data-quota]')];
for (const button of displayButtons) {
  button.addEventListener('click', () => {
    const rings = button.dataset.display === 'rings';
    document.querySelector('#quota-rings').hidden = !rings;
    document.querySelector('#quota-readout').hidden = rings;
    for (const other of displayButtons) other.setAttribute('aria-pressed', String(other === button));
  });
}
for (const button of quotaButtons) {
  button.addEventListener('click', () => {
    const state = button.dataset.quota;
    const low = state === 'low';
    const value = low ? 12 : 72;
    const prefix = state === 'stale' ? '~' : '';
    codexDemo.classList.toggle('is-low', low);
    document.querySelector('#five-hour-ring').setAttribute('stroke-dasharray', value + ' 100');
    document.querySelector('#five-hour-number').textContent = prefix + value;
    document.querySelector('#five-hour-title').textContent = '5-hour window: ' + value + ' percent remaining' + (state === 'stale' ? ', last known reading' : '');
    document.querySelector('#readout-five-hour').textContent = prefix + value + '%';
    document.querySelector('#readout-fill').style.transform = 'scaleX(' + value / 100 + ')';
    document.querySelector('#demo-status').textContent = state === 'low' ? 'A clear warning when a window falls below 20%.' : state === 'stale' ? 'Last-known values stay visible when a refresh fails.' : 'Two windows. One glance.';
    for (const other of quotaButtons) other.setAttribute('aria-pressed', String(other === button));
  });
}
// Content is visible before JavaScript. Motion enhances the finished page.
if (!reduced.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el=entry.target;
      el.animate([{transform:'translateY(22px)',opacity:.55},{transform:'translateY(0)',opacity:1}],{duration:920,easing:'cubic-bezier(.16,1,.3,1)',delay:Number(el.dataset.delay||0)});
      observer.unobserve(el);
    }
  }, {threshold:.1});
  document.querySelectorAll('.platform-photo,.demo-heading,.demo-styles,.quota-window,.demo-scenarios,.demo-status,.section-intro h2,.section-intro>p,.project-index a,.project-copy h3,.project-subtitle,.project-copy>p:not(.project-subtitle),.project-facts,.project-link,.scanner-stage,.codex-demo,.about-columns p,.contact h2,.contact-row p,.contact-row a,.footer-name').forEach((el,i)=>{el.dataset.delay=String((i%3)*65);observer.observe(el)});
  document.querySelectorAll('.hero h1 span').forEach((el,i)=>el.animate([{transform:'translateY(75px)'},{transform:'translateY(0)'}],{duration:900,delay:i*90,easing:'cubic-bezier(.16,1,.3,1)'}));
}
