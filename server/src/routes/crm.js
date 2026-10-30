import { Router } from 'express';
import mongoose from 'mongoose';
import { SalesTransaction as Tx, Shop, Product, BusinessSettings } from '../models/index.js';
import { ah, httpError, getSettings } from '../lib/context.js';
import { UNCAT } from '../lib/analytics.js';

const router = Router();
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- shop CRM fields
async function shopDoc(key) {
  const s = await Shop.findOne({ key });
  if (s) return s;
  const t = await Tx.findOne({ shopKey: key }).lean();
  if (!t) throw httpError(404, 'Shop not found.');
  return Shop.create({ key, name: t.shopName, area: t.area, city: t.city });
}
router.put('/shops/:key', ah(async (req, res) => {
  const b = req.body || {};
  const status = b.followUpStatus;
  if (status !== undefined && !['none', 'to_contact', 'contacted', 'done'].includes(status)) throw httpError(400, 'Invalid follow-up status.');
  if (b.phone !== undefined && !/^[0-9+()\-\s]{0,20}$/.test(String(b.phone))) throw httpError(400, 'Phone number may only contain digits, spaces, + ( ) and -.');
  const s = await shopDoc(req.params.key);
  Object.assign(s, clean({ contactPerson: str(b.contactPerson, 100), phone: str(b.phone, 20), address: str(b.address, 300), notes: str(b.notes, 4000), salesperson: str(b.salesperson, 100), followUpStatus: status }));
  await s.save();
  res.json(s);
}));
router.post('/shops/:key/reminders', ah(async (req, res) => {
  const text = str(req.body?.text, 300);
  if (!text) throw httpError(400, 'Reminder text is required.');
  const due = req.body.dueDate ? new Date(req.body.dueDate) : null;
  if (due && isNaN(due)) throw httpError(400, 'Invalid due date.');
  const s = await shopDoc(req.params.key);
  s.reminders.push({ text, dueDate: due });
  await s.save();
  res.json(s);
}));
router.patch('/shops/:key/reminders/:rid', ah(async (req, res) => {
  const s = await shopDoc(req.params.key);
  const r = s.reminders.id(req.params.rid);
  if (!r) throw httpError(404, 'Reminder not found.');
  r.done = !!req.body.done; await s.save(); res.json(s);
}));
router.delete('/shops/:key/reminders/:rid', ah(async (req, res) => {
  const s = await shopDoc(req.params.key);
  s.reminders.pull({ _id: req.params.rid }); await s.save(); res.json(s);
}));
router.get('/followups', ah(async (req, res) => {
  const shops = await Shop.find({ 'reminders.0': { $exists: true } }, 'key name area reminders').lean();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const out = [];
  for (const s of shops) for (const r of s.reminders) if (!r.done) out.push({ id: r._id, shopKey: s.key, shopName: s.name, area: s.area, text: r.text, dueDate: r.dueDate, overdue: !!r.dueDate && r.dueDate < now });
  out.sort((a, b) => (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity));
  res.json(out);
}));

// ---------- categories & product assignment
router.get('/categories', ah(async (req, res) => {
  const used = (await Tx.distinct('category')).filter(Boolean);
  const s = await getSettings();
  res.json([...new Set([...(s.categories || []), ...used])].sort((a, b) => a.localeCompare(b)));
}));
router.put('/products/:key/category', ah(async (req, res) => {
  const category = str(req.body?.category, 80);
  if (!category || category === UNCAT) throw httpError(400, 'Enter a category name.');
  const key = req.params.key;
  const overwrite = req.body.overwrite === true;
  const p = await Product.findOne({ key });
  if (!p) throw httpError(404, 'Product not found.');
  p.category = category; await p.save(); // used for future imports of this product
  const filter = overwrite ? { productKey: key } : { productKey: key, $or: [{ category: null }, { category: '' }] };
  const r = await Tx.updateMany(filter, { $set: { category } });
  await BusinessSettings.updateOne({ key: 'default' }, { $addToSet: { categories: category } });
  res.json({ ok: true, updated: r.modifiedCount });
}));
router.post('/categories/rename', ah(async (req, res) => {
  const from = str(req.body?.from, 80), to = str(req.body?.to, 80);
  if (!from || !to || to === UNCAT) throw httpError(400, 'Both the current and new category names are required.');
  const r = await Tx.updateMany({ category: from }, { $set: { category: to } });
  await Product.updateMany({ category: from }, { $set: { category: to } });
  const s = await getSettings();
  const cats = [...new Set((s.categories || []).map((c) => (c === from ? to : c)).concat(to))];
  await BusinessSettings.updateOne({ key: 'default' }, { $set: { categories: cats } });
  res.json({ ok: true, updated: r.modifiedCount });
}));
router.post('/categories', ah(async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name || name === UNCAT) throw httpError(400, 'Enter a category name.');
  await BusinessSettings.updateOne({ key: 'default' }, { $addToSet: { categories: name } }, { upsert: true });
  res.json({ ok: true });
}));

