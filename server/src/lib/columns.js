// Canonical fields, alias matching and mapping validation.
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const FIELDS = [
  { key: 'date', label: 'Sale date', aliases: ['date', 'saledate', 'billdate', 'invoicedate', 'orderdate', 'transactiondate', 'voucherdate', 'dateofsale'] },
  { key: 'invoiceNo', label: 'Invoice number', aliases: ['invoiceno', 'invoicenumber', 'invno', 'billno', 'billnumber', 'orderid', 'orderno', 'voucherno', 'vchno', 'invoiceid'] },
  { key: 'lineId', label: 'Invoice line ID', aliases: ['lineid', 'invoicelineid', 'linenumber', 'lineno'] },
  { key: 'shopName', label: 'Shop / customer name', aliases: ['shop', 'shopname', 'customer', 'customername', 'retailer', 'retailername', 'dealer', 'dealername', 'partyname', 'party', 'outlet', 'outletname', 'store', 'storename', 'client', 'clientname', 'buyer', 'accountname'] },
  { key: 'shopId', label: 'Shop ID', aliases: ['customerid', 'partycode', 'dealercode', 'shopid', 'shopcode', 'customercode', 'retailercode', 'outletcode', 'accountcode'] },
  { key: 'area', label: 'Area / market', aliases: ['area', 'areaname', 'locality', 'market', 'marketname', 'territory', 'zone', 'location', 'route'] },
  { key: 'city', label: 'City', aliases: ['city', 'town', 'district', 'cityname'] },
  { key: 'product', label: 'Product name', aliases: ['product', 'productname', 'item', 'itemname', 'skuname', 'itemdescription', 'particulars'] },
  { key: 'productId', label: 'Product ID / SKU', aliases: ['sku', 'skucode', 'productcode', 'itemcode', 'productid', 'itemid', 'barcode'] },
  { key: 'category', label: 'Category', aliases: ['category', 'productcategory', 'producttype', 'itemgroup', 'itemcategory', 'group', 'productgroup'] },
  { key: 'quantity', label: 'Quantity', aliases: ['qty', 'quantity', 'quantitysold', 'units', 'unitssold', 'qtysold', 'pcs', 'nos'] },
  { key: 'unitPrice', label: 'Unit price', aliases: ['rate', 'price', 'unitprice', 'unitrate', 'sellingprice', 'sellingrate', 'salerate', 'saleprice'] },
  { key: 'grossAmount', label: 'Gross amount', aliases: ['grossamount', 'grosssales', 'basicamount', 'lineamount', 'grossvalue', 'amountbeforediscount'] },
  { key: 'discount', label: 'Discount', aliases: ['discount', 'discountamount', 'discamt', 'disc', 'discountvalue', 'tradediscount', 'schemediscount'] },
  { key: 'netSales', label: 'Net sales', aliases: ['netamount', 'netsales', 'salesamount', 'revenue', 'netvalue', 'linetotal', 'netsalesamount', 'saleamount', 'finalamount', 'totalnetamount'] },
  { key: 'costPrice', label: 'Cost price (per unit)', aliases: ['cost', 'costprice', 'purchaserate', 'unitcost', 'purchaseprice', 'buyingprice', 'landedcost'] },
  { key: 'salesperson', label: 'Salesperson', aliases: ['salesperson', 'salesrep', 'salesexecutive', 'representative', 'salesman', 'rep', 'executive', 'fieldexecutive'] },
  { key: 'paymentStatus', label: 'Payment status', aliases: ['paymentstatus', 'paidstatus', 'paystatus', 'payment'] },
];

// Headers that must NEVER be mapped silently; the user decides.
export const AMBIGUOUS = {
  total: ['netSales', 'grossAmount'], amount: ['netSales', 'grossAmount'], value: ['netSales', 'grossAmount'],
  grandtotal: ['netSales', 'grossAmount'], totalamount: ['netSales', 'grossAmount'], totalvalue: ['netSales', 'grossAmount'],
  sales: ['netSales', 'grossAmount'], salesvalue: ['netSales', 'grossAmount'],
  name: ['shopName', 'product'], id: ['shopId', 'productId'], code: ['shopId', 'productId'],
};

export const IMPORT_TYPES = {
  transaction: 'Transaction-level (one row per product line)',
  invoice: 'Invoice-level (one row per invoice)',
  aggregated: 'Pre-aggregated (already grouped totals)',
};

