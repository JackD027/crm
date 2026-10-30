import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { pctText } from './format.js';

export const Loading = ({ text = 'Loading…' }) => <div className="loading"><span className="spinner" /> {text}</div>;
export const ErrorBox = ({ error }) => (error ? <div className="alert error">{error}</div> : null);
export const Empty = ({ title, children }) => <div className="empty"><h3>{title}</h3><div>{children}</div></div>;
export const NoData = () => <Empty title="No sales data yet"><p>Import an Excel or CSV file to see your analytics.</p><Link className="btn primary" to="/import">Import sales data</Link></Empty>;

export function Panel({ title, right, children, className = '' }) {
  return <section className={'panel ' + className}>{(title || right) && <header><h3>{title}</h3><div>{right}</div></header>}{children}</section>;
}

export function Delta({ pct }) {
  if (pct === null || pct === undefined) return null;
  return <span className={'delta ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : '')}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {pctText(pct)}</span>;
}

export function Kpi({ label, value, sub, delta, note }) {
  return <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-sub">{delta !== undefined && <Delta pct={delta} />} {sub}</div>{note && <div className="kpi-note">{note}</div>}</div>;
}

export function PeriodNote({ range }) {
  if (!range) return null;
  return <div className="period-note">
    <b>Period:</b> {range.text}
    {range.comparisonAvailable ? <> · <b>Compared with:</b> {range.comparisonText}</> : <span className="muted"> · {range.comparisonNote}</span>}
  </div>;
}

export function DataTable({ columns, rows, initialSort, pageSize = 15, onRowClick, emptyText = 'Nothing to show.', dense }) {
  const [sort, setSort] = useState(initialSort || null), [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
    return [...rows].sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1); });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = sorted.slice(cur * pageSize, cur * pageSize + pageSize);
  if (!rows.length) return <div className="muted pad">{emptyText}</div>;
  return <div>
    <div className="table-wrap"><table className={'table ' + (dense ? 'dense' : '')}>
      <thead><tr>{columns.map((c) => <th key={c.key} className={(c.align || '') + (c.sortable === false ? '' : ' sortable')} onClick={() => c.sortable !== false && setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>{c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
      <tbody>{slice.map((r, i) => <tr key={r.key ?? r.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>{columns.map((c) => <td key={c.key} className={c.align || ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody>
    </table></div>
    {pages > 1 && <div className="pager"><button className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button><span>Page {cur + 1} of {pages} · {sorted.length} rows</span><button className="btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button></div>}
  </div>;
}

export const Badge = ({ kind = 'gray', children }) => <span className={'badge ' + kind}>{children}</span>;
