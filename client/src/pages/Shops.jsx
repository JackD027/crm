import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { useApp, useFetch } from '../state.jsx';
import { Badge, DataTable, Delta, ErrorBox, Kpi, Loading, NoData, Panel, PeriodNote } from '../components.jsx';
import { dateText, inr, num, pctText, periodLabel, short } from '../format.js';
import { Donut, HBar } from './Dashboard.jsx';

const STATUS = { none: 'No follow-up', to_contact: 'To contact', contacted: 'Contacted', done: 'Done' };

export function Shops() {
  const { meta } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('all'), [q, setQ] = useState('');
  if (meta && !meta.hasData) return <NoData />;
  return <>
    <div className="page-head"><h1>Shops / Customers</h1><p>Revenue, trends and follow-up suggestions per shop.</p></div>
    <div className="tabs">{[['all', 'All shops'], ['flags', 'Follow-up suggestions'], ['reminders', 'My reminders']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'all' && <AllShops q={q} setQ={setQ} nav={nav} />}{tab === 'flags' && <Flags nav={nav} />}{tab === 'reminders' && <Reminders nav={nav} />}
  </>;
}

function AllShops({ q, setQ, nav }) {
  const { data, loading, error } = useFetch('/api/shops', { q });
  const cmp = data?.comparisonAvailable;
  return <>{data && <PeriodNote range={data.range} />}<ErrorBox error={error} />
    <Panel title={data ? `${data.rows.length} shops` : 'Shops'} right={<input placeholder="Search shop, area, city…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      {loading && !data ? <Loading /> : data && <DataTable rows={data.rows} initialSort={{ key: 'net', dir: 'desc' }} onRowClick={(r) => nav('/shops/' + encodeURIComponent(r.key))} columns={[
        { key: 'label', label: 'Shop', render: (r) => <b>{r.label}</b> }, { key: 'area', label: 'Area' }, { key: 'city', label: 'City' },
        { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'invoices', label: 'Invoices', align: 'right', render: (r) => r.invoices || '—' },
        { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
        { key: 'aov', label: 'Avg order', align: 'right', sortValue: (r) => (r.invoices ? r.net / r.invoices : null), render: (r) => (r.invoices ? inr(r.net / r.invoices) : '—') },
        { key: 'lastDate', label: 'Last purchase', render: (r) => dateText(r.lastDate) },
        { key: 'changePct', label: 'Change', align: 'right', render: (r) => (cmp ? (r.isNew ? <Badge kind="blue">new</Badge> : <Delta pct={r.changePct} />) : <span className="muted">—</span>) },
        { key: 'share', label: 'Share', align: 'right', render: (r) => (r.share != null ? r.share + '%' : '—') }, { key: 'topCategory', label: 'Top category' },
        { key: 'followUpStatus', label: 'Follow-up', render: (r) => (r.followUpStatus !== 'none' ? <Badge kind="amber">{STATUS[r.followUpStatus]}</Badge> : '') }]} />}
      {!cmp && data && <div className="muted" style={{ marginTop: 8 }}>Growth/decline needs a date range with an equally long earlier period in your data (e.g. “Last full month”).</div>}
    </Panel></>;
}

