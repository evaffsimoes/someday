/**
 * cue — Test helpers that load app code into Node:
 *  - loadAppScripts: runs browser scripts (js/*.js) in a VM with a minimal fake page
 *  - loadApi: imports api/gemini.js (an ES module in a CommonJS package) via a temporary .mjs copy
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');

function loadAppScripts(names, extraGlobals = {}) {
  const noop = () => {};
  const element = () => null;
  const context = {
    console, TextEncoder, URL, setTimeout, clearTimeout,
    document: {
      getElementById: element,
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: () => ({ style: {}, setAttribute: noop, classList: { add: noop, remove: noop } }),
      documentElement: { style: { setProperty: noop } }
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { pushState: noop, back: noop, go: noop },
    navigator: {},
    addEventListener: noop,
    ...extraGlobals
  };
  context.window = context;
  vm.createContext(context);
  for (const name of names) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', `${name}.js`), 'utf8'), context, { filename: `${name}.js` });
  }
  return context;
}

async function loadApi() {
  const source = fs.readFileSync(path.join(ROOT, 'api', 'gemini.js'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-api-'));
  const file = path.join(dir, 'gemini.mjs');
  fs.writeFileSync(file, `${source}\nexport { scrapeInstagramMetadata };\n`);
  return import(pathToFileURL(file).href);
}

module.exports = { loadAppScripts, loadApi, ROOT };
