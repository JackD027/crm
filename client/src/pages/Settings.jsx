import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useFetch } from '../state.jsx';
import { DataTable, ErrorBox, Loading, Panel } from '../components.jsx';

export default function Settings() {
  const { meta, refresh } = useApp();
  const { data, error, reload } = useFetch('/api/settings', {}, { useFilters: false });
  const [f, setF] = useState(null), [msg, setMsg] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;
  const d = f.importDefaults || {};
  const setD = (k, v) => setF({ ...f, importDefaults: { ...d, [k]: v } });
  const save = async () => { setErr(null); setMsg(null); try { await api.put('/api/settings', { businessName: f.businessName, defaultRange: f.defaultRange, inactiveDays: Number(f.inactiveDays), declinePct: Number(f.declinePct), importDefaults: d }); setMsg('Saved.'); refresh(); reload(); } catch (e) { setErr(e.message); } };
  return <><div className="page-head"><h1>Settings</h1></div>
    <Panel title="Business & analysis" right={msg && <span className="muted">{msg}</span>}><ErrorBox error={err} />
      <div className="grid g3">
        <label className="f">Business name<input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></label>
        <label className="f">Currency<select value="INR" disabled><option>INR (₹)</option></select></label>
        <label className="f">Default date range<select value={f.defaultRange} onChange={(e) => setF({ ...f, defaultRange: e.target.value })}>{[['all', 'All dates'], ['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days'], ['180', 'Last 180 days'], ['365', 'Last 365 days'], ['lastmonth', 'Last full month']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Inactivity threshold (days)<input type="number" min="7" max="365" value={f.inactiveDays} onChange={(e) => setF({ ...f, inactiveDays: e.target.value })} /></label>
        <label className="f">Flag a shop when sales fall by (%)<input type="number" min="5" max="90" value={f.declinePct} onChange={(e) => setF({ ...f, declinePct: e.target.value })} /></label></div>
      <h3 style={{ margin: '16px 0 6px' }}>Import defaults</h3>
      <div className="grid g3">
        <label className="f">Date order<select value={d.dateOrder} onChange={(e) => setD('dateOrder', e.target.value)}><option value="DMY">Day / Month / Year</option><option value="MDY">Month / Day / Year</option></select></label>
        <label className="f">Discount values<select value={d.discountType} onChange={(e) => setD('discountType', e.target.value)}><option value="amount">Rupee amounts</option><option value="percent">Percentages</option></select></label>
        <label className="f">Negative amounts<select value={d.negativeHandling} onChange={(e) => setD('negativeHandling', e.target.value)}><option value="returns">Treat as returns</option><option value="reject">Reject</option></select></label>
        <label className="f">Invalid dates<select value={d.invalidDates} onChange={(e) => setD('invalidDates', e.target.value)}><option value="reject">Reject row</option><option value="import_without_date">Import without date</option></select></label>
        <label className="f">Rows already imported<select value={d.duplicateStrategy} onChange={(e) => setD('duplicateStrategy', e.target.value)}><option value="skip">Skip</option><option value="keep">Import again</option></select></label></div>
      <div className="actions"><button className="btn primary" onClick={save}>Save settings</button></div></Panel>
    <Categories refresh={refresh} /><Aliases meta={meta} refresh={refresh} /><Profiles />
    <Panel title="How numbers are defined"><ul style={{ margin: 0, paddingLeft: 18 }}>
      <li><b>Net sales</b> = the net amount in your file, or quantity × rate − discount (discount subtracted once). Returns are negative and reduce net sales. Tax is neither added nor removed.</li>
      <li><b>Average order value</b> = sales before returns ÷ distinct invoice numbers.</li><li><b>Gross profit</b> = net sales − unit cost × quantity, only when cost is available for ≥ 90% of sales.</li>
      <li><b>Previous period</b> = the immediately preceding period of equal length (or the previous calendar month for “Last full month”), shown only if fully covered by your data. Periods end at your latest sale date, not today.</li>
      <li><b>Inactive shop</b> = no purchase in the threshold days before the latest sale date, and only when your data spans at least that long.</li></ul></Panel>
    <Panel title="Backup & restore"><p style={{ marginTop: 0 }}>From the <code>server</code> folder in a terminal: <code>npm run backup</code> writes one JSON file with all data; <code>npm run restore -- backup-file.json --yes</code> replaces current data with it. See the README for <code>mongodump</code> alternatives. Data stays on this computer.</p></Panel></>;
}

function Categories({ refresh }) {
  const { data, reload } = useFetch('/api/categories', {}, { useFilters: false });
  const [name, setName] = useState(''), [ren, setRen] = useState({ from: '', to: '' }), [err, setErr] = useState(null);
  const go = async (fn) => { setErr(null); try { await fn(); setName(''); setRen({ from: '', to: '' }); reload(); refresh(); } catch (e) { setErr(e.message); } };
  return <Panel title="Categories"><ErrorBox error={err} /><div className="muted" style={{ marginBottom: 8 }}>{(data || []).join(' · ') || 'No categories yet.'}</div>
    <div className="actions" style={{ marginTop: 0 }}><input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" disabled={!name} onClick={() => go(() => api.post('/api/categories', { name }))}>Add</button></div>
    <div className="actions"><select value={ren.from} onChange={(e) => setRen({ ...ren, from: e.target.value })}><option value="">Rename / merge…</option>{(data || []).map((c) => <option key={c}>{c}</option>)}</select><span>→</span><input placeholder="New name (existing name merges)" value={ren.to} onChange={(e) => setRen({ ...ren, to: e.target.value })} /><button className="btn" disabled={!ren.from || !ren.to} onClick={() => go(() => api.post('/api/categories/rename', ren))}>Apply</button></div>
    <div className="muted" style={{ fontSize: 12 }}>To categorise products, use the Products & Categories page.</div></Panel>;
}

function Aliases({ meta, refresh }) {
  const { data, reload } = useFetch('/api/aliases', {}, { useFilters: false });
  const [m, setM] = useState({ type: 'shop', fromKey: '', toKey: '' }), [err, setErr] = useState(null);
  const opts = (m.type === 'shop' ? meta?.options?.shops : meta?.options?.products) || [];
  const merge = async (x) => { if (!window.confirm('Merge these? Their sales are combined under the second name. Future imports will follow this rule.')) return; setErr(null); try { await api.post('/api/aliases', x); setM({ ...m, fromKey: '', toKey: '' }); reload(); refresh(); } catch (e) { setErr(e.message); } };
  return <Panel title="Shop & product aliases"><div className="muted" style={{ marginBottom: 8 }}>Names that differ only in capitalisation or spacing merge automatically. Anything else is merged only when <b>you</b> confirm it.</div><ErrorBox error={err} />
    {data?.suggestions?.length > 0 && <><b>Possible duplicates to review</b>{data.suggestions.map((s, i) => <div key={i} style={{ padding: '4px 0' }}>{s.type}: {s.items.map((x) => x.name).join('  ≟  ')} <button className="btn small" onClick={() => merge({ type: s.type, fromKey: s.items[1].key, toKey: s.items[0].key })}>Merge into “{s.items[0].name}”</button></div>)}</>}
    <div className="actions"><select value={m.type} onChange={(e) => setM({ type: e.target.value, fromKey: '', toKey: '' })}><option value="shop">Shop</option><option value="product">Product</option></select>
      <select value={m.fromKey} onChange={(e) => setM({ ...m, fromKey: e.target.value })}><option value="">Merge this…</option>{opts.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select><span>into</span>
      <select value={m.toKey} onChange={(e) => setM({ ...m, toKey: e.target.value })}><option value="">…this one</option>{opts.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select><button className="btn" disabled={!m.fromKey || !m.toKey || m.fromKey === m.toKey} onClick={() => merge(m)}>Merge</button></div>
    {data?.aliases?.length > 0 && <DataTable dense rows={data.aliases.map((a) => ({ ...a, key: a._id }))} columns={[{ key: 'type', label: 'Type' }, { key: 'fromName', label: 'Name' }, { key: 'toName', label: 'Merged into' }, { key: 'x', label: '', sortable: false, render: (a) => <button className="btn small" onClick={async () => { await api.del('/api/aliases/' + a._id); reload(); }}>Forget rule</button> }]} />}</Panel>;
}

function Profiles() {
  const { data, reload } = useFetch('/api/imports/profiles', {}, { useFilters: false });
  return <Panel title="Saved column-mapping profiles"><DataTable dense rows={(data || []).map((p) => ({ ...p, key: p._id }))} emptyText="None yet. They are saved when you import with “Remember this column mapping” ticked." columns={[{ key: 'name', label: 'Name' }, { key: 'importType', label: 'Type' }, { key: 'headers', label: 'Columns', sortable: false, render: (p) => p.headers.join(', ') }, { key: 'x', label: '', sortable: false, render: (p) => <button className="btn small danger" onClick={async () => { await api.del('/api/imports/profiles/' + p._id); reload(); }}>Delete</button> }]} /></Panel>;
}
