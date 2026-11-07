import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const host = '127.0.0.1';
function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, host, () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(label, read, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const httpPort = await freePort();
const debugPort = await freePort();
const profile = await mkdtemp(join(tmpdir(), 'portfolio-browser-'));
let server, chrome, socket;
try {
  server = spawn('python3', ['-m', 'http.server', String(httpPort), '--bind', host], { stdio: 'ignore' });
  await waitFor('local server', async () => {
    try { return (await fetch(`http://${host}:${httpPort}/tests/browser.html`)).ok; } catch { return false; }
  });

  const chromePath = process.env.CHROME_BIN || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-dev-shm-usage', '--enable-webgl',
    '--enable-unsafe-swiftshader', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  let chromeError;
  chrome.once('error', error => { chromeError = error; });
  const target = await waitFor('headless Chrome', async () => {
    if (chromeError) throw chromeError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited with code ${chrome.exitCode}`);
    try {
      const response = await fetch(`http://${host}:${debugPort}/json/list`);
      return (await response.json()).find(page => page.type === 'page');
    } catch { return false; }
  });

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome did not answer ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.navigate', { url: `http://${host}:${httpPort}/tests/browser.html` });

  const deadline = Date.now() + 180000;
  let passed = false;
  while (Date.now() < deadline) {
    const response = await command('Runtime.evaluate', {
      expression: "({title:document.title,results:document.querySelector('#results')?.textContent||''})",
      returnByValue: true
    });
    const state = response.result?.value;
    if (!state) { await delay(200); continue; }
    if (state.title.startsWith('FAIL')) throw new Error(state.results);
    if (state.title.startsWith('PASS')) {
      console.log(state.results);
      passed = true;
      break;
    }
    await delay(200);
  }
  if (!passed) throw new Error('Timed out waiting for browser regression checks');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  socket?.close();
  chrome?.kill('SIGTERM');
  server?.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
