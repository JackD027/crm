import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { SalesTransaction as Tx, Shop, Product, ImportBatch, ImportProfile } from '../models/index.js';
import { ah, httpError, requireDb, dbReady, getSettings, aliasMapsFrom } from '../lib/context.js';
import { readWorkbook, detectHeaderRow, buildTable } from '../lib/parse.js';
import { FIELDS, IMPORT_TYPES, suggestMapping, detectImportType, checkMapping, norm } from '../lib/columns.js';
import { processRows, DEFAULT_OPTIONS } from '../lib/importer.js';
import { putFile, getFile } from '../lib/importCache.js';
import { demoWorkbookBuffer, demoCsvBuffer, templateWorkbookBuffer } from '../lib/demoData.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const blank = (r) => r.every((v) => v === null || v === '');
const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const sendCsv = (res, name, rows) => { res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.type('text/csv; charset=utf-8').send('\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')); };

// ---------- helpers
function tableFor(entry, sheetName, headerRow) {
  const sheet = entry.wb.sheets[sheetName];
  if (!sheet) throw httpError(400, `Worksheet "${sheetName}" was not found in this file.`);
  let idx = detectHeaderRow(sheet.aoa);
  if (headerRow) { const i = Number(headerRow) - 1 - sheet.rowOffset; if (Number.isInteger(i) && i >= 0 && i < sheet.aoa.length) idx = i; }
  return buildTable(sheet, idx);
}
const signatureOf = (headers) => headers.map(norm).filter(Boolean).sort().join('|');

async function payload(token, entry, sheetName, headerRow) {
  const table = tableFor(entry, sheetName, headerRow);
  const sug = suggestMapping(table.headers);
  let mapping = sug.mapping, details = sug.details, importType = detectImportType(mapping), savedProfile = null, options = {};
  if (dbReady()) {
    const p = await ImportProfile.findOne({ signature: signatureOf(table.headers) }).lean().catch(() => null);
    if (p) {
      const m = {}; for (const f of FIELDS) m[f.key] = p.mapping?.[f.key] && table.headers.includes(p.mapping[f.key]) ? p.mapping[f.key] : null;
      mapping = m; importType = p.importType || importType; options = p.options || {};
      details = Object.fromEntries(FIELDS.map((f) => [f.key, m[f.key] ? { confidence: 'saved' } : null]));
      savedProfile = { name: p.name, note: 'Mapping loaded from a saved profile for this file layout. Please verify it.' };
    }
  }
  const samples = {};
  table.headers.forEach((h, i) => { const s = []; for (const r of table.rows) { const v = r.v[i]; if (v !== null && v !== '' && !s.includes(String(v))) s.push(String(v)); if (s.length >= 3) break; } samples[h] = s; });
  const settings = dbReady() ? await getSettings().catch(() => null) : null;
  return {
    token, fileName: entry.fileName, fileSize: entry.fileSize,
    sheets: entry.wb.names.map((n) => ({ name: n, rows: entry.wb.sheets[n].aoa.filter((r) => !blank(r)).length })),
    sheet: sheetName, headerRow: table.headerRowNumber, headers: table.headers, sampleValues: samples,
    previewRows: table.rows.slice(0, 20), totalRows: table.rows.length, warnings: table.warnings,
    suggestion: { mapping, details, ambiguousColumns: sug.ambiguousColumns, hints: sug.hints, importType }, savedProfile,
    fields: FIELDS.map((f) => ({ key: f.key, label: f.label })), importTypes: IMPORT_TYPES,
    defaults: { ...DEFAULT_OPTIONS, ...(settings?.importDefaults || {}), ...(sug.hints.discountPercent ? { discountType: 'percent' } : {}), ...options },
  };
}

async function findExistingKeys(keys) {
  const out = new Set();
  for (let i = 0; i < keys.length; i += 5000) {
    const docs = await Tx.find({ sourceKey: { $in: keys.slice(i, i + 5000) } }, 'sourceKey').lean();
    for (const d of docs) out.add(d.sourceKey);
  }
  return out;
}

