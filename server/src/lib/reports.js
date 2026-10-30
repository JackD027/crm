// Report builders + CSV/XLSX serialisers. Reports reuse the same analytics functions as the screens,
// so exported numbers always agree with what is displayed.
import XLSX from 'xlsx';
import { summarize, shopsTable, areasTable, productsTable, categoriesTable, trend, catOf, toISO, UNCAT } from './analytics.js';

export const REPORT_TYPES = {
  summary: 'Overall sales summary', transactions: 'Transaction-level records', shops: 'Shop-wise sales', areas: 'Area-wise sales',
  products: 'Product-wise sales', categories: 'Category-wise sales', monthly: 'Monthly trends', inactive: 'Inactive shops',
  insights: 'Business insights', errors: 'Import errors',
};

const c = (key, label) => ({ key, label });
const growthCols = [c('prevNet', 'Previous period net sales (₹)'), c('changePct', 'Change vs previous period (%)')];

export function buildReport(type, { cur = [], prev = null, flags = null, insights = null, errors = null } = {}) {
  switch (type) {
    case 'summary': {
      const s = summarize(cur);
      const p = prev ? summarize(prev) : null;
      const rows = [
        ['Net sales (₹)', s.netSales, p?.netSales ?? ''], ['Gross sales (₹)', s.grossSales ?? 'n/a', p?.grossSales ?? ''], ['Discounts (₹)', s.discounts ?? 'n/a', p?.discounts ?? ''],
        ['Returns (₹)', s.returns, p?.returns ?? ''], ['Quantity sold', s.quantity, p?.quantity ?? ''], ['Invoices', s.invoices ?? 'n/a', p?.invoices ?? ''],
        ['Purchasing shops', s.shops, p?.shops ?? ''], ['Average order value (₹)', s.aov ?? 'n/a', p?.aov ?? ''],
        ['Gross profit (₹)', s.profit ? s.profit.value : 'n/a (cost data missing or insufficient)', p?.profit?.value ?? ''], ['Gross margin (%)', s.profit ? s.profit.margin : 'n/a', p?.profit?.margin ?? ''],
      ].map(([metric, value, previous]) => ({ metric, value, previous }));
      return { columns: [c('metric', 'Metric'), c('value', 'Selected period'), c('previous', 'Previous period')], rows };
    }
    case 'transactions':
      return { columns: [c('date', 'Date'), c('invoiceNo', 'Invoice'), c('shopName', 'Shop'), c('area', 'Area'), c('city', 'City'), c('productName', 'Product'), c('category', 'Category'), c('quantity', 'Quantity'), c('unitPrice', 'Unit price (₹)'), c('gross', 'Gross (₹)'), c('discount', 'Discount (₹)'), c('net', 'Net sales (₹)'), c('type', 'Type'), c('salesperson', 'Salesperson'), c('sourceRow', 'Source row')],
        rows: cur.map((t) => ({ date: t.saleDate ? toISO(t.saleDate) : '', invoiceNo: t.invoiceNo || '', shopName: t.shopName || '', area: t.area || '', city: t.city || '', productName: t.productName || '', category: catOf(t), quantity: t.quantity ?? '', unitPrice: t.unitPrice ?? '', gross: t.grossAmount ?? '', discount: t.discount ?? '', net: t.netSales, type: t.isReturn ? 'Return' : 'Sale', salesperson: t.salesperson || '', sourceRow: t.sourceRow ?? '' })) };
    case 'shops':
      return { columns: [c('label', 'Shop'), c('area', 'Area'), c('city', 'City'), c('net', 'Net sales (₹)'), c('invoices', 'Invoices'), c('quantity', 'Quantity'), c('lastDate', 'Last purchase'), c('share', 'Share of sales (%)'), c('topCategory', 'Most purchased category'), ...growthCols], rows: shopsTable(cur, prev) };
    case 'areas':
      return { columns: [c('label', 'Area'), c('city', 'City'), c('net', 'Net sales (₹)'), c('shops', 'Purchasing shops'), c('invoices', 'Invoices'), c('avgPerShop', 'Avg sales per shop (₹)'), c('share', 'Share of sales (%)'), ...growthCols], rows: areasTable(cur, prev) };
    case 'products':
      return { columns: [c('label', 'Product'), c('category', 'Category'), c('net', 'Net sales (₹)'), c('quantity', 'Quantity'), c('avgPrice', 'Avg selling price (₹)'), c('share', 'Share of sales (%)'), ...growthCols], rows: productsTable(cur, prev) };
    case 'categories':
      return { columns: [c('label', 'Category'), c('net', 'Net sales (₹)'), c('quantity', 'Quantity'), c('share', 'Share of sales (%)'), ...growthCols], rows: categoriesTable(cur, prev) };
    case 'monthly':
      return { columns: [c('period', 'Month'), c('net', 'Net sales (₹)'), c('quantity', 'Quantity'), c('invoices', 'Invoices')], rows: trend(cur, 'month') };
    case 'inactive': {
      const f = flags || { inactive: [], oneAndDone: [], declining: [], lowFrequency: [], notes: [] };
      const rows = [
        ...f.inactive.map((x) => ({ ...x, flag: 'No recent purchase' })), ...f.oneAndDone.map((x) => ({ ...x, flag: 'Single purchase only' })),
        ...f.declining.map((x) => ({ ...x, flag: 'Sales declined' })), ...f.lowFrequency.map((x) => ({ ...x, flag: 'Purchase frequency fell' })),
      ];
      return { columns: [c('shopName', 'Shop'), c('area', 'Area'), c('flag', 'Follow-up suggestion'), c('reason', 'Why'), c('lastPurchase', 'Last purchase'), c('daysSince', 'Days since purchase'), c('lifetimeNet', 'Lifetime net sales (₹)')], rows, note: f.notes?.join(' ') };
    }
    case 'insights':
      return { columns: [c('title', 'Insight'), c('text', 'Detail'), c('metric', 'Metric'), c('value', 'Value'), c('comparison', 'Comparison'), c('dateRange', 'Period'), c('method', 'How it was determined')], rows: insights || [] };
    case 'errors':
      return { columns: [c('row', 'Source row'), c('level', 'Level'), c('code', 'Code'), c('field', 'Field'), c('message', 'Message')], rows: errors || [] };
    default: throw new Error('Unknown report type: ' + type);
  }
}

const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function toCsv(report, meta) {
  const lines = [`# Report: ${meta.title}`, `# Generated: ${meta.generated}`, `# Period: ${meta.period}`, `# Filters: ${meta.filters}`];
  if (report.note) lines.push(`# Note: ${report.note}`);
  lines.push('');
  lines.push(report.columns.map((x) => csvCell(x.label)).join(','));
  for (const r of report.rows) lines.push(report.columns.map((x) => csvCell(r[x.key])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens ₹ and Hindi names correctly
}

export function toXlsx(report, meta) {
  const wb = XLSX.utils.book_new();
  const aoa = [report.columns.map((x) => x.label), ...report.rows.map((r) => report.columns.map((x) => r[x.key] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = report.columns.map((x) => ({ wch: Math.min(40, Math.max(12, x.label.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const info = [['Report', meta.title], ['Generated', meta.generated], ['Period', meta.period], ['Filters', meta.filters]];
  if (report.note) info.push(['Note', report.note]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Info');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
