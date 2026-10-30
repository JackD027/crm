import { Router } from 'express';
import { SalesTransaction as Tx, Shop, Product, ImportBatch } from '../models/index.js';
import { ah, httpError, loadContext, computeFlags, lastPurchaseMap, filterSummaryText, getAnchors, getSettings } from '../lib/context.js';
import * as A from '../lib/analytics.js';
import { generateInsights } from '../lib/insights.js';
import { buildReport, toCsv, toXlsx, REPORT_TYPES } from '../lib/reports.js';

const router = Router();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- filter dropdown values + data availability
router.get('/meta', ah(async (req, res) => {
  const anchors = await getAnchors();
  const [shops, products, areas, cities, categories, salespersons, settings] = await Promise.all([
    Shop.find({}, 'key name').sort({ name: 1 }).lean(), Product.find({}, 'key name').sort({ name: 1 }).lean(),
    Tx.distinct('area'), Tx.distinct('city'), Tx.distinct('category'), Tx.distinct('salesperson'), getSettings(),
  ]);
  const clean = (a) => a.filter(Boolean).sort((x, y) => x.localeCompare(y));
  const cats = clean(categories);
  if (await Tx.exists({ $or: [{ category: null }, { category: '' }] })) cats.push(A.UNCAT);
  res.json({
    anchors, hasData: anchors.count > 0, businessName: settings.businessName, defaultRange: settings.defaultRange, inactiveDays: settings.inactiveDays,
    options: { shops: shops.map((s) => ({ key: s.key, name: s.name })), products: products.map((p) => ({ key: p.key, name: p.name })), areas: clean(areas), cities: clean(cities), categories: cats, salespersons: clean(salespersons) },
  });
}));

function trendWithPrev(ctx, grain) {
  const days = ctx.rg.days ?? (ctx.anchors.min && ctx.anchors.max ? A.daysBetween(A.fromISO(ctx.anchors.min), A.fromISO(ctx.anchors.max)) + 1 : null);
  const g = ['day', 'week', 'month', 'year'].includes(grain) ? grain : A.pickGrain(days);
  const cur = A.trend(ctx.cur, g);
  let prev = null;
  if (ctx.prev) prev = A.trend(A.shiftTxns(ctx.prev, ctx.rg.prev.days), g); // shifted forward so it lines up with the selected period
  const m = new Map(cur.map((x) => [x.period, { period: x.period, net: x.net, quantity: x.quantity, invoices: x.invoices, prevNet: null }]));
  if (prev) for (const p of prev) { const e = m.get(p.period) || { period: p.period, net: null, quantity: null, invoices: null }; e.prevNet = p.net; m.set(p.period, e); }
  return { grain: g, series: [...m.values()].sort((a, b) => (a.period < b.period ? -1 : 1)), hasPrevious: !!prev };
}

router.get('/dashboard/summary', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const summary = A.summarize(ctx.cur), prevSummary = ctx.prev ? A.summarize(ctx.prev) : null;
  const shops = A.shopsTable(ctx.cur, ctx.prev), areas = A.areasTable(ctx.cur, ctx.prev), products = A.productsTable(ctx.cur, ctx.prev), categories = A.categoriesTable(ctx.cur, ctx.prev);
  const topN = 8, shopTop = shops.slice(0, topN);
  const other = shops.slice(topN).reduce((s, x) => s + x.net, 0);
  res.json({
    range: ctx.range, filtersText: filterSummaryText(ctx.f), summary, prevSummary,
    deltas: prevSummary ? { netSales: A.pct(summary.netSales, prevSummary.netSales), quantity: A.pct(summary.quantity, prevSummary.quantity), invoices: summary.invoices != null && prevSummary.invoices ? A.pct(summary.invoices, prevSummary.invoices) : null, shops: A.pct(summary.shops, prevSummary.shops) } : null,
    trend: trendWithPrev(ctx, req.query.grain),
    areas: areas.slice(0, 12).map((a) => ({ label: a.label, net: a.net })),
    topShops: shops.slice(0, 10).map((s) => ({ label: s.label, net: s.net })),
    topProductsByRevenue: [...products].sort((a, b) => b.net - a.net).slice(0, 10).map((p) => ({ label: p.label, net: p.net })),
    topProductsByQty: [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 10).map((p) => ({ label: p.label, quantity: p.quantity })),
    categories: categories.map((c) => ({ label: c.label, net: c.net, share: c.share })),
    shopContribution: [...shopTop.map((s) => ({ label: s.label, net: s.net, share: s.share })), ...(other > 0 ? [{ label: 'All other shops', net: Math.round(other * 100) / 100, share: summary.netSales > 0 ? Math.round((other / summary.netSales) * 10000) / 100 : null }] : [])],
  });
}));

router.get('/analytics/sales-trend', ah(async (req, res) => { const ctx = await loadContext(req.query); res.json({ range: ctx.range, ...trendWithPrev(ctx, req.query.grain) }); }));