async function loadCanon() {
  const [area, city, category, salesperson, shops, products] = await Promise.all([Tx.distinct('area'), Tx.distinct('city'), Tx.distinct('category'), Tx.distinct('salesperson'), Shop.find({}, 'key name').lean(), Product.find({}, 'key name category').lean()]);
  const f = (a) => a.filter(Boolean);
  return { area: f(area), city: f(city), category: f(category), salesperson: f(salesperson),
    shops: Object.fromEntries(shops.map((s) => [s.key, s.name])), products: Object.fromEntries(products.map((p) => [p.key, p.name])),
    productCategories: Object.fromEntries(products.filter((p) => p.category).map((p) => [p.key, p.category])) };
}

function cleanBody(body) {
  const importType = body.importType;
  if (!IMPORT_TYPES[importType]) throw httpError(400, 'Choose an import type.');
  const mapping = {};
  for (const f of FIELDS) { const v = body.mapping?.[f.key]; mapping[f.key] = typeof v === 'string' && v ? v : null; }
  const o = body.options || {}, options = {};
  const pick = (k, allowed) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') { if (!allowed.includes(o[k])) throw httpError(400, `Invalid option "${k}".`); options[k] = o[k]; } };
  pick('dateOrder', ['DMY', 'MDY']); pick('invalidDates', ['reject', 'import_without_date']); pick('negativeHandling', ['returns', 'reject']);
  pick('discountType', ['amount', 'percent']); pick('repeatedTotals', ['calculate', 'first_row', 'keep']); pick('duplicateStrategy', ['skip', 'keep']);
  return { importType, mapping, options };
}

async function runPipeline(entry, body, { checkDb = true, ignoreExisting = false } = {}) {
  const { importType, mapping, options } = cleanBody(body);
  const table = tableFor(entry, body.sheet, body.headerRow);
  const chk = checkMapping(mapping, importType, table.headers);
  if (chk.errors.length) { const e = httpError(422, 'The column mapping is incomplete.'); e.details = chk; throw e; }
  if (options.repeatedTotals === 'calculate' && !(mapping.quantity && mapping.unitPrice)) throw httpError(422, 'To calculate line amounts, both Quantity and Unit price must be mapped.');
  let canon = {}, aliases = {}, dbChecked = false;
  if (checkDb && dbReady()) { canon = await loadCanon(); aliases = aliasMapsFrom(await getSettings()); }
  let r = processRows({ table, mapping, importType, options, aliases, canon });
  if (checkDb && dbReady() && !ignoreExisting && r.records.length) {
    const existing = await findExistingKeys(r.records.map((x) => x.sourceKey));
    dbChecked = true;
    if (existing.size) r = processRows({ table, mapping, importType, options, aliases, canon, existingKeys: existing });
  }
  return { r, table, chk, dbChecked, importType, mapping, options };
}

