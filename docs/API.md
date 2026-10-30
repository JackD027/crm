# REST API

Base URL `http://localhost:5000`. JSON in/out. Errors: `{ "error": "message", "details"?: {...} }` with a suitable status
(400 invalid input · 404 · 409 conflict · 410 upload expired · 422 mapping incomplete · 503 database offline).

## Common filter query parameters (all analytics, transactions and report endpoints)
| Param | Meaning |
|---|---|
| `range` | `all` · `30` · `60` · `90` · `180` · `365` (days, ending at the latest sale date) · `lastmonth` (last fully covered month) |
| `from`, `to` | `YYYY-MM-DD`; overrides `range` |
| `shop`, `product` | shop / product **key** (`id:code` or `n:lowercase name`) |
| `area`, `city`, `category`, `salesperson` | exact value; `Uncategorized` selects rows without category |
Several values may be joined with `|`. Responses include `range` (`text`, `comparisonAvailable`, `comparisonText`, `comparisonNote`).

## Import wizard
| Method & path | Purpose |
|---|---|
| `POST /api/imports/preview` | multipart `file`. Returns token, sheets, headers, first 20 rows, suggested mapping + confidence, detected import type, saved profile |
| `POST /api/imports/demo-preview` | same, using the built-in demo workbook |
| `POST /api/imports/preview/sheet` | `{token, sheet, headerRow?}` switch worksheet / header row |
| `POST /api/imports/validate` | `{token, sheet, headerRow?, importType, mapping, options}` → stats, calculation preview, rules, issues, `needsDecision` (nothing saved) |
| `GET /api/imports/errors/:token[?kind=rejected]` | CSV of issues, or rejected rows with original values |
| `POST /api/imports/commit` | validate + save. Adds `mode` (`append`\|`replace`), `confirmReplace`, `saveProfile`. Idempotent per upload |
| `GET /api/imports` · `GET /api/imports/:id` | history · detail (mapping, rules, issue log) |
| `POST /api/imports/:id/undo` | `{confirm:true}` removes only that import |
| `GET /api/imports/profiles` · `DELETE /api/imports/profiles/:id` | saved mappings |
| `GET /api/imports/template.xlsx` · `demo.xlsx` · `demo.csv` | downloads |

`options`: `dateOrder` DMY\|MDY · `invalidDates` reject\|import_without_date · `negativeHandling` returns\|reject · `discountType` amount\|percent · `repeatedTotals` calculate\|first_row\|keep · `duplicateStrategy` skip\|keep.

## Analytics
`GET /api/meta` (filter options, data range) · `GET /api/dashboard/summary[?grain=day|week|month|year]` ·
`GET /api/analytics/sales-trend` · `GET /api/shops[?q=]` (= `/api/analytics/shops`) · `GET /api/shops/:key` ·
`GET /api/analytics/follow-ups[?days=]` · `GET /api/analytics/areas` · `GET /api/analytics/areas/:name` ·
`GET /api/analytics/products` · `GET /api/analytics/products/:key` · `GET /api/analytics/categories` · `GET /api/insights`

`GET /api/transactions?page=&pageSize=(10-200)&sort=date|shop|product|area|net|invoice|quantity&dir=asc|desc&q=` — server-side pagination.

## Reports
`GET /api/reports/export?type=&format=csv|xlsx` + filters. Types: `summary transactions shops areas products categories monthly inactive insights errors` (`errors` also needs `batchId`).

## CRM & settings
`PUT /api/shops/:key` · `POST|PATCH|DELETE /api/shops/:key/reminders[/:rid]` · `GET /api/followups` ·
`PUT /api/products/:key/category` `{category, overwrite?}` · `GET|POST /api/categories` · `POST /api/categories/rename` ·
`GET|POST /api/aliases` · `DELETE /api/aliases/:id` · `GET|PUT /api/settings` · `GET /api/health`
