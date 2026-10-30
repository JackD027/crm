import { useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './state.jsx';
import { useAuth } from './AuthGate.jsx';
import { dateText } from './format.js';
import Dashboard from './pages/Dashboard.jsx';
import Import from './pages/Import.jsx';
import Transactions from './pages/Transactions.jsx';
import { Shops, ShopDetail } from './pages/Shops.jsx';
import { Areas, AreaDetail } from './pages/Areas.jsx';
import Products from './pages/Products.jsx';
import Insights from './pages/Insights.jsx';
import Reports from './pages/Reports.jsx';
import { History, HistoryDetail } from './pages/History.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['Analytics', [['/', 'Dashboard'], ['/shops', 'Shops / Customers'], ['/areas', 'Areas / Markets'], ['/products', 'Products & Categories'], ['/insights', 'Business Insights']]],
  ['Data', [['/import', 'Import Sales Data'], ['/transactions', 'Sales Transactions'], ['/history', 'Import History']]],
  ['Output', [['/reports', 'Reports & Exports'], ['/settings', 'Settings']]],
];
const RANGES = [['all', 'All dates'], ['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days'], ['180', 'Last 180 days'], ['365', 'Last 365 days'], ['lastmonth', 'Last full month']];
const FILTERS = [['shop', 'Shop', 'shops'], ['area', 'Area', 'areas'], ['city', 'City', 'cities'], ['product', 'Product', 'products'], ['category', 'Category', 'categories'], ['salesperson', 'Salesperson', 'salespersons']];

function TopBar() {
  const { meta, filters, setFilters, resetFilters } = useApp();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const analytic = !['/import', '/history', '/settings', '/reports'].some((p) => loc.pathname.startsWith(p)) || loc.pathname.startsWith('/reports');
  const custom = filters.from || filters.to;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const optLabel = (k, v) => { const list = meta?.options?.[FILTERS.find((x) => x[0] === k)[2]] || []; const hit = list.find((o) => o.key === v); return hit ? hit.name : v; };
  const active = FILTERS.filter(([k]) => filters[k]);
  return <div className="topbar">
    <div className="row">
      <div className="title">{meta?.businessName || 'Sales Analytics'} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· Sales Analytics CRM</span></div>
      <button className="btn" onClick={logout}>Sign out</button>
      {meta?.hasData && analytic && <>
        <select value={custom ? 'custom' : filters.range || 'all'} onChange={(e) => setFilters((f) => ({ ...f, from: '', to: '', range: e.target.value === 'custom' ? 'all' : e.target.value }))}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}{custom && <option value="custom">Custom range</option>}
        </select>
        <input type="date" value={filters.from} min={meta.anchors.min} max={meta.anchors.max} onChange={(e) => set('from', e.target.value)} title="From" />
        <input type="date" value={filters.to} min={meta.anchors.min} max={meta.anchors.max} onChange={(e) => set('to', e.target.value)} title="To" />
        <button className="btn" onClick={() => setOpen(!open)}>Filters{active.length ? ` (${active.length})` : ''}</button>
        <button className="btn" onClick={resetFilters}>Reset</button>
      </>}
    </div>
    {meta?.hasData && analytic && <div className="chips"><span className="muted" style={{ fontSize: 12 }}>Data available: {dateText(meta.anchors.min)} – {dateText(meta.anchors.max)} (periods are measured up to the latest sale)</span>
      {active.map(([k, l]) => <span key={k} className="chip">{l}: {optLabel(k, filters[k])} <a href="#x" onClick={(e) => { e.preventDefault(); set(k, ''); }}>✕</a></span>)}</div>}
    {open && meta && <div className="filters">{FILTERS.map(([k, l, src]) => <label className="f" key={k}>{l}
      <select value={filters[k]} onChange={(e) => set(k, e.target.value)}><option value="">All</option>
        {(meta.options[src] || []).map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.key} value={o.key}>{o.name}</option>))}</select></label>)}</div>}
  </div>;
}

export default function App() {
  const { metaError } = useApp();
  return <div className="layout">
    <nav className="sidebar"><div className="brand">📈 Sales Analytics CRM</div>
      {NAV.map(([g, items]) => <div key={g}><div className="group">{g}</div>{items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}</div>)}
    </nav>
    <div className="main"><TopBar />
      <div className="content">
        {metaError && <div className="alert error"><b>Cannot load data.</b> {metaError}<br />Check that MongoDB is running and the backend is started (see README). You can still open <a href="/import">Import</a> to preview files.</div>}
        <Routes>
          <Route path="/" element={<Dashboard />} /><Route path="/import" element={<Import />} /><Route path="/transactions" element={<Transactions />} />
          <Route path="/shops" element={<Shops />} /><Route path="/shops/:key" element={<ShopDetail />} />
          <Route path="/areas" element={<Areas />} /><Route path="/areas/:name" element={<AreaDetail />} />
          <Route path="/products" element={<Products />} /><Route path="/insights" element={<Insights />} /><Route path="/reports" element={<Reports />} />
          <Route path="/history" element={<History />} /><Route path="/history/:id" element={<HistoryDetail />} /><Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </div>
  </div>;
}
