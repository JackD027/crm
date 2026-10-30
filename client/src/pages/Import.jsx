import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Badge, DataTable, ErrorBox, Panel } from '../components.jsx';
import { dateText, inr, num } from '../format.js';

const STEPS = ['1 File', '2 Preview', '3 Map columns', '4 Validate', '5 Review & confirm', '6 Done'];
const REQ = {
  transaction: ['shopName', 'product', 'netSales'], invoice: ['shopName', 'netSales'], aggregated: ['netSales'],
};
const RECOMMENDED = ['date', 'invoiceNo', 'area', 'category'];
const GROUPS = [['Who & where', ['shopName', 'shopId', 'area', 'city', 'salesperson']], ['What', ['product', 'productId', 'category']], ['When & which bill', ['date', 'invoiceNo', 'lineId']], ['How much', ['quantity', 'unitPrice', 'grossAmount', 'discount', 'netSales']], ['Optional', ['costPrice', 'paymentStatus']]];
const CODE_LABEL = { missing_required: 'Missing required value', invalid_date: 'Invalid / missing date', invalid_number: 'Invalid number', no_amount: 'No usable amount', negative_value: 'Negative value rejected', calc_mismatch: 'Net differs from qty × rate − discount', repeated_invoice_total: 'Repeated invoice total', duplicate_existing: 'Already imported', possible_duplicate_row: 'Identical row in this file', return_row: 'Treated as return', invalid_cost: 'Cost ignored' };

