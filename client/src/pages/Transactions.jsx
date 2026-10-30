import { useEffect, useState } from 'react';
import { useApp, useFetch } from '../state.jsx';
import { Badge, ErrorBox, Loading, NoData, PeriodNote, Panel } from '../components.jsx';
import { dateText, inr, num } from '../format.js';

export default function Transactions() {
  const { meta } = useApp();
  const [q, setQ] = useState(''), [qd, setQd] = useState(''), [page, setPage] = useState(1), [sort, setSort] = useState('date'), [dir, setDir] = useState('desc');
  useEffect(() => { const t = setTimeout(() => { setQd(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, loading, error } = useFetch('/api/transactions', { page, pageSize: 50, sort, dir, q: qd }, { skip: !meta?.hasData });
  if (meta && !meta.hasData) return <NoData />;
  const th = (key, label, cls = '') => <th className={'sortable ' + cls} onClick={() => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('desc'); } setPage(1); }}>{label}{sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>;
  return <>
    <div className="page-head"><h1>Sales transactions</h1><p>Every imported line, traceable to its row in your file.</p></div>
    {data && <PeriodNote range={data.range} />}
    <Panel title={data ? `${num(data.total)} lines · net ${inr(data.totalNet, 2)}` : 'Lines'} right={<input placeholder="Search shop, product, invoice…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <ErrorBox error={error} />{loading && !data ? <Loading /> : data && <>
        <div className="table-wrap"><table className="table dense"><thead><tr>{th('date', 'Date')}{th('invoice', 'Invoice')}{th('shop', 'Shop')}{th('area', 'Area')}{th('product', 'Product')}<th>Category</th>{th('quantity', 'Qty', 'right')}<th className="right">Discount</th>{th('net', 'Net sales', 'right')}<th>Row</th></tr></thead>
          <tbody>{data.rows.map((t) => <tr key={t.id}><td className="nowrap">{dateText(t.date)}</td><td>{t.invoiceNo || '—'}</td><td title={t.originalShop !== t.shop ? `Original: ${t.originalShop}` : ''}>{t.shop}</td><td>{t.area || '—'}</td><td>{t.product || '—'}</td><td>{t.category}</td><td className="right">{t.quantity ?? '—'}</td><td className="right">{t.discount ? inr(t.discount, 2) : '—'}</td><td className="right">{inr(t.net, 2)} {t.isReturn && <Badge kind="amber">return</Badge>}</td><td className="muted">{t.sourceRow}</td></tr>)}</tbody></table></div>
        {data.rows.length === 0 && <div className="muted pad">No lines match.</div>}
        <div className="pager"><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button><span>Page {page} of {Math.max(1, data.pages)}</span><button className="btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next ›</button></div></>}
    </Panel></>;
}
