import { useApp, useFetch } from '../state.jsx';
import { ErrorBox, Loading, NoData, PeriodNote, Panel } from '../components.jsx';

export default function Insights() {
  const { meta } = useApp();
  const { data, loading, error } = useFetch('/api/insights', {}, { skip: !meta?.hasData });
  if (meta && !meta.hasData) return <NoData />;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return <>
    <div className="page-head"><h1>Business insights</h1><p>Plain rules applied to your actual numbers. They describe what the data shows; they do not explain why.</p></div>
    <PeriodNote range={data.range} />
    {data.insights.length === 0 && <div className="alert info">No insights could be generated for the current selection.</div>}
    {data.insights.map((i) => <Panel key={i.id} className="insight">
      <h3>{i.title}</h3><p>{i.text}</p>
      <div className="muted" style={{ fontSize: 12 }}><b>{i.metric}:</b> {i.value}{i.comparison ? ` · ${i.comparison}` : ''} · {i.dateRange}</div>
      <details><summary>How this was determined</summary>{i.method}</details></Panel>)}
    {data.unavailable.length > 0 && <Panel title="Insights that could not be generated"><ul style={{ margin: 0 }}>{data.unavailable.map((u) => <li key={u.id}><b>{u.title}:</b> {u.reason}</li>)}</ul></Panel>}
  </>;
}
