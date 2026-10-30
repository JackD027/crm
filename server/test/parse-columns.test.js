import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readWorkbook, detectHeaderRow, buildTable, ImportError } from '../src/lib/parse.js';
import { suggestMapping, detectImportType, checkMapping } from '../src/lib/columns.js';
import { demoWorkbookBuffer, demoCsvBuffer, templateWorkbookBuffer } from '../src/lib/demoData.js';
import { xlsxBuffer } from './helpers.js';

const load = (buf, name, sheet) => { const wb = readWorkbook(buf, name); const s = wb.sheets[sheet || wb.names[0]]; return { wb, table: buildTable(s, detectHeaderRow(s.aoa)) }; };

test('1. valid Excel upload: sheets, headers, dates as ISO', () => {
  const { wb, table } = load(demoWorkbookBuffer(), 'demo.xlsx');
  assert.deepEqual(wb.names, ['Sales', 'Notes']);
  assert.equal(table.headers[0], 'Bill Date');
  assert.ok(table.rows.length >= 50 && table.rows.length <= 100);
  assert.match(table.rows[0].v[0], /^2026-\d\d-\d\d$/);
});

test('2. valid CSV upload (dd/mm/yyyy strings kept as text)', () => {
  const { table } = load(demoCsvBuffer(), 'demo.csv');
  assert.equal(table.headers.length, 14);
  assert.match(table.rows[0].v[0], /^\d\d\/\d\d\/2026$/);
});

test('3. different column names are recognised, case/spacing/punctuation insensitive', () => {
  const s = suggestMapping(['INVOICE_NO.', 'Retailer', 'sku name', ' Locality ', 'Units', 'Selling  Rate', 'Disc Amt', 'Net-Sales', 'Sales Executive']);
  assert.equal(s.mapping.invoiceNo, 'INVOICE_NO.');
  assert.equal(s.mapping.shopName, 'Retailer');
  assert.equal(s.mapping.product, 'sku name');
  assert.equal(s.mapping.area, ' Locality ');
  assert.equal(s.mapping.quantity, 'Units');
  assert.equal(s.mapping.unitPrice, 'Selling  Rate');
  assert.equal(s.mapping.discount, 'Disc Amt');
  assert.equal(s.mapping.netSales, 'Net-Sales');
  assert.equal(s.mapping.salesperson, 'Sales Executive');
});

test('3b. an ambiguous "Total" column is never mapped silently', () => {
  const s = suggestMapping(['Party Name', 'Item', 'Qty', 'Total']);
  assert.equal(s.mapping.netSales, null);
  assert.equal(s.ambiguousColumns[0].column, 'Total');
  const chk = checkMapping(s.mapping, 'transaction', ['Party Name', 'Item', 'Qty', 'Total']);
  assert.ok(chk.errors.some((e) => /sales amount/i.test(e)));
});

test('3c. competing identical matches are reported ambiguous instead of guessed', () => {
  const s = suggestMapping(['Date', 'Bill Date', 'Party', 'Item', 'Net Amount']);
  assert.equal(s.mapping.date, null);
  assert.equal(s.details.date.confidence, 'ambiguous');
});

test('4. multiple worksheets are listed and selectable', () => {
  const buf = xlsxBuffer({ Summary: [['x', 'y'], [1, 2]], Data: [['Shop', 'Product', 'Amount'], ['A', 'P', 5]] });
  const { wb, table } = load(buf, 'm.xlsx', 'Data');
  assert.deepEqual(wb.names, ['Summary', 'Data']);
  assert.deepEqual(table.headers, ['Shop', 'Product', 'Amount']);
});

test('5. missing optional columns still passes with warnings; 6. missing required columns is an error', () => {
  const ok = checkMapping(suggestMapping(['Customer', 'Product', 'Revenue']).mapping, 'transaction', ['Customer', 'Product', 'Revenue']);
  assert.equal(ok.errors.length, 0);
  assert.ok(ok.warnings.some((w) => /date/i.test(w)) && ok.warnings.some((w) => /area/i.test(w)));
  const bad = checkMapping(suggestMapping(['Product', 'Qty']).mapping, 'transaction', ['Product', 'Qty']);
  assert.ok(bad.errors.some((e) => /Shop/.test(e)));
  assert.ok(bad.errors.some((e) => /amount/i.test(e)));
});

test('8. empty workbook, unsupported and corrupt files give helpful errors', () => {
  assert.throws(() => readWorkbook(xlsxBuffer({ Sheet1: [[]] }), 'e.xlsx'), (e) => e instanceof ImportError && /no data/.test(e.message));
  assert.throws(() => readWorkbook(Buffer.from('hello'), 'notes.txt'), /Unsupported file type/);
  assert.throws(() => readWorkbook(Buffer.alloc(0), 'a.csv'), /empty/);
  assert.throws(() => readWorkbook(Buffer.from('PK\u0003\u0004garbage-not-a-zip'), 'bad.xlsx'), ImportError);
});

test('duplicate headers are renamed with a warning; title rows above headers are skipped', () => {
  const buf = xlsxBuffer({ S: [['ABC Traders - Sales Report'], [], ['Shop', 'Shop', 'Item', 'Net Amount'], ['A', 'B', 'P', 5]] });
  const { table } = load(buf, 's.xlsx');
  assert.deepEqual(table.headers, ['Shop', 'Shop (2)', 'Item', 'Net Amount']);
  assert.equal(table.warnings.length, 1);
  assert.equal(table.rows[0].n, 4); // row number as shown in Excel
});

test('import type detection', () => {
  assert.equal(detectImportType(suggestMapping(['Date', 'Bill No', 'Party', 'Item', 'Qty', 'Rate', 'Net Amount']).mapping), 'transaction');
  assert.equal(detectImportType(suggestMapping(['Date', 'Invoice No', 'Customer', 'Net Sales']).mapping), 'invoice');
  assert.equal(detectImportType(suggestMapping(['Shop', 'Area', 'Net Sales']).mapping), 'aggregated');
});

test('sample files exist and the template parses', () => {
  const { table } = load(templateWorkbookBuffer(), 't.xlsx');
  assert.equal(table.rows.length, 3);
  assert.ok(fs.existsSync(new URL('../../sample-data/demo-sales.xlsx', import.meta.url)));
});
