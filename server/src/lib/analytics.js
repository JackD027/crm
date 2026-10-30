// Pure analytics over arrays of transaction objects. No database access.
export const DAY = 86400000;
export const toISO = (d) => d.toISOString().slice(0, 10);
export const fromISO = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((b - a) / DAY);
export const UNCAT = 'Uncategorized';
export const catOf = (t) => t.category || UNCAT;
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const pct = (cur, prev) => (prev > 0 ? r2(((cur - prev) / prev) * 100) : null);

export function inr(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = fromISO(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ---------- filters & periods ----------
const list = (v) => (v === undefined || v === '' ? null : String(v).split('|').filter(Boolean));

export function buildMatch(f = {}, { from, to } = {}) {
  const m = {};
  const set = (field, v) => { const l = list(v); if (l) m[field] = l.length === 1 ? l[0] : { $in: l }; };
  set('shopKey', f.shop); set('area', f.area); set('city', f.city); set('productKey', f.product); set('salesperson', f.salesperson);
  const cats = list(f.category);
  if (cats) {
    const real = cats.filter((c) => c !== UNCAT);
    const or = [];
    if (real.length) or.push({ category: { $in: real } });
    if (cats.includes(UNCAT)) or.push({ category: null }, { category: '' });
    m.$or = or;
  }
  if (from || to) { m.saleDate = {}; if (from) m.saleDate.$gte = from; if (to) m.saleDate.$lte = to; }
  return m;
}

// Ranges are anchored on the latest sale date in the data, not today, so imported history is never "empty".
export function resolveRange(f = {}, anchors = {}) {
  const min = anchors.min ? fromISO(anchors.min) : null, max = anchors.max ? fromISO(anchors.max) : null;
  let from = null, to = null, label = 'All dates', prevOverride = null;
  if (f.from || f.to) {
    from = f.from ? fromISO(f.from) : min; to = f.to ? fromISO(f.to) : max;
    label = 'Custom range';
  } else if (f.range === 'lastmonth' && max) {
    // Latest calendar month that the data covers completely, compared with the calendar month before it.
    const endsOnMonthEnd = addDays(max, 1).getUTCDate() === 1;
    const y = max.getUTCFullYear(), m = max.getUTCMonth();
    from = new Date(Date.UTC(y, endsOnMonthEnd ? m : m - 1, 1));
    to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    const pFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
    prevOverride = { from: pFrom, to: addDays(from, -1) };
    label = 'Last full month';
  } else if (f.range && f.range !== 'all' && max) {
    const n = Number(f.range);
    if (n > 0) { to = max; from = addDays(max, -(n - 1)); label = `Last ${n} days (up to latest sale)`; }
  }
  let prev = null;
  if (from && to && min && from <= to) {
    if (prevOverride) {
      if (prevOverride.from >= min) prev = { ...prevOverride, days: daysBetween(prevOverride.from, prevOverride.to) + 1 };
    } else {
      const len = daysBetween(from, to) + 1;
      const pTo = addDays(from, -1), pFrom = addDays(pTo, -(len - 1));
      if (pFrom >= min) prev = { from: pFrom, to: pTo, days: len };
    }
  }
  return { from, to, prev, label, days: from && to ? daysBetween(from, to) + 1 : null };
}

export const rangeText = (r, anchors) => {
  const a = r.from ? toISO(r.from) : anchors?.min, b = r.to ? toISO(r.to) : anchors?.max;
  return a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : 'all available dates';
};

// ---------- summary ----------
export function summarize(txns) {
  let net = 0, gross = 0, grossSeen = false, disc = 0, discSeen = false, ret = 0, qty = 0, salesBeforeReturns = 0;
  let costNet = 0, costSum = 0, costRows = 0, noDate = 0;
  const invoices = new Set(), shops = new Set();
  for (const t of txns) {
    net += t.netSales;
    if (t.quantity != null) qty += t.quantity;
    if (!t.saleDate) noDate++;
    if (t.isReturn) { ret += -t.netSales; continue; }
    salesBeforeReturns += t.netSales;
    if (t.grossAmount != null) { gross += t.grossAmount; grossSeen = true; }
    if (t.discount != null) { disc += t.discount; discSeen = true; }
    if (!t.isAggregated && t.invoiceNo) invoices.add(t.invoiceNo);
    if (t.shopKey && t.netSales > 0) shops.add(t.shopKey);
  }
  for (const t of txns) if (t.costTotal != null) { costNet += t.netSales; costSum += t.costTotal; costRows++; }
  const totalAbs = txns.reduce((s, t) => s + Math.abs(t.netSales), 0);
  const coverage = totalAbs ? txns.reduce((s, t) => s + (t.costTotal != null ? Math.abs(t.netSales) : 0), 0) / totalAbs : 0;
  const profitOk = costRows > 0 && coverage >= 0.9;
  const hasInvoices = invoices.size > 0;
  return {
    rows: txns.length, netSales: r2(net), grossSales: grossSeen ? r2(gross) : null, discounts: discSeen ? r2(disc) : null,
    returns: r2(ret), quantity: r2(qty), invoices: hasInvoices ? invoices.size : null, shops: shops.size,
    aov: hasInvoices ? r2(salesBeforeReturns / invoices.size) : null,
    profit: profitOk ? { value: r2(costNet - costSum), margin: costNet ? r2(((costNet - costSum) / costNet) * 100) : null, coverage: r2(coverage * 100) } : null,
    costCoverage: r2(coverage * 100), rowsWithoutDate: noDate,
  };
}

// ---------- generic grouping ----------
export function aggregate(txns, keyFn, labelFn = (t) => keyFn(t), track = []) {
  const m = new Map();
  let total = 0;
  for (const t of txns) {
    const k = keyFn(t);
    if (k === null || k === undefined) continue;
    let g = m.get(k);
    if (!g) { g = { key: k, label: labelFn(t), net: 0, quantity: 0, gross: 0, discount: 0, rows: 0, invoices: new Set(), shops: new Set(), events: new Set(), first: null, last: null, tr: {} }; m.set(k, g); }
    g.net += t.netSales; g.rows++;
    total += t.netSales;
    if (t.quantity != null) g.quantity += t.quantity;
    if (!t.isReturn) {
      if (t.grossAmount != null) g.gross += t.grossAmount;
      if (t.discount != null) g.discount += t.discount;
      if (!t.isAggregated && t.invoiceNo) g.invoices.add(t.invoiceNo);
      if (t.shopKey && t.netSales > 0) g.shops.add(t.shopKey);
      if (t.saleDate) g.events.add(t.invoiceNo ? 'i:' + t.invoiceNo : 'd:' + toISO(t.saleDate));
    }
    if (t.saleDate && !t.isReturn) { const iso = toISO(t.saleDate); if (!g.first || iso < g.first) g.first = iso; if (!g.last || iso > g.last) g.last = iso; }
    for (const name of track) {
      const v = name === 'category' ? catOf(t) : t[name];
      if (v === null || v === undefined || v === '') continue;
      const w = name === 'category' ? Math.max(t.netSales, 0) : 1;
      g.tr[name] ||= new Map(); g.tr[name].set(v, (g.tr[name].get(v) || 0) + w);
    }
  }
  const out = [...m.values()].map((g) => {
    const o = { key: g.key, label: g.label, net: r2(g.net), quantity: r2(g.quantity), gross: r2(g.gross), discount: r2(g.discount), rows: g.rows,
      invoices: g.invoices.size, shops: g.shops.size, purchases: g.events.size, firstDate: g.first, lastDate: g.last,
      share: total > 0 ? r2((g.net / total) * 100) : null, avgPrice: g.quantity > 0 ? r2(g.net / g.quantity) : null };
    for (const name of track) { const mm = g.tr[name]; o['top_' + name] = mm ? [...mm.entries()].sort((a, b) => b[1] - a[1])[0][0] : null; }
    return o;
  });
  out.sort((a, b) => b.net - a.net);
  return out;
}

export function withGrowth(cur, prev) {
  if (!prev) return cur.map((c) => ({ ...c, prevNet: null, changePct: null, change: null, isNew: false }));
  const pm = new Map(prev.map((p) => [p.key, p]));
  return cur.map((c) => {
    const p = pm.get(c.key);
    const pn = p ? p.net : 0;
    return { ...c, prevNet: pn, change: r2(c.net - pn), changePct: pct(c.net, pn), isNew: pn <= 0 && c.net > 0 };
  });
}

// ---------- time series ----------
export function bucketKey(d, grain) {
  const iso = toISO(d);
  if (grain === 'day') return iso;
  if (grain === 'month') return iso.slice(0, 7);
  if (grain === 'year') return iso.slice(0, 4);
  const dow = (d.getUTCDay() + 6) % 7; // Monday start
  return toISO(addDays(d, -dow));
}

export function trend(txns, grain = 'month') {
  const m = new Map();
  for (const t of txns) {
    if (!t.saleDate) continue;
    const k = bucketKey(t.saleDate, grain);
    let b = m.get(k); if (!b) { b = { period: k, net: 0, quantity: 0, invoices: new Set() }; m.set(k, b); }
    b.net += t.netSales; if (t.quantity != null) b.quantity += t.quantity;
    if (!t.isReturn && t.invoiceNo) b.invoices.add(t.invoiceNo);
  }
  return [...m.values()].sort((a, b) => (a.period < b.period ? -1 : 1)).map((b) => ({ period: b.period, net: r2(b.net), quantity: r2(b.quantity), invoices: b.invoices.size }));
}

export function shiftTxns(txns, days) { return txns.map((t) => (t.saleDate ? { ...t, saleDate: addDays(t.saleDate, days) } : t)); }

export function pickGrain(days) { return days === null ? 'month' : days <= 31 ? 'day' : days <= 120 ? 'week' : days <= 800 ? 'month' : 'year'; }

// ---------- shops / areas / products ----------
export const shopsTable = (cur, prev) => withGrowth(aggregate(cur, (t) => t.shopKey, (t) => t.shopName, ['area', 'city', 'category']), prev ? aggregate(prev, (t) => t.shopKey) : null)
  .map((s) => ({ ...s, area: s.top_area, city: s.top_city, topCategory: s.top_category }));

export function areasTable(cur, prev) {
  const rows = withGrowth(aggregate(cur, (t) => t.area, (t) => t.area, ['city']), prev ? aggregate(prev, (t) => t.area) : null);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalShops = new Set(cur.filter((t) => t.area && t.shopKey && t.netSales > 0 && !t.isReturn).map((t) => t.shopKey)).size;
  const avgPerShop = totalShops ? totalNet / totalShops : null;
  return rows.map((r) => {
    const avg = r.shops ? r2(r.net / r.shops) : null;
    const notes = [];
    if (rows.length > 1 && r.share >= 100 / rows.length * 1.5) notes.push('High revenue share');
    if (r.changePct !== null && r.changePct <= -15) notes.push('Sales declining');
    if (avg !== null && avgPerShop && avg < avgPerShop * 0.7 && r.shops >= 2) notes.push('Low sales per shop vs average');
    return { ...r, city: r.top_city, avgPerShop: avg, observations: notes };
  });
}

export const productsTable = (cur, prev) => withGrowth(aggregate(cur.filter((t) => t.productKey), (t) => t.productKey, (t) => t.productName, ['category']), prev ? aggregate(prev.filter((t) => t.productKey), (t) => t.productKey) : null).map((p) => ({ ...p, category: p.top_category }));
export const categoriesTable = (cur, prev) => withGrowth(aggregate(cur, catOf), prev ? aggregate(prev, catOf) : null);

export function monthMatrix(txns, keyFn, labelFn, topN = 8) {
  const top = aggregate(txns, keyFn, labelFn).slice(0, topN);
  const months = [...new Set(txns.filter((t) => t.saleDate).map((t) => toISO(t.saleDate).slice(0, 7)))].sort();
  const cells = new Map();
  for (const t of txns) { if (!t.saleDate) continue; const k = keyFn(t); if (k == null) continue; const mk = k + '|' + toISO(t.saleDate).slice(0, 7); cells.set(mk, (cells.get(mk) || 0) + t.netSales); }
  return { months, rows: top.map((g) => ({ key: g.key, label: g.label, values: months.map((m) => r2(cells.get(g.key + '|' + m) || 0)) })) };
}

export function categoryByArea(txns) {
  const m = new Map();
  for (const t of txns) { if (!t.area) continue; const k = t.area + '||' + catOf(t); m.set(k, (m.get(k) || 0) + t.netSales); }
  return [...m.entries()].map(([k, v]) => { const [area, category] = k.split('||'); return { area, category, net: r2(v) }; });
}

export function boughtTogether(txns, top = 10) {
  const inv = new Map();
  for (const t of txns) { if (t.isReturn || t.isAggregated || !t.invoiceNo || !t.productKey) continue; (inv.get(t.invoiceNo) || inv.set(t.invoiceNo, new Map()).get(t.invoiceNo)).set(t.productKey, t.productName); }
  const pairs = new Map();
  for (const prods of inv.values()) {
    const ks = [...prods.keys()].sort();
    if (ks.length > 12) continue;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const k = ks[i] + '||' + ks[j]; const e = pairs.get(k) || { a: prods.get(ks[i]), b: prods.get(ks[j]), count: 0 }; e.count++; pairs.set(k, e);
    }
  }
  return [...pairs.values()].filter((p) => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, top);
}

// ---------- follow-up flags ----------
export function followUpFlags(txns, { inactiveDays = 60, declinePct = 25, asOf, minDate }) {
  const T = inactiveDays;
  const notes = [];
  const span = asOf && minDate ? daysBetween(fromISO(minDate), fromISO(asOf)) : 0;
  const okInactive = span >= T, okDecline = span >= 2 * T;
  if (!okInactive) notes.push(`Data covers only ${span} days, which is less than the ${T}-day threshold, so inactivity cannot be established.`);
  else if (!okDecline) notes.push(`Data covers ${span} days, less than two ${T}-day windows, so decline and frequency comparisons are not shown.`);
  const out = { asOf, thresholdDays: T, dataSpanDays: span, notes, inactive: [], oneAndDone: [], declining: [], lowFrequency: [] };
  if (!asOf || !okInactive) return out;
  const end = fromISO(asOf), curFrom = addDays(end, -(T - 1)), prevTo = addDays(curFrom, -1), prevFrom = addDays(prevTo, -(T - 1));
  const by = new Map();
  for (const t of txns) {
    if (t.isReturn || !t.saleDate || !t.shopKey) continue;
    let s = by.get(t.shopKey);
    if (!s) { s = { shopKey: t.shopKey, shopName: t.shopName, area: t.area, dates: new Set(), life: 0, cur: 0, prev: 0, curEv: new Set(), prevEv: new Set() }; by.set(t.shopKey, s); }
    const d = t.saleDate, ev = t.invoiceNo ? 'i:' + t.invoiceNo : 'd:' + toISO(d);
    s.dates.add(toISO(d)); s.life += t.netSales;
    if (d >= curFrom && d <= end) { s.cur += t.netSales; s.curEv.add(ev); }
    else if (d >= prevFrom && d <= prevTo) { s.prev += t.netSales; s.prevEv.add(ev); }
  }
  for (const s of by.values()) {
    const last = [...s.dates].sort().pop();
    const days = daysBetween(fromISO(last), end);
    const base = { shopKey: s.shopKey, shopName: s.shopName, area: s.area, lastPurchase: last, daysSince: days, lifetimeNet: r2(s.life), recentNet: r2(s.cur), priorNet: r2(s.prev) };
    if (days >= T) {
      if (s.dates.size === 1) out.oneAndDone.push({ ...base, reason: `Only one purchase on record (${fmtDate(last)}), none since.` });
      else out.inactive.push({ ...base, reason: `No purchase for ${days} days (last: ${fmtDate(last)}).` });
    } else if (okDecline) {
      const ch = pct(s.cur, s.prev);
      if (s.prev > 0 && ch !== null && ch <= -declinePct) out.declining.push({ ...base, changePct: ch, reason: `Sales ${ch}% lower than the previous ${T} days.` });
      if (s.prevEv.size >= 3 && s.curEv.size <= s.prevEv.size * 0.5) out.lowFrequency.push({ ...base, recentPurchases: s.curEv.size, priorPurchases: s.prevEv.size, reason: `${s.curEv.size} purchases in the last ${T} days vs ${s.prevEv.size} in the ${T} days before.` });
    }
  }
  out.inactive.sort((a, b) => b.lifetimeNet - a.lifetimeNet);
  out.oneAndDone.sort((a, b) => b.lifetimeNet - a.lifetimeNet);
  out.declining.sort((a, b) => a.changePct - b.changePct);
  return out;
}

// ---------- shop detail ----------
export function shopDetail(cur, prev) {
  const s = summarize(cur);
  const dates = [...new Set(cur.filter((t) => t.saleDate && !t.isReturn).map((t) => toISO(t.saleDate)))].sort();
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(fromISO(dates[i - 1]), fromISO(dates[i])));
  return {
    summary: s, prevSummary: prev ? summarize(prev) : null,
    monthly: trend(cur, 'month'),
    products: aggregate(cur.filter((t) => t.productKey), (t) => t.productKey, (t) => t.productName),
    categories: aggregate(cur, catOf),
    frequency: { purchaseDays: dates.length, firstPurchase: dates[0] || null, lastPurchase: dates[dates.length - 1] || null, avgDaysBetween: gaps.length ? r2(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null },
  };
}
