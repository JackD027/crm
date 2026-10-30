export const qs = (o = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};
async function req(method, url, body, isForm) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (isForm) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth-required'));
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status; e.details = data?.details; throw e;
  }
  return data;
}
export const api = {
  get: (p, params) => req('GET', p + qs(params)),
  post: (p, body) => req('POST', p, body ?? {}),
  put: (p, body) => req('PUT', p, body ?? {}),
  patch: (p, body) => req('PATCH', p, body ?? {}),
  del: (p) => req('DELETE', p),
  upload: (p, file) => { const f = new FormData(); f.append('file', file); return req('POST', p, f, true); },
};
