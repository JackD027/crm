import { useNavigate, useParams, Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useFetch } from '../state.jsx';
import { Badge, DataTable, Delta, ErrorBox, Kpi, Loading, NoData, Panel, PeriodNote } from '../components.jsx';
import { inr, num, periodLabel, short, PALETTE } from '../format.js';
import { HBar } from './Dashboard.jsx';

export function Areas() {
  const { meta } = useApp();
  const nav = useNavigate();
  const { data, loading, error } = useFetch('/api/analytics/areas', {}, { skip: !meta?.hasData });
  if (meta && !meta.hasData) return <NoData />;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const cats = [...new Set(data.byCategory.map((x) => x.category))];
  const stack = [...new Set(data.byCategory.map((x) => x.area))].map((a) => ({ area: a, ...Object.fromEntries(data.byCategory.filter((x) => x.area === a).map((x) => [x.category, x.net])) }));
  const m = data.months;
  const lineData = m.months.map((mo, i) => ({ month: mo, ...Object.fromEntries(m.rows.map((r) => [r.label, r.values[i]])) }));
  return <>
    <div className="page-head"><h1>Areas / Markets</h1><p>Where sales come from. Observations below are patterns in your data, not proven causes.</p></div>
    <PeriodNote range={data.range} />
    {data.rows.length === 0 ? <div className="alert warn">No area values found in this data/period. Map an Area column when importing.</div> : <>
      {data.missingArea > 0 && <div className="alert warn">{data.missingArea} lines have no area and are not shown here.</div>}
      <div className="grid g2"><Panel title="Net sales by area"><HBar data={data.rows.map((r) => ({ label: r.label, net: r.net }))} /></Panel>
        <Panel title="Category mix by area"><ResponsiveContainer width="100%" height={Math.max(240, stack.length * 36 + 60)}><BarChart data={stack} layout="vertical" stackOffset="expand"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(v) => Math.round(v * 100) + '%'} /><YAxis type="category" dataKey="area" width={110} tick={{ fontSize: 12 }} /><Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />{cats.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={PALETTE[i % PALETTE.length]} />)}</BarChart></ResponsiveContainer></Panel></div>
      <Panel title="Ranked areas" right={data.businessAvgPerShop && <span className="muted">Business average per shop: {inr(data.businessAvgPerShop)}</span>}>
        <DataTable initialSort={{ key: 'net', dir: 'desc' }} onRowClick={(r) => nav('/areas/' + encodeURIComponent(r.key))} columns={[
          { key: 'label', label: 'Area', render: (r) => <b>{r.label}</b> }, { key: 'city', label: 'City' }, { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'share', label: 'Share', align: 'right', render: (r) => r.share + '%' },
          { key: 'shops', label: 'Shops', align: 'right' }, { key: 'invoices', label: 'Invoices', align: 'right', render: (r) => r.invoices || '—' }, { key: 'avgPerShop', label: 'Avg / shop', align: 'right', render: (r) => inr(r.avgPerShop) },
          { key: 'changePct', label: 'Change', align: 'right', render: (r) => (r.prevNet == null ? <span className="muted">—</span> : <Delta pct={r.changePct} />) },
          { key: 'observations', label: 'Observations', sortable: false, render: (r) => r.observations.map((o) => <Badge key={o} kind={/declin|Low/.test(o) ? 'amber' : 'green'}>{o}</Badge>) }]} rows={data.rows} /></Panel>
      <Panel title="Monthly sales — top areas">{lineData.length ? <ResponsiveContainer width="100%" height={280}><LineChart data={lineData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tickFormatter={(x) => periodLabel(x, 'month')} /><YAxis tickFormatter={short} /><Tooltip formatter={(v) => inr(v)} labelFormatter={(x) => periodLabel(x, 'month')} /><Legend />{m.rows.map((r, i) => <Line key={r.key} dataKey={r.label} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />)}</LineChart></ResponsiveContainer> : <div className="muted">No dated sales.</div>}</Panel></>}</>;
}

export function AreaDetail() {
  const { name } = useParams();
  const { data, loading, error } = useFetch(`/api/analytics/areas/${encodeURIComponent(name)}`);
  if (loading && !data) return <Loading />;
  if (error) return <><Link to="/areas">‹ Areas</Link><ErrorBox error={error} /></>;
  const s = data.summary, p = data.prevSummary;
  return <><Link to="/areas">‹ All areas</Link><div className="page-head" style={{ marginTop: 6 }}><h1>{data.area}</h1></div><PeriodNote range={data.range} />
    <div className="kpis"><Kpi label="Net sales" value={inr(s.netSales)} delta={p && p.netSales > 0 ? Math.round(((s.netSales - p.netSales) / p.netSales) * 1000) / 10 : undefined} /><Kpi label="Purchasing shops" value={s.shops} /><Kpi label="Invoices" value={s.invoices ?? 'n/a'} /><Kpi label="Avg per shop" value={s.shops ? inr(s.netSales / s.shops) : '—'} /><Kpi label="Quantity" value={num(s.quantity)} /></div>
    <div className="grid g2"><Panel title="Monthly sales"><ResponsiveContainer width="100%" height={240}><BarChart data={data.monthly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" tickFormatter={(x) => periodLabel(x, 'month')} /><YAxis tickFormatter={short} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="net" fill="#2563eb" /></BarChart></ResponsiveContainer></Panel>
      <Panel title="Category mix"><HBar data={data.categories.map((c) => ({ label: c.label, net: c.net }))} /></Panel></div>
    <Panel title="Top shops in this area"><DataTable dense rows={data.shops} columns={[{ key: 'label', label: 'Shop' }, { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'share', label: 'Share', align: 'right', render: (r) => r.share + '%' }, { key: 'invoices', label: 'Invoices', align: 'right' }, { key: 'changePct', label: 'Change', align: 'right', render: (r) => <Delta pct={r.changePct} /> }]} /></Panel></>;
}
