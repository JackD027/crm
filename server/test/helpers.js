import XLSX from 'xlsx';
export const tableOf = (headers, rows) => ({ headers, rows: rows.map((v, i) => ({ n: i + 2, v })) });
export const M = (o) => ({ date: null, invoiceNo: null, lineId: null, shopName: null, shopId: null, area: null, city: null, product: null, productId: null, category: null, quantity: null, unitPrice: null, grossAmount: null, discount: null, netSales: null, costPrice: null, salesperson: null, paymentStatus: null, ...o });
export function xlsxBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
// a transaction object like those loaded from the database
export const tx = (o) => ({ saleDate: new Date(o.date + 'T00:00:00Z'), invoiceNo: null, shopKey: 'n:a', shopName: 'A', area: 'X', city: null, productKey: 'n:p', productName: 'P', category: 'C', quantity: 1, grossAmount: null, discount: null, netSales: 100, costTotal: null, isReturn: false, isAggregated: false, salesperson: null, ...o, ...(o.date ? {} : {}) });
