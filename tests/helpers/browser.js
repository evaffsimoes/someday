/**
 * cue — Test helper: serves the app locally and drives a headless Chromium browser (Edge or
 * Chrome) over the DevTools protocol. No dependencies: uses Node's fetch and WebSocket.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// CUE_TEST_BROWSER overrides; otherwise the usual Edge / Chrome install locations
function findBrowser() {
  const candidates = [
    process.env.CUE_TEST_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

/**
 * Starts the app. `api(req, body)` may answer /api/gemini and returns { status, json };
 * `nativeMocks` is page script that runs before the app (e.g. a fake window.Capacitor).
 */
async function startApp({ api, nativeMocks = '' } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) return null;

  const apiCalls = [];
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/api/gemini') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = body ? JSON.parse(body) : {};
      apiCalls.push(payload);
      const answer = api ? await api(payload) : { status: 500, json: { error: 'No API in this test' } };
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(answer.json));
    }
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}/index.html`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-test-'));
  const downloads = path.join(profile, 'downloads');
  fs.mkdirSync(downloads);
  const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank']);

  // The browser writes the port it picked to DevToolsActivePort
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (_) {}
  }
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (_) {}
    if (!target) await sleep(100);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => { ws.onopen = resolve; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text);
    }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

  // Evaluates an expression in the page; rejects on exceptions so tests fail loudly
  const ev = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
    }
    return result.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
  if (nativeMocks) await send('Page.addScriptToEvaluateOnNewDocument', { source: nativeMocks });

  // Loads the app with these events in storage (and an optional page set-up script); waits until
  // the app holds expectedCount events (defaults to the ones stored)
  const load = async (events = [], setup = '', expectedCount = events.length) => {
    await send('Page.navigate', { url: appUrl });
    await sleep(800);
    await ev(`localStorage.clear(); localStorage.setItem('cue-events-v12', ${JSON.stringify(JSON.stringify(events))}); ${setup}`);
    errors.length = 0;
    apiCalls.length = 0;
    await send('Page.reload');
    await waitFor(() => ev(`typeof cueAppState !== 'undefined' && cueAppState.events.length === ${expectedCount}`));
  };

  const waitFor = async (check, timeoutMs = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await check()) return true;
      await sleep(100);
    }
    throw new Error('Timed out waiting for the page');
  };

  const close = async () => {
    try { ws.close(); } catch (_) {}
    browser.kill();
    server.close();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };

  return { ev, send, load, waitFor, close, errors, apiCalls, downloads, sleep };
}

// Event dates relative to today, as YYYY-MM-DD
function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

module.exports = { startApp, findBrowser, daysFromNow, sleep };
