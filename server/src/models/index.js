import mongoose from 'mongoose';
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const salesTransactionSchema = new Schema({
  importBatchId: { type: ObjectId, required: true, index: true },
  saleDate: { type: Date, default: null },
  invoiceNo: String, lineId: String,
  shopKey: String, shopName: String, originalShopName: String, shopId: String,
  area: String, city: String,
  productKey: String, productName: String, originalProductName: String, productId: String, category: String,
  quantity: Number, unitPrice: Number, grossAmount: Number, discount: Number, netSales: { type: Number, required: true },
  costPrice: Number, costTotal: Number,
  salesperson: String, paymentStatus: String,
  isReturn: { type: Boolean, default: false }, isAggregated: { type: Boolean, default: false },
  importType: String, calcBasis: String, sourceRow: Number,
  sourceKey: { type: String, index: true },
}, { timestamps: true });
salesTransactionSchema.index({ saleDate: 1 });
salesTransactionSchema.index({ shopKey: 1, saleDate: 1 });
salesTransactionSchema.index({ area: 1, saleDate: 1 });
salesTransactionSchema.index({ productKey: 1, saleDate: 1 });
salesTransactionSchema.index({ category: 1, saleDate: 1 });
salesTransactionSchema.index({ invoiceNo: 1 });

const shopSchema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  area: String, city: String, salesperson: String,
  contactPerson: { type: String, default: '' }, phone: { type: String, default: '' }, address: { type: String, default: '' }, notes: { type: String, default: '' },
  followUpStatus: { type: String, enum: ['none', 'to_contact', 'contacted', 'done'], default: 'none' },
  reminders: [{ text: { type: String, required: true }, dueDate: Date, done: { type: Boolean, default: false } }],
  createdByBatch: ObjectId,
}, { timestamps: true });

const productSchema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true }, productId: String, category: { type: String, default: null }, createdByBatch: ObjectId,
}, { timestamps: true });

const importBatchSchema = new Schema({
  fileName: String, fileSize: Number, sheet: String,
  importType: { type: String, enum: ['transaction', 'invoice', 'aggregated'] },
  mapping: Schema.Types.Mixed, options: Schema.Types.Mixed, mode: { type: String, enum: ['append', 'replace'], default: 'append' },
  sourceRows: Number, importedCount: Number, skippedCount: Number, errorCount: Number, duplicateCount: Number, warningCount: Number,
  totalNetSales: Number, dateMin: String, dateMax: String,
  status: { type: String, enum: ['importing', 'completed', 'failed', 'undone', 'replaced'], default: 'importing' },
  rules: [String], issueLog: [Schema.Types.Mixed], // first 1000 issues, for the error report
  failureReason: String, profileName: String,
}, { timestamps: true });

const importProfileSchema = new Schema({
  name: String, signature: { type: String, unique: true }, headers: [String],
  mapping: Schema.Types.Mixed, importType: String, sheet: String, options: Schema.Types.Mixed, lastUsedAt: Date,
}, { timestamps: true });

const settingsSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  businessName: { type: String, default: 'My Business' },
  currency: { type: String, default: 'INR' },
  defaultRange: { type: String, default: 'all' },
  inactiveDays: { type: Number, default: 60 },
  declinePct: { type: Number, default: 25 },
  importDefaults: {
    dateOrder: { type: String, default: 'DMY' }, negativeHandling: { type: String, default: 'returns' },
    discountType: { type: String, default: 'amount' }, invalidDates: { type: String, default: 'reject' }, duplicateStrategy: { type: String, default: 'skip' },
  },
  categories: { type: [String], default: [] },
  aliases: [{ type: { type: String, enum: ['shop', 'product'] }, fromKey: String, fromName: String, toKey: String, toName: String }],
}, { timestamps: true });

const m = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
export const SalesTransaction = m('SalesTransaction', salesTransactionSchema);
export const Shop = m('Shop', shopSchema);
export const Product = m('Product', productSchema);
export const ImportBatch = m('ImportBatch', importBatchSchema);
export const ImportProfile = m('ImportProfile', importProfileSchema);
export const BusinessSettings = m('BusinessSettings', settingsSchema);
