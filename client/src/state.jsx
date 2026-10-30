import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
const BLANK = { range: null, from: '', to: '', shop: '', area: '', city: '', product: '', category: '', salesperson: '' };

export function AppProvider({ children }) {
  const [meta, setMeta] = useState(null), [metaError, setMetaError] = useState(null), [version, setVersion] = useState(0);
  const [filters, setFilters] = useState(BLANK);
  useEffect(() => {
    api.get('/api/meta').then((m) => { setMeta(m); setMetaError(null); setFilters((f) => (f.range || f.from || f.to ? f : { ...f, range: m.defaultRange || 'all' })); }).catch((e) => setMetaError(e.message));
  }, [version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const query = useMemo(() => {
    const p = {};
    if (filters.from || filters.to) { if (filters.from) p.from = filters.from; if (filters.to) p.to = filters.to; } else p.range = filters.range || 'all';
    for (const k of ['shop', 'area', 'city', 'product', 'category', 'salesperson']) if (filters[k]) p[k] = filters[k];
    return p;
  }, [filters]);
  const resetFilters = () => setFilters({ ...BLANK, range: meta?.defaultRange || 'all' });
  return <Ctx.Provider value={{ meta, metaError, filters, setFilters, query, resetFilters, version, refresh }}>{children}</Ctx.Provider>;
}

export function useFetch(path, extra = {}, { useFilters = true, skip = false } = {}) {
  const { query, version } = useApp();
  const params = { ...(useFilters ? query : {}), ...extra };
  const key = path + JSON.stringify(params) + version + skip;
  const [st, setSt] = useState({ data: null, loading: !skip, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (skip) return undefined;
    let dead = false;
    setSt((s) => ({ ...s, loading: true, error: null }));
    api.get(path, params).then((data) => !dead && setSt({ data, loading: false, error: null })).catch((error) => !dead && setSt({ data: null, loading: false, error: error.message }));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { ...st, reload: () => setTick((t) => t + 1) };
}
