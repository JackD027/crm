export const inr = (n, d = 0) => (n === null || n === undefined || isNaN(n) ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const num = (n, d = 0) => (n === null || n === undefined || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d }));
export const short = (n) => { const a = Math.abs(n); const s = n < 0 ? '-' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(1) + 'Cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1) + 'L'; if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(0) + 'K'; return s + '₹' + a; };
export const pctText = (p) => (p === null || p === undefined ? '—' : (p > 0 ? '+' : '') + p.toFixed(1) + '%');
export const dateText = (iso) => { if (!iso) return '—'; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
export const periodLabel = (p, grain) => {
  if (!p) return '';
  if (grain === 'month') { const d = new Date(p + '-01T00:00:00Z'); return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }); }
  if (grain === 'year') return p;
  return dateText(p).replace(/ \d{4}$/, '');
};
export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];
