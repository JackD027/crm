import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readWorkbook, detectHeaderRow, buildTable } from '../src/lib/parse.js';
import { suggestMapping } from '../src/lib/columns.js';
import { processRows } from '../src/lib/importer.js';
import * as A from '../src/lib/analytics.js';
import { generateInsights } from '../src/lib/insights.js';
import { buildReport, toCsv, toXlsx } from '../src/lib/reports.js';
import { tx } from './helpers.js';
import XLSX from 'xlsx';

function demo() {
  const wb = readWorkbook(fs.readFileSync(new URL('../../sample-data/demo-sales.xlsx', import.meta.url)), 'demo.xlsx');
  const table = buildTable(wb.sheets.Sales, detectHeaderRow(wb.sheets.Sales.aoa));
  const map = suggestMapping(table.headers).mapping;
  const r = processRows({ table, mapping: map, importType: 'transaction' });
  return { r, all: r.records, expectedNet: r.stats.totals.net };
}
const anchorsOf = (txns) => { const d = txns.filter((t) => t.saleDate).map((t) => A.toISO(t.saleDate)).sort(); return { min: d[0], max: d[d.length - 1] }; };
const inRange = (txns, rg) => txns.filter((t) => t.saleDate && (!rg.from || t.saleDate >= rg.from) && (!rg.to || t.saleDate <= rg.to));

test('17. dashboard totals equal imported totals and every breakdown reconciles', () => {
  const { all, expectedNet, r } = demo();
  const s = A.summarize(all);
  assert.equal(s.netSales, expectedNet);
  assert.equal(s.returns, 456);
  assert.equal(s.shops, 12);
  const sum = (rows) => Math.round(rows.reduce((a, x) => a + x.net, 0) * 100) / 100;
  assert.equal(sum(A.aggregate(all, (t) => t.shopKey)), s.netSales);
  assert.equal(sum(A.areasTable(all, null)), s.netSales);
  assert.equal(sum(A.categoriesTable(all, null)), s.netSales);
  assert.equal(sum(A.productsTable(all, null)), s.netSales);
  assert.equal(Math.round(A.trend(all, 'month').reduce((a, x) => a + x.net, 0) * 100) / 100, s.netSales);
  assert.equal(Math.round(A.trend(all, 'day').reduce((a, x) => a + x.net, 0) * 100) / 100, s.netSales);
  assert.equal(Math.round(A.trend(all, 'week').reduce((a, x) => a + x.net, 0) * 100) / 100, s.netSales);
  assert.equal(s.discounts, r.stats.totals.discount);
  assert.equal(s.profit, null); // no cost column => no profit claimed
});

test('invoice-level metrics: distinct invoices, AOV excludes returns from the numerator', () => {
  const t = [tx({ date: '2026-04-01', invoiceNo: 'I1', netSales: 300 }), tx({ date: '2026-04-01', invoiceNo: 'I1', netSales: 100 }), tx({ date: '2026-04-02', invoiceNo: 'I2', netSales: 200 }), tx({ date: '2026-04-03', invoiceNo: 'CN', netSales: -50, isReturn: true, quantity: -1 })];
  const s = A.summarize(t);
  assert.equal(s.invoices, 2); assert.equal(s.aov, 300); assert.equal(s.netSales, 550); assert.equal(s.returns, 50);
});

test('profit only when cost data is sufficient', () => {
  const full = [tx({ date: '2026-04-01', netSales: 1000, costTotal: 600 }), tx({ date: '2026-04-02', netSales: 500, costTotal: 300 })];
  assert.equal(A.summarize(full).profit.value, 600);
  assert.equal(A.summarize(full).profit.margin, 40);
  assert.equal(A.summarize([...full, tx({ date: '2026-04-03', netSales: 1500 })]).profit, null);
});