// ---------- downloads (no database needed)
router.get('/template.xlsx', (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="sales-template.xlsx"'); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(templateWorkbookBuffer()); });
router.get('/demo.xlsx', (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="demo-sales.xlsx"'); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(demoWorkbookBuffer()); });
router.get('/demo.csv', (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="demo-sales.csv"'); res.type('text/csv; charset=utf-8').send(demoCsvBuffer()); });

// ---------- wizard steps 1-2: upload + preview (no database needed)
router.post('/preview', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw httpError(400, 'No file received. Choose an .xlsx, .xls or .csv file.');
  const wb = readWorkbook(req.file.buffer, req.file.originalname);
  const token = putFile({ fileName: req.file.originalname, fileSize: req.file.size, wb });
  const entry = getFile(token);
  const first = wb.names.find((n) => wb.sheets[n].aoa.some((r) => !blank(r))) || wb.names[0];
  res.json(await payload(token, entry, first));
}));
router.post('/demo-preview', ah(async (req, res) => {
  const wb = readWorkbook(demoWorkbookBuffer(), 'demo-sales.xlsx');
  const token = putFile({ fileName: 'demo-sales.xlsx', fileSize: demoWorkbookBuffer().length, wb });
  res.json(await payload(token, getFile(token), 'Sales'));
}));
router.post('/preview/sheet', ah(async (req, res) => {
  const entry = getFile(req.body.token);
  if (!entry) throw httpError(410, 'This upload has expired. Please select the file again.');
  res.json(await payload(req.body.token, entry, req.body.sheet, req.body.headerRow));
}));

// ---------- wizard step 4: validation + calculation review
router.post('/validate', ah(async (req, res) => {
  const entry = getFile(req.body.token);
  if (!entry) throw httpError(410, 'This upload has expired. Please select the file again.');
  const { r, chk, dbChecked, options } = await runPipeline(entry, req.body);
  entry.lastValidation = { issues: r.issues, rejectedRows: r.rejectedRows, headers: tableFor(entry, req.body.sheet, req.body.headerRow).headers };
  const order = { error: 0, warning: 1, info: 2 };
  const issues = [...r.issues].sort((a, b) => order[a.level] - order[b.level] || a.row - b.row);
  const byCode = {}; for (const i of r.issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
  res.json({ stats: r.stats, calcPreview: r.calcPreview, rules: r.rules, needsDecision: r.needsDecision, mappingWarnings: chk.warnings, dbChecked,
    issues: issues.slice(0, 300), issueCount: issues.length, issueCodes: byCode, rejectedRows: r.rejectedRows.slice(0, 100), rejectedCount: r.rejectedRows.length, effectiveOptions: { ...DEFAULT_OPTIONS, ...options } });
}));

router.get('/errors/:token', ah(async (req, res) => {
  const entry = getFile(req.params.token);
  if (!entry?.lastValidation) throw httpError(404, 'Nothing to download: run validation first (the upload may have expired).');
  const v = entry.lastValidation;
  if (req.query.kind === 'rejected') sendCsv(res, 'rejected-rows.csv', [['Source row', 'Reason(s)', ...v.headers], ...v.rejectedRows.map((x) => [x.row, x.reasons, ...x.values])]);
  else sendCsv(res, 'validation-report.csv', [['Source row', 'Level', 'Code', 'Field', 'Message'], ...v.issues.map((i) => [i.row, i.level, i.code, i.field, i.message])]);
}));

// ---------- wizard step 8-9: commit
router.post('/commit', requireDb, ah(async (req, res) => {
  const entry = getFile(req.body.token);
  if (!entry) throw httpError(410, 'This upload has expired. Please select the file again.');
  if (entry.committedBatchId) return res.json({ alreadyImported: true, batchId: entry.committedBatchId, message: 'This file was already imported in this session.' });
  if (entry.committing) throw httpError(409, 'An import of this file is already in progress.');
  const mode = req.body.mode === 'replace' ? 'replace' : 'append';
  if (mode === 'replace' && req.body.confirmReplace !== true) throw httpError(400, 'Replacing existing data needs explicit confirmation.');
  entry.committing = true;
  let batch;
  try {
    const { r, importType, mapping, options } = await runPipeline(entry, req.body, { ignoreExisting: mode === 'replace' });
    if (r.needsDecision) throw httpError(409, 'Some invoices repeat the same total on several product lines. Choose how to handle them before importing.');
    if (!r.records.length) throw httpError(422, 'There are no importable rows. Fix the mapping or the file and validate again.');
    const settings = await getSettings();
    batch = await ImportBatch.create({
      fileName: entry.fileName, fileSize: entry.fileSize, sheet: req.body.sheet, importType, mapping, options: { ...DEFAULT_OPTIONS, ...options }, mode,
      sourceRows: r.stats.totalRows, importedCount: 0, skippedCount: r.stats.skippedDuplicates, errorCount: r.stats.rejected, duplicateCount: r.stats.counts.existingDuplicates,
      warningCount: r.stats.warnings, totalNetSales: r.stats.totals.net, dateMin: r.stats.dateRange.min, dateMax: r.stats.dateRange.max, status: 'importing', rules: r.rules,
      issueLog: r.issues.filter((i) => i.level !== 'info').slice(0, 1000), profileName: req.body.profileName || undefined,
    });
    try {
      let n = 0;
      for (let i = 0; i < r.records.length; i += 1000) {
        const chunk = r.records.slice(i, i + 1000).map((x) => ({ ...x, importBatchId: batch._id }));
        await Tx.insertMany(chunk, { ordered: true }); n += chunk.length;
      }
      const shopOps = new Map(), prodOps = new Map();
      for (const x of r.records) {
        if (x.shopKey && !shopOps.has(x.shopKey)) shopOps.set(x.shopKey, { updateOne: { filter: { key: x.shopKey }, update: { $setOnInsert: { key: x.shopKey, name: x.shopName, area: x.area, city: x.city, salesperson: x.salesperson, contactPerson: '', phone: '', address: '', notes: '', followUpStatus: 'none', reminders: [], createdByBatch: batch._id } }, upsert: true } });
        if (x.productKey && !prodOps.has(x.productKey)) prodOps.set(x.productKey, { updateOne: { filter: { key: x.productKey }, update: { $setOnInsert: { key: x.productKey, name: x.productName, productId: x.productId, category: x.category, createdByBatch: batch._id } }, upsert: true } });
      }
      if (shopOps.size) await Shop.bulkWrite([...shopOps.values()], { ordered: false });
      if (prodOps.size) await Product.bulkWrite([...prodOps.values()], { ordered: false });
      if (mode === 'replace') {
        const olds = await ImportBatch.find({ status: 'completed', _id: { $ne: batch._id } }, '_id').lean();
        const ids = olds.map((o) => o._id);
        await Tx.deleteMany({ importBatchId: { $in: ids } });
        await ImportBatch.updateMany({ _id: { $in: ids } }, { $set: { status: 'replaced' } });
        await cleanupOrphans(ids);
      }
      batch.importedCount = n; batch.status = 'completed'; await batch.save();
    } catch (e) {
      // roll back this batch only; unrelated records are never touched
      await Tx.deleteMany({ importBatchId: batch._id }).catch(() => {});
      await cleanupOrphans([batch._id]).catch(() => {});
      batch.status = 'failed'; batch.failureReason = e.message; batch.importedCount = 0; await batch.save().catch(() => {});
      throw httpError(500, 'The import failed part-way and was rolled back; nothing from this file was kept. (' + e.message + ')');
    }
    if (req.body.saveProfile) {
      const table = tableFor(entry, req.body.sheet, req.body.headerRow);
      await ImportProfile.findOneAndUpdate({ signature: signatureOf(table.headers) }, { name: String(req.body.saveProfile).slice(0, 80), signature: signatureOf(table.headers), headers: table.headers, mapping, importType, sheet: req.body.sheet, options: { dateOrder: options.dateOrder, discountType: options.discountType, negativeHandling: options.negativeHandling }, lastUsedAt: new Date() }, { upsert: true, new: true });
    }
    entry.committedBatchId = String(batch._id);
    res.json({ batchId: batch._id, imported: batch.importedCount, skipped: batch.skippedCount, rejected: batch.errorCount, totalNetSales: batch.totalNetSales, mode });
  } finally { entry.committing = false; }
}));

async function cleanupOrphans(batchIds) {
  const [usedShops, usedProducts] = await Promise.all([Tx.distinct('shopKey'), Tx.distinct('productKey')]);
  await Shop.deleteMany({ key: { $nin: usedShops }, createdByBatch: { $in: batchIds }, notes: '', phone: '', contactPerson: '', address: '', reminders: { $size: 0 } });
  await Product.deleteMany({ key: { $nin: usedProducts }, createdByBatch: { $in: batchIds } });
}

// ---------- history, detail, undo
router.get('/profiles', requireDb, ah(async (req, res) => res.json(await ImportProfile.find({}, 'name headers importType lastUsedAt').sort({ updatedAt: -1 }).lean())));
router.delete('/profiles/:id', requireDb, ah(async (req, res) => { await ImportProfile.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));

router.get('/', requireDb, ah(async (req, res) => res.json(await ImportBatch.find({}, '-issueLog -rules -mapping').sort({ createdAt: -1 }).limit(200).lean())));

router.get('/:id', requireDb, ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid import id.');
  const b = await ImportBatch.findById(req.params.id).lean();
  if (!b) throw httpError(404, 'Import not found.');
  const live = b.status === 'completed' ? await Tx.countDocuments({ importBatchId: b._id }) : 0;
  res.json({ ...b, liveRecordCount: live });
}));

router.post('/:id/undo', requireDb, ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid import id.');
  const b = await ImportBatch.findById(req.params.id);
  if (!b) throw httpError(404, 'Import not found.');
  if (b.status !== 'completed') throw httpError(409, `This import cannot be undone because its status is "${b.status}".`);
  if (req.body.confirm !== true) throw httpError(400, 'Undo needs explicit confirmation.');
  const del = await Tx.deleteMany({ importBatchId: b._id });
  b.status = 'undone'; await b.save();
  await cleanupOrphans([b._id]);
  res.json({ ok: true, removedRecords: del.deletedCount });
}));

export default router;