export function suggestMapping(headers) {
  const candidates = []; // {field, col, score}
  headers.forEach((h, col) => {
    const n = norm(h);
    if (!n) return;
    for (const f of FIELDS) {
      for (const a of f.aliases) {
        if (n === a) candidates.push({ field: f.key, col, score: 100 });
        else if (a.length >= 4 && n.includes(a) && !AMBIGUOUS[n]) candidates.push({ field: f.key, col, score: 60 });
      }
    }
  });
  // best score per (field, col)
  const best = new Map();
  for (const c of candidates) {
    const k = c.field + ':' + c.col;
    if (!best.has(k) || best.get(k).score < c.score) best.set(k, c);
  }
  const list = [...best.values()].sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping = {}, details = {}, usedCols = new Set();
  for (const f of FIELDS) { mapping[f.key] = null; details[f.key] = null; }
  // greedy: highest score first; a column is used once
  for (const c of list) {
    if (mapping[c.field] !== null || usedCols.has(c.col)) continue;
    const rivals = list.filter((o) => o.field === c.field && o.col !== c.col && o.score === c.score && !usedCols.has(o.col));
    if (rivals.length) {
      details[c.field] = { confidence: 'ambiguous', candidates: [c, ...rivals].map((x) => headers[x.col]) };
      continue; // leave unmapped; user must choose
    }
    mapping[c.field] = headers[c.col];
    usedCols.add(c.col);
    details[c.field] = { confidence: c.score >= 100 ? 'high' : 'medium' };
  }
  const ambiguousColumns = [];
  headers.forEach((h) => {
    const cands = AMBIGUOUS[norm(h)];
    if (cands) ambiguousColumns.push({ column: h, couldBe: cands, message: `"${h}" could mean different things (${cands.join(' / ')}). Please choose its meaning yourself.` });
  });
  const hints = {};
  if (mapping.discount && /%/.test(mapping.discount)) hints.discountPercent = true;
  return { mapping, details, ambiguousColumns, hints };
}

export function detectImportType(mapping) {
  const has = (k) => !!mapping[k];
  if (has('product') || has('productId')) {
    if (has('quantity') || has('unitPrice') || has('lineId')) return 'transaction';
    if (!has('invoiceNo') && !has('date')) return 'aggregated';
    return 'transaction';
  }
  if (has('invoiceNo')) return 'invoice';
  if (!has('date') && (has('shopName') || has('area') || has('category'))) return 'aggregated';
  return 'invoice';
}

export function checkMapping(mapping, importType, headers) {
  const errors = [], warnings = [];
  const has = (k) => !!mapping[k];
  for (const [k, col] of Object.entries(mapping)) {
    if (col && !headers.includes(col)) errors.push(`Column "${col}" (for ${k}) does not exist in this sheet.`);
  }
  const used = {};
  for (const [k, col] of Object.entries(mapping)) {
    if (!col) continue;
    (used[col] ||= []).push(k);
  }
  for (const [col, keys] of Object.entries(used)) {
    if (keys.length > 1) warnings.push(`Column "${col}" is mapped to more than one field (${keys.join(', ')}). Check this is intended.`);
  }
  const amountOk = has('netSales') || has('grossAmount') || (has('quantity') && has('unitPrice'));
  if (!amountOk) errors.push('No usable sales amount. Map "Net sales", or "Gross amount", or both "Quantity" and "Unit price".');
  if (importType === 'transaction') {
    if (!has('shopName') && !has('shopId')) errors.push('Shop / customer name is required.');
    if (!has('product') && !has('productId')) errors.push('Product name is required for transaction-level data (or choose another import type).');
  } else if (importType === 'invoice') {
    if (!has('shopName') && !has('shopId')) errors.push('Shop / customer name is required.');
    if (!has('invoiceNo')) warnings.push('No invoice number mapped: invoice counts and average order value will be unavailable.');
    if (!has('product')) warnings.push('No product mapped: product analytics will be unavailable for this import.');
  } else if (importType === 'aggregated') {
    if (!['shopName', 'shopId', 'area', 'product', 'productId', 'category'].some(has)) errors.push('Map at least one grouping column (shop, area, product or category).');
    warnings.push('Pre-aggregated data: invoice counts, order history and purchase frequency cannot be derived.');
  }
  if (!has('date')) warnings.push('No date mapped: trends, period comparisons and inactivity flags will be unavailable.');
  if (importType !== 'aggregated' && !has('invoiceNo') && importType === 'transaction') warnings.push('No invoice number mapped: invoice counts and average order value will be unavailable.');
  if (!has('category')) warnings.push('No category mapped: products will show as "Uncategorized" until you assign categories.');
  if (!has('area')) warnings.push('No area mapped: area analytics will be unavailable.');
  return { errors, warnings };
}