export default function Import() {
  const { refresh, meta } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [step, setStep] = useState(1);
  const [pv, setPv] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importType, setImportType] = useState('transaction');
  const [options, setOptions] = useState({});
  const [headerRow, setHeaderRow] = useState('');
  const [val, setVal] = useState(null);
  const [mode, setMode] = useState('append');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [dupe, setDupe] = useState('skip');
  const [saveProfile, setSaveProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errDetails, setErrDetails] = useState(null);
  const [result, setResult] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef();

  const adopt = (p) => {
    setPv(p); setMapping(p.suggestion.mapping); setImportType(p.suggestion.importType); setOptions({ ...p.defaults, repeatedTotals: null }); setHeaderRow(String(p.headerRow)); setVal(null); setStep(2);
  };
  useEffect(() => { if (loc.state?.preview) { adopt(loc.state.preview); window.history.replaceState({}, ''); } }, []); // eslint-disable-line

  const run = async (fn) => { setBusy(true); setError(null); setErrDetails(null); try { return await fn(); } catch (e) { setError(e.message); setErrDetails(e.details); return null; } finally { setBusy(false); } };
  const upload = (file) => run(async () => { setResult(null); adopt(await api.upload('/api/imports/preview', file)); });
  const demo = () => run(async () => { setResult(null); adopt(await api.post('/api/imports/demo-preview')); });
  const changeSheet = (sheet, hr) => run(async () => {
    const p = await api.post('/api/imports/preview/sheet', { token: pv.token, sheet, headerRow: hr || undefined });
    setPv(p); setMapping(p.suggestion.mapping); setImportType(p.suggestion.importType); setHeaderRow(String(p.headerRow)); setOptions((o) => ({ ...p.defaults, repeatedTotals: o.repeatedTotals ?? null }));
  });
  const body = (extra = {}) => ({ token: pv.token, sheet: pv.sheet, headerRow: Number(headerRow) || undefined, mapping, importType, options, ...extra });
  const validate = (opts = options) => run(async () => { const v = await api.post('/api/imports/validate', body({ options: opts })); setVal(v); setStep(4); return v; });
  const commit = () => run(async () => {
    const r = await api.post('/api/imports/commit', body({ mode, confirmReplace: mode === 'replace' ? confirmReplace : undefined, options: { ...options, duplicateStrategy: dupe }, saveProfile: saveProfile ? pv.fileName.replace(/\.[^.]+$/, '') : undefined }));
    setResult(r); refresh(); setStep(6);
  });
  const reset = () => { setPv(null); setVal(null); setResult(null); setError(null); setStep(1); setMode('append'); setConfirmReplace(false); };

  const missing = useMemo(() => {
    if (!pv) return [];
    const m = [];
    const has = (k) => !!mapping[k];
    if (importType !== 'aggregated' && !has('shopName') && !has('shopId')) m.push('Shop / customer name');
    if (importType === 'transaction' && !has('product') && !has('productId')) m.push('Product name');
    if (importType === 'aggregated' && !['shopName', 'shopId', 'area', 'product', 'productId', 'category'].some(has)) m.push('At least one of shop / area / product / category');
    if (!(has('netSales') || has('grossAmount') || (has('quantity') && has('unitPrice')))) m.push('A sales amount (Net sales, or Gross amount, or Quantity + Unit price)');
    return m;
  }, [pv, mapping, importType]);

  return <>
    <div className="page-head"><h1>Import sales data</h1><p>Nothing is saved until you confirm at step 5.</p></div>
    <div className="steps">{STEPS.map((s, i) => <span key={s} className={'step ' + (i + 1 === step ? 'on' : i + 1 < step ? 'done' : '')}>{s}</span>)}</div>
    <ErrorBox error={error} />
    {errDetails?.errors?.length > 0 && <div className="alert error"><ul>{errDetails.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}

    {step === 1 && <>
      <div className={'drop ' + (over ? 'over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
        <h2>Drag & drop your Excel or CSV file here</h2><p className="muted">.xlsx, .xls or .csv — up to 100 MB. Your file stays on this computer.</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        <button className="btn primary" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Reading file…' : 'Browse files'}</button>
      </div>
      <Panel title="Need a starting point?"><div className="actions" style={{ marginTop: 0 }}>
        <a className="btn" href="/api/imports/template.xlsx">⬇ Sales Excel template</a><a className="btn" href="/api/imports/demo.xlsx">⬇ Demo sales (Excel, 84 rows)</a><a className="btn" href="/api/imports/demo.csv">⬇ Demo sales (CSV)</a>
        <button className="btn" onClick={demo} disabled={busy}>Load demo data into the wizard</button></div></Panel>
    </>}

    {step >= 2 && step <= 5 && pv && <div className="alert info"><b>{pv.fileName}</b> · {(pv.fileSize / 1024).toFixed(0)} KB · worksheet “{pv.sheet}” · {num(pv.totalRows)} data rows</div>}

    {step === 2 && pv && <Panel title="Select worksheet and check the preview">
      <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
        <label className="f" style={{ minWidth: 220 }}>Worksheet<select value={pv.sheet} disabled={busy} onChange={(e) => changeSheet(e.target.value)}>{pv.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>)}</select></label>
        <label className="f" style={{ width: 150 }}>Header row number<input type="number" min="1" value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} /></label>
        <button className="btn" disabled={busy} onClick={() => changeSheet(pv.sheet, headerRow)}>Apply</button>
      </div>
      {pv.warnings.map((w) => <div key={w} className="alert warn">{w}</div>)}
      {pv.totalRows === 0 ? <div className="alert error">This worksheet has no data rows under the header. Pick another worksheet or header row.</div> :
        <><div className="muted" style={{ marginBottom: 6 }}>First {pv.previewRows.length} of {num(pv.totalRows)} rows:</div>
          <div className="table-wrap"><table className="table dense"><thead><tr><th>Row</th>{pv.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{pv.previewRows.map((r) => <tr key={r.n}><td className="muted">{r.n}</td>{r.v.map((c, i) => <td key={i}>{c === null ? '' : String(c)}</td>)}</tr>)}</tbody></table></div></>}
      <div className="actions"><button className="btn primary" disabled={!pv.totalRows} onClick={() => setStep(3)}>Continue</button><button className="btn" onClick={reset}>Cancel</button></div>
    </Panel>}

    {step === 3 && pv && <Panel title="Match your columns to the app's fields">
      <div className="grid g2" style={{ marginBottom: 10 }}>
        <label className="f">What does each row represent?
          <select value={importType} onChange={(e) => setImportType(e.target.value)}>{Object.entries(pv.importTypes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <div className="muted" style={{ fontSize: 12 }}>Detected automatically — please confirm. {importType === 'aggregated' && 'Aggregated data stays at its original level; invoice and purchase history will not be inferred.'}{importType === 'invoice' && ' Product analytics need a product column.'}</div>
      </div>
      {pv.savedProfile && <div className="alert info">{pv.savedProfile.note} (profile “{pv.savedProfile.name}”)</div>}
      {pv.suggestion.ambiguousColumns.map((a) => <div key={a.column} className="alert warn">“{a.column}” is ambiguous (it could be {a.couldBe.join(' or ')}). It was <b>not</b> mapped automatically — choose below if it is correct.</div>)}
      {missing.length > 0 && <div className="alert error">Still needed: {missing.join('; ')}.</div>}
      {GROUPS.map(([g, keys]) => <div key={g}><h3 style={{ margin: '14px 0 6px' }}>{g}</h3>
        <table className="table dense"><thead><tr><th style={{ width: '22%' }}>App field</th><th style={{ width: '30%' }}>Your Excel column</th><th>Status</th><th>Sample values</th></tr></thead><tbody>
          {keys.map((k) => { const f = pv.fields.find((x) => x.key === k); const det = pv.suggestion.details[k]; const sel = mapping[k] || '';
            const required = REQ[importType].includes(k) || (importType !== 'aggregated' && k === 'shopId' && false);
            return <tr key={k}><td><b>{f.label}</b></td>
              <td><select value={sel} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value || null }))}><option value="">— not used —</option>{pv.headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></td>
              <td>{required ? <Badge kind="red">Required{k === 'netSales' ? '*' : ''}</Badge> : RECOMMENDED.includes(k) ? <Badge kind="amber">Recommended</Badge> : <Badge>Optional</Badge>}{' '}
                {sel && det?.confidence === 'high' && <Badge kind="green">auto · high</Badge>}{sel && det?.confidence === 'medium' && <Badge kind="amber">auto · check</Badge>}{sel && det?.confidence === 'saved' && <Badge kind="blue">saved profile</Badge>}{!sel && det?.confidence === 'ambiguous' && <Badge kind="red">ambiguous: {det.candidates.join(' / ')}</Badge>}
                {k === 'netSales' && <div className="muted" style={{ fontSize: 11 }}>*or Gross amount, or Quantity × Unit price</div>}</td>
              <td className="muted" style={{ fontSize: 12 }}>{sel ? (pv.sampleValues[sel] || []).join(' · ') : ''}</td></tr>; })}
        </tbody></table></div>)}
      <h3 style={{ margin: '16px 0 6px' }}>Unused columns</h3>
      <div className="muted">{pv.headers.filter((h) => !Object.values(mapping).includes(h)).join(', ') || 'None — every column is mapped.'}</div>
      <h3 style={{ margin: '16px 0 6px' }}>How should values be read?</h3>
      <div className="grid g3">
        <label className="f">Dates like 05/03/2026 mean<select value={options.dateOrder} onChange={(e) => setOptions({ ...options, dateOrder: e.target.value })}><option value="DMY">5 March (day / month) — India</option><option value="MDY">3 May (month / day)</option></select></label>
        <label className="f">Discount column holds<select value={options.discountType} onChange={(e) => setOptions({ ...options, discountType: e.target.value })}><option value="amount">Rupee amounts</option><option value="percent">Percentages</option></select></label>
        <label className="f">Rows with an invalid date<select value={options.invalidDates} onChange={(e) => setOptions({ ...options, invalidDates: e.target.value })}><option value="reject">Reject (show in error report)</option><option value="import_without_date">Import without a date</option></select></label>
        <label className="f">Negative quantities / amounts<select value={options.negativeHandling} onChange={(e) => setOptions({ ...options, negativeHandling: e.target.value })}><option value="returns">Treat as returns / refunds</option><option value="reject">Reject</option></select></label>
      </div>
      <div className="actions"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" disabled={busy || missing.length > 0} onClick={() => validate()}>{busy ? 'Validating…' : 'Validate data'}</button><button className="btn" onClick={reset}>Cancel</button></div>
    </Panel>}

    {step === 4 && val && <Validation {...{ val, pv, options, setOptions, validate, busy, setStep }} />}

    {step === 5 && val && <Panel title="Review calculations and confirm">
      <h3>How sales are calculated</h3><ul>{val.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      <h3>Example rows</h3>
      <DataTable dense pageSize={8} rows={val.calcPreview.map((c) => ({ ...c, key: c.row }))} columns={[{ key: 'row', label: 'Row' }, { key: 'shop', label: 'Shop' }, { key: 'product', label: 'Product' }, { key: 'text', label: 'Calculation' }, { key: 'isReturn', label: '', render: (r) => (r.isReturn ? <Badge kind="amber">return</Badge> : '') }]} />
      <h3 style={{ marginTop: 14 }}>What will be imported</h3>
      <div className="stats"><div className="stat good"><b>{num(val.stats.imported)}</b>rows to import</div><div className="stat"><b>{inr(val.stats.totals.net)}</b>net sales</div>
        <div className="stat"><b>{val.stats.totals.gross ? inr(val.stats.totals.gross) : '—'}</b>gross</div><div className="stat"><b>{val.stats.totals.discount ? inr(val.stats.totals.discount) : '—'}</b>discounts</div>
        {val.stats.totals.returns > 0 && <div className="stat warn"><b>{inr(val.stats.totals.returns)}</b>returns deducted</div>}
        <div className="stat"><b>{val.stats.shops}</b>shops</div><div className="stat"><b>{val.stats.dateRange.min ? `${dateText(val.stats.dateRange.min)} – ${dateText(val.stats.dateRange.max)}` : 'no dates'}</b>date range</div></div>
      <h3>Import strategy</h3>
      <label className={'radio ' + (mode === 'append' ? 'on' : '')}><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /><b>Add to existing data</b> — keeps everything already imported.</label>
      {mode === 'append' && val.stats.counts.existingDuplicates > 0 && <div className="alert warn">{val.stats.counts.existingDuplicates} rows already exist from earlier imports.
        <label className="radio" style={{ marginTop: 8 }}><input type="radio" checked={dupe === 'skip'} onChange={() => setDupe('skip')} />Skip them (recommended — avoids double counting)</label>
        <label className="radio"><input type="radio" checked={dupe === 'keep'} onChange={() => setDupe('keep')} />Import them again anyway</label></div>}
      <label className={'radio ' + (mode === 'replace' ? 'on' : '')}><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /><b>Replace all existing sales data</b> with this file.</label>
      {mode === 'replace' && <div className="alert error"><label><input type="checkbox" style={{ width: 'auto' }} checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} /> I understand this permanently removes all sales from earlier imports{meta?.anchors?.count ? ` (${num(meta.anchors.count)} rows)` : ''}. Shop notes and reminders are kept.</label></div>}
      <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" style={{ width: 'auto' }} checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} /> Remember this column mapping for files with the same layout (you will still be asked to verify it)</label>
      <div className="actions"><button className="btn" disabled={busy} onClick={() => setStep(4)}>Back</button>
        <button className="btn primary" disabled={busy || !val.stats.imported || (mode === 'replace' && !confirmReplace)} onClick={commit}>{busy ? 'Importing… please wait' : `Confirm and import ${num(val.stats.imported)} rows`}</button></div>
    </Panel>}

    {step === 6 && result && <Panel title={result.alreadyImported ? 'Already imported' : 'Import complete ✔'}>
      {result.alreadyImported ? <div className="alert info">{result.message}</div> : <div className="stats"><div className="stat good"><b>{num(result.imported)}</b>rows imported</div><div className="stat"><b>{inr(result.totalNetSales)}</b>net sales</div><div className="stat"><b>{result.skipped}</b>duplicates skipped</div><div className="stat"><b>{result.rejected}</b>rows rejected</div></div>}
      <div className="actions"><button className="btn primary" onClick={() => nav('/')}>View dashboard</button><Link className="btn" to="/insights">See insights</Link><Link className="btn" to="/shops">Shops</Link><Link className="btn" to="/history">Import history</Link><button className="btn" onClick={reset}>Import another file</button></div>
    </Panel>}
  </>;
}

