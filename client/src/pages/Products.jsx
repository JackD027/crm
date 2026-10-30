import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { useApp, useFetch } from '../state.jsx';
import { Badge, DataTable, Delta, ErrorBox, Loading, NoData, Panel, PeriodNote } from '../components.jsx';
import { inr, num, periodLabel } from '../format.js';
import { PALETTE } from '../format.js';

const Heat = ({ m }) => {
  const max = Math.max(1, ...m.rows.flatMap((r) => r.values));
  return <div className="table-wrap"><table className="table dense heat"><thead><tr><th>Name</th>{m.months.map((x) => <th key={x} className="right">{periodLabel(x, 'month')}</th>)}</tr></thead>
    <tbody>{m.rows.map((r) => <tr key={r.key}><td>{r.label}</td>{r.values.map((v, i) => <td key={i} style={{ background: `rgba(37,99,235,${Math.max(0, v) / max * 0.35})` }}>{inr(v)}</td>)}</tr>)}</tbody></table></div>;
};

function AssignCategory({ rows, cats, onDone }) {
  const [vals, setVals] = useState({}), [err, setErr] = useState(null);
  const save = async (r) => { setErr(null); try { await api.put(`/api/products/${encodeURIComponent(r.key)}/category`, { category: vals[r.key] }); onDone(); } catch (e) { setErr(e.message); } };
  return <Panel title={`Assign categories (${rows.length} products without one)`}><div className="muted" style={{ marginBottom: 8 }}>Your choice is applied to the product's existing lines and to future imports of the same product.</div><ErrorBox error={err} />
    <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
    {rows.map((r) => <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><span style={{ flex: 1 }}>{r.label} <span className="muted">· {inr(r.net)}</span></span><input list="cats" placeholder="Category" value={vals[r.key] || ''} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} /><button className="btn small" disabled={!vals[r.key]} onClick={() => save(r)}>Save</button></div>)}</Panel>;
}

