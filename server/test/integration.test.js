// End-to-end tests over HTTP against a real MongoDB (database "sales_crm_test").
// Skipped automatically when MongoDB is not reachable. URI: TEST_MONGODB_URI or mongodb://127.0.0.1:27017/sales_crm_test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/sales_crm_test';
let up = false, server, base, app, Tx, Shop, ImportBatch;
let authCookie;
import { demoWorkbookBuffer, demoCsvBuffer } from '../src/lib/demoData.js';

before(async () => {
  try { await mongoose.connect(URI, { serverSelectionTimeoutMS: 2500 }); up = true; } catch { console.log('      (MongoDB not reachable: integration tests skipped)'); return; }
  await mongoose.connection.dropDatabase();
  process.env.AUTH_USERNAME = 'integration-owner';
  process.env.AUTH_PASSWORD = 'integration-test-password-long-enough';
  process.env.AUTH_SECRET = 'integration-test-secret-that-is-at-least-thirty-two-characters';
  ({ app } = await import('../src/index.js'));
  ({ SalesTransaction: Tx, Shop, ImportBatch } = await import('../src/models/index.js'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.AUTH_USERNAME, password: process.env.AUTH_PASSWORD }),
  });
  assert.equal(login.status, 200);
  authCookie = login.headers.get('set-cookie').split(';', 1)[0];
});
after(async () => { if (server) server.close(); if (up) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

const J = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie: authCookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
};
const upload = async (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); const r = await fetch(base + '/api/imports/preview', { method: 'POST', headers: { cookie: authCookie }, body: fd }); return { status: r.status, body: await r.json() }; };
async function importFile(buf, name, { options = {}, mode = 'append', sheet, confirmReplace } = {}) {
  const pv = (await upload(buf, name)).body;
  const body = { token: pv.token, sheet: sheet || pv.sheet, importType: pv.suggestion.importType, mapping: pv.suggestion.mapping, options };
  const v = await J('POST', '/api/imports/validate', body);
  const c = await J('POST', '/api/imports/commit', { ...body, mode, confirmReplace });
  return { pv, v, c, body };
}
const sum = (rows, k = 'net') => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
const skip = (t) => { if (!up) { t.skip('MongoDB not available'); return true; } return false; };

test('empty database reports no data; DB-less endpoints still answer', async (t) => {
  if (skip(t)) return;
  assert.equal((await J('GET', '/api/meta')).body.hasData, false);
  assert.equal((await J('GET', '/api/imports')).body.length, 0);
});

let firstBatch;
test('Excel import: preview → validate → commit; totals match the validation report', async (t) => {
  if (skip(t)) return;
  const { pv, v, c } = await importFile(demoWorkbookBuffer(), 'demo.xlsx');
  assert.equal(pv.sheets.length, 2);
  assert.equal(v.status, 200); assert.equal(v.body.stats.imported, 84); assert.equal(v.body.dbChecked, true);
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.imported, 84); assert.equal(c.body.totalNetSales, 326196);
  firstBatch = c.body.batchId;
  assert.equal(await Tx.countDocuments(), 84);
  const b = (await J('GET', '/api/imports/' + firstBatch)).body;
  assert.equal(b.status, 'completed'); assert.equal(b.liveRecordCount, 84); assert.ok(b.mapping.shopName); assert.ok(b.rules.length);
});

test('double-clicking Confirm does not import twice (idempotent per upload)', async (t) => {
  if (skip(t)) return;
  const pv = (await upload(demoCsvBuffer(), 'again.csv')).body;
  const body = { token: pv.token, sheet: pv.sheet, importType: pv.suggestion.importType, mapping: pv.suggestion.mapping, options: { duplicateStrategy: 'keep' } };
  const [a, b] = await Promise.all([J('POST', '/api/imports/commit', body), J('POST', '/api/imports/commit', body)]);
  assert.ok([a.status, b.status].includes(200) && [a.status, b.status].some((s) => s === 409 || (s === 200 && (a.body.alreadyImported || b.body.alreadyImported))), JSON.stringify([a.body, b.body]));
  const n = await Tx.countDocuments(); assert.equal(n, 168); // imported exactly once ("keep" duplicates on request)
  const again = await J('POST', '/api/imports/commit', body);
  assert.equal(again.body.alreadyImported, true); assert.equal(await Tx.countDocuments(), 168);
  await J('POST', `/api/imports/${a.body.batchId || b.body.batchId}/undo`, { confirm: true }); // clean up
  assert.equal(await Tx.countDocuments(), 84);
});