test('16. date filters (match object) and previous-period comparison', () => {
  const { all } = demo();
  const anchors = anchorsOf(all);
  const rg = A.resolveRange({ range: '60' }, anchors);
  assert.equal(A.toISO(rg.to), anchors.max);
  assert.equal(rg.days, 60);
  assert.equal(rg.prev.days, 60);
  assert.equal(A.toISO(A.addDays(rg.prev.to, 1)), A.toISO(rg.from)); // contiguous, equal length, no overlap
  const cur = inRange(all, rg), prev = inRange(all, rg.prev);
  assert.ok(cur.length && prev.length && cur.length + prev.length <= all.length);
  assert.equal(A.summarize(cur).netSales + A.summarize(prev).netSales + A.summarize(all.filter((t) => t.saleDate < rg.prev.from)).netSales, A.summarize(all).netSales);
  const m = A.buildMatch({ shop: 'n:a', area: 'X|Y', category: 'Uncategorized' }, { from: rg.from, to: rg.to });
  assert.equal(m.shopKey, 'n:a'); assert.deepEqual(m.area, { $in: ['X', 'Y'] }); assert.equal(m.$or.length, 2); assert.ok(m.saleDate.$gte);
  // not enough history => no comparison offered
  assert.equal(A.resolveRange({ range: '180' }, anchors).prev, null);
  assert.equal(A.resolveRange({ range: '90' }, anchors).prev, null); // demo data is only ~170 days: the prior 90 days are not fully covered
  const lm = A.resolveRange({ range: 'lastmonth' }, anchors); // data ends 24 Sep => last FULL month is August, compared with July
  assert.equal(A.toISO(lm.from), '2026-08-01'); assert.equal(A.toISO(lm.to), '2026-08-31');
  assert.equal(A.toISO(lm.prev.from), '2026-07-01'); assert.equal(A.toISO(lm.prev.to), '2026-07-31'); assert.equal(lm.prev.days, 31);
  assert.equal(A.toISO(A.resolveRange({ range: 'lastmonth' }, { min: '2026-04-08', max: '2026-09-30' }).from), '2026-09-01');
  assert.equal(A.resolveRange({ range: 'lastmonth' }, { min: '2026-07-15', max: '2026-08-31' }).prev, null); // July only partly covered
  assert.equal(A.resolveRange({ range: 'all' }, anchors).prev, null);
  assert.equal(A.resolveRange({ from: '2026-09-01', to: '2026-09-30' }, anchors).prev.days, 30);
});

test('growth calculations: new items have no percentage; zero previous never divides', () => {
  const cur = [tx({ date: '2026-09-01', shopKey: 'n:a', netSales: 150 }), tx({ date: '2026-09-02', shopKey: 'n:b', netSales: 50 })];
  const prev = [tx({ date: '2026-08-01', shopKey: 'n:a', netSales: 100 })];
  const rows = A.withGrowth(A.aggregate(cur, (t) => t.shopKey), A.aggregate(prev, (t) => t.shopKey));
  assert.equal(rows.find((r) => r.key === 'n:a').changePct, 50);
  const b = rows.find((r) => r.key === 'n:b'); assert.equal(b.changePct, null); assert.equal(b.isNew, true);
});

test('follow-up flags: inactive shops, one-time buyers, declines, and refusal when history is too short', () => {
  const { all } = demo();
  const a = anchorsOf(all);
  const f = A.followUpFlags(all, { inactiveDays: 60, asOf: a.max, minDate: a.min });
  assert.ok(f.inactive.some((s) => s.shopName === 'Kapoor Mini Mart')); // stopped after June in the demo data
  assert.ok(f.inactive.every((s) => s.daysSince >= 60));
  const short = A.followUpFlags(all.filter((t) => A.toISO(t.saleDate) < '2026-05-15'), { inactiveDays: 60, asOf: '2026-05-14', minDate: '2026-04-08' });
  assert.equal(short.inactive.length, 0);
  assert.match(short.notes[0], /cannot be established/);
  const one = A.followUpFlags([tx({ date: '2026-01-01', shopKey: 'n:z', shopName: 'Z' }), tx({ date: '2026-06-01', shopKey: 'n:y', shopName: 'Y' }), tx({ date: '2026-06-20', shopKey: 'n:y', shopName: 'Y' })], { inactiveDays: 60, asOf: '2026-06-20', minDate: '2026-01-01' });
  assert.equal(one.oneAndDone[0].shopName, 'Z');
});

