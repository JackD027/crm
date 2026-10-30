// Row validation + sales calculation. Pure functions: no database access.
import { FIELDS } from './columns.js';

export const DEFAULT_OPTIONS = {
  dateOrder: 'DMY',                 // how to read 05/03/2026: DMY (India) or MDY
  invalidDates: 'reject',           // 'reject' | 'import_without_date'
  negativeHandling: 'returns',      // 'returns' (keep as returns, negative sales) | 'reject'
  discountType: 'amount',           // 'amount' | 'percent'
  repeatedTotals: null,             // null (undecided) | 'calculate' | 'first_row' | 'keep'
  duplicateStrategy: 'skip',        // 'skip' rows already in the database | 'keep'
};

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const toISO = (d) => d.toISOString().slice(0, 10);

function mkDate(y, m, d) {
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

export function parseDate(v, order = 'DMY') {
  if (v === null || v === undefined || v === '') return { empty: true };
  if (v instanceof Date && !isNaN(v)) return { date: new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())) };
  if (typeof v === 'number') {
    if (v >= 20000 && v <= 80000) return { date: new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000) };
    return { invalid: true };
  }
  const s = String(v).trim();
  if (!s) return { empty: true };
  let m;
  const ok = (dt) => (dt ? { date: dt } : { invalid: true });
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) return ok(mkDate(+m[1], +m[2] - 1, +m[3]));
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    const [d, mo] = order === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return ok(mkDate(y, mo - 1, d));
  }
  if ((m = s.match(/^(\d{1,2})[\s\-/.,]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2}|\d{4})(?:[ T,].*)?$/))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; let y = +m[3]; if (y < 100) y += 2000;
    return mo === undefined ? { invalid: true } : ok(mkDate(y, mo, +m[1]));
  }
  if ((m = s.match(/^([A-Za-z]{3,9})[\s\-.]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo === undefined ? { invalid: true } : ok(mkDate(+m[3], mo, +m[2]));
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return { invalid: true };
}

export function parseNumber(v, { percent = false } = {}) {
  if (v === null || v === undefined) return { empty: true };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { invalid: true };
  if (typeof v === 'boolean') return { invalid: true };
  let s = String(v).trim();
  if (s === '' || /^(-|--|na|n\/a|nil|null|none)$/i.test(s)) return { empty: true };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/₹|rs\.?|inr/gi, '').replace(/,/g, '').replace(/\s+/g, '');
  if (percent) s = s.replace(/%$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { invalid: true };
  const n = Number(s);
  return { value: neg ? -n : n };
}

const cleanText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Detect invoices whose total was repeated on every product line.
function detectRepeatedTotals(table, idx, opt) {
  const flagged = new Set();
  const invoices = new Set();
  if (idx.invoiceNo < 0 || idx.netSales < 0 || (idx.product < 0 && idx.productId < 0)) return { flagged, invoices };
  const groups = new Map();
  for (const { n, v } of table.rows) {
    const inv = cleanText(v[idx.invoiceNo]);
    const net = parseNumber(v[idx.netSales]).value;
    if (!inv || net === undefined) continue;
    const prod = cleanText(v[idx.product >= 0 ? idx.product : idx.productId])?.toLowerCase() ?? null;
    const q = idx.quantity >= 0 ? parseNumber(v[idx.quantity]).value : undefined;
    const u = idx.unitPrice >= 0 ? parseNumber(v[idx.unitPrice]).value : undefined;
    let d = 0;
    if (idx.discount >= 0) { const dv = parseNumber(v[idx.discount], { percent: true }).value; if (dv !== undefined) d = opt.discountType === 'percent' && q !== undefined && u !== undefined ? (q * u * dv) / 100 : dv; }
    const line = q !== undefined && u !== undefined ? q * u - d : null;
    if (!groups.has(inv)) groups.set(inv, []);
    groups.get(inv).push({ n, net, prod, line });
  }
  for (const [inv, rows] of groups) {
    if (rows.length < 2 || new Set(rows.map((r) => r.prod)).size < 2) continue;
    if (!rows.every((r) => r.net === rows[0].net) || rows[0].net === 0) continue;
    const consistent = rows.every((r) => r.line !== null && Math.abs(r.line - r.net) <= 1);
    if (consistent) continue; // each line really equals the net amount; legitimate
    invoices.add(inv);
    rows.forEach((r) => flagged.add(r.n));
  }
  return { flagged, invoices };
}

export function describeRules(mapping, importType, opt) {
  const rules = [];
  rules.push('Net sales is the money actually billed for the line, after discount. Taxes are not added or removed; if your source net amount includes GST, so will all reports.');
  if (mapping.netSales) rules.push(`Net sales = the "${mapping.netSales}" column, used exactly as it appears in the file.`);
  else if (mapping.grossAmount) rules.push(`Net sales = "${mapping.grossAmount}" minus discount${mapping.discount ? ` ("${mapping.discount}")` : ' (none provided)'}.`);
  else rules.push(`Net sales = ${mapping.quantity ? `"${mapping.quantity}"` : 'Quantity'} × ${mapping.unitPrice ? `"${mapping.unitPrice}"` : 'Unit price'} minus discount${mapping.discount ? ` ("${mapping.discount}")` : ' (none provided)'}.`);
  if (mapping.discount) rules.push(opt.discountType === 'percent' ? 'Discount values are percentages of the gross line amount.' : 'Discount values are rupee amounts. Discount is subtracted only once, and never when the file already provides a net amount.');
  rules.push(opt.negativeHandling === 'returns' ? 'Rows with negative quantity or amount are treated as returns/refunds: they reduce net sales, are reported separately, and are never counted as positive sales.' : 'Rows with negative quantity or amount are rejected.');
  if (!mapping.costPrice) rules.push('No cost column mapped: profit and margin will not be shown.');
  else rules.push('Gross profit = net sales − (unit cost × quantity). Shown only when cost is present for at least 90% of net sales.');
  if (importType === 'aggregated') rules.push('Pre-aggregated data is kept at its original level. No invoice or purchase history is implied.');
  return rules;
}

export function processRows({ table, mapping, importType = 'transaction', options = {}, aliases = {}, existingKeys = new Set(), canon = {} }) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const idx = {};
  for (const f of FIELDS) idx[f.key] = mapping[f.key] ? table.headers.indexOf(mapping[f.key]) : -1;
  const issues = [];
  const add = (row, level, code, field, message) => issues.push({ row, level, code, field, message });

  // display-name canonicalisation (spacing / capitalisation only)
  const maps = {};
  for (const k of ['area', 'city', 'category', 'salesperson']) maps[k] = new Map((canon[k] || []).map((s) => [s.toLowerCase(), s]));
  const shopNames = new Map(Object.entries(canon.shops || {}));
  const productNames = new Map(Object.entries(canon.products || {}));
  const productCats = canon.productCategories || {};
  const canonize = (k, s) => { if (!s) return null; const l = s.toLowerCase(); if (!maps[k].has(l)) maps[k].set(l, s); return maps[k].get(l); };

  const rep = detectRepeatedTotals(table, idx, opt);
  const needsDecision = rep.flagged.size > 0 && !opt.repeatedTotals;
  const seenInvoiceForFirstRow = new Set();
  const occurrences = new Map();
  const firstRowOfKey = new Map();

  const stats = {
    totalRows: table.rows.length, rejected: 0, imported: 0, skippedDuplicates: 0, warnings: 0,
    counts: { missingRequired: 0, invalidDates: 0, invalidNumbers: 0, negatives: 0, inFileDuplicates: 0, existingDuplicates: 0, missingShop: 0, missingProduct: 0, missingArea: 0, missingCategory: 0, calcMismatch: 0, repeatedInvoiceRows: rep.flagged.size, repeatedInvoices: rep.invoices.size, noDate: 0 },
    totals: { net: 0, gross: 0, discount: 0, returns: 0, quantity: 0 },
    dateRange: { min: null, max: null },
  };
  const records = [], rejectedRows = [], calcPreview = [];
  const shopSet = new Set(), productSet = new Set();

  for (const { n, v } of table.rows) {
    const get = (k) => (idx[k] >= 0 ? v[idx[k]] : null);
    const rowIssues = [];
    const reject = (code, field, message) => { add(n, 'error', code, field, message); rowIssues.push(code); };

    // ---- identities
    let shopName = cleanText(get('shopName')), shopId = cleanText(get('shopId'));
    let shopKey = shopId ? 'id:' + shopId.toLowerCase() : shopName ? 'n:' + shopName.toLowerCase() : null;
    const originalShopName = shopName;
    const sa = shopKey && aliases.shops?.[shopKey];
    if (sa) { shopKey = sa.key; shopName = sa.name; }
    else if (shopKey) { const known = shopNames.get(shopKey); shopName = known || shopName || shopId; if (!known) shopNames.set(shopKey, shopName); }

    let productName = cleanText(get('product')), productId = cleanText(get('productId'));
    let productKey = productId ? 'id:' + productId.toLowerCase() : productName ? 'n:' + productName.toLowerCase() : null;
    const originalProductName = productName;
    const pa = productKey && aliases.products?.[productKey];
    if (pa) { productKey = pa.key; productName = pa.name; }
    else if (productKey) { const known = productNames.get(productKey); productName = known || productName || productId; if (!known) productNames.set(productKey, productName); }

    const area = canonize('area', cleanText(get('area')));
    const city = canonize('city', cleanText(get('city')));
    const salesperson = canonize('salesperson', cleanText(get('salesperson')));
    let category = canonize('category', cleanText(get('category')));
    if (!category && productKey && productCats[productKey]) category = productCats[productKey];
    const invoiceNo = cleanText(get('invoiceNo'));
    const lineId = cleanText(get('lineId'));
    const paymentStatus = cleanText(get('paymentStatus'));

    // ---- required fields
    if (importType === 'aggregated') {
      if (!shopKey && !area && !productKey && !category) reject('missing_required', 'shopName', 'Row has no shop, area, product or category.');
    } else {
      if (!shopKey) reject('missing_required', 'shopName', 'Missing shop / customer name.');
      if (importType === 'transaction' && !productKey) reject('missing_required', 'product', 'Missing product name.');
    }

    // ---- date
    let saleDate = null;
    if (idx.date >= 0) {
      const pd = parseDate(get('date'), opt.dateOrder);
      if (pd.date) saleDate = pd.date;
      else if (pd.invalid) {
        stats.counts.invalidDates++;
        if (opt.invalidDates === 'reject') reject('invalid_date', 'date', `Invalid date "${get('date')}".`);
        else add(n, 'warning', 'invalid_date', 'date', `Invalid date "${get('date')}". Imported without a date.`);
      } else if (opt.invalidDates === 'reject') { stats.counts.invalidDates++; reject('invalid_date', 'date', 'Missing date.'); }
    }

    // ---- numbers
    const num = (k, o) => {
      if (idx[k] < 0) return undefined;
      const p = parseNumber(get(k), o);
      if (p.invalid) { stats.counts.invalidNumbers++; reject('invalid_number', k, `"${get(k)}" is not a valid number for ${FIELDS.find((f) => f.key === k).label}.`); return undefined; }
      return p.empty ? undefined : p.value;
    };
    let qty = num('quantity'), unit = num('unitPrice'), grossv = num('grossAmount');
    let discv = num('discount', { percent: true }), netv = num('netSales');
    let costv;
    if (idx.costPrice >= 0) { const p = parseNumber(get('costPrice')); if (p.invalid) add(n, 'warning', 'invalid_cost', 'costPrice', `Cost "${get('costPrice')}" ignored (not a number).`); else costv = p.value; }

    // ---- repeated invoice totals
    let ignoreNet = false, zeroNet = false;
    if (rep.flagged.has(n)) {
      if (opt.repeatedTotals === 'calculate') ignoreNet = true;
      else if (opt.repeatedTotals === 'first_row') { if (seenInvoiceForFirstRow.has(invoiceNo)) zeroNet = true; else seenInvoiceForFirstRow.add(invoiceNo); }
      add(n, 'warning', 'repeated_invoice_total', 'netSales', `Invoice ${invoiceNo}: the same total (${inr(netv ?? 0)}) appears on several product lines.${opt.repeatedTotals ? '' : ' Choose how to handle it.'}`);
    }
    if (ignoreNet) netv = undefined;

    // ---- amounts
    let gross = null, discount = null, net = null, basis = '';
    const grossCalc = grossv !== undefined ? grossv : qty !== undefined && unit !== undefined ? qty * unit : null;
    let discAmt = null;
    if (discv !== undefined) discAmt = opt.discountType === 'percent' ? (grossCalc !== null ? (grossCalc * discv) / 100 : null) : discv;
    if (!rowIssues.length || !rowIssues.includes('invalid_number')) {
      if (netv !== undefined && !zeroNet) {
        net = netv; gross = grossCalc; discount = discAmt; basis = 'Net amount column';
        if (grossCalc !== null) {
          const expected = grossCalc - (discAmt || 0);
          if (Math.abs(net - expected) > Math.max(1, Math.abs(expected) * 0.01)) {
            stats.counts.calcMismatch++;
            add(n, 'warning', 'calc_mismatch', 'netSales', `Net amount ${inr(net)} differs from ${grossv !== undefined ? 'gross' : 'qty × rate'} less discount (${inr(expected)}). The net amount from the file was used (it may include tax).`);
          }
        }
      } else if (zeroNet) { net = 0; gross = null; basis = 'Repeated invoice total counted once on first line'; }
      else if (grossCalc !== null) {
        gross = grossCalc; discount = discAmt; net = grossCalc - (discAmt || 0);
        basis = (grossv !== undefined ? 'Gross amount' : 'Qty × rate') + (discAmt ? ' − discount' : '');
      } else if (!rowIssues.length) reject('no_amount', 'netSales', 'No usable sales amount on this row.');
    }

    // ---- negatives / returns
    let isReturn = false;
    if (net !== null && (net < 0 || (qty !== undefined && qty < 0))) {
      stats.counts.negatives++;
      if (opt.negativeHandling === 'reject') reject('negative_value', 'netSales', 'Negative quantity or amount (returns are set to be rejected).');
      else { isReturn = true; if (qty !== undefined && qty > 0) qty = -qty; add(n, 'info', 'return_row', 'netSales', 'Treated as a return/refund (reduces net sales).'); }
    }

    if (rowIssues.length) {
      stats.rejected++;
      if (rowIssues.includes('missing_required')) stats.counts.missingRequired++;
      rejectedRows.push({ row: n, reasons: issues.filter((i) => i.row === n && i.level === 'error').map((i) => i.message).join(' | '), values: v });
      continue;
    }

    // ---- optional-field gaps (counts)
    if (!shopKey) stats.counts.missingShop++;
    if (!productKey) stats.counts.missingProduct++;
    if (!area) stats.counts.missingArea++;
    if (!category) stats.counts.missingCategory++;
    if (!saleDate) stats.counts.noDate++;

    // ---- identity of the line (for duplicate detection); occurrence index keeps genuine repeat purchases
    const base = lineId && invoiceNo ? `inv:${invoiceNo.toLowerCase()}|line:${lineId.toLowerCase()}`
      : [saleDate ? toISO(saleDate) : '', invoiceNo?.toLowerCase() ?? '', shopKey ?? '', productKey ?? '', area?.toLowerCase() ?? '', category?.toLowerCase() ?? '', qty ?? '', net !== null ? r2(net) : ''].join('|');
    const occ = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occ);
    const sourceKey = `${importType}|${base}#${occ}`;
    if (occ > 1) {
      stats.counts.inFileDuplicates++;
      add(n, 'info', 'possible_duplicate_row', null, `Identical to row ${firstRowOfKey.get(base)}. Kept, because genuine repeat purchases look the same. Check if this is unexpected.`);
    } else firstRowOfKey.set(base, n);
    if (existingKeys.has(sourceKey)) {
      stats.counts.existingDuplicates++;
      add(n, 'warning', 'duplicate_existing', null, 'This line already exists in previously imported data.');
      if (opt.duplicateStrategy === 'skip') { stats.skippedDuplicates++; continue; }
    }

    const netR = r2(net);
    const rec = {
      saleDate, invoiceNo, lineId, shopKey, shopName, originalShopName, shopId, area, city,
      productKey, productName, originalProductName, productId, category,
      quantity: qty ?? null, unitPrice: unit ?? null,
      grossAmount: gross !== null ? r2(gross) : null, discount: discount !== null ? r2(discount) : null, netSales: netR,
      costPrice: costv ?? null, costTotal: costv !== undefined && qty !== undefined ? r2(costv * qty) : null,
      salesperson, paymentStatus, isReturn, isAggregated: importType === 'aggregated', importType,
      calcBasis: basis, sourceRow: n, sourceKey,
    };
    records.push(rec);
    stats.imported++;
    stats.totals.net += netR;
    if (rec.grossAmount !== null && !isReturn) stats.totals.gross += rec.grossAmount;
    if (rec.discount !== null && !isReturn) stats.totals.discount += rec.discount;
    if (isReturn) stats.totals.returns += -netR;
    stats.totals.quantity += qty ?? 0; // return rows carry negative quantity
    if (saleDate) {
      const iso = toISO(saleDate);
      if (!stats.dateRange.min || iso < stats.dateRange.min) stats.dateRange.min = iso;
      if (!stats.dateRange.max || iso > stats.dateRange.max) stats.dateRange.max = iso;
    }
    if (shopKey) shopSet.add(shopKey);
    if (productKey) productSet.add(productKey);
    if (calcPreview.length < 8) {
      const parts = [];
      if (basis === 'Net amount column') parts.push(`${inr(netR)} (from net column)`);
      else if (qty !== undefined && unit !== undefined && grossv === undefined) parts.push(`${qty} × ${inr(unit)}${discount ? ` − ${inr(discount)}` : ''} = ${inr(netR)}`);
      else parts.push(`${inr(gross ?? 0)}${discount ? ` − ${inr(discount)}` : ''} = ${inr(netR)}`);
      calcPreview.push({ row: n, shop: shopName, product: productName, text: parts[0], isReturn });
    }
  }

  for (const k of ['net', 'gross', 'discount', 'returns', 'quantity']) stats.totals[k] = r2(stats.totals[k]);
  stats.warnings = issues.filter((i) => i.level === 'warning').length;
  stats.shops = shopSet.size; stats.products = productSet.size;
  stats.validRows = stats.totalRows - stats.rejected;
  return { records, issues, stats, rejectedRows, calcPreview, needsDecision, rules: describeRules(mapping, importType, opt) };
}