test('9. duplicate import attempt: same data (CSV vs XLSX) is detected and skipped', async (t) => {
  if (skip(t)) return;
  const { v, c } = await importFile(demoCsvBuffer(), 'same-data.csv');
  assert.equal(v.body.stats.counts.existingDuplicates, 84);
  assert.equal(c.status, 422); assert.match(c.body.error, /no importable rows/i);
  assert.equal(await Tx.countDocuments(), 84);
});

let extraBatch;
test('a file with old + new rows only adds the new row; new shop is created', async (t) => {
  if (skip(t)) return;
  const csv = Buffer.concat([demoCsvBuffer(), Buffer.from('\n30/09/2026,INV-2026-9999,Brand New Traders,BNT99,Sector 18,Noida,Cola 600ml,COLA600,Beverages,10,38,,380,Vikas')]);
  const { c } = await importFile(csv, 'extended.csv');
  assert.equal(c.body.imported, 1); assert.equal(c.body.skipped, 84);
  extraBatch = c.body.batchId;
  assert.equal(await Tx.countDocuments(), 85); assert.ok(await Shop.findOne({ name: 'Brand New Traders' }));
});

test('17. dashboard totals, filters and previous-period comparison are correct', async (t) => {
  if (skip(t)) return;
  const all = (await J('GET', '/api/dashboard/summary?range=all')).body;
  assert.equal(all.summary.netSales, 326196 + 380); assert.equal(all.summary.returns, 456); assert.equal(all.summary.shops, 13);
  assert.equal(all.range.comparisonAvailable, false);
  assert.equal(sum(all.areas), sum(all.categories)); assert.equal(sum(all.categories), all.summary.netSales);
  const lm = (await J('GET', '/api/dashboard/summary?range=lastmonth')).body; // data ends 30 Sep => last full month = September, vs August
  assert.equal(lm.range.comparisonAvailable, true); assert.ok(lm.prevSummary.netSales > 0); assert.ok(lm.deltas.netSales !== null);
  const aug = (await J('GET', '/api/dashboard/summary?from=2026-08-01&to=2026-08-31')).body;
  const jul = (await J('GET', '/api/dashboard/summary?from=2026-07-01&to=2026-07-31')).body;
  assert.equal(aug.prevSummary.netSales, jul.summary.netSales); // previous period = identical-length period before
  const area = (await J('GET', '/api/dashboard/summary?range=all&area=Sadar%20Bazar')).body;
  assert.ok(area.summary.netSales < all.summary.netSales && area.summary.netSales > 0);
  assert.equal(area.filtersText, 'area = Sadar Bazar');
  assert.equal((await J('GET', '/api/dashboard/summary?from=bad')).status, 400);
});

test('shops, areas, products, categories, trend and insights endpoints agree with each other', async (t) => {
  if (skip(t)) return;
  const net = 326196 + 380;
  const shops = (await J('GET', '/api/analytics/shops?range=all')).body; assert.equal(sum(shops.rows.filter((r) => !r.noSalesInPeriod)), net);
  const areas = (await J('GET', '/api/analytics/areas?range=all')).body; assert.equal(sum(areas.rows), net);
  const prods = (await J('GET', '/api/analytics/products?range=all')).body; assert.equal(sum(prods.rows), net);
  const cats = (await J('GET', '/api/analytics/categories?range=all')).body; assert.equal(sum(cats.rows), net);
  const tr = (await J('GET', '/api/analytics/sales-trend?range=all&grain=month')).body; assert.equal(sum(tr.series), net);
  assert.equal(tr.series.length, 6);
  const ins = (await J('GET', '/api/insights?range=lastmonth')).body; assert.ok(ins.insights.length >= 4); assert.ok(ins.insights.every((i) => i.method && i.dateRange));
  const fl = (await J('GET', '/api/analytics/follow-ups?days=60')).body; assert.ok(fl.inactive.some((s) => s.shopName === 'Kapoor Mini Mart'));
  const key = encodeURIComponent(shops.rows.find((r) => r.label === 'Jain Traders').key);
  const d = (await J('GET', `/api/shops/${key}?range=all`)).body; assert.equal(d.shop.name, 'Jain Traders'); assert.ok(d.monthly.length > 3); assert.ok(d.lastPurchase);
  const ad = (await J('GET', '/api/analytics/areas/Sadar%20Bazar?range=all')).body; assert.equal(ad.summary.netSales, areas.rows.find((r) => r.label === 'Sadar Bazar').net);
});

