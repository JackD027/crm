// Reads .xlsx / .xls / .csv into plain row arrays. Dates in Excel date-formatted cells become ISO strings.
import XLSX from 'xlsx';
import Papa from 'papaparse';

export class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isoFromSerial = (n) => {
  const p = XLSX.SSF.parse_date_code(n);
  if (!p) return null;
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};

function cellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 'e') return null;
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) return isoFromSerial(cell.v);
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.t === 's') { const s = String(cell.v).trim(); return s === '' ? null : s; }
  return cell.v;
}

function sheetToAoa(ws) {
  if (!ws || !ws['!ref']) return { aoa: [], rowOffset: 0 };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const aoa = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) row.push(cellValue(ws[XLSX.utils.encode_cell({ r, c })]));
    aoa.push(row);
  }
  return { aoa, rowOffset: range.s.r };
}

const blankRow = (r) => r.every((v) => v === null || v === '' || v === undefined);

export function readWorkbook(buffer, fileName = '') {
  const ext = fileName.toLowerCase().split('.').pop();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) throw new ImportError(`Unsupported file type ".${ext}". Please upload .xlsx, .xls or .csv.`);
  if (!buffer || !buffer.length) throw new ImportError('The file is empty.');
  const sheets = {};
  try {
    if (ext === 'csv') {
      let text = buffer.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const res = Papa.parse(text, { skipEmptyLines: false });
      const aoa = res.data.map((r) => r.map((v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; }));
      sheets['CSV'] = { aoa, rowOffset: 0 };
    } else {
      const wb = XLSX.read(buffer, { type: 'buffer', cellNF: true });
      for (const name of wb.SheetNames) sheets[name] = sheetToAoa(wb.Sheets[name]);
    }
  } catch (e) {
    throw new ImportError('Could not read this file. It may be corrupted or password-protected. (' + e.message + ')');
  }
  const names = Object.keys(sheets);
  if (!names.length || names.every((n) => sheets[n].aoa.every(blankRow))) throw new ImportError('The file contains no data.');
  return { sheets, names };
}

// Pick the header row: first of the top 15 rows with >=2 filled cells, mostly non-numeric text.
export function detectHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const cells = aoa[i].filter((v) => v !== null && v !== '');
    if (cells.length < 2) continue;
    const text = cells.filter((v) => typeof v === 'string' && !/^-?[\d.,]+$/.test(v)).length;
    if (text / cells.length >= 0.6 && aoa.slice(i + 1).some((r) => !blankRow(r))) return i;
  }
  return 0;
}

export function buildTable(sheet, headerIdx) {
  const { aoa, rowOffset } = sheet;
  const warnings = [];
  const raw = aoa[headerIdx] || [];
  const seen = new Map();
  const headers = raw.map((h, i) => {
    let name = h === null || h === undefined || h === '' ? `Column ${XLSX.utils.encode_col(i)}` : String(h).trim();
    const k = name.toLowerCase();
    if (seen.has(k)) {
      const c = seen.get(k) + 1; seen.set(k, c);
      warnings.push(`Duplicate column name "${name}" was renamed to "${name} (${c})".`);
      name = `${name} (${c})`;
    } else seen.set(k, 1);
    return name;
  });
  while (headers.length && /^Column [A-Z]+$/.test(headers[headers.length - 1]) && aoa.every((r) => r[headers.length - 1] == null)) headers.pop();
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const v = aoa[i].slice(0, headers.length);
    while (v.length < headers.length) v.push(null);
    if (blankRow(v)) continue;
    rows.push({ n: rowOffset + i + 1, v }); // n = row number as seen in Excel / the CSV file
  }
  return { headers, rows, warnings, headerRowNumber: rowOffset + headerIdx + 1 };
}
