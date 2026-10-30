// Restores a backup made by scripts/backup.js. REPLACES all current data, so it asks you to confirm with --yes.
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import { SalesTransaction, Shop, Product, ImportBatch, ImportProfile, BusinessSettings } from '../src/models/index.js';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: npm run restore -- <backup-file.json> --yes'); process.exit(1); }
if (!process.argv.includes('--yes')) { console.error('This replaces ALL current data. Re-run with --yes to confirm.'); process.exit(1); }
const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sales_crm';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data.version !== 1) { console.error('Unsupported backup version.'); process.exit(1); }
await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
const revive = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v));
for (const [name, M] of Object.entries({ transactions: SalesTransaction, shops: Shop, products: Product, batches: ImportBatch, profiles: ImportProfile, settings: BusinessSettings })) {
  const docs = (data.collections[name] || []).map(revive);
  await M.deleteMany({});
  for (let i = 0; i < docs.length; i += 1000) await M.collection.insertMany(docs.slice(i, i + 1000));
  console.log(`${name}: restored ${docs.length}`);
}
await mongoose.disconnect();