// ---------- aliases (manual, confirmed merges only)
router.get('/aliases', ah(async (req, res) => {
  const s = await getSettings();
  const suggest = async (Model, type) => {
    const docs = await Model.find({}, 'key name').lean();
    const g = new Map();
    for (const d of docs) { const k = norm(d.name); if (k) (g.get(k) || g.set(k, []).get(k)).push({ key: d.key, name: d.name }); }
    return [...g.values()].filter((x) => x.length > 1).map((items) => ({ type, items }));
  };
  res.json({ aliases: s.aliases || [], suggestions: [...(await suggest(Shop, 'shop')), ...(await suggest(Product, 'product'))] });
}));
router.post('/aliases', ah(async (req, res) => {
  const { type, fromKey, toKey } = req.body || {};
  if (!['shop', 'product'].includes(type) || !fromKey || !toKey || fromKey === toKey) throw httpError(400, 'Choose two different records of the same type.');
  const Model = type === 'shop' ? Shop : Product;
  const [from, to] = await Promise.all([Model.findOne({ key: fromKey }), Model.findOne({ key: toKey })]);
  if (!from || !to) throw httpError(404, 'One of the records was not found.');
  const field = type === 'shop' ? 'shopKey' : 'productKey', nameField = type === 'shop' ? 'shopName' : 'productName';
  await Tx.updateMany({ [field]: fromKey }, { $set: { [field]: toKey, [nameField]: to.name } });
  const s = await getSettings();
  const aliases = (s.aliases || []).map((a) => (a.type === type && a.toKey === fromKey ? { ...a, toKey, toName: to.name } : a));
  aliases.push({ type, fromKey, fromName: from.name, toKey, toName: to.name });
  // Files without an ID column identify the same record by name, so the old name must resolve to the merged record too.
  const nameKey = 'n:' + from.name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (nameKey !== fromKey && nameKey !== toKey && !aliases.some((a) => a.type === type && a.fromKey === nameKey)) aliases.push({ type, fromKey: nameKey, fromName: from.name, toKey, toName: to.name });
  await BusinessSettings.updateOne({ key: 'default' }, { $set: { aliases } });
  if (type === 'shop') { // keep the target's CRM data, carrying over anything it lacks
    for (const f of ['contactPerson', 'phone', 'address', 'notes']) if (!to[f] && from[f]) to[f] = from[f];
    to.reminders.push(...from.reminders.map((r) => ({ text: r.text, dueDate: r.dueDate, done: r.done })));
    await to.save();
  } else if (!to.category && from.category) { to.category = from.category; await to.save(); }
  await Model.deleteOne({ key: fromKey });
  res.json({ ok: true });
}));
router.delete('/aliases/:id', ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid id.');
  await BusinessSettings.updateOne({ key: 'default' }, { $pull: { aliases: { _id: req.params.id } } });
  res.json({ ok: true, note: 'The rule was removed for future imports. Records already merged stay merged.' });
}));

// ---------- settings
router.get('/settings', ah(async (req, res) => res.json(await getSettings())));
router.put('/settings', ah(async (req, res) => {
  const b = req.body || {}, set = {};
  if (b.businessName !== undefined) { const v = str(b.businessName, 80); if (!v) throw httpError(400, 'Business name cannot be empty.'); set.businessName = v; }
  if (b.defaultRange !== undefined) { if (!['all', '30', '60', '90', '180', '365', 'lastmonth'].includes(b.defaultRange)) throw httpError(400, 'Invalid default date range.'); set.defaultRange = b.defaultRange; }
  if (b.inactiveDays !== undefined) { const n = Number(b.inactiveDays); if (!Number.isInteger(n) || n < 7 || n > 365) throw httpError(400, 'Inactivity threshold must be a whole number between 7 and 365 days.'); set.inactiveDays = n; }
  if (b.declinePct !== undefined) { const n = Number(b.declinePct); if (!(n >= 5 && n <= 90)) throw httpError(400, 'Decline threshold must be between 5 and 90 percent.'); set.declinePct = n; }
  const d = b.importDefaults || {};
  const opt = (k, allowed) => { if (d[k] !== undefined) { if (!allowed.includes(d[k])) throw httpError(400, `Invalid import default "${k}".`); set[`importDefaults.${k}`] = d[k]; } };
  opt('dateOrder', ['DMY', 'MDY']); opt('negativeHandling', ['returns', 'reject']); opt('discountType', ['amount', 'percent']); opt('invalidDates', ['reject', 'import_without_date']); opt('duplicateStrategy', ['skip', 'keep']);
  await BusinessSettings.updateOne({ key: 'default' }, { $set: set }, { upsert: true });
  res.json(await getSettings());
}));

export default router;