test('transactions: server-side pagination, search and sorting', async (t) => {
  if (skip(t)) return;
  const p1 = (await J('GET', '/api/transactions?range=all&pageSize=50&page=1')).body;
  assert.equal(p1.total, 85); assert.equal(p1.rows.length, 50); assert.equal(p1.pages, 2); assert.equal(p1.totalNet, 326576);
  const p2 = (await J('GET', '/api/transactions?range=all&pageSize=50&page=2')).body; assert.equal(p2.rows.length, 35);
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => String(r.id))).size, 85);
  const s = (await J('GET', '/api/transactions?range=all&q=jain')).body; assert.ok(s.total > 0 && s.rows.every((r) => /jain/i.test(r.shop)));
  assert.equal((await J('GET', '/api/transactions?range=all&q=.*(')).status, 200); // regex characters are escaped
});

test('15. missing categories show as Uncategorized and can be assigned (applies to existing and future rows)', async (t) => {
  if (skip(t)) return;
  const prods = (await J('GET', '/api/analytics/products?range=all')).body;
  const sh = prods.rows.find((r) => r.label === 'Shampoo 180ml'); assert.ok(!sh.category || sh.category === 'Uncategorized');
  assert.ok((await J('GET', '/api/analytics/categories?range=all')).body.rows.some((r) => r.label === 'Uncategorized'));
  assert.ok((await J('GET', '/api/meta')).body.options.categories.includes('Uncategorized'));
  const r = await J('PUT', `/api/products/${encodeURIComponent(sh.key)}/category`, { category: 'Personal Care' });
  assert.equal(r.status, 200); assert.ok(r.body.updated > 0);
  assert.ok(!(await J('GET', '/api/analytics/categories?range=all')).body.rows.some((x) => x.label === 'Uncategorized'));
  const filtered = (await J('GET', '/api/dashboard/summary?range=all&category=Personal%20Care')).body; assert.ok(filtered.summary.netSales > 0);
});

