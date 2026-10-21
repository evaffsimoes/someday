/**
 * cue — End-to-end checks of the app in a headless browser (Edge or Chrome).
 * The Android side (Capacitor plugins) is simulated; skipped when no browser is installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp, findBrowser, daysFromNow } = require('./helpers/browser');

const skip = findBrowser() ? false : 'no Edge or Chrome found (set CUE_TEST_BROWSER)';

const EVENTS = [
  { id: 'a', artist: 'Arctic Monkeys', startDate: daysFromNow(3), endDate: daysFromNow(3), time: '21:00', venue: 'Altice Arena', city: 'Lisboa', category: 'Concert', ticketInfo: 'https://ticketline.pt/arctic' },
  { id: 'b', artist: 'NOS Alive', startDate: daysFromNow(40), endDate: daysFromNow(42), city: 'Oeiras', category: 'Festival' },
  { id: 'p', artist: 'Old Gig', startDate: daysFromNow(-10), endDate: daysFromNow(-10), city: 'Porto', category: 'Concert' }
];

// ---------- Web build: navigation and calendar export ----------

test('web app', { skip }, async t => {
  const app = await startApp();
  t.after(() => app.close());
  await app.load(EVENTS);

  const ui = async () => JSON.parse(await app.ev(`JSON.stringify({
    tab: document.querySelector('.tab-screen.active').id,
    detail: document.getElementById('eventModalOverlay').classList.contains('active'),
    settings: document.getElementById('settingsModalOverlay').classList.contains('active'),
    form: !!document.querySelector('#reviewSlot .review'),
    layers: backLayers.map(layer => layer.name).join('>')
  })`));
  const back = async () => { await app.ev('history.back()'); await app.sleep(500); };
  const openDetail = async () => { await app.ev(`openDetailModal(cueAppState.events.find(e => e.id === 'a'))`); await app.sleep(500); };

  await t.test('the back gesture closes the event detail instead of leaving', async () => {
    await openDetail();
    assert.equal((await ui()).detail, true);
    await back();
    assert.deepEqual(await ui(), { tab: 'screen-queue', detail: false, settings: false, form: false, layers: '' });
  });

  await t.test('tapping outside the sheet, or ✕, closes the detail', async () => {
    await openDetail();
    await app.ev(`document.getElementById('eventModalContent').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await app.sleep(500);
    assert.equal((await ui()).detail, false);
    await openDetail();
    await app.ev(`document.getElementById('closeModalBtn').click()`);
    await app.sleep(500);
    assert.deepEqual(await ui(), { tab: 'screen-queue', detail: false, settings: false, form: false, layers: '' });
  });

  await t.test('settings close with back and by tapping outside', async () => {
    await app.ev(`document.getElementById('settingsBtn').click()`);
    await app.sleep(300);
    await app.ev(`document.getElementById('settingsModalOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await app.sleep(500);
    assert.equal((await ui()).settings, false);
    await app.ev(`document.getElementById('settingsBtn').click()`);
    await app.sleep(300);
    await back();
    assert.deepEqual(await ui(), { tab: 'screen-queue', detail: false, settings: false, form: false, layers: '' });
  });

  await t.test('back walks out of the form, then out of the Add tab', async () => {
    await app.ev(`document.querySelector('[data-tab="add"]').click()`);
    await app.ev(`document.getElementById('btnOptionManual').click()`);
    await app.sleep(300);
    assert.equal((await ui()).layers, 'tab>review');
    await back();
    assert.deepEqual(await ui(), { tab: 'screen-add', detail: false, settings: false, form: false, layers: 'tab' });
    await back();
    assert.equal((await ui()).tab, 'screen-queue');
  });

  await t.test('back from editing an event returns to the list', async () => {
    await openDetail();
    await app.ev(`document.getElementById('editFromModalBtn').click()`);
    await app.sleep(500);
    assert.deepEqual(await ui(), { tab: 'screen-add', detail: false, settings: false, form: true, layers: 'edit' });
    await back();
    assert.deepEqual(await ui(), { tab: 'screen-queue', detail: false, settings: false, form: false, layers: '' });
  });

  await t.test('"Add all to my calendar" downloads the upcoming events only', async () => {
    await app.ev(`document.querySelector('[data-tab="calendar"]').click()`);
    await app.ev(`document.getElementById('calExportBtn').click()`);
    const file = path.join(app.downloads, 'cue-events.ics');
    await app.waitFor(async () => fs.existsSync(file) && fs.statSync(file).size > 0);
    const ics = fs.readFileSync(file, 'utf8');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(!ics.includes('Old Gig'));
  });

  await t.test('no page errors', () => {
    assert.deepEqual(app.errors, []);
  });

  await t.test('opens and shows the events without internet', async () => {
    // Everything outside the local server (Google, CDNs, Firebase) is unreachable
    await app.send('Network.enable');
    await app.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await app.load(EVENTS);
    await app.waitFor(async () => (await app.ev(`document.body.innerText.includes('Arctic Monkeys')`)) === true);
    assert.equal(await app.ev(`typeof flatpickr`), 'function', 'the date picker ships with the app');
    assert.equal(await app.ev(`typeof firebase`), 'object', 'Firebase ships with the app');
    assert.equal(await app.ev(`getComputedStyle(document.querySelector('.cue-logo')).fontFamily.includes('Unbounded')`), true);
    assert.deepEqual(app.errors, []);
    await app.send('Network.setBlockedURLs', { urls: [] });
  });
});

// ---------- Android build (simulated plugins): shares, widgets, notifications ----------

const POST_HTML = '<meta property="og:description" content="2,374 likes - marinaherlop on July 31, 2026: &quot;Dawn of Dja Dja tour.&quot;" /><meta property="og:image" content="https://cdn.example/poster.jpg" />';
const NATIVE_MOCKS = `
  window.CUE_API_ORIGIN = location.origin;
  window.__prefs = JSON.parse(localStorage.getItem('__testPrefs') || '{}');
  window.__calls = { share: [], files: [], http: [], listeners: {} };
  const savePrefs = () => localStorage.setItem('__testPrefs', JSON.stringify(window.__prefs));
  window.Capacitor = { isNativePlatform: () => true, isNative: true, Plugins: {
    Preferences: {
      get: async ({ key }) => ({ value: window.__prefs[key] || null }),
      set: async ({ key, value }) => { window.__prefs[key] = value; savePrefs(); },
      remove: async ({ key }) => { delete window.__prefs[key]; savePrefs(); }
    },
    LocalNotifications: {
      addListener: (name, fn) => { window.__calls.listeners[name] = fn; return { remove() {} }; },
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      getPending: async () => ({ notifications: [] }), cancel: async () => {}, schedule: async () => {}
    },
    Filesystem: { writeFile: async ({ path }) => { window.__calls.files.push(path); return { uri: 'file:///cache/' + path }; } },
    Share: { share: async options => { window.__calls.share.push(options); } },
    CapacitorHttp: { request: async ({ url, responseType }) => {
      window.__calls.http.push(url);
      return responseType === 'blob'
        ? { status: 200, headers: { 'Content-Type': 'image/jpeg' }, data: '/9j/4AAQSkZJRg==' }
        : { status: 200, headers: {}, data: ${JSON.stringify(POST_HTML)} };
    } }
  } };
`;

// Fake import API: refuses bare links (like a post the server couldn't open), reads captions
async function fakeApi(payload) {
  if (!String(payload.sharedUrl || '').includes('Caption:')) {
    return { status: 422, json: { error: "Couldn't open this Instagram post (it may be private). Share a screenshot of the poster instead." } };
  }
  const image = payload.contents?.[0]?.parts?.[0]?.inlineData;
  return {
    status: 200,
    json: {
      candidates: [{ content: { parts: [{ text: '{"artist":"Marina Herlop","category":"Concert"}' }] } }],
      ...(image ? { _extractedImage: `data:${image.mimeType};base64,${image.data}` } : {})
    }
  };
}

test('android app (simulated)', { skip }, async t => {
  const app = await startApp({ api: fakeApi, nativeMocks: NATIVE_MOCKS });
  t.after(() => app.close());

  await t.test('the first launch from the APK brings back the events from the widget copy', async () => {
    const widgetCopy = [
      { id: 'w1', artist: 'Capitão Fausto', startDate: daysFromNow(20), endDate: daysFromNow(20), city: 'Porto', category: 'Concert', company: 'Rita, João' },
      { id: 'w2', artist: 'NOS Alive', startDate: daysFromNow(40), endDate: daysFromNow(42), city: 'Oeiras', category: 'Festival', company: 'Rita' }
    ];
    // A fresh bundled install: nothing in the app's own storage, the widget copy still on the phone
    await app.load([], `localStorage.removeItem('cue-events-v12'); localStorage.setItem('__testPrefs', JSON.stringify({ 'shared-events': ${JSON.stringify(JSON.stringify(widgetCopy))} }))`, 2);
    assert.equal(await app.ev(`JSON.parse(localStorage.getItem('cue-events-v12')).length`), 2, 'saved into the app storage');
    assert.deepEqual(JSON.parse(await app.ev(`JSON.stringify(state.savedFriends)`)), ['Rita', 'João']);
    assert.match(await app.ev(`document.getElementById('debugAlertBox')?.textContent || ''`), /moved into the app/);
  });

  await t.test('a post shared from Instagram at launch opens the filled-in form', async () => {
    await app.load(EVENTS, `localStorage.setItem('__testPrefs', JSON.stringify({ 'pending-share-intent': 'https://www.instagram.com/p/DbdCDovqqdx/?dlrf=x' }))`);
    await app.waitFor(async () => (await app.ev(`document.getElementById('f_artist')?.value || ''`)) === 'Marina Herlop');
    assert.equal(await app.ev(`document.querySelector('.tab-screen.active').id`), 'screen-add');
    assert.equal(await app.ev(`'pending-share-intent' in window.__prefs`), false);
  });

  await t.test('when the server cannot open the post, the phone reads it and sends caption + poster', () => {
    assert.equal(app.apiCalls.length, 2, 'each share is handled once: one refused call, one with the post');
    assert.match(app.apiCalls[1].sharedUrl, /Caption: Dawn of Dja Dja tour\./);
    assert.ok(app.apiCalls[1].contents[0].parts[0].inlineData.data);
  });

  await t.test('the shared poster ends up in the form', async () => {
    assert.equal(await app.ev(`!!document.querySelector('#eventImagePreviewWrapper img')`), true);
  });

  await t.test('tapping a day in the calendar widget opens that day', async () => {
    await app.ev(`switchTab('queue'); window.__prefs['pending-widget-open-date'] = '${daysFromNow(3)}'; window.checkForWidgetOpenIntentNative()`);
    await app.sleep(600);
    assert.equal(await app.ev(`document.querySelector('.tab-screen.active').id`), 'screen-calendar');
    assert.equal(await app.ev('state.calSelectedDateStr'), daysFromNow(3));
  });

  await t.test('tapping a reminder opens its event', async () => {
    await app.ev(`window.__calls.listeners.localNotificationActionPerformed({ notification: { extra: { eventId: 'a' } } })`);
    await app.sleep(600);
    assert.equal(await app.ev(`document.getElementById('eventModalOverlay').classList.contains('active')`), true);
    assert.equal(await app.ev(`document.querySelector('.event-detail-title').textContent`), 'Arctic Monkeys');
  });

  await t.test('Share sends the event as plain text with a map and ticket link', async () => {
    await app.ev(`document.getElementById('shareFromModalBtn').click()`);
    await app.sleep(300);
    const [shared] = JSON.parse(await app.ev('JSON.stringify(window.__calls.share)'));
    const lines = shared.text.split('\n');
    assert.equal(lines[0], 'Arctic Monkeys');
    assert.ok(lines.includes('Altice Arena, Lisboa'));
    assert.ok(lines.includes('Tickets: https://ticketline.pt/arctic'));
    assert.ok(lines.some(line => line.startsWith('https://maps.google.com/?q=')));
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(shared.text), 'no emojis');
  });

  await t.test('no page errors', () => {
    assert.deepEqual(app.errors, []);
  });
});
