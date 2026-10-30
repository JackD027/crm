# Sales Analytics CRM (local)

A lightweight sales analytics app for Indian small businesses, retailers, wholesalers and FMCG teams.
Import your existing Excel/CSV sales file, map the columns, check the numbers, and see sales by shop, area,
product, category and date. Everything runs on your own computer: no cloud, no paid services, no AI API.

**Stack:** React + Vite + Recharts (client) · Node.js + Express + Mongoose (server) · MongoDB Atlas (database).

---

## 1. Install (Windows)

1. Install **Node.js 20 or newer** (LTS): https://nodejs.org
2. Create a MongoDB Atlas database and database user. Allow your current IP in Network Access and copy the Atlas driver URI.
3. Open **Command Prompt** or PowerShell in the project folder and run:

```bat
npm run install:all
copy server\.env.example server\.env
npm run build
```

## 2. Start

**Simplest (one window, one address):**

```bat
npm start
```
Then open **http://localhost:5000** and sign in.

**Development mode (auto-reload; client on 5173, API on 5000):**

```bat
npm run dev
```
Then open **http://localhost:5173** and sign in.

On startup, the server creates the app's collections if they do not exist; the database appears in Atlas once those collections are created. The Atlas database user needs permission to read and write the `sales_crm` database.

For Atlas, create a **database user** in Atlas (not your Atlas website login), allow your current IP in **Network Access**, then copy the connection string from **Connect → Drivers** into `MONGODB_URI` in `server\.env`. Replace all placeholders, including `<password>`, with the database user's credentials. URL-encode reserved characters in the password. If the page shows "Cannot load data", check the URI, credentials, network access, and database-user permissions.
Set `AUTH_USERNAME`, `AUTH_PASSWORD` (at least 14 characters), and `AUTH_SECRET` (at least 32 random characters) in `server\.env`. These are your app login credentials, separate from the Atlas database credentials. Generate a local secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. The server refuses to start without these settings. Sessions use signed, HTTP-only cookies; hosted production cookies require HTTPS. The app creates its MongoDB collections after a successful Atlas connection.

## 3. Host it for mobile access (free tier)

The included `render.yaml` prepares a single-origin deployment on Render's free web-service tier. Push the project to a **private GitHub repository** (do not upload `server\.env`), then in Render choose **New → Blueprint** and connect that repository. Set the Blueprint's `MONGODB_URI`, `AUTH_USERNAME`, and a strong `AUTH_PASSWORD` when prompted; Render generates `AUTH_SECRET`. Deploy and open the HTTPS `onrender.com` address from your phone or computer, then sign in with the app credentials.

Render's free service may sleep when idle and cold-start on the next visit. Atlas requires the database username/password (never the Atlas website login) and grants only the database access you assign. Free hosting may use changing outbound IP addresses; if the host does not provide stable outbound IPs, Atlas may require `0.0.0.0/0` in Network Access. That makes the database endpoint reachable from the internet, so use a unique strong database password and a database user restricted to read/write access on `sales_crm`; never use an Atlas administrator account. Use HTTPS and keep both app secrets and the Atlas URI only in Render's environment settings.

## 4. Load the sample data

Open **Import Sales Data** and click **Load demo data into the wizard**, then follow the steps.
(The same files are in `sample-data/`: `demo-sales.xlsx` (84 rows, 2 sheets), `demo-sales.csv`, `sales-template.xlsx`.
Regenerate them with `npm run samples`.)

The demo is fictional: 12 shops in Delhi and Noida, 4 areas, 10 products, Apr–Sep 2026, with built-in patterns:
growing beverages, declining namkeen, one shop that stopped buying after June, one new shop from August, one
return (credit note), and an uncategorised product.

## 5. Import a real Excel file

1. **Import Sales Data → Browse files** (or drag the file in). `.xlsx`, `.xls`, `.csv`.
2. **Preview:** pick the worksheet; if there are title rows above your headers, set the header row number.
3. **Map columns:** common names (Party Name, Bill No, Item, Qty, Rate, Net Amount…) are matched automatically.
   Ambiguous columns such as **Total** or **Amount** are *never* mapped silently; choose what they mean.
   Confirm what each row represents (transaction line / invoice / pre-aggregated).
