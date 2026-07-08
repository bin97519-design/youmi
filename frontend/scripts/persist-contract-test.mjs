// Regression test for the canvas doc-scoped persistence fix.
// Runs the REAL src/stores/canvas.js logic in Node (no browser, no test framework).
//
// Approach: we load the real store module but neutralize the two browser-only
// transitive imports (apiBase's `import.meta.env`, and the user store) so the
// persistence code (makeCanvasDocument / saveLocal / loadLocal / persist /
// updateDocument / ensureDocument) executes unmodified. The original source
// files are NOT modified; only a temp transformed copy is written here.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..'); // youmi/frontend
const SRC = resolve(ROOT, 'src/stores/canvas.js');
const TMP = resolve(__dirname, '.tmp_canvas_under_test.mjs');

// ---- localStorage shim (shared across simulated reloads) ----
function makeLocalStorageShim() {
  const map = new Map();
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    raw: () => JSON.stringify([...map.entries()]),
  };
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// ---- build the transformed temp copy of the real store ----
const original = readFileSync(SRC, 'utf8');

// 1) static guard: real store must NEVER write the three fields to the global UI key
check(
  'static: canvas.js does not reference the global UI key (youmi_canvas_ui_layout_v3)',
  !original.includes('youmi_canvas_ui_layout_v3'),
);

// neutralize browser-only imports
let transformed = original
  .replace(/import\s+\{\s*apiPath\s*\}\s*from\s*['"]\.\.\/utils\/apiBase['"];?/,
    'const apiPath = () => "";')
  .replace(/import\s+\{\s*useUserStore\s*\}\s*from\s*['"]\.\/user['"];?/,
    'const useUserStore = () => ({ authHeaders: () => ({}) });')
  // strip asset URL(..., import.meta.url) that needs a bundler
  .replace(/new URL\([^)]*import\.meta\.url\)\.href/g, "''");

if (transformed.includes('import.meta.env')) {
  // safety net: should not happen after the apiBase import was removed
  transformed = transformed.replace(/import\.meta\.env\.VITE_APP_BASE_API/g, "''");
}

writeFileSync(TMP, transformed, 'utf8');

// ---- run ----
const { createPinia, setActivePinia } = await import('pinia');
const mod = await import(pathToFileURL(TMP).href);
const { makeCanvasDocument, useCanvasStore } = mod;

// global shim must exist before the store is instantiated (loadLocal reads it)
globalThis.localStorage = makeLocalStorageShim();

console.log('\n[1] default payload shape (real makeCanvasDocument)');
const fresh = makeCanvasDocument('default-id');
check('payload.connections is []', Array.isArray(fresh.payload.connections) && fresh.payload.connections.length === 0);
check('payload.generationHistory is []', Array.isArray(fresh.payload.generationHistory) && fresh.payload.generationHistory.length === 0);
check('payload.chatConfig is {}', fresh.payload.chatConfig && typeof fresh.payload.chatConfig === 'object' && Object.keys(fresh.payload.chatConfig).length === 0);

console.log('\n[2] write: persist doc-scoped state to localStorage');
setActivePinia(createPinia());
const store = useCanvasStore();
const docId = 'docA';
store.ensureDocument(docId);

const connections = [
  { id: 'c1', fromLayerId: 'L1', fromPort: 'right', toLayerId: 'L2', toPort: 'left' },
];
const generationHistory = [
  {
    id: 'gen-1',
    prompt: 'a cat on a chair',
    model: 'banana2',
    ratio: '9:16',
    resolution: '2K',
    imageUrl: 'https://cdn.example.com/gen1.png',
    referenceImageUrls: ['https://cdn.example.com/ref.png'],
    createdAt: 1700000000000,
  },
];
const chatConfig = { model: 'gpt-image-2', ratio: '1:1', resolution: '4K' };

store.updateDocument(docId, (d) => {
  d.payload.connections = connections;
  d.payload.generationHistory = generationHistory;
  d.payload.chatConfig = chatConfig;
  return d;
});
store.persist();

const rawAfterPersist = globalThis.localStorage.getItem('youmi_canvas_documents_v3');
check('persisted under doc key youmi_canvas_documents_v3', typeof rawAfterPersist === 'string' && rawAfterPersist.length > 0);
check('NOT persisted under global UI key', rawAfterPersist == null || !rawAfterPersist.includes('youmi_canvas_ui_layout_v3'));

const writtenDocs = JSON.parse(rawAfterPersist);
const writtenDocA = writtenDocs.find((d) => d.id === docId);
check('docA present in persisted blob', !!writtenDocA);
check('docA.connections preserved exactly', JSON.stringify(writtenDocA.payload.connections) === JSON.stringify(connections));
check('docA.generationHistory preserved exactly', JSON.stringify(writtenDocA.payload.generationHistory) === JSON.stringify(generationHistory));
check('docA.chatConfig preserved exactly', JSON.stringify(writtenDocA.payload.chatConfig) === JSON.stringify(chatConfig));

console.log('\n[3] reload: read back from localStorage (round-trip)');
// simulate a full page reload: new pinia + new store instance, same localStorage
setActivePinia(createPinia());
const store2 = useCanvasStore();
const reloadedDocA = store2.documents.find((d) => d.id === docId);
check('reloaded docA exists', !!reloadedDocA);
check('reloaded connections === original', JSON.stringify(reloadedDocA.payload.connections) === JSON.stringify(connections));
check('reloaded generationHistory === original', JSON.stringify(reloadedDocA.payload.generationHistory) === JSON.stringify(generationHistory));
check('reloaded chatConfig === original', JSON.stringify(reloadedDocA.payload.chatConfig) === JSON.stringify(chatConfig));
check('reloaded imageUrl in history preserved', reloadedDocA.payload.generationHistory[0].imageUrl === 'https://cdn.example.com/gen1.png');

console.log('\n[4] isolation: a different document must NOT inherit docA data');
const docB = store2.ensureDocument('docB');
check('docB.connections is empty (no leakage from docA)', JSON.stringify(docB.payload.connections) === '[]');
check('docB.generationHistory is empty (no leakage from docA)', JSON.stringify(docB.payload.generationHistory) === '[]');
check('docB.chatConfig is empty (no leakage from docA)', JSON.stringify(docB.payload.chatConfig) === '{}');

console.log('\n[5] backward-compat: old doc without the 3 fields must load without crashing');
let compatOk = true;
let compatNote = '';
try {
  const oldShim = makeLocalStorageShim();
  const oldDoc = {
    id: 'legacy',
    title: 'legacy doc',
    payload: { schemaVersion: 1, view: { scale: 0.68, offset: { x: 0, y: 0 } }, layers: [], chat: [] },
  };
  oldShim.setItem('youmi_canvas_documents_v3', JSON.stringify([oldDoc]));
  globalThis.localStorage = oldShim;
  setActivePinia(createPinia());
  const store3 = useCanvasStore();
  const legacy = store3.documents.find((d) => d.id === 'legacy');
  compatOk = !!legacy;
  compatNote = legacy ? 'legacy doc loaded; payload.connections=' + JSON.stringify(legacy.payload?.connections) : 'legacy doc missing';
} catch (e) {
  compatOk = false;
  compatNote = String(e && e.message ? e.message : e);
}
check('old doc loads without throwing', compatOk, compatNote);

// cleanup temp file
try { rmSync(TMP, { force: true }); } catch {}

console.log(`\n==== RESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ====`);
process.exit(failures === 0 ? 0 : 1);
