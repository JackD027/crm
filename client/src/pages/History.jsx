import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useFetch } from '../state.jsx';
import { Badge, DataTable, ErrorBox, Loading, Panel } from '../components.jsx';
import { dateText, inr, num } from '../format.js';

const KIND = { completed: 'green', undone: 'gray', failed: 'red', replaced: 'amber', importing: 'blue' };
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function History() {
  const { data, loading, error } = useFetch('/api/imports', {}, { useFilters: false });
  const nav = useNavigate();
  return <><div className="page-head"><h1>Import history</h1><p>Every file imported, with the option to undo one import without touching the others.</p></div>
    <ErrorBox error={error} />{loading && !data ? <Loading /> : <Panel><DataTable rows={(data || []).map((b) => ({ ...b, key: b._id }))} onRowClick={(r) => nav('/history/' + r._id)} emptyText="No imports yet." columns={[
      { key: 'createdAt', label: 'Imported', render: (r) => when(r.createdAt) }, { key: 'fileName', label: 'File', render: (r) => <b>{r.fileName}</b> }, { key: 'sheet', label: 'Sheet' }, { key: 'importType', label: 'Type' },
      { key: 'sourceRows', label: 'Source rows', align: 'right' }, { key: 'importedCount', label: 'Imported', align: 'right' }, { key: 'skippedCount', label: 'Skipped', align: 'right' }, { key: 'errorCount', label: 'Rejected', align: 'right' },
      { key: 'totalNetSales', label: 'Net sales', align: 'right', render: (r) => inr(r.totalNetSales) }, { key: 'status', label: 'Status', render: (r) => <Badge kind={KIND[r.status]}>{r.status}</Badge> }]} /></Panel>}</>;
}

export function HistoryDetail() {
  const { id } = useParams();
  const { refresh } = useApp();
  const { data: b, loading, error, reload } = useFetch('/api/imports/' + id, {}, { useFilters: false });
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const undo = async () => {
    if (!window.confirm(`Remove the ${num(b.liveRecordCount)} records from “${b.fileName}”? Other imports are not affected. This cannot be redone, but you can import the file again.`)) return;
    setBusy(true); setErr(null);
    try { await api.post(`/api/imports/${id}/undo`, { confirm: true }); refresh(); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <><Link to="/history">‹ Import history</Link>
    <div className="page-head" style={{ marginTop: 6 }}><h1>{b.fileName} <Badge kind={KIND[b.status]}>{b.status}</Badge></h1><p>Imported {when(b.createdAt)} · worksheet “{b.sheet}” · {b.importType} · mode: {b.mode}</p></div>
    <ErrorBox error={err || (b.failureReason && 'Failed: ' + b.failureReason)} />
    <div className="stats"><div className="stat"><b>{num(b.sourceRows)}</b>source rows</div><div className="stat good"><b>{num(b.importedCount)}</b>imported</div><div className="stat"><b>{num(b.skippedCount)}</b>duplicates skipped</div><div className="stat bad"><b>{num(b.errorCount)}</b>rejected</div><div className="stat"><b>{num(b.warningCount)}</b>warnings</div><div className="stat"><b>{inr(b.totalNetSales)}</b>net sales</div><div className="stat"><b>{b.dateMin ? `${dateText(b.dateMin)} – ${dateText(b.dateMax)}` : '—'}</b>dates</div></div>
    <div className="actions" style={{ marginBottom: 14 }}>{b.status === 'completed' && <button className="btn danger" disabled={busy} onClick={undo}>Undo this import</button>}
      <a className="btn" href={`/api/reports/export?type=errors&format=csv&batchId=${id}`}>⬇ Error report (CSV)</a></div>
    <div className="grid g2"><Panel title="Column mapping used"><table className="table dense"><tbody>{Object.entries(b.mapping || {}).filter(([, v]) => v).map(([k, v]) => <tr key={k}><td>{k}</td><td><b>{v}</b></td></tr>)}</tbody></table></Panel>
      <Panel title="Calculation rules applied"><ul style={{ margin: 0, paddingLeft: 18 }}>{(b.rules || []).map((r) => <li key={r}>{r}</li>)}</ul></Panel></div>
    <Panel title="Warnings and errors recorded"><DataTable dense pageSize={15} emptyText="None recorded." rows={(b.issueLog || []).map((e, i) => ({ ...e, key: i }))} columns={[{ key: 'row', label: 'Row' }, { key: 'level', label: 'Level' }, { key: 'code', label: 'Code' }, { key: 'message', label: 'Details', sortable: false }]} /></Panel></>;
}