export default function Products() {
  const { meta, refresh } = useApp();
  const [tab, setTab] = useState('products');
  const P = useFetch('/api/analytics/products', {}, { skip: !meta?.hasData });
  const C = useFetch('/api/analytics/categories', {}, { skip: !meta?.hasData });
  if (meta && !meta.hasData) return <NoData />;
  const d = tab === 'products' ? P : C;
  if (!d.data) return d.error ? <ErrorBox error={d.error} /> : <Loading />;
  const cmp = d.data.range.comparisonAvailable;
  const chg = { key: 'changePct', label: 'Change', align: 'right', render: (r) => (cmp ? (r.isNew ? <Badge kind="blue">new</Badge> : <Delta pct={r.changePct} />) : <span className="muted">—</span>) };
  const uncat = (P.data?.rows || []).filter((r) => !r.category || r.category === 'Uncategorized');
  const cats = (C.data?.rows || []).map((r) => r.label).filter((l) => l !== 'Uncategorized');
  return <>
    <div className="page-head"><h1>Products & Categories</h1><p>What sells, what is growing, and what is fading. No stock levels are shown: inventory data is not part of sales files.</p></div>
    <div className="tabs">{[['products', 'Products'], ['categories', 'Categories']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    <PeriodNote range={d.data.range} />
    {tab === 'products' && <>
      {uncat.length > 0 && <AssignCategory rows={uncat.slice(0, 15)} cats={cats} onDone={refresh} />}
      <Panel title="All products"><DataTable initialSort={{ key: 'net', dir: 'desc' }} rows={P.data.rows} columns={[{ key: 'label', label: 'Product', render: (r) => <b>{r.label}</b> }, { key: 'category', label: 'Category', render: (r) => r.category || 'Uncategorized' }, { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) }, { key: 'avgPrice', label: 'Avg price', align: 'right', render: (r) => inr(r.avgPrice, 2) }, { key: 'share', label: 'Share', align: 'right', render: (r) => r.share + '%' }, { key: 'shops', label: 'Shops', align: 'right' }, chg,
        ...(P.data.hasCost ? [{ key: 'profit', label: 'Gross profit', align: 'right', render: (r) => (r.profit != null ? `${inr(r.profit)} (${r.margin}%)` : '—') }] : [])]} /></Panel>
      <div className="grid g2">
        <Panel title="Declining products">{P.data.declining === null ? <div className="muted">Needs a comparison period (see note above).</div> : <DataTable dense rows={P.data.declining} emptyText="No product fell by 10% or more." columns={[{ key: 'label', label: 'Product' }, { key: 'net', label: 'Now', align: 'right', render: (r) => inr(r.net) }, { key: 'prevNet', label: 'Before', align: 'right', render: (r) => inr(r.prevNet) }, { key: 'changePct', label: 'Change', align: 'right', render: (r) => <Delta pct={r.changePct} /> }]} />}</Panel>
        <Panel title="Growing products">{P.data.growing === null ? <div className="muted">Needs a comparison period.</div> : <DataTable dense rows={P.data.growing} emptyText="No product grew by 10% or more." columns={[{ key: 'label', label: 'Product' }, { key: 'net', label: 'Now', align: 'right', render: (r) => inr(r.net) }, { key: 'prevNet', label: 'Before', align: 'right', render: (r) => inr(r.prevNet) }, { key: 'changePct', label: 'Change', align: 'right', render: (r) => <Delta pct={r.changePct} /> }]} />}</Panel></div>
      <Panel title="Monthly net sales — top products"><Heat m={P.data.months} /></Panel>
      <Panel title="Frequently bought together"><DataTable dense rows={P.data.boughtTogether.map((b, i) => ({ ...b, key: i }))} emptyText="Needs invoice numbers with several products per invoice, appearing together at least twice." columns={[{ key: 'a', label: 'Product A' }, { key: 'b', label: 'Product B' }, { key: 'count', label: 'Invoices together', align: 'right' }]} /></Panel></>}
    {tab === 'categories' && <>
      <Panel title="Category revenue"><DataTable initialSort={{ key: 'net', dir: 'desc' }} rows={C.data.rows} columns={[{ key: 'label', label: 'Category', render: (r) => <b>{r.label}</b> }, { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) }, { key: 'share', label: 'Share', align: 'right', render: (r) => r.share + '%' }, chg]} /></Panel>
      <Panel title="Growing categories">{C.data.growing === null ? <div className="muted">Needs a comparison period.</div> : <DataTable dense rows={C.data.growing} emptyText="No category grew by 10% or more." columns={[{ key: 'label', label: 'Category' }, { key: 'prevNet', label: 'Before', align: 'right', render: (r) => inr(r.prevNet) }, { key: 'net', label: 'Now', align: 'right', render: (r) => inr(r.net) }, { key: 'changePct', label: 'Change', align: 'right', render: (r) => <Delta pct={r.changePct} /> }]} />}</Panel>
      <Panel title="Monthly net sales by category"><Heat m={C.data.months} /></Panel>
      <Panel title="Category preferences by area">{C.data.byArea.length === 0 ? <div className="muted">No area data.</div> : (() => { const areas = [...new Set(C.data.byArea.map((x) => x.area))], cs = [...new Set(C.data.byArea.map((x) => x.category))]; const rows = areas.map((a) => ({ area: a, ...Object.fromEntries(C.data.byArea.filter((x) => x.area === a).map((x) => [x.category, x.net])) }));
        return <ResponsiveContainer width="100%" height={300}><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="area" /><YAxis /><Tooltip formatter={(v) => inr(v)} /><Legend />{cs.map((c, i) => <Bar key={c} dataKey={c} fill={PALETTE[i % PALETTE.length]} />)}</BarChart></ResponsiveContainer>; })()}</Panel></>}
  </>;
}
