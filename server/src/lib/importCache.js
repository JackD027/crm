// Short-lived in-memory store for uploaded files between wizard steps (files never touch disk or third parties).
import crypto from 'node:crypto';
const TTL = 30 * 60 * 1000, MAX = 6;
const store = new Map();
function sweep() { const now = Date.now(); for (const [k, v] of store) if (now - v.touched > TTL) store.delete(k); while (store.size > MAX) store.delete(store.keys().next().value); }
export function putFile(entry) { sweep(); const token = crypto.randomBytes(16).toString('hex'); store.set(token, { ...entry, touched: Date.now(), committing: false, committedBatchId: null, lastValidation: null }); return token; }
export function getFile(token) { sweep(); const e = store.get(token); if (e) e.touched = Date.now(); return e; }