async function shopsPayload(req) {
  const ctx = await loadContext(req.query);
  const last = await lastPurchaseMap(ctx.f);
  const crm = new Map((await Shop.find({}).lean()).map((s) => [s.key, s]));
  let rows = A.shopsTable(ctx.cur, ctx.prev).map((s) => ({ ...s, lastDate: last.get(s.key) || s.lastDate, phone: crm.get(s.key)?.phone || '', contactPerson: crm.get(s.key)?.contactPerson || '', followUpStatus: crm.get(s.key)?.followUpStatus || 'none', salesperson: crm.get(s.key)?.salesperson || '' }));
  // directory entries for shops with no sales in this period
  const inRows = new Set(rows.map((r) => r.key));
  for (const s of crm.values()) if (!inRows.has(s.key) && !Object.keys(ctx.f).some((k) => ['shop', 'area', 'city', 'product', 'category', 'salesperson'].includes(k))) rows.push({ key: s.key, label: s.name, area: s.area, city: s.city, net: 0, invoices: 0, quantity: 0, share: 0, lastDate: last.get(s.key) || null, topCategory: null, changePct: null, prevNet: null, phone: s.phone, contactPerson: s.contactPerson, followUpStatus: s.followUpStatus, salesperson: s.salesperson, noSalesInPeriod: true });
  if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((r) => `${r.label} ${r.area || ''} ${r.city || ''}`.toLowerCase().includes(q)); }
  return { range: ctx.range, rows, comparisonAvailable: !!ctx.prev };
}
router.get('/shops', ah(async (req, res) => res.json(await shopsPayload(req))));
router.get('/analytics/shops', ah(async (req, res) => res.json(await shopsPayload(req))));

router.get('/analytics/follow-ups', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const days = req.query.days ? Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 60)) : undefined;
  res.json(await computeFlags(ctx, days));
}));

router.get('/shops/:key', ah(async (req, res) => {
  const key = req.params.key;
  const ctx = await loadContext(req.query, { forceFilters: { shop: key } });
  const shop = await Shop.findOne({ key }).lean();
  if (!shop && !ctx.cur.length) throw httpError(404, 'Shop not found.');
  const all = await Tx.find({ shopKey: key }).lean();
  const lastAll = all.filter((t) => t.saleDate && !t.isReturn).map((t) => A.toISO(t.saleDate)).sort().pop() || null;
  const totalNet = A.summarize(await Tx.find({}, 'netSales isReturn shopKey').lean()).netSales;
  const d = A.shopDetail(ctx.cur, ctx.prev);
  res.json({ range: ctx.range, shop: shop || { key, name: ctx.cur[0]?.shopName }, ...d, lastPurchase: lastAll, lifetimeNet: A.summarize(all).netSales, shareOfAllSales: totalNet > 0 ? Math.round((d.summary.netSales / totalNet) * 10000) / 100 : null,
    recent: ctx.cur.filter((t) => t.saleDate).sort((a, b) => b.saleDate - a.saleDate).slice(0, 25).map((t) => ({ date: A.toISO(t.saleDate), invoiceNo: t.invoiceNo, product: t.productName, quantity: t.quantity, net: t.netSales, isReturn: t.isReturn })) });
}));

router.get('/analytics/areas', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const rows = A.areasTable(ctx.cur, ctx.prev);
  const area = ctx.cur.filter((t) => t.area);
  res.json({ range: ctx.range, rows, byCategory: A.categoryByArea(area), months: A.monthMatrix(area, (t) => t.area, (t) => t.area, 8),
    missingArea: ctx.cur.length - area.length, businessAvgPerShop: (() => { const sh = new Set(area.filter((t) => t.shopKey && t.netSales > 0).map((t) => t.shopKey)).size; return sh ? Math.round((area.reduce((s, t) => s + t.netSales, 0) / sh) * 100) / 100 : null; })() });
}));

router.get('/analytics/areas/:name', ah(async (req, res) => {
  const ctx = await loadContext(req.query, { forceFilters: { area: req.params.name } });
  if (!ctx.cur.length) throw httpError(404, 'No sales found for this area in the selected period.');
  res.json({ range: ctx.range, area: req.params.name, summary: A.summarize(ctx.cur), prevSummary: ctx.prev ? A.summarize(ctx.prev) : null,
    shops: A.shopsTable(ctx.cur, ctx.prev).slice(0, 25), categories: A.categoriesTable(ctx.cur, ctx.prev), monthly: A.trend(ctx.cur, 'month') });
}));

router.get('/analytics/products', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const cost = new Map();
  for (const t of ctx.cur) if (t.productKey && t.costTotal != null) { const e = cost.get(t.productKey) || { net: 0, cost: 0 }; e.net += t.netSales; e.cost += t.costTotal; cost.set(t.productKey, e); }
  const rows = A.productsTable(ctx.cur, ctx.prev).map((r) => { const e = cost.get(r.key); return e ? { ...r, profit: Math.round((e.net - e.cost) * 100) / 100, margin: e.net ? Math.round(((e.net - e.cost) / e.net) * 10000) / 100 : null } : r; });
  const withProduct = ctx.cur.filter((t) => t.productKey);
  res.json({ range: ctx.range, rows, months: A.monthMatrix(withProduct, (t) => t.productKey, (t) => t.productName, 8),
    declining: ctx.prev ? rows.filter((r) => r.changePct !== null && r.changePct <= -10).sort((a, b) => a.change - b.change).slice(0, 10) : null,
    growing: ctx.prev ? rows.filter((r) => r.changePct !== null && r.changePct >= 10).sort((a, b) => b.change - a.change).slice(0, 10) : null,
    boughtTogether: A.boughtTogether(ctx.cur), uncategorized: rows.filter((r) => !r.category || r.category === A.UNCAT).length,
    hasCost: ctx.cur.some((t) => t.costTotal != null) });
}));