test('insights: every item carries metric/value/comparison/period/method; no comparison without history', () => {
  const { all } = demo();
  const a = anchorsOf(all);
  const flags = A.followUpFlags(all, { inactiveDays: 60, asOf: a.max, minDate: a.min });
  const rg = A.resolveRange({ range: '60' }, a);
  const out = generateInsights({ cur: inRange(all, rg), prev: inRange(all, rg.prev), periodText: 'P', prevText: 'Q', flags });
  assert.ok(out.insights.length >= 5);
  for (const i of out.insights) for (const k of ['title', 'text', 'metric', 'value', 'dateRange', 'method']) assert.ok(i[k], `${i.id} lacks ${k}`);
  assert.ok(out.insights.some((i) => i.id === 'inactive'));
  const none = generateInsights({ cur: all, prev: null, periodText: 'all', prevText: '', flags });
  assert.ok(!none.insights.some((i) => /overall|product-up|product-down/.test(i.id)));
  assert.ok(none.unavailable.some((u) => u.id === 'overall' && /earlier period/.test(u.reason)));
  assert.equal(generateInsights({ cur: [], prev: null }).insights.length, 0);
});

test('insights explain missing fields (no areas, no categories)', () => {
  const t = Array.from({ length: 3 }, (_, i) => tx({ date: `2026-04-0${i + 1}`, area: null, category: null, shopKey: 'n:' + i }));
  const out = generateInsights({ cur: t, prev: null, periodText: 'x', flags: null });
  assert.ok(out.unavailable.some((u) => u.id === 'top-area'));
  assert.ok(out.unavailable.some((u) => u.id === 'top-category'));
});

test('19. exports respect filters and agree with the screens; CSV/XLSX carry headings and timestamp', () => {
  const { all } = demo();
  const sadar = all.filter((t) => t.area === 'Sadar Bazar');
  const rep = buildReport('shops', { cur: sadar, prev: null });
  assert.equal(Math.round(rep.rows.reduce((s, r) => s + r.net, 0) * 100) / 100, A.summarize(sadar).netSales);
  assert.ok(rep.rows.every((r) => r.area === 'Sadar Bazar'));
  const txReport = buildReport('transactions', { cur: sadar });
  assert.equal(Math.round(txReport.rows.reduce((s, r) => s + r.net, 0) * 100) / 100, A.summarize(sadar).netSales);
  const meta = { title: 'Shop-wise sales', generated: '2026-10-29 10:00', period: 'All dates', filters: 'Area = Sadar Bazar' };
  const csv = toCsv(rep, meta);
  assert.match(csv, /# Generated: 2026-10-29 10:00/); assert.match(csv, /Net sales \(₹\)/); assert.match(csv, /Filters: Area = Sadar Bazar/);
  const wb = XLSX.read(toXlsx(rep, meta), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Report', 'Info']);
  for (const type of ['summary', 'areas', 'products', 'categories', 'monthly', 'inactive', 'insights', 'errors']) assert.ok(buildReport(type, { cur: all }).columns.length);
});

test('20. large-file validation: 50,000 rows are processed and aggregated quickly and correctly', () => {
  const headers = ['Date', 'Bill', 'Shop', 'Area', 'Item', 'Qty', 'Rate'];
  const rows = [];
  for (let i = 0; i < 50000; i++) rows.push({ n: i + 2, v: [`${1 + (i % 28)}/${1 + (i % 12)}/2026`, 'B' + Math.floor(i / 3), 'Shop ' + (i % 400), 'Area ' + (i % 25), 'Item ' + (i % 90), 1 + (i % 9), 10 + (i % 50)] });
  const map = suggestMapping(headers).mapping;
  const t0 = Date.now();
  const r = processRows({ table: { headers, rows }, mapping: map, importType: 'transaction' });
  const s = A.summarize(r.records); A.shopsTable(r.records, null); A.areasTable(r.records, null);
  const ms = Date.now() - t0;
  assert.equal(r.stats.imported, 50000);
  let expect = 0; for (let i = 0; i < 50000; i++) expect += (1 + (i % 9)) * (10 + (i % 50));
  assert.equal(s.netSales, expect);
  assert.ok(ms < 10000, `took ${ms}ms`);
  console.log(`      (50,000 rows processed + aggregated in ${ms} ms)`);
});
