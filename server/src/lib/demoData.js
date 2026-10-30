// Deterministic demo data: Indian shops, areas, products; Apr–Sep 2026 with deliberate trends.
import XLSX from 'xlsx';

export const DEMO_HEADERS = ['Bill Date', 'Bill No', 'Party Name', 'Party Code', 'Area', 'City', 'Item Name', 'Item Code', 'Category', 'Qty', 'Rate', 'Discount', 'Net Amount', 'Sales Rep'];

const SHOPS = [
  ['Sharma General Store', 'SGS01', 'Karol Bagh', 'Delhi', 'Rohit', 1.0],
  ['Gupta Kirana', 'GK02', 'Karol Bagh', 'Delhi', 'Rohit', 0.8],
  ['New Bharat Provision', 'NBP03', 'Sadar Bazar', 'Delhi', 'Amit', 1.4],
  ['Jain Traders', 'JT04', 'Sadar Bazar', 'Delhi', 'Amit', 2.2],
  ['Mahalaxmi Stores', 'MS05', 'Sadar Bazar', 'Delhi', 'Amit', 1.2],
  ['Verma Supermart', 'VS06', 'Lajpat Nagar', 'Delhi', 'Neha', 1.3],
  ['Kapoor Mini Mart', 'KM07', 'Lajpat Nagar', 'Delhi', 'Neha', 1.0],
  ['Singh Dairy & General', 'SD08', 'Lajpat Nagar', 'Delhi', 'Neha', 0.7],
  ['Raj Super Bazaar', 'RSB09', 'Sector 18', 'Noida', 'Vikas', 1.5],
  ['Anand Retail', 'AR10', 'Sector 18', 'Noida', 'Vikas', 1.0],
  ['Krishna Stores', 'KS11', 'Sector 62', 'Noida', 'Vikas', 0.9],
  ['Pooja General Store', 'PGS12', 'Sector 62', 'Noida', 'Vikas', 1.0],
];
const PRODUCTS = [
  ['Cola 600ml', 'COLA600', 'Beverages', 38, [24, 96]],
  ['Mango Drink 200ml', 'MNG200', 'Beverages', 18, [48, 144]],
  ['Packaged Water 1L', 'PW1L', 'Beverages', 15, [48, 120]],
  ['Potato Chips 50g', 'CHP50', 'Snacks', 20, [48, 120]],
  ['Namkeen Mix 400g', 'NMK400', 'Snacks', 95, [10, 36]],
  ['Basmati Rice 5kg', 'RICE5', 'Staples', 520, [4, 16]],
  ['Atta 10kg', 'ATTA10', 'Staples', 430, [4, 16]],
  ['Refined Oil 1L', 'OIL1', 'Staples', 165, [12, 48]],
  ['Bath Soap 4-pack', 'SOAP4', 'Personal Care', 140, [10, 40]],
  ['Shampoo 180ml', 'SHP180', 'Personal Care', 155, [8, 30]],
];

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const serial = (y, m, d) => Math.round((Date.UTC(y, m, d) - Date.UTC(1899, 11, 30)) / 86400000);

