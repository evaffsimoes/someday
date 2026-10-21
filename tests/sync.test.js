/**
 * cue — Cloud sync (js/auth.js) against an in-memory fake Firestore.
 * The scenarios run in order and share one "cloud", like several devices over time.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./helpers/load');

const authSource = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const store = new Map(); // path -> document data
const writes = [];
let denyMedia = false;

const denied = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

function docRef(docPath) {
  return {
    get: async () => ({ exists: store.has(docPath), data: () => store.get(docPath) }),
    set: async (data, options) => {
      if (denyMedia && docPath.includes('/media/')) throw denied();
      writes.push(docPath);
      store.set(docPath, options && options.merge ? { ...(store.get(docPath) || {}), ...data } : data);
    },
    delete: async () => {
      if (denyMedia && docPath.includes('/media/')) throw denied();
      writes.push(`DEL ${docPath}`);
      store.delete(docPath);
    },
    collection: name => collectionRef(`${docPath}/${name}`)
  };
}

function collectionRef(collectionPath) {
  return {
    doc: docId => docRef(`${collectionPath}/${docId}`),
    get: async () => {
      if (denyMedia && collectionPath.endsWith('/media')) throw denied();
      const docs = [...store].filter(([key]) => key.startsWith(`${collectionPath}/`) && !key.slice(collectionPath.length + 1).includes('/'));
      return { forEach: callback => docs.forEach(([key, value]) => callback({ id: key.split('/').pop(), data: () => value })) };
    }
  };
}

// One "device": its own storage, app state and copy of auth.js
function makeDevice(events) {
  const local = new Map();
  const toasts = [];
  let onAuth;
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    localStorage: { getItem: key => (local.has(key) ? local.get(key) : null), setItem: (key, value) => local.set(key, String(value)), removeItem: key => local.delete(key) },
    document: { getElementById: () => null },
    alert: () => {},
    addEventListener() {},
    CUE_FIREBASE_CONFIG: { apiKey: 'test-key', projectId: 'test' },
    cueAppState: { events },
    cueSaveEvents: async () => true,
    cueRenderApp: () => {},
    cueToast: message => toasts.push(message),
    cueShrinkEventImages: async () => false,
    cueDedupeEvents: list => list
  };
  const auth = {
    useDeviceLanguage() {},
    setPersistence: () => Promise.resolve(),
    onAuthStateChanged(callback) { onAuth = callback; return () => {}; },
    getRedirectResult: () => Promise.resolve(null)
  };
  context.firebase = {
    apps: [],
    initializeApp() {},
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 'local' } } }),
    firestore: Object.assign(() => ({ collection: collectionRef, settings() {}, enablePersistence: () => Promise.resolve() }), { FieldValue: { serverTimestamp: () => 'now' } })
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(authSource, context);
  context.CueAuth.init();
  return {
    toasts,
    get events() { return context.cueAppState.events; },
    set events(value) { context.cueAppState.events = value; },
    login: () => onAuth({ uid: 'u1', email: 'a@b.c', displayName: 'A' }),
    save: () => context.CueAuth.saveEventToCloud()
  };
}

const image = (tag, kb) => `data:image/jpeg;base64,${tag}`.padEnd(kb * 1024, 'A');
const mainDoc = () => store.get('users/u1') || {};
let phone;
let tablet;

test('cloud sync', async t => {
  // Legacy cloud data: one event with an inline poster (the old format)
  store.set('users/u1', { events: [{ id: 'old', artist: 'Old Event', startDate: '2026-11-01', image: image('OLD', 50) }] });

  await t.test('a device with local events keeps them and gains the cloud ones', async () => {
    phone = makeDevice([
      { id: 'e1', artist: 'Band', startDate: '2026-11-10', image: image('E1', 90), updatedAt: 100 },
      { id: 'e2', artist: 'Fest', startDate: '2026-12-01' }
    ]);
    await phone.login();
    assert.deepEqual(phone.events.map(event => event.id).sort(), ['e1', 'e2', 'old']);
  });

  await t.test('the main cloud document holds text only', () => {
    assert.ok(mainDoc().events.every(event => !('image' in event) && !('ticketFile' in event)));
  });

  await t.test('posters move to per-event media documents', () => {
    assert.ok(store.has('users/u1/media/e1'));
    assert.ok(store.has('users/u1/media/old'));
    assert.ok(!store.has('users/u1/media/e2'));
  });

  await t.test('a fresh install restores every event and poster without re-uploading', async () => {
    tablet = makeDevice([]);
    writes.length = 0;
    await tablet.login();
    assert.equal(tablet.events.length, 3);
    assert.ok(tablet.events.find(event => event.id === 'e1').image.startsWith('data:image/jpeg;base64,E1'));
    assert.ok(!writes.some(write => write.includes('/media/')), writes.join(' '));
  });

  await t.test('saving without media changes writes only the main document', async () => {
    writes.length = 0;
    await phone.save();
    assert.deepEqual(writes, ['users/u1']);
  });

  await t.test('the newer edit and poster from another device win', async () => {
    tablet.events = tablet.events.map(event => (event.id === 'e1' ? { ...event, artist: 'Band (edited)', image: image('E1NEW', 80), updatedAt: 200 } : event));
    await tablet.save();
    await phone.login();
    const e1 = phone.events.find(event => event.id === 'e1');
    assert.equal(e1.artist, 'Band (edited)');
    assert.ok(e1.image.startsWith('data:image/jpeg;base64,E1NEW'));
  });

  await t.test('a deleted event leaves the cloud, media included', async () => {
    phone.events = phone.events.filter(event => event.id !== 'e1');
    await phone.save();
    assert.ok(!mainDoc().events.some(event => event.id === 'e1'));
    assert.ok(!store.has('users/u1/media/e1'));
  });

  await t.test('a ticket too big for the cloud stays local, with one warning', async () => {
    phone.events.push({ id: 'e3', artist: 'Ticketed', startDate: '2026-12-20', image: image('E3', 60), ticketFile: image('PDF', 1000), ticketFileName: 't.pdf', updatedAt: 300 });
    await phone.save();
    const media = store.get('users/u1/media/e3');
    assert.ok(media && !media.ticketFile && media.image.startsWith('data:image/jpeg;base64,E3'));
    assert.ok(phone.toasts.some(message => message.includes('too large')));
  });

  await t.test('events still sync when media is denied, with one warning', async () => {
    denyMedia = true;
    const laptop = makeDevice([{ id: 'e4', artist: 'Laptop Gig', startDate: '2027-01-05', image: image('E4', 40), updatedAt: 400 }]);
    await laptop.login();
    await laptop.save();
    denyMedia = false;
    assert.ok(mainDoc().events.some(event => event.id === 'e4'));
    assert.equal(laptop.toasts.filter(message => message.includes('images')).length, 1);
  });
});