4. **Validate:** see rejected rows and why, download the error report, and decide what to do about repeated invoice totals.
5. **Review & confirm:** read the calculation rules, choose Add or Replace, confirm. Nothing is saved before this step.
6. Use **Import History** to undo any import without affecting the others.

Minimum your file needs: a shop/customer name, a product name (for line-level data) and either a net amount, a gross
amount, or quantity × rate. Dates, invoice numbers, area, city and category are optional but unlock more analysis.

## 6. How numbers are defined

* **Net sales** = the net amount in your file; otherwise quantity × rate − discount. Discount is subtracted once and never on top of a net column. Tax is neither added nor removed.
* **Returns / credit notes** (negative quantity or amount) reduce net sales, are reported separately, and are never counted as positive sales.
* **Average order value** = sales before returns ÷ distinct invoice numbers (shown only if invoice numbers exist).
* **Gross profit** = net sales − unit cost × quantity, shown only when cost exists for ≥ 90 % of sales.
* **Periods** end at your **latest sale date**, not today. The **previous period** is the preceding period of equal length (or the previous calendar month for *Last full month*) and is only offered when your data fully covers it.
* **Follow-up suggestions** (inactive, one-time, declining, buying less often) are suggestions, not predictions, and are withheld when your history is too short to support them.
* Names differing only in spacing or capitalisation merge automatically; anything else merges only when you confirm it in **Settings → aliases**. Missing categories show as *Uncategorized*; assign them on the Products page.

## 7. Back up and restore

```bat
npm run backup
npm run restore -- backup-20261029-1530.json --yes
```
`backup` writes one JSON file (all collections) into the folder you run it from. `restore` **replaces** current data.
Alternative with MongoDB's own tools: `mongodump --db sales_crm --out C:\backup` and `mongorestore --drop C:\backup`.

## 8. Tests

```bat
npm test
```
* 39 unit tests need nothing but Node (authentication, import, calculations, analytics, insights, exports, 50,000-row performance).
* 17 integration tests drive the real HTTP API against MongoDB database `sales_crm_test` (dropped before and after). They are skipped automatically if MongoDB is unreachable. Override with `TEST_MONGODB_URI`.
* `dev-tools/ui-smoke.mjs` is an optional jsdom UI check (drives the import wizard and visits every page); see its header.

## 9. Limits and honest notes

* Tested with 50,000 rows in about a second for processing and aggregation. Larger files should work but are untested; analytics load the *filtered* rows into server memory, which suits thousands to tens of thousands of lines, not millions.
* MongoDB standalone has no multi-document transactions, so imports use an **import-batch rollback**: a failed import deletes only its own rows and is marked *failed* (tested).
* The `xlsx` npm package (0.18.x, the last version on npm) has known advisories for maliciously crafted files. For a local app opening your own files that is acceptable; do not feed it files from untrusted senders.
* Excel/CSV parsing happens on the server (not in the browser) so large files do not freeze the page; the file never leaves your computer.
* Authentication is a single-owner login configured with environment secrets; multiple independent user accounts and data separation are not implemented.

## 10. Folder structure

```
sales-crm/
├─ package.json            root scripts (install:all, dev, build, start, test, backup, restore)
├─ sample-data/            demo-sales.xlsx / .csv, sales-template.xlsx
├─ docs/API.md             REST API reference
├─ dev-tools/              optional jsdom UI smoke test
├─ server/
│  ├─ .env.example
│  ├─ src/index.js         Express app, DB connection, serves client/dist
│  ├─ src/models/index.js  SalesTransaction, Shop, Product, ImportBatch, ImportProfile, BusinessSettings (+ indexes)
│  ├─ src/lib/             columns.js (mapping) · parse.js (xlsx/csv) · importer.js (validation + calculations)
│  │                       analytics.js · insights.js · reports.js · demoData.js · context.js · importCache.js
│  ├─ src/routes/          imports.js · analytics.js · crm.js
│  ├─ scripts/             make-samples.js · backup.js · restore.js
│  └─ test/                *.test.js (unit + integration)
└─ client/
   └─ src/                 App.jsx · state.jsx · api.js · components.jsx · pages/ (Dashboard, Import, Transactions,
                           Shops, Areas, Products, Insights, Reports, History, Settings)
```
#   c r m  
 #   c r m  
 