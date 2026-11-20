import { execFileSync, spawn } from 'node:child_process';
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
  let chromeVersion = 'unavailable';
  try {
    chromeVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (error) {
    chromeVersion = `unavailable (${error.code || error.message})`;
  }
  console.log(`Chrome binary: ${chromePath}`);
  console.log(`Chrome version: ${chromeVersion}`);
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-dev-shm-usage', '--enable-webgl',
    '--enable-unsafe-swiftshader', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeError;
  let chromeStdout = '';
  let chromeStderr = '';
  let endpointState = 'not checked';
  chrome.stdout.on('data', chunk => { chromeStdout = (chromeStdout + chunk.toString()).slice(-4000); });
  chrome.stderr.on('data', chunk => { chromeStderr = (chromeStderr + chunk.toString()).slice(-4000); });
  chrome.once('error', error => { chromeError = error; });
  const diagnostics = () => `path=${chromePath}; version=${chromeVersion}; exitCode=${chrome.exitCode}; signalCode=${chrome.signalCode}; endpoint=${endpointState}; stdout=${chromeStdout.trim() || '(empty)'}; stderr=${chromeStderr.trim() || '(empty)'}`;
  let target;
  try {
    target = await waitFor('headless Chrome', async () => {
      if (chromeError) throw new Error(`Failed to spawn Chrome: ${chromeError.message}`);
      if (chrome.exitCode !== null || chrome.signalCode !== null) {
        throw new Error('Chrome exited before the remote-debugging endpoint was ready');
      }
      let response;
      try {
        response = await fetch(`http://${host}:${debugPort}/json/list`);
      } catch (error) {
        endpointState = `request failed (${error.message})`;
        return false;
      }
      endpointState = `reachable, HTTP ${response.status}`;
      if (!response.ok) return false;
      let pages;
      try {
        pages = await response.json();
      } catch (error) {
        endpointState += `, invalid JSON (${error.message})`;
        return false;
      }
      const target = pages.find(page => page.type === 'page');
      endpointState += `, page targets=${pages.filter(page => page.type === 'page').length}`;
      return target;
    });
  } catch (error) {
    throw new Error(`${error.message}; ${diagnostics()}`);
  }

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