function Validation({ val, pv, options, setOptions, validate, busy, setStep }) {
  const [level, setLevel] = useState('all');
  const s = val.stats, c = s.counts;
  const tiles = [['Source rows', s.totalRows, ''], ['Valid rows', s.validRows, 'good'], ['Rejected', s.rejected, s.rejected ? 'bad' : ''], ['Warnings', s.warnings, s.warnings ? 'warn' : ''], ['Already in database', c.existingDuplicates, c.existingDuplicates ? 'warn' : ''], ['Repeat rows in file', c.inFileDuplicates, '']];
  const lines = [['Missing required values', c.missingRequired], ['Invalid dates', c.invalidDates], ['Invalid numbers', c.invalidNumbers], ['Negative quantities / amounts (returns)', c.negatives], ['Rows missing area', c.missingArea], ['Rows missing category (shown as Uncategorized)', c.missingCategory], ['Rows missing date', c.noDate], ['Net amount differs from qty × rate − discount', c.calcMismatch], ['Rows with repeated invoice totals', c.repeatedInvoiceRows]].filter(([, n]) => n > 0);
  const issues = val.issues.filter((i) => level === 'all' || i.level === level);
  const choose = (v) => { const o = { ...options, repeatedTotals: v }; setOptions(o); validate(o); };
  return <Panel title="Validation report">
    <div className="stats">{tiles.map(([l, n, k]) => <div key={l} className={'stat ' + k}><b>{num(n)}</b>{l}</div>)}</div>
    {!val.dbChecked && <div className="alert warn">Duplicate check against existing data was skipped (database not connected).</div>}
    {val.mappingWarnings.map((w) => <div key={w} className="alert warn">{w}</div>)}
    {val.needsDecision && <div className="alert error"><b>Repeated invoice totals detected.</b> {c.repeatedInvoices} invoice(s) ({c.repeatedInvoiceRows} lines) carry the same total on every product line. Counting each line would multiply revenue. How should they be handled?
      <label className="radio" style={{ marginTop: 8 }}><input type="radio" name="rt" onChange={() => choose('calculate')} />Calculate each line as quantity × rate − discount (needs both mapped)</label>
      <label className="radio"><input type="radio" name="rt" onChange={() => choose('first_row')} />Count the invoice total once (first line); other lines count as ₹0 — product-level revenue will be inaccurate</label>
      <label className="radio"><input type="radio" name="rt" onChange={() => choose('keep')} />Keep as-is (I confirm each line really is a separate amount)</label></div>}
    {options.repeatedTotals && c.repeatedInvoiceRows > 0 && <div className="alert ok">Repeated totals handled: <b>{{ calculate: 'calculated per line', first_row: 'counted once per invoice', keep: 'kept as-is' }[options.repeatedTotals]}</b>.</div>}
    {lines.length > 0 && <table className="table dense" style={{ maxWidth: 560, marginBottom: 12 }}><tbody>{lines.map(([l, n]) => <tr key={l}><td>{l}</td><td className="right"><b>{num(n)}</b></td></tr>)}</tbody></table>}
    <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}>
      <a className="btn small" href={`/api/imports/errors/${pv.token}`}>⬇ Download full validation report (CSV)</a>
      {val.rejectedCount > 0 && <a className="btn small" href={`/api/imports/errors/${pv.token}?kind=rejected`}>⬇ Download rejected rows (CSV, with original values)</a>}</div>
    <div className="tabs">{['all', 'error', 'warning', 'info'].map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l === 'all' ? 'All issues' : l[0].toUpperCase() + l.slice(1) + 's'}</button>)}</div>
    {val.issueCount > val.issues.length && <div className="muted">Showing the first {val.issues.length} of {val.issueCount}; download the CSV for all.</div>}
    <DataTable dense pageSize={10} emptyText="No issues found." rows={issues.map((i, k) => ({ ...i, key: k }))} columns={[{ key: 'row', label: 'Row' }, { key: 'level', label: 'Level', render: (r) => <Badge kind={r.level === 'error' ? 'red' : r.level === 'warning' ? 'amber' : 'blue'}>{r.level}</Badge> }, { key: 'code', label: 'Issue', render: (r) => CODE_LABEL[r.code] || r.code }, { key: 'message', label: 'Details', sortable: false }]} />
    <div className="actions"><button className="btn" onClick={() => setStep(3)}>Back to mapping</button>
      <button className="btn primary" disabled={busy || s.validRows === 0 || val.needsDecision} onClick={() => setStep(5)}>{val.needsDecision ? 'Choose how to handle repeated totals' : s.rejected ? `Continue (${s.rejected} rows will be left out)` : 'Continue'}</button></div>
  </Panel>;
}
