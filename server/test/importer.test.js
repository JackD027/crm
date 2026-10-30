import test from 'node:test';
import assert from 'node:assert/strict';
import { processRows, parseDate, parseNumber } from '../src/lib/importer.js';
import { tableOf, M } from './helpers.js';

const H = ['Date', 'Inv', 'Shop', 'Area', 'Item', 'Cat', 'Qty', 'Rate', 'Disc', 'Net'];
const map = M({ date: 'Date', invoiceNo: 'Inv', shopName: 'Shop', area: 'Area', product: 'Item', category: 'Cat', quantity: 'Qty', unitPrice: 'Rate', discount: 'Disc', netSales: 'Net' });
const run = (rows, over = {}) => processRows({ table: tableOf(H, rows), mapping: over.mapping || map, importType: over.type || 'transaction', options: over.options || {}, existingKeys: over.existing, aliases: over.aliases });

test('date and number parsing (Indian formats, Excel serials, ₹, brackets)', () => {
  assert.equal(parseDate('05/03/2026').date.toISOString().slice(0, 10), '2026-03-05');
  assert.equal(parseDate('05/03/2026', 'MDY').date.toISOString().slice(0, 10), '2026-05-03');
  assert.equal(parseDate('15-Mar-2026').date.toISOString().slice(0, 10), '2026-03-15');
  assert.equal(parseDate(46000).date.toISOString().slice(0, 10), '2025-12-09');
  assert.ok(parseDate('31/02/2026').invalid && parseDate('hello').invalid);
  assert.equal(parseNumber('₹1,25,000.50').value, 125000.5);
  assert.equal(parseNumber('(500)').value, -500);
  assert.ok(parseNumber('12abc').invalid && parseNumber('-').empty);
});