test('19. exports respect filters and match the screens; CSV and Excel both work', async (t) => {
  if (skip(t)) return;
  const csv = await J('GET', '/api/reports/export?type=shops&format=csv&range=all&area=Sadar%20Bazar');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /shops-report-\d+\.csv/);
  assert.match(csv.body, /# Generated:/); assert.match(csv.body, /area = Sadar Bazar/);
  const lines = csv.body.split('\r\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('\uFEFF#'));
  assert.equal(lines.length - 1, 3); // header + 3 Sadar Bazar shops
  const xl = await fetch(base + '/api/reports/export?type=transactions&format=xlsx&range=all');
  const wb = XLSX.read(Buffer.from(await xl.arrayBuffer()), { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Report).length, 85);
  for (const type of ['summary', 'areas', 'products', 'categories', 'monthly', 'inactive', 'insights']) assert.equal((await J('GET', `/api/reports/export?type=${type}&format=csv&range=all`)).status, 200, type);
  assert.equal((await J('GET', `/api/reports/export?type=errors&format=csv&batchId=${firstBatch}`)).status, 200);
  assert.equal((await J('GET', '/api/reports/export?type=nope')).status, 400);
});

test('14. confirmed alias merge combines shops and applies to future imports', async (t) => {
  if (skip(t)) return;
  const rows = (await J('GET', '/api/shops?range=all')).body.rows;
  const a = rows.find((r) => r.label === 'Gupta Kirana'), b = rows.find((r) => r.label === 'Sharma General Store');
  const before = (await J('GET', '/api/dashboard/summary?range=all')).body.summary;
  assert.equal((await J('POST', '/api/aliases', { type: 'shop', fromKey: a.key, toKey: b.key })).status, 200);
  const after = (await J('GET', '/api/dashboard/summary?range=all')).body.summary;
  assert.equal(after.netSales, before.netSales); assert.equal(after.shops, before.shops - 1);
  const merged = (await J('GET', '/api/shops?range=all')).body.rows.find((r) => r.label === 'Sharma General Store');
  assert.equal(merged.net, a.net + b.net);
  const csv = Buffer.from('Party Name,Item Name,Net Amount,Bill Date\nGupta Kirana,Atta 10kg,430,01/10/2026\n');
  const r = await importFile(csv, 'alias.csv'); assert.equal(r.c.body.imported, 1);
  const tx = await Tx.findOne({ sourceRow: 2, importBatchId: r.c.body.batchId }); assert.equal(tx.shopName, 'Sharma General Store');
  await J('POST', `/api/imports/${r.c.body.batchId}/undo`, { confirm: true });
});

test('18. undo removes only that import and cleans up what it created', async (t) => {
  if (skip(t)) return;
  const before = (await J('GET', '/api/dashboard/summary?range=all')).body.summary.netSales;
  assert.equal((await J('POST', `/api/imports/${extraBatch}/undo`, {})).status, 400); // needs confirmation
  const u = await J('POST', `/api/imports/${extraBatch}/undo`, { confirm: true });
  assert.equal(u.status, 200); assert.equal(u.body.removedRecords, 1);
  assert.equal(await Tx.countDocuments(), 84); assert.equal(await Shop.findOne({ name: 'Brand New Traders' }), null);
  assert.equal((await J('GET', '/api/dashboard/summary?range=all')).body.summary.netSales, before - 380);
  assert.equal((await ImportBatch.findById(extraBatch)).status, 'undone');
  assert.equal((await J('POST', `/api/imports/${extraBatch}/undo`, { confirm: true })).status, 409); // cannot undo twice
  assert.ok(await Shop.findOne({ name: 'Jain Traders' })); // unrelated data untouched
});

test('18b. a failure part-way through an import rolls back only that batch', async (t) => {
  if (skip(t)) return;
  const lines = ['Date,Bill No,Shop,Item,Qty,Rate']; for (let i = 0; i < 2500; i++) lines.push(`01/09/2026,B${i},Bulk Shop ${i % 50},Item ${i % 7},1,10`);
  const orig = Tx.insertMany.bind(Tx); let calls = 0;
  Tx.insertMany = async (...a) => { if (++calls === 2) throw new Error('simulated disk failure'); return orig(...a); };
  let r; try { r = await importFile(Buffer.from(lines.join('\n')), 'bulk.csv'); } finally { Tx.insertMany = orig; }
  assert.equal(r.c.status, 500); assert.match(r.c.body.error, /rolled back/);
  assert.equal(await Tx.countDocuments(), 84); // nothing from the failed file, nothing lost from earlier imports
  assert.equal(await Shop.findOne({ name: 'Bulk Shop 1' }), null);
  assert.equal((await ImportBatch.findOne({ fileName: 'bulk.csv' })).status, 'failed');
  const ok = await importFile(Buffer.from(lines.join('\n')), 'bulk2.csv'); // and a retry works (large file, 3 chunks)
  assert.equal(ok.c.body.imported, 2500);
  await J('POST', `/api/imports/${ok.c.body.batchId}/undo`, { confirm: true });
  assert.equal(await Tx.countDocuments(), 84);
});

test('11. repeated invoice totals block the import until the user decides', async (t) => {
  if (skip(t)) return;
  const csv = Buffer.from('Bill No,Party,Item,Qty,Rate,Net Amount\nR1,Repeat Shop,Item A,2,100,500\nR1,Repeat Shop,Item B,3,100,500\n');
  const first = await importFile(csv, 'repeat.csv');
  assert.equal(first.v.body.needsDecision, true); assert.equal(first.c.status, 409);
  assert.equal(await Tx.countDocuments({ shopName: 'Repeat Shop' }), 0);
  const ok = await importFile(csv, 'repeat2.csv', { options: { repeatedTotals: 'calculate' } });
  assert.equal(ok.c.body.totalNetSales, 500); // 200 + 300, not 1000
  await J('POST', `/api/imports/${ok.c.body.batchId}/undo`, { confirm: true });
});

test('incomplete mapping and expired uploads give clear errors', async (t) => {
  if (skip(t)) return;
  const bad = await J('POST', '/api/imports/validate', { token: 'nope', sheet: 'x', importType: 'transaction', mapping: {} });
  assert.equal(bad.status, 410);
  const pv = (await upload(Buffer.from('Party,Item\nA,B\n'), 'x.csv')).body;
  const r = await J('POST', '/api/imports/validate', { token: pv.token, sheet: pv.sheet, importType: 'transaction', mapping: { shopName: 'Party', product: 'Item' } });
  assert.equal(r.status, 422); assert.match(JSON.stringify(r.body), /sales amount/);
});

test('replace mode needs confirmation, then swaps all sales data; CRM notes survive', async (t) => {
  if (skip(t)) return;
  const shops = (await J('GET', '/api/shops?range=all')).body.rows;
  const jain = shops.find((r) => r.label === 'Jain Traders');
  await J('PUT', `/api/shops/${encodeURIComponent(jain.key)}`, { notes: 'Prefers morning delivery', phone: '98100 00000', followUpStatus: 'to_contact' });
  assert.equal((await J('PUT', `/api/shops/${encodeURIComponent(jain.key)}`, { phone: 'abc' })).status, 400);
  await J('POST', `/api/shops/${encodeURIComponent(jain.key)}/reminders`, { text: 'Call about restock', dueDate: '2020-01-01' });
  const fu = (await J('GET', '/api/followups')).body; assert.equal(fu.length, 1); assert.equal(fu[0].overdue, true);
  const csv = Buffer.from('Date,Bill No,Shop,Area,Item,Qty,Rate\n05/10/2026,N1,Fresh Shop,Zone Z,Widget,4,250\n');
  const pv = (await upload(csv, 'fresh.csv')).body;
  const body = { token: pv.token, sheet: pv.sheet, importType: pv.suggestion.importType, mapping: pv.suggestion.mapping, mode: 'replace' };
  assert.equal((await J('POST', '/api/imports/commit', body)).status, 400);
  const c = await J('POST', '/api/imports/commit', { ...body, confirmReplace: true });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(await Tx.countDocuments(), 1);
  assert.equal((await ImportBatch.findById(firstBatch)).status, 'replaced');
  assert.equal((await J('POST', `/api/imports/${firstBatch}/undo`, { confirm: true })).status, 409);
  const kept = await Shop.findOne({ name: 'Jain Traders' }); assert.equal(kept.notes, 'Prefers morning delivery'); // notes preserved
});

test('settings validate input and saved mapping profiles are offered for the same layout', async (t) => {
  if (skip(t)) return;
  assert.equal((await J('PUT', '/api/settings', { inactiveDays: 3 })).status, 400);
  assert.equal((await J('PUT', '/api/settings', { defaultRange: 'bogus' })).status, 400);
  const s = await J('PUT', '/api/settings', { businessName: 'Test Traders', inactiveDays: 45, importDefaults: { dateOrder: 'MDY' } });
  assert.equal(s.body.businessName, 'Test Traders'); assert.equal(s.body.inactiveDays, 45); assert.equal(s.body.importDefaults.dateOrder, 'MDY');
  const csv = Buffer.from('Customer Name,Product,Net Sales\nA,B,10\n');
  const pv = (await upload(csv, 'p.csv')).body;
  const body = { token: pv.token, sheet: pv.sheet, importType: 'invoice', mapping: { shopName: 'Customer Name', netSales: 'Net Sales', product: 'Product' }, saveProfile: 'My billing software' };
  await J('POST', '/api/imports/commit', { ...body, importType: 'transaction' });
  const again = (await upload(csv, 'p2.csv')).body;
  assert.equal(again.savedProfile?.name, 'My billing software');
});
