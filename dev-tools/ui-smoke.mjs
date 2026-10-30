// Optional UI smoke test (jsdom). Needs: the API running with an EMPTY database, `npm i jsdom`, and an IIFE build of the client:
//   cd client && cp ../dev-tools/vite.iife.config.mjs ./vite.iife.tmp.mjs && npx vite build --config ./vite.iife.tmp.mjs && rm vite.iife.tmp.mjs
// Paths below (/tmp/iife/app.js, http://127.0.0.1:5055) are the ones used during development; adjust as needed.
import { JSDOM, VirtualConsole } from 'jsdom';
const BASE = 'http://127.0.0.1:5055';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail?.message || e.message)));
vc.on('error', (...a) => { const m = a.join(' '); if (!/width\(0\)|ResizeObserver|not implemented/i.test(m)) errors.push('console.error: ' + m.slice(0, 300)); });
import fs from 'node:fs';
const code = fs.readFileSync('/tmp/iife/app.js','utf8');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: BASE + '/',
  runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.fetch = (u, o) => fetch(new URL(u, BASE), o); w.FormData = FormData; w.Blob = Blob;
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    w.confirm = () => true; w.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
    w.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + e.reason));
  },
});
const w = dom.window, d = w.document;
w.eval(code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => d.querySelector('.content')?.textContent || '';
const find = (t) => [...d.querySelectorAll('button,a.btn,a')].find((b) => b.textContent.includes(t) && !b.disabled);
const click = async (t, wait = 900) => { const b = find(t); if (!b) throw new Error('no button: ' + t + ' | page: ' + text().slice(0, 200)); b.click(); await sleep(wait); };
const go = async (path, wait = 1200) => { w.history.pushState({}, '', path); w.dispatchEvent(new w.PopStateEvent('popstate')); await sleep(wait); };
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  → ' + extra)); if (!ok) fails++; };

await sleep(1500);
check('empty dashboard shows import prompt', /No sales data yet/.test(text()), text().slice(0, 150));

// ---- wizard through the UI
await go('/import', 600);
check('wizard step 1', /Drag & drop/.test(text()));
await click('Load demo data into the wizard');
check('step 2 preview with sheets & rows', /Select worksheet/.test(text()) && /Notes/.test(text()) && /84 data rows/.test(text()), text().slice(0, 200));
await click('Continue');
check('step 3 mapping shows auto-detected columns', /Match your columns/.test(text()) && /auto · high/.test(text()));
await click('Validate data', 1500);
check('step 4 validation report', /Validation report/.test(text()) && /Source rows/.test(text()), text().slice(0, 250));
await click('Continue');
check('step 5 calculation review', /How sales are calculated/.test(text()) && /Confirm and import 84 rows/.test(text()), text().slice(0, 250));
await click('Confirm and import 84 rows', 2500);
check('step 6 import complete', /Import complete/.test(text()) && /84/.test(text()), text().slice(0, 250));
await click('View dashboard', 2000);
check('dashboard shows KPIs after import', /Net sales/.test(text()) && /₹3,26,196/.test(text()), text().slice(0, 300));

// ---- every route renders with real data
const meta = await (await fetch(BASE + '/api/meta')).json();
const shops = await (await fetch(BASE + '/api/shops?range=all')).json();
const hist = await (await fetch(BASE + '/api/imports')).json();
const skey = encodeURIComponent(shops.rows.find((r) => r.label === 'Jain Traders').key);
const routes = [
  ['/', /Sales trend/], ['/shops', /Jain Traders/], ['/shops/' + skey, /Contact & notes/], ['/areas', /Ranked areas/], ['/areas/Sadar%20Bazar', /Top shops in this area/],
  ['/products', /All products/], ['/insights', /How this was determined/], ['/reports', /Shop-wise sales/], ['/history', /demo-sales\.xlsx/], ['/history/' + hist[0]._id, /Column mapping used/],
  ['/settings', /Import defaults/], ['/transactions', /INV-2026-0001|lines/],
];
for (const [p, re] of routes) { await go(p, 1500); check('route ' + p.slice(0, 40), re.test(text()) && !/Cannot load data/.test(text()), text().slice(0, 160)); }

// ---- interactions
await go('/shops', 1200); await click('Follow-up suggestions', 1500);
check('follow-up tab lists Kapoor Mini Mart', /Kapoor Mini Mart/.test(text()), text().slice(0, 200));
await go('/products', 1500);
check('uncategorised products offered for assignment', /Assign categories/.test(text()) && /Shampoo/.test(text()));
await go('/areas', 1200);
check('area observations rendered', /Observations/.test(text()));
await go('/insights', 1500);
check('insights mention inactive shops', /have not purchased|has not purchased/.test(text()), text().slice(0, 300));
// filters UI
await go('/', 1500); await click('Filters', 500);
const sel = [...d.querySelectorAll('.filters select')].find((s) => [...s.options].some((o) => o.value === 'Sadar Bazar'));
sel.value = 'Sadar Bazar'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(1800);
check('area filter chip + filtered dashboard', /Area: Sadar Bazar/.test(d.querySelector('.topbar').textContent) && /Filters applied: area = Sadar Bazar/.test(text()), text().slice(0, 200));

console.log('\nRuntime errors captured:', errors.length); errors.slice(0, 8).forEach((e) => console.log('  ' + e));
console.log(fails ? `\n${fails} FAILED` : '\nALL UI CHECKS PASSED');
process.exit(0);