test('12. discount is applied once: net column wins; otherwise qty×rate−discount', () => {
  const r = run([['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 10, 100, 50, 950], ['2026-04-01', 'I2', 'A', 'X', 'Q', 'C', 10, 100, 50, null]]);
  assert.equal(r.records[0].netSales, 950); // not 900
  assert.equal(r.records[1].netSales, 950); // 1000 − 50
  assert.equal(r.stats.totals.net, 1900);
  assert.equal(r.stats.totals.discount, 100);
  assert.equal(r.stats.counts.calcMismatch, 0);
});

test('percentage discounts', () => {
  const r = run([['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 10, 100, 10, null]], { options: { discountType: 'percent' } });
  assert.equal(r.records[0].netSales, 900);
});

test('suspicious calculation is flagged but not altered', () => {
  const r = run([['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 10, 100, null, 1180]]);
  assert.equal(r.records[0].netSales, 1180);
  assert.equal(r.stats.counts.calcMismatch, 1);
});

test('7. invalid dates are rejected by default with row numbers, or imported undated by choice', () => {
  const rows = [['31/02/2026', 'I1', 'A', 'X', 'P', 'C', 1, 100, null, 100], ['2026-04-01', 'I2', 'A', 'X', 'P', 'C', 1, 100, null, 100]];
  const r = run(rows);
  assert.equal(r.stats.rejected, 1);
  assert.equal(r.rejectedRows[0].row, 2);
  assert.match(r.rejectedRows[0].reasons, /Invalid date/);
  const r2 = run(rows, { options: { invalidDates: 'import_without_date' } });
  assert.equal(r2.stats.imported, 2);
  assert.equal(r2.records[0].saleDate, null); // never invented
});

test('missing required values and invalid numbers are rejected, never silently dropped', () => {
  const r = run([['2026-04-01', 'I1', '', 'X', 'P', 'C', 1, 100, null, 100], ['2026-04-01', 'I1', 'A', 'X', '', 'C', 1, 100, null, 100], ['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 'abc', 100, null, 100], ['2026-04-01', 'I1', 'A', 'X', 'P', 'C', null, null, null, null]]);
  assert.equal(r.stats.rejected, 4);
  assert.equal(r.stats.totalRows, r.stats.validRows + r.stats.rejected);
  assert.equal(r.rejectedRows.length, 4);
  assert.ok(r.issues.some((i) => i.code === 'no_amount'));
});

test('10. legitimate repeat purchases are never discarded', () => {
  const same = ['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 5, 100, null, 500];
  const r = run([same, [...same], ['2026-05-01', 'I9', 'A', 'X', 'P', 'C', 5, 100, null, 500]]);
  assert.equal(r.stats.imported, 3);
  assert.equal(r.stats.counts.inFileDuplicates, 1); // flagged for information only
  assert.equal(new Set(r.records.map((x) => x.sourceKey)).size, 3);
});

test('9. duplicate import attempt: same file twice is detected and skipped (or kept on request)', () => {
  const rows = [['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 5, 100, null, 500], ['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 5, 100, null, 500], ['2026-04-02', 'I2', 'B', 'X', 'P', 'C', 1, 100, null, 100]];
  const first = run(rows);
  const existing = new Set(first.records.map((r) => r.sourceKey));
  const again = run(rows, { existing });
  assert.equal(again.stats.skippedDuplicates, 3);
  assert.equal(again.stats.imported, 0);
  const keep = run(rows, { existing, options: { duplicateStrategy: 'keep' } });
  assert.equal(keep.stats.imported, 3);
  // a file containing the old rows plus one new row only adds the new one
  const extended = run([...rows, ['2026-04-03', 'I3', 'C', 'X', 'P', 'C', 2, 100, null, 200]], { existing });
  assert.equal(extended.stats.imported, 1);
});

test('stable line ids are used for duplicate detection when available', () => {
  const m = M({ ...map, lineId: 'Cat' }); // reuse a column as a line id for the test
  const a = run([['2026-04-01', 'I1', 'A', 'X', 'P', '1', 5, 100, null, 500]], { mapping: m });
  const b = run([['2026-06-09', 'I1', 'A', 'X', 'P', '1', 7, 100, null, 700]], { mapping: m, existing: new Set(a.records.map((r) => r.sourceKey)) });
  assert.equal(b.stats.skippedDuplicates, 1); // same invoice + line id => same record, even if other values changed
});

test('11. repeated invoice totals are detected and need a decision; each strategy works', () => {
  const rows = [
    ['2026-04-01', 'I1', 'A', 'X', 'P1', 'C', 2, 100, null, 500], ['2026-04-01', 'I1', 'A', 'X', 'P2', 'C', 3, 100, null, 500],
    ['2026-04-02', 'I2', 'B', 'X', 'P1', 'C', 1, 100, null, 100],
  ];
  const ask = run(rows);
  assert.equal(ask.needsDecision, true);
  assert.equal(ask.stats.counts.repeatedInvoices, 1);
  assert.equal(run(rows, { options: { repeatedTotals: 'calculate' } }).stats.totals.net, 600); // 200 + 300 + 100
  assert.equal(run(rows, { options: { repeatedTotals: 'first_row' } }).stats.totals.net, 600);  // 500 once + 100
  assert.equal(run(rows, { options: { repeatedTotals: 'keep' } }).stats.totals.net, 1100);
  // lines that legitimately each equal the net amount are not flagged
  const ok = run([['2026-04-01', 'I5', 'A', 'X', 'P1', 'C', 1, 100, null, 100], ['2026-04-01', 'I5', 'A', 'X', 'P2', 'C', 1, 100, null, 100]]);
  assert.equal(ok.needsDecision, false);
});

test('13. returns/refunds reduce sales, are reported separately and are never positive sales', () => {
  const rows = [['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 10, 100, null, 1000], ['2026-04-05', 'CN1', 'A', 'X', 'P', 'C', -2, 100, null, -200]];
  const r = run(rows);
  assert.equal(r.stats.totals.net, 800);
  assert.equal(r.stats.totals.returns, 200);
  assert.equal(r.stats.totals.quantity, 8);
  assert.equal(r.records[1].isReturn, true);
  const rej = run(rows, { options: { negativeHandling: 'reject' } });
  assert.equal(rej.stats.rejected, 1);
});

test('14. shop / area normalisation: spacing and capitalisation only; similar-but-different names stay separate', () => {
  const r = run([
    ['2026-04-01', 'I1', 'ABC Store', 'karol bagh', 'P', 'C', 1, 10, null, 10], ['2026-04-02', 'I2', 'ABC  STORE ', 'Karol Bagh', 'P', 'C', 1, 10, null, 10],
    ['2026-04-03', 'I3', 'ABC Stores', 'KAROL BAGH', 'P', 'C', 1, 10, null, 10],
  ]);
  assert.equal(r.records[0].shopKey, r.records[1].shopKey);
  assert.notEqual(r.records[0].shopKey, r.records[2].shopKey); // not merged on similarity
  assert.equal(r.records[1].shopName, 'ABC Store');
  assert.equal(r.records[1].originalShopName, 'ABC STORE'); // source value stays traceable
  assert.deepEqual([...new Set(r.records.map((x) => x.area))], ['karol bagh']);
});

test('confirmed aliases are applied to future imports', () => {
  const aliases = { shops: { 'n:abc stores': { key: 'n:abc store', name: 'ABC Store' } } };
  const r = run([['2026-04-03', 'I3', 'ABC Stores', 'X', 'P', 'C', 1, 10, null, 10]], { aliases });
  assert.equal(r.records[0].shopKey, 'n:abc store');
});

test('15. missing categories stay empty (shown as Uncategorized later), never invented', () => {
  const r = run([['2026-04-01', 'I1', 'A', 'X', 'P', '', 1, 10, null, 10]]);
  assert.equal(r.records[0].category, null);
  assert.equal(r.stats.counts.missingCategory, 1);
});

test('aggregated import keeps its level: no invoices implied', () => {
  const m = M({ shopName: 'Shop', area: 'Area', netSales: 'Net' });
  const r = processRows({ table: tableOf(H, [[null, null, 'A', 'X', null, null, null, null, null, 5000]]), mapping: m, importType: 'aggregated' });
  assert.equal(r.records[0].isAggregated, true);
  assert.equal(r.records[0].invoiceNo, null);
});

test('cost data: costTotal = unit cost × quantity', () => {
  const m = M({ ...map, costPrice: 'Disc' });
  const r = processRows({ table: tableOf(H, [['2026-04-01', 'I1', 'A', 'X', 'P', 'C', 10, 100, 60, 1000]]), mapping: m, importType: 'transaction' });
  assert.equal(r.records[0].costTotal, 600);
});
