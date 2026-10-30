import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import importsRouter from './routes/imports.js';
import analyticsRouter from './routes/analytics.js';
import crmRouter from './routes/crm.js';
import { requireDb, dbReady } from './lib/context.js';
import { authRouter, requireAuth, validateAuthConfiguration } from './lib/auth.js';

const PORT = Number(process.env.PORT) || 5000;
const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sales_crm';
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

export const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(cors({ origin: [ORIGIN, 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady() }));
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
// Import endpoints that need no database (upload, preview, validate, templates) are guarded inside the router.
app.use('/api/imports', importsRouter);
app.use('/api', requireDb, analyticsRouter);
app.use('/api', requireDb, crmRouter);
app.use('/api', (req, res) => res.status(404).json({ error: `No such API route: ${req.method} ${req.originalUrl}` }));

// If the client has been built (npm run build in /client), serve it from this same server: one process, one port.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 100 MB.' : err.message });
  if (err?.name === 'CastError' || err?.name === 'ValidationError') return res.status(400).json({ error: err.message });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.', ...(err.details ? { details: err.details } : {}) });
});

async function connect() {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 4000 });
    const models = mongoose.modelNames().map((name) => mongoose.model(name));
    for (const model of models) {
      try {
        await model.createCollection();
      } catch (e) {
        if (e.code !== 48) throw e;
      }
    }
    console.log(`MongoDB connected; ${models.length} collections ready:`, URI.replace(/\/\/.*@/, '//***@'));
  } catch (e) {
    console.error(`MongoDB connection or collection setup failed (${e.message}). Check MONGODB_URI, Atlas database-user credentials, network access, and database permissions. Retrying in 5s.`);
    setTimeout(connect, 5000);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  validateAuthConfiguration();
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  app.listen(PORT, host, () => console.log(`API listening on http://${host}:${PORT}`));
  connect();
}
