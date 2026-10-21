/**
 * cue — Google Play requirements that are easy to break without noticing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/load');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the app does not request USE_EXACT_ALARM (restricted by Google Play)', () => {
  assert.ok(!read('android/app/src/main/AndroidManifest.xml').includes('android.permission.USE_EXACT_ALARM'));
});

test('the Android app runs from the APK, not from a website', () => {
  assert.equal(JSON.parse(read('capacitor.config.json')).server?.url, undefined);
});

test('the privacy policy and account deletion pages exist and link each other', () => {
  assert.match(read('privacy.html'), /href="\/delete-account\.html"/);
  assert.match(read('delete-account.html'), /href="\/privacy\.html"/);
});

test('the legal pages have a real contact email (no placeholder left)', () => {
  for (const page of ['privacy.html', 'delete-account.html']) {
    const html = read(page);
    assert.ok(!html.includes('__CONTACT_EMAIL__'), `${page} still has the __CONTACT_EMAIL__ placeholder`);
    assert.match(html, /mailto:[^"@\s]+@[^"\s]+\.[a-z]{2,}/i, `${page} has no contact email`);
  }
});

test('Settings links to the published privacy policy', () => {
  assert.match(read('index.html'), /href="https:\/\/cue-events\.vercel\.app\/privacy\.html"/);
});
