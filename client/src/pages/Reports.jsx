import { useState } from 'react';
import { qs } from '../api.js';
import { useApp, useFetch } from '../state.jsx';
import { NoData, Panel, PeriodNote } from '../components.jsx';

const TYPES = [['summary', 'Overall sales summary', 'Key totals for the period, with the previous period when available.'], ['transactions', 'Transaction-level records', 'Every line, with its source row number.'], ['shops', 'Shop-wise sales', 'Revenue, invoices, last purchase and change per shop.'], ['areas', 'Area-wise sales', 'Revenue, shops and average per shop by area.'], ['products', 'Product-wise sales', 'Revenue, quantity and average price per product.'], ['categories', 'Category-wise sales', 'Revenue and share by category.'], ['monthly', 'Monthly trends', 'Net sales, quantity and invoices per month.'], ['inactive', 'Inactive shops & follow-ups', 'Shops with no recent purchase, one-time buyers, declines.'], ['insights', 'Business insights', 'The rule-based observations with how each was determined.']];

export default function Reports() {
  const { meta, query } = useApp();
  const { data: hist } = useFetch('/api/imports', {}, { useFilters: false, skip: !meta });
  const [batch, setBatch] = useState('');
  if (meta && !meta.hasData) return <NoData />;
  const url = (type, format, extra = {}) => '/api/reports/export' + qs({ ...query, type, format, ...extra });
  return <>
    <div className="page-head"><h1>Reports & exports</h1><p>Exports respect the date range and filters currently selected at the top. Each file includes a generated-at timestamp.</p></div>
    <PeriodNote range={{ text: query.from || query.to ? `${query.from || 'start'} – ${query.to || 'latest'}` : query.range === 'all' ? 'All dates' : `Preset: ${query.range}`, comparisonAvailable: false, comparisonNote: 'Comparison columns appear when the selected period has an earlier period in your data.' }} />
    <div className="grid g2">{TYPES.map(([t, title, desc]) => <Panel key={t} title={title}><p className="muted" style={{ marginTop: 0 }}>{desc}</p><div className="actions" style={{ marginTop: 0 }}><a className="btn" href={url(t, 'csv')}>⬇ CSV</a><a className="btn" href={url(t, 'xlsx')}>⬇ Excel</a></div></Panel>)}
      <Panel title="Import errors"><p className="muted" style={{ marginTop: 0 }}>Warnings and rejected-row reasons recorded for one import.</p>
        <select value={batch} onChange={(e) => setBatch(e.target.value)}><option value="">Choose an import…</option>{(hist || []).map((b) => <option key={b._id} value={b._id}>{b.fileName} · {new Date(b.createdAt).toLocaleDateString('en-IN')} · {b.status}</option>)}</select>
        <div className="actions"><a className={'btn ' + (batch ? '' : 'disabled')} style={batch ? {} : { pointerEvents: 'none', opacity: 0.5 }} href={url('errors', 'csv', { batchId: batch })}>⬇ CSV</a><a className="btn" style={batch ? {} : { pointerEvents: 'none', opacity: 0.5 }} href={url('errors', 'xlsx', { batchId: batch })}>⬇ Excel</a></div></Panel></div></>;
}