router.get('/analytics/products/:key', ah(async (req, res) => {
  const ctx = await loadContext(req.query, { forceFilters: { product: req.params.key } });
  res.json({ range: ctx.range, summary: A.summarize(ctx.cur), shops: A.aggregate(ctx.cur, (t) => t.shopKey, (t) => t.shopName).slice(0, 25), monthly: A.trend(ctx.cur, 'month') });
}));

router.get('/analytics/categories', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const rows = A.categoriesTable(ctx.cur, ctx.prev);
  res.json({ range: ctx.range, rows, months: A.monthMatrix(ctx.cur, A.catOf, A.catOf, 8), byArea: A.categoryByArea(ctx.cur), growing: ctx.prev ? rows.filter((r) => r.changePct !== null && r.changePct >= 10).sort((a, b) => b.changePct - a.changePct) : null });
}));

router.get('/insights', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const flags = await computeFlags(ctx);
  const out = generateInsights({ cur: ctx.cur, prev: ctx.prev, periodText: ctx.periodText, prevText: ctx.prevText, flags, settings: ctx.settings });
  res.json({ range: ctx.range, ...out, flags: { asOf: flags.asOf, thresholdDays: flags.thresholdDays, notes: flags.notes } });
}));

const SORTS = { date: 'saleDate', shop: 'shopName', product: 'productName', area: 'area', net: 'netSales', invoice: 'invoiceNo', quantity: 'quantity' };
router.get('/transactions', ah(async (req, res) => {
  const ctx = await loadContext(req.query);
  const { buildMatch } = A;
  const match = buildMatch(ctx.f, { from: ctx.rg.from, to: ctx.rg.to });
  if (req.query.q) { const rx = new RegExp(esc(String(req.query.q).slice(0, 80)), 'i'); match.$and = [{ $or: [{ shopName: rx }, { productName: rx }, { invoiceNo: rx }] }]; }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 50));
  const sortField = SORTS[req.query.sort] || 'saleDate', dir = req.query.dir === 'asc' ? 1 : -1;
  const [rows, total, agg] = await Promise.all([
    Tx.find(match).sort({ [sortField]: dir, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Tx.countDocuments(match), Tx.aggregate([{ $match: match }, { $group: { _id: null, net: { $sum: '$netSales' } } }]),
  ]);
  res.json({ range: ctx.range, page, pageSize, total, pages: Math.ceil(total / pageSize), totalNet: Math.round((agg[0]?.net || 0) * 100) / 100,
    rows: rows.map((t) => ({ id: t._id, date: t.saleDate ? A.toISO(t.saleDate) : null, invoiceNo: t.invoiceNo, shop: t.shopName, area: t.area, product: t.productName, category: A.catOf(t), quantity: t.quantity, unitPrice: t.unitPrice, discount: t.discount, net: t.netSales, isReturn: t.isReturn, sourceRow: t.sourceRow, originalShop: t.originalShopName })) });
}));

router.get('/reports/export', ah(async (req, res) => {
  const type = req.query.type, format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  if (!REPORT_TYPES[type]) throw httpError(400, `Unknown report type. Use one of: ${Object.keys(REPORT_TYPES).join(', ')}.`);
  const ctx = await loadContext(req.query);
  const input = { cur: ctx.cur, prev: ctx.prev };
  if (type === 'inactive' || type === 'insights') input.flags = await computeFlags(ctx);
  if (type === 'insights') input.insights = generateInsights({ cur: ctx.cur, prev: ctx.prev, periodText: ctx.periodText, prevText: ctx.prevText, flags: input.flags, settings: ctx.settings }).insights;
  if (type === 'errors') {
    if (!/^[a-f0-9]{24}$/.test(req.query.batchId || '')) throw httpError(400, 'batchId is required for the import errors report.');
    const b = await ImportBatch.findById(req.query.batchId).lean();
    if (!b) throw httpError(404, 'Import not found.');
    input.errors = b.issueLog || [];
  }
  const report = buildReport(type, input);
  const meta = { title: REPORT_TYPES[type], generated: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), period: type === 'errors' ? 'n/a' : ctx.periodText, filters: filterSummaryText(ctx.f) };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `${type}-report-${stamp}.${format}`;
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  if (format === 'xlsx') { res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.send(toXlsx(report, meta)); }
  else { res.type('text/csv; charset=utf-8'); res.send(toCsv(report, meta)); }
}));

export default router;