export function makeDemoRows() {
  const rnd = rng(2026), out = [];
  for (let mi = 0; mi < 6; mi++) {
    const month = 3 + mi; // Apr..Sep
    SHOPS.forEach(([name, code, area, city, rep, w], si) => {
      if (code === 'KM07' && mi >= 3) return;      // stopped buying after June
      if (code === 'AR10' && mi < 4) return;       // new shop from August
      let invoices = w >= 1.4 ? 2 : 1;
      if (rnd() < 0.25 && w < 1.4) invoices = 0;     // occasional skipped month
      if (code === 'PGS12' && mi >= 3) invoices = mi === 3 ? 1 : (mi === 4 ? 0 : 1); // fading
      for (let k = 0; k < invoices; k++) {
        const day = 2 + Math.floor(rnd() * 25);
        const lines = 1 + (rnd() < 0.3 ? 1 : 0);
        const chosen = new Set();
        for (let l = 0; l < lines; l++) {
          const weights = PRODUCTS.map((p) => (p[2] === 'Beverages' ? 1 + mi * 0.6 : p[0].startsWith('Namkeen') ? Math.max(0.15, 2 - mi * 0.4) : 1));
          let r = rnd() * weights.reduce((a, b) => a + b, 0), pi = 0;
          while (r > weights[pi]) { r -= weights[pi]; pi++; }
          if (chosen.has(pi)) continue; chosen.add(pi);
          const p = PRODUCTS[pi];
          let qty = Math.round((p[4][0] + rnd() * (p[4][1] - p[4][0])) * w * (p[2] === 'Beverages' ? 1 + mi * 0.12 : 1));
          qty = Math.max(1, qty);
          const gross = qty * p[3];
          const discount = w >= 1.4 && rnd() < 0.5 ? Math.round(gross * 0.05) : 0;
          out.push({ day: serial(2026, month, day), shop: [name, code, area, city, rep], p, qty, discount, net: gross - discount, month, d: day });
        }
      }
    });
  }
  out.sort((a, b) => a.day - b.day || a.shop[1].localeCompare(b.shop[1]));
  // invoice numbers: same shop + same day share an invoice
  const inv = new Map(); let n = 0;
  const rows = out.map((o) => {
    const key = o.day + o.shop[1];
    if (!inv.has(key)) inv.set(key, `INV-2026-${String(++n).padStart(4, '0')}`);
    // leave Shampoo uncategorised in the file (demonstrates "Uncategorized" + manual assignment)
    const category = o.p[0].startsWith('Shampoo') ? null : o.p[2];
    return [o.day, inv.get(key), o.shop[0], o.shop[1], o.shop[2], o.shop[3], o.p[0], o.p[1], category, o.qty, o.p[3], o.discount || null, o.net, o.shop[4]];
  });
  // one genuine return (credit note) for the biggest shop
  const lastAug = rows.filter((r) => r[3] === 'JT04').find((r) => r[6] === 'Cola 600ml' && r[0] >= serial(2026, 7, 1));
  if (lastAug) rows.push([lastAug[0] + 6, 'CN-2026-0001', 'Jain Traders', 'JT04', 'Sadar Bazar', 'Delhi', 'Cola 600ml', 'COLA600', 'Beverages', -12, 38, null, -456, 'Amit']);
  return rows;
}

function sheetFrom(rows) {
  const ws = XLSX.utils.aoa_to_sheet([DEMO_HEADERS, ...rows]);
  for (let r = 1; r <= rows.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c) c.z = 'dd-mmm-yyyy'; }
  ws['!cols'] = DEMO_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  return ws;
}

export function demoWorkbookBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(makeDemoRows()), 'Sales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Demo data for Sales Analytics CRM'], ['Fictional shops and sales for testing. Apr–Sep 2026.'], ['The second sheet exists to demonstrate worksheet selection; import the "Sales" sheet.']]), 'Notes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function demoCsvBuffer() {
  const rows = makeDemoRows().map((r) => { const d = new Date(Date.UTC(1899, 11, 30) + r[0] * 86400000); return [d.toISOString().slice(0, 10).split('-').reverse().join('/'), ...r.slice(1)]; });
  const esc = (v) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return Buffer.from([DEMO_HEADERS, ...rows].map((r) => r.map(esc).join(',')).join('\n'), 'utf8');
}

export function templateWorkbookBuffer() {
  const sample = makeDemoRows().slice(0, 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(sample), 'Sales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['How to use this template'],
    ['1. Keep one row per product line on an invoice. Replace the three sample rows with your own.'],
    ['2. Required: shop/party name, product/item name, and either Net Amount or Qty × Rate.'],
    ['3. Recommended: Bill Date, Bill No, Area, City, Category.'],
    ['4. Your own column names are fine; the import screen lets you map them.'],
    ['5. Returns / credit notes: enter negative quantity and amount.'],
  ]), 'Instructions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