function Flags({ nav }) {
  const { meta } = useApp();
  const [days, setDays] = useState(String(meta?.inactiveDays || 60));
  const { data, loading, error } = useFetch('/api/analytics/follow-ups', { days }, { useFilters: true });
  const cols = (extra = []) => [{ key: 'shopName', label: 'Shop', render: (r) => <b>{r.shopName}</b> }, { key: 'area', label: 'Area' }, { key: 'lastPurchase', label: 'Last purchase', render: (r) => dateText(r.lastPurchase) }, { key: 'daysSince', label: 'Days since', align: 'right' }, { key: 'lifetimeNet', label: 'Lifetime sales', align: 'right', render: (r) => inr(r.lifetimeNet) }, ...extra, { key: 'reason', label: 'Why flagged', sortable: false }];
  const open = (r) => nav('/shops/' + encodeURIComponent(r.shopKey));
  return <><div className="alert info">These are <b>follow-up suggestions</b>, not predictions. A shop may be seasonal or have switched suppliers. Measured against the latest sale in your data ({data ? dateText(data.asOf) : '…'}).</div>
    <label className="f" style={{ maxWidth: 240, marginBottom: 12 }}>Inactivity threshold<select value={days} onChange={(e) => setDays(e.target.value)}>{['30', '60', '90', '120'].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
    <ErrorBox error={error} />{loading && !data ? <Loading /> : data && <>
      {data.notes.map((n) => <div key={n} className="alert warn">{n}</div>)}
      <Panel title={`No purchase in ${data.thresholdDays}+ days (${data.inactive.length})`}><DataTable dense rows={data.inactive.map((r) => ({ ...r, key: r.shopKey }))} columns={cols()} onRowClick={open} emptyText="No shops flagged." /></Panel>
      <Panel title={`Bought only once, nothing since (${data.oneAndDone.length})`}><DataTable dense rows={data.oneAndDone.map((r) => ({ ...r, key: r.shopKey }))} columns={cols()} onRowClick={open} emptyText="None." /></Panel>
      <Panel title={`Sales declined (${data.declining.length})`}><DataTable dense rows={data.declining.map((r) => ({ ...r, key: r.shopKey }))} columns={cols([{ key: 'changePct', label: 'Change', align: 'right', render: (r) => pctText(r.changePct) }])} onRowClick={open} emptyText="None, or not enough history to compare." /></Panel>
      <Panel title={`Buying less often (${data.lowFrequency.length})`}><DataTable dense rows={data.lowFrequency.map((r) => ({ ...r, key: r.shopKey }))} columns={cols()} onRowClick={open} emptyText="None, or not enough history to compare." /></Panel></>}</>;
}

function Reminders({ nav }) {
  const { data, loading, error, reload } = useFetch('/api/followups', {}, { useFilters: false });
  const done = async (r) => { await api.patch(`/api/shops/${encodeURIComponent(r.shopKey)}/reminders/${r.id}`, { done: true }); reload(); };
  return <Panel title="Open reminders"><ErrorBox error={error} />{loading && !data ? <Loading /> : <DataTable rows={(data || []).map((r) => ({ ...r, key: r.id }))} emptyText="No open reminders. Add them from a shop's page." columns={[
    { key: 'shopName', label: 'Shop', render: (r) => <a href="#s" onClick={(e) => { e.preventDefault(); nav('/shops/' + encodeURIComponent(r.shopKey)); }}>{r.shopName}</a> }, { key: 'text', label: 'Reminder' },
    { key: 'dueDate', label: 'Due', render: (r) => (r.dueDate ? <>{dateText(r.dueDate)} {r.overdue && <Badge kind="red">overdue</Badge>}</> : '—') }, { key: 'x', label: '', sortable: false, render: (r) => <button className="btn small" onClick={() => done(r)}>Mark done</button> }]} />}</Panel>;
}

export function ShopDetail() {
  const { key } = useParams();
  const { data, loading, error, reload } = useFetch(`/api/shops/${encodeURIComponent(key)}`);
  const [form, setForm] = useState(null), [msg, setMsg] = useState(null), [rem, setRem] = useState({ text: '', dueDate: '' }), [err, setErr] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <><Link to="/shops">‹ Shops</Link><ErrorBox error={error} /></>;
  const { shop, summary: s, prevSummary: p } = data;
  const f = form || { contactPerson: shop.contactPerson || '', phone: shop.phone || '', address: shop.address || '', salesperson: shop.salesperson || '', notes: shop.notes || '', followUpStatus: shop.followUpStatus || 'none' };
  const set = (k, v) => setForm({ ...f, [k]: v });
  const save = async () => { setErr(null); try { await api.put(`/api/shops/${encodeURIComponent(key)}`, f); setMsg('Saved.'); setForm(null); reload(); } catch (e) { setErr(e.message); } };
  const addRem = async () => { setErr(null); try { await api.post(`/api/shops/${encodeURIComponent(key)}/reminders`, rem); setRem({ text: '', dueDate: '' }); reload(); } catch (e) { setErr(e.message); } };
  return <>
    <Link to="/shops">‹ All shops</Link>
    <div className="page-head" style={{ marginTop: 6 }}><h1>{shop.name}</h1><p>{[shop.area, shop.city].filter(Boolean).join(', ') || 'Area not provided'}</p></div>
    <PeriodNote range={data.range} />
    <div className="kpis">
      <Kpi label="Net sales (period)" value={inr(s.netSales)} delta={p ? (p.netSales > 0 ? Math.round(((s.netSales - p.netSales) / p.netSales) * 1000) / 10 : null) : undefined} sub={p ? `previous: ${inr(p.netSales)}` : ''} />
      <Kpi label="Share of all sales" value={data.shareOfAllSales != null ? data.shareOfAllSales + '%' : '—'} sub="this period vs all shops, all time" />
      <Kpi label="Invoices" value={s.invoices ?? 'n/a'} sub={s.aov ? `avg ${inr(s.aov)}` : ''} /><Kpi label="Quantity" value={num(s.quantity)} />
      <Kpi label="Last purchase" value={dateText(data.lastPurchase)} sub={`first: ${dateText(data.frequency.firstPurchase)}`} />
      <Kpi label="Purchase frequency" value={data.frequency.avgDaysBetween ? `every ${data.frequency.avgDaysBetween} days` : '—'} sub={`${data.frequency.purchaseDays} purchase days`} />
      <Kpi label="Lifetime net sales" value={inr(data.lifetimeNet)} /></div>
    <div className="grid g2">
      <Panel title="Monthly sales">{data.monthly.length ? <ResponsiveContainer width="100%" height={240}><BarChart data={data.monthly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" tickFormatter={(x) => periodLabel(x, 'month')} /><YAxis tickFormatter={short} /><Tooltip formatter={(v) => inr(v)} labelFormatter={(x) => periodLabel(x, 'month')} /><Bar dataKey="net" fill="#2563eb" /></BarChart></ResponsiveContainer> : <div className="muted">No dated sales.</div>}</Panel>
      <Panel title="Category preferences"><Donut data={data.categories} /></Panel>
    </div>
    <Panel title="Products purchased"><DataTable dense rows={data.products} columns={[{ key: 'label', label: 'Product' }, { key: 'net', label: 'Net sales', align: 'right', render: (r) => inr(r.net) }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) }, { key: 'share', label: 'Share', align: 'right', render: (r) => r.share + '%' }]} /></Panel>
    <Panel title="Recent lines"><DataTable dense pageSize={10} rows={data.recent.map((r, i) => ({ ...r, key: i }))} columns={[{ key: 'date', label: 'Date', render: (r) => dateText(r.date) }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'product', label: 'Product' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'net', label: 'Net', align: 'right', render: (r) => inr(r.net, 2) }]} /></Panel>
    <div className="grid g2">
      <Panel title="Contact & notes" right={msg && <span className="muted">{msg}</span>}><ErrorBox error={err} />
        <div className="grid g2" style={{ gap: 8 }}>
          <label className="f">Contact person<input value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></label>
          <label className="f">Phone<input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="f">Assigned salesperson<input value={f.salesperson} onChange={(e) => set('salesperson', e.target.value)} /></label>
          <label className="f">Follow-up status<select value={f.followUpStatus} onChange={(e) => set('followUpStatus', e.target.value)}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
        <label className="f" style={{ marginTop: 8 }}>Address<input value={f.address} onChange={(e) => set('address', e.target.value)} /></label>
        <label className="f" style={{ marginTop: 8 }}>Notes<textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="actions"><button className="btn primary" onClick={save}>Save</button></div></Panel>
      <Panel title="Reminders">
        {(shop.reminders || []).length === 0 && <div className="muted">None yet.</div>}
        {(shop.reminders || []).map((r) => <div key={r._id} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={r.done} onChange={async (e) => { await api.patch(`/api/shops/${encodeURIComponent(key)}/reminders/${r._id}`, { done: e.target.checked }); reload(); }} />
          <span style={{ flex: 1, textDecoration: r.done ? 'line-through' : '' }}>{r.text} {r.dueDate && <span className="muted">· {dateText(r.dueDate)}</span>}</span><button className="btn small danger" onClick={async () => { await api.del(`/api/shops/${encodeURIComponent(key)}/reminders/${r._id}`); reload(); }}>✕</button></div>)}
        <div className="actions"><input placeholder="e.g. Call about restocking" value={rem.text} onChange={(e) => setRem({ ...rem, text: e.target.value })} style={{ flex: 1 }} /><input type="date" value={rem.dueDate} onChange={(e) => setRem({ ...rem, dueDate: e.target.value })} /><button className="btn" onClick={addRem}>Add</button></div></Panel>
    </div></>;
}
