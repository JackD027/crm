import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useFetch } from '../state.jsx';
import { api } from '../api.js';
import { Kpi, Loading, ErrorBox, Panel, PeriodNote, NoData, Empty } from '../components.jsx';
import { inr, num, short, periodLabel, PALETTE } from '../format.js';

const tip = (v) => (typeof v === 'number' ? inr(v) : v);

export function HBar({ data, dataKey = 'net', fmt = tip, height }) {
  return <ResponsiveContainer width="100%" height={height || Math.max(200, data.length * 30 + 30)}>
    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} />
      <XAxis type="number" tickFormatter={dataKey === 'net' ? short : undefined} /><YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} />
      <Tooltip formatter={(v) => fmt(v)} /><Bar dataKey={dataKey} fill="#2563eb" radius={[0, 4, 4, 0]} /></BarChart>
  </ResponsiveContainer>;
}
export function Donut({ data, nameKey = 'label', valueKey = 'net' }) {
  return <ResponsiveContainer width="100%" height={280}><PieChart>
    <Pie data={data.filter((d) => d[valueKey] > 0)} dataKey={valueKey} nameKey={nameKey} innerRadius={55} outerRadius={95} paddingAngle={1}>{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie>
    <Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer>;
}

export default function Dashboard() {
  const { meta, refresh } = useApp();
  const nav = useNavigate();
  const [grain, setGrain] = useState('');
  const { data, loading, error } = useFetch('/api/dashboard/summary', { grain }, { skip: !meta?.hasData });
  const [busy, setBusy] = useState(false);
  const demo = async () => { setBusy(true); try { const p = await api.post('/api/imports/demo-preview'); nav('/import', { state: { preview: p } }); } finally { setBusy(false); } };

  if (!meta) return <Loading />;
  if (!meta.hasData) return <><NoData /><div className="actions" style={{ justifyContent: 'center' }}><button className="btn" onClick={demo} disabled={busy}>Or try it with demo data (opens the import wizard)</button></div></>;
  if (loading || !data) return error ? <ErrorBox error={error} /> : <Loading />;
  const { summary: s, deltas: d, trend } = data;
  const g = trend.grain;
  return <>
    <div className="page-head"><h1>Dashboard</h1><p>Net sales, shops, areas and products for the selected period.</p></div>
    <PeriodNote range={data.range} />
    {data.filtersText !== 'none' && <div className="alert info">Filters applied: {data.filtersText}</div>}
    {s.rows === 0 ? <Empty title="No sales match these filters">Try widening the date range or resetting the filters.</Empty> : <>
      <div className="kpis">
        <Kpi label="Net sales" value={inr(s.netSales)} delta={d?.netSales} sub={d ? 'vs previous period' : ''} />
        <Kpi label="Invoices / orders" value={s.invoices === null ? 'n/a' : num(s.invoices)} delta={d?.invoices ?? undefined} sub={s.invoices === null ? 'no invoice numbers in data' : ''} />
        <Kpi label="Quantity sold" value={num(s.quantity)} delta={d?.quantity} />
        <Kpi label="Purchasing shops" value={num(s.shops)} delta={d?.shops} />
        <Kpi label="Average order value" value={s.aov === null ? 'n/a' : inr(s.aov)} sub={s.aov === null ? 'needs invoice numbers' : 'sales before returns ÷ invoices'} />
        <Kpi label="Total discounts" value={s.discounts === null ? 'n/a' : inr(s.discounts)} sub={s.discounts === null ? 'no discount data' : ''} />
        {s.returns > 0 && <Kpi label="Returns deducted" value={inr(s.returns)} sub="already removed from net sales" />}
        <Kpi label="Gross profit" value={s.profit ? inr(s.profit.value) : 'n/a'} sub={s.profit ? `margin ${s.profit.margin}%` : 'cost data missing or insufficient'} note={s.profit && s.profit.coverage < 100 ? `cost known for ${s.profit.coverage}% of sales` : ''} />
      </div>
      {s.rowsWithoutDate > 0 && <div className="alert warn">{s.rowsWithoutDate} rows have no date. They count in totals but not in the trend chart.</div>}
      <Panel title="Sales trend" right={<select value={grain} onChange={(e) => setGrain(e.target.value)}><option value="">Auto ({g})</option>{['day', 'week', 'month', 'year'].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}ly</option>)}</select>}>
        {trend.series.length === 0 ? <div className="muted pad">No dated sales in this period.</div> :
          <ResponsiveContainer width="100%" height={300}><LineChart data={trend.series} margin={{ right: 20 }}><CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" tickFormatter={(p) => periodLabel(p, g)} tick={{ fontSize: 12 }} /><YAxis tickFormatter={short} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => inr(v)} labelFormatter={(p) => periodLabel(p, g)} /><Legend />
            <Line type="monotone" dataKey="net" name="Net sales" stroke="#2563eb" strokeWidth={2} dot={trend.series.length < 40} connectNulls />
            {trend.hasPrevious && <Line type="monotone" dataKey="prevNet" name="Previous period (aligned)" stroke="#94a3b8" strokeDasharray="5 4" dot={false} connectNulls />}</LineChart></ResponsiveContainer>}
      </Panel>
      <div className="grid g2">
        <Panel title="Sales by area">{data.areas.length ? <HBar data={data.areas} /> : <div className="muted pad">No area data imported.</div>}</Panel>
        <Panel title="Category contribution"><Donut data={data.categories} /></Panel>
        <Panel title="Top shops by revenue"><HBar data={data.topShops} /></Panel>
        <Panel title="Shop contribution to total sales"><Donut data={data.shopContribution} /></Panel>
        <Panel title="Top products by revenue"><HBar data={data.topProductsByRevenue} /></Panel>
        <Panel title="Top products by quantity"><HBar data={data.topProductsByQty} dataKey="quantity" fmt={(v) => num(v)} /></Panel>
      </div>
    </>}
  </>;
}
