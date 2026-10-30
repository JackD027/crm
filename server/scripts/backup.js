// Node-only backup: writes every collection to one JSON file. No mongodump needed.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { SalesTransaction, Shop, Product, ImportBatch, ImportProfile, BusinessSettings } from '../src/models/index.js';
const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sales_crm';
const out = process.argv[2] || path.resolve(`backup-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`);
await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
const data = { version: 1, exportedAt: new Date().toISOString(), collections: {} };
for (const [name, M] of Object.entries({ transactions: SalesTransaction, shops: Shop, products: Product, batches: ImportBatch, profiles: ImportProfile, settings: BusinessSettings })) {
  data.collections[name] = await M.find({}).lean();
  console.log(`${name}: ${data.collections[name].length}`);
}
fs.writeFileSync(out, JSON.stringify(data));
console.log('Backup written to', out);
await mongoose.disconnect();
