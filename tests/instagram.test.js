/**
 * cue — Reading shared Instagram posts in the import API (api/gemini.js), with a mocked network:
 * no requests reach Instagram, Google or Gemini.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./helpers/load');

const POST_HTML = `<html><head>
<meta property="og:title" content="NOS Alive on Instagram: &quot;The Strokes play #NOSAlive&#x2019;27&quot;" />
<meta property="og:description" content="21K likes, 363 comments - nos_alive on October 19, 2026: &quot;@thestrokes atuam no dia 8 de julho no #NOSAlive&#x2019;27.&quot;." />
<meta property="og:image" content="https://scontent.cdninstagram.com/poster.jpg?a=1&amp;b=2" />
</head></html>`;
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');

function response({ status = 200, url = '', body = '', type = 'text/html' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(body))
  };
}

// Routes fetch calls to fake answers and records which URLs were asked for
function mockFetch(routes) {
  const requested = [];
  globalThis.fetch = async (url, options = {}) => {
    requested.push({ url: String(url), userAgent: options.headers?.['User-Agent'] });
    for (const [pattern, answer] of routes) {
      if (String(url).includes(pattern)) return typeof answer === 'function' ? answer(String(url), options) : answer;
    }
    return response({ status: 404 });
  };
  return requested;
}

let api;
test.before(async () => {
  api = await loadApi();
});

test('reads caption, author, date and poster from a public post', async () => {
  mockFetch([
    ['instagram.com/p/DeqxfsHI_Iq/', response({ body: POST_HTML })],
    ['poster.jpg', response({ body: JPEG, type: 'image/jpeg' })]
  ]);
  const post = await api.scrapeInstagramMetadata('https://www.instagram.com/p/DeqxfsHI_Iq/?igsh=abc');
  assert.equal(post.readable, true);
  assert.match(post.text, /Posted by @nos_alive on October 19, 2026/);
  assert.match(post.text, /Caption: @thestrokes atuam no dia 8 de julho no #NOSAlive’27\.$/m);
  assert.ok(post.posterImageDataUrl.startsWith('data:image/jpeg;base64,'));
});

test('reads reels and links with text around them', async () => {
  const requested = mockFetch([['instagram.com/p/DeqxfsHI_Iq/', response({ body: POST_HTML })]]);
  const post = await api.scrapeInstagramMetadata('Vejam isto! https://www.instagram.com/reel/DeqxfsHI_Iq/');
  assert.equal(post.readable, true);
  assert.ok(requested.some(request => request.url === 'https://www.instagram.com/p/DeqxfsHI_Iq/'));
});

test('tries other crawlers when Instagram serves an empty page first', async () => {
  let pageRequests = 0;
  mockFetch([['instagram.com/p/DeqxfsHI_Iq/', () => response({ body: ++pageRequests === 1 ? '<html></html>' : POST_HTML })]]);
  const post = await api.scrapeInstagramMetadata('https://www.instagram.com/p/DeqxfsHI_Iq/');
  assert.equal(post.readable, true);
  assert.equal(pageRequests, 2);
});

test('follows share links to the post', async () => {
  mockFetch([
    ['instagram.com/share/', response({ url: 'https://www.instagram.com/p/DeqxfsHI_Iq/', body: '' })],
    ['instagram.com/p/DeqxfsHI_Iq/', response({ body: POST_HTML })]
  ]);
  const post = await api.scrapeInstagramMetadata('https://www.instagram.com/share/BAxyz123');
  assert.equal(post.readable, true);
});

test('reports a post it cannot open as unreadable, without throwing', async () => {
  mockFetch([['instagram.com', response({ body: '<html>Log in</html>' })]]);
  const originalWarn = console.warn;
  console.warn = () => {};
  const post = await api.scrapeInstagramMetadata('https://www.instagram.com/p/PRIVATE1234/');
  console.warn = originalWarn;
  assert.equal(post.readable, false);
});

function callHandler(body, headers = {}) {
  return new Promise(resolve => {
    const res = {
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { resolve({ status: this.code, body: payload }); },
      end() { resolve({ status: this.code }); }
    };
    api.default({ method: 'POST', headers, body }, res);
  });
}

test('the import API refuses requests without a Google sign-in', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const { status } = await callHandler({ sharedUrl: 'https://www.instagram.com/p/DeqxfsHI_Iq/' });
  assert.equal(status, 401);
});

test('the import API answers 422 for a bare link to a post it cannot open', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  mockFetch([
    ['identitytoolkit.googleapis.com', response({ body: JSON.stringify({ users: [{ localId: 'u1', email: 'a@b.c' }] }), type: 'application/json' })],
    ['instagram.com', response({ body: '<html>Log in</html>' })]
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  const { status, body } = await callHandler({ sharedUrl: 'https://www.instagram.com/p/PRIVATE1234/' }, { authorization: 'Bearer token-422' });
  console.warn = originalWarn;
  assert.equal(status, 422);
  assert.match(body.error, /Share a screenshot of the poster/);
});

test('the import API sends the caption and poster to Gemini', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  let geminiRequest;
  mockFetch([
    ['identitytoolkit.googleapis.com', response({ body: JSON.stringify({ users: [{ localId: 'u2', email: 'a@b.c' }] }), type: 'application/json' })],
    ['instagram.com/p/DeqxfsHI_Iq/', response({ body: POST_HTML })],
    ['poster.jpg', response({ body: JPEG, type: 'image/jpeg' })],
    ['generativelanguage.googleapis.com', (url, options) => {
      geminiRequest = JSON.parse(options.body);
      return response({ type: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"artist":"The Strokes"}' }] } }] }) });
    }]
  ]);
  const { status, body } = await callHandler({ sharedUrl: 'https://www.instagram.com/p/DeqxfsHI_Iq/' }, { authorization: 'Bearer token-ok' });
  assert.equal(status, 200);
  const parts = geminiRequest.contents[0].parts;
  assert.ok(parts.some(part => part.inlineData?.mimeType === 'image/jpeg'));
  assert.ok(parts.some(part => /atuam no dia 8 de julho/.test(part.text || '')));
  assert.ok(body._extractedImage.startsWith('data:image/jpeg;base64,'));
});
