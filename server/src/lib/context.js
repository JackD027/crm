// Shared request helpers: filter parsing, settings, anchors, loading the filtered transactions.
import mongoose from 'mongoose';
import { SalesTransaction as Tx, BusinessSettings } from '../models/index.js';
import { buildMatch, resolveRange, rangeText, toISO, fmtDate, followUpFlags } from './analytics.js';
import { ImportError } from './parse.js';

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const httpError = (status, message) => new ImportError(message, status);
export const dbReady = () => mongoose.connection.readyState === 1;
export const requireDb = (req, res, next) => (dbReady() ? next() : res.status(503).json({ error: 'The database is not connected. Start MongoDB and check MONGODB_URI in server/.env.' }));

const RANGES = ['all', '30', '60', '90', '180', '365', 'lastmonth'];
const FILTER_KEYS = ['shop', 'area', 'city', 'product', 'category', 'salesperson'];

export function pickFilters(q = {}) {
  const f = {};
  for (const k of FILTER_KEYS) if (typeof q[k] === 'string' && q[k] !== '') f[k] = q[k];
  for (const k of ['from', 'to']) {
    if (q[k]) { if (!/^\d{4}-\d{2}-\d{2}$/.test(q[k])) throw httpError(400, `"${k}" must be a date like 2026-04-30.`); f[k] = q[k]; }
  }
  if (q.range) f.range = RANGES.includes(q.range) ? q.range : 'all';
  return f;
}

export async function getSettings() {
  let s = await BusinessSettings.findOne({ key: 'default' }).lean();
  if (!s) s = (await BusinessSettings.create({ key: 'default' })).toObject();
  return s;
}

export async function getAnchors() {
  const [a] = await Tx.aggregate([{ $group: { _id: null, min: { $min: '$saleDate' }, max: { $max: '$saleDate' }, count: { $sum: 1 } } }]);
  return { min: a?.min ? toISO(a.min) : null, max: a?.max ? toISO(a.max) : null, count: a?.count || 0 };
}

export function filterSummaryText(f) {
  const parts = [];
  for (const k of FILTER_KEYS) if (f[k]) parts.push(`${k} = ${f[k].split('|').map((x) => x.replace(/^[a-z]+:/, '')).join(', ')}`);
  return parts.length ? parts.join('; ') : 'none';
}

// Loads current and previous-period transactions for the request filters.
export async function loadContext(query, { forceFilters = {} } = {}) {
  const settings = await getSettings();
  const anchors = await getAnchors();
  const f = { ...pickFilters(query), ...forceFilters };
  if (!f.range && !f.from && !f.to) f.range = settings.defaultRange || 'all';
  const rg = resolveRange(f, anchors);
  const cur = await Tx.find(buildMatch(f, { from: rg.from, to: rg.to })).lean();
  const prev = rg.prev ? await Tx.find(buildMatch(f, { from: rg.prev.from, to: rg.prev.to })).lean() : null;
  const periodText = rangeText(rg, anchors);
  const prevText = rg.prev ? `${fmtDate(toISO(rg.prev.from))} – ${fmtDate(toISO(rg.prev.to))}` : null;
  const range = {
    label: rg.label, text: periodText, from: rg.from ? toISO(rg.from) : anchors.min, to: rg.to ? toISO(rg.to) : anchors.max,
    comparisonAvailable: !!rg.prev, comparisonText: prevText,
    comparisonNote: rg.prev ? null : (rg.from ? 'No comparison: the earlier period of equal length is not fully covered by your data.' : 'Choose a date range to compare with the previous period.'),
  };
  return { settings, anchors, f, rg, cur, prev, periodText, prevText, range };
}

// Follow-up flags ignore the date filter (they are measured against the latest sale date).
export async function computeFlags(ctx, days) {
  const f = { ...ctx.f }; delete f.from; delete f.to; delete f.range;
  const txns = await Tx.find(buildMatch(f)).lean();
  return followUpFlags(txns, { inactiveDays: days || ctx.settings.inactiveDays || 60, declinePct: ctx.settings.declinePct || 25, asOf: ctx.anchors.max, minDate: ctx.anchors.min });
}

export async function lastPurchaseMap(f) {
  const g = { ...f }; delete g.from; delete g.to; delete g.range;
  const rows = await Tx.aggregate([{ $match: { ...buildMatch(g), isReturn: false, saleDate: { $ne: null } } }, { $group: { _id: '$shopKey', last: { $max: '$saleDate' } } }]);
  return new Map(rows.map((r) => [r._id, toISO(r.last)]));
}

export const aliasMapsFrom = (settings) => {
  const out = { shops: {}, products: {} };
  for (const a of settings.aliases || []) out[a.type === 'shop' ? 'shops' : 'products'][a.fromKey] = { key: a.toKey, name: a.toName };
  return out;
};
