# Cashier / POS System

A point-of-sale system for stores: a **Django REST API** backend, an **Electron + React desktop**
frontend, and a small **Node WhatsApp sidecar**. Designed for a networked store — one server
(PostgreSQL + API + WhatsApp) with one or more Electron cashier terminals on the LAN.

For chains, each store runs its own copy (one **branch**) and automatically sends a **daily report
to a central HQ** service that aggregates and compares all branches.

The desktop app is branded for **Fathet Kheer (فاتحة خير)**. See [Branding](#branding).

## Features

### Selling
- **Barcode scanning** — USB scanners work as keyboard wedges; a scan registers anywhere on the
  POS without clicking into a field first. Server-side barcode lookup, so it stays fast on a
  large catalogue.
- **Any goods** — quantities are `Decimal(12,3)`, so the same system handles whole units (tins,
  boxes) and measured goods (kg, litres, metres). `Product.sold_by` marks which; unit items are
  held to whole numbers.
- **Split payments** — one sale can be settled by several tenders (cash + card), with cash
  tendered and change due tracked so the drawer always balances.
- **Hold / resume** — park a sale to serve the next customer; held sales survive a reload.
- **Discounts** — per line and per order, with a manager PIN required above a configurable
  threshold. No discount can drive a total negative.
- **Offline mode** — a sale that cannot reach the server is banked locally and replayed on
  reconnect. Checkout is idempotent on a terminal-generated `client_uuid`, so a replay (or a
  retry whose response was lost) can never ring the same sale up twice.

### Cash accountability
- **Shifts / till sessions** — open with a counted float, and every sale binds to the shift that
  took it. A cash sale with no open shift is refused rather than left unattributable.
- **Cash drawer** — paid-in, paid-out and drops, each requiring a reason.
- **Blind close** — the cashier submits their physical count *before* the expected figure is
  shown; the variance is persisted so a short drawer stays attributable to a named person.
- **X and Z reports** — mid-shift read and end-of-shift close, printable to the thermal printer.

### Corrections
- **Voids** — reverse a whole sale while the shift is still open: restocks every line and pulls
  the cash back out of the drawer.
- **Returns / refunds** — whole or partial, afterwards, as a numbered document (`RT00001`).
  Refunds at the price *actually paid*, so a discounted line is not refunded at full price, and
  each line is capped at what has not already been returned. Damaged goods can be refunded
  without restocking.
- **Manager PIN override** — voids, refunds and large discounts need a supervisor's PIN (stored
  hashed). The audit log records both the cashier and the authorising manager.

### Stock
- **Ledger** — every change to stock is an append-only `StockMovement` (sale, purchase, return,
  void, stock take, waste); product stock is derived from it.
- **Purchase orders & goods receipt** — order from a supplier, then receive in one or several
  deliveries. Over-receiving is refused, and a delivered price different from the ordered price
  updates the product cost.
- **Stock takes** — snapshot expected levels at the start of a count so sales during the count
  do not distort the variance; applying writes explicit corrections through the ledger.
- **Product photos** — super admins add one per product in the product form. Stored in the
  database (not on disk), so a website reading the same database has them too — see
  [Website on the same database](#website-on-the-same-database).

### Reporting
- **Margin report** — revenue vs cost of goods, using the cost snapshotted at sale time, so
  historic margins do not move when a product's cost is edited.
- **Per-cashier** — sales, average sale, and void/refund counts side by side.
- **Hourly trade profile** for staffing, plus daily and monthly series.
- **CSV export** — line-level sales (with per-line margin) and stock valuation.
- **Audit log** — who discounted, voided, refunded, changed a price or moved cash, and who
  authorised it.
- **HQ daily reporting** — each branch auto-sends an end-of-day report to a central HQ service
  that stores it and shows a cross-branch dashboard. Resilient (retry + idempotent upsert).

### Hardware & platform
- **Thermal printing (ESC/POS)** — silent, instant receipts over TCP 9100 or a device path, with
  no native module to compile. Falls back to the HTML print dialog when no printer is
  configured or one fails, so a printer fault never blocks a sale.
- **Cash drawer kick** — fired only when cash actually changed hands.
- **Auto-update** — installed tills update themselves from GitHub releases, downloading only what
  changed (delta updates); a startup splash shows the progress. See [RELEASE.md](RELEASE.md).
- **Native-looking window** — on Windows the app draws its own branded title bar, with only the
  system minimize / maximize / close buttons, and no stock Electron menu.
- **Roles** — Super Admin (full CRUD) and Cashier (read-only catalog, can ring up sales).
- **Customers**, **suppliers + WhatsApp**, and a **dashboard** with KPI cards and low-stock.

## Architecture

```
            ┌──────────────── HQ (head office) ────────────────┐
            │   Django + PostgreSQL — ingest API + dashboard     │
            └───────────────▲───────────────▲───────────────────┘
              daily report  │               │  daily report (HTTPS, per-branch API key)
   ┌────────────────────────┴──┐         ┌──┴────────────────────────┐
   │  BRANCH A (one store)      │         │  BRANCH B (one store)      │
   │  PostgreSQL ◄► Django+DRF  │   ...   │  PostgreSQL ◄► Django+DRF  │
   │       ▲          ▲         │         │                            │
   │  whatsapp-svc  Electron×N  │         │                            │
   └────────────────────────────┘         └────────────────────────────┘
```

```
Cashier/
  backend/            Branch Django project (apps: common, accounts, products, inventory,
                      customers, suppliers, orders, shifts, purchasing, whatsapp,
                      reports, hqsync)
  whatsapp-service/   Node + Express + whatsapp-web.js sidecar
  frontend/           Electron + Vite + React + TypeScript desktop app
  hq/                 Central HQ Django project (branches + ingest + dashboard)
  docker-compose.yml  Branch stack (db + backend + scheduler + whatsapp-service)
  hq/docker-compose.yml  HQ stack (hq-db + hq)
```

## Prerequisites

- Python 3.12+, Node 18+ (tested on 24), npm.
- For the WhatsApp sidecar: a phone with WhatsApp to pair (and Chromium — Puppeteer downloads it).
- Optional: Docker + Docker Compose for the server stack.

---

## Local development (without Docker)

Uses SQLite by default so you can run everything on one machine quickly.

### 1) Backend

```bash
cd backend
python -m venv venv
# Windows:  venv\Scripts\activate     macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
python manage.py migrate
python manage.py seed_demo      # demo users, products, stock, orders
python manage.py runserver
```

API: http://127.0.0.1:8000/api · Django admin: http://127.0.0.1:8000/admin

Seeded logins: **admin / admin12345** (Super Admin) and **cashier / cashier12345** (Cashier).
The admin's **manager override PIN is 4321** — needed to void, refund, or apply a large discount
as the cashier. The demo catalogue has barcodes (so the scanner can be tried) and two by-weight
deli products (so weighed selling can be tried).

### Trying the till

1. **Shift & Drawer → Open shift** with a float. Selling is blocked until a drawer is open.
2. **New Order** — scan a barcode (or type one and press Enter). By-weight items are added at
   zero so you can key in what the scale says.
3. **Take payment** — quick-cash for the common case, or split across cash and card.
4. **Orders** — look up the sale, reprint it, or void/refund it (PIN `4321`).
5. **Shift & Drawer → Close shift** — enter a blind count and compare against expected.

### 2) WhatsApp sidecar (optional — needed only for the WhatsApp feature)

```bash
cd whatsapp-service
npm install                     # downloads Chromium via Puppeteer (large)
cp .env.example .env            # set the same WHATSAPP_SHARED_SECRET as the backend
npm start
```

Then in the desktop app open **Suppliers → WhatsApp setup** and scan the QR with
WhatsApp (Linked devices → Link a device). The session persists, so you only do this once.

### 3) Frontend (Electron desktop)

```bash
cd frontend
npm install                     # downloads Electron (large)
cp .env.example .env            # VITE_API_BASE_URL → your API URL
npm run dev
```

> The renderer also runs in a plain browser (http://localhost:5173) for quick UI work; token
> storage and receipt printing fall back to browser equivalents when not inside Electron.

### 4) HQ central service (optional — only if you want cross-branch reporting)

```bash
cd hq
python -m venv venv && pip install -r requirements.txt   # (or reuse any Django 5 env)
cp .env.example .env
python manage.py migrate
python manage.py seed_hq        # creates hqadmin/hqadmin12345 + a demo branch BR001
python manage.py runserver 9000
```

HQ dashboard: http://127.0.0.1:9000 (login **hqadmin / hqadmin12345**). Register each store under
**Django admin → Branches** (http://127.0.0.1:9000/admin) — copy its generated `api_key`.

---

## Networked / production (Docker server stack)

On the **server** machine:

```bash
# from the repo root — set secrets via env or a root .env
SECRET_KEY=... WHATSAPP_SHARED_SECRET=... \
ALLOWED_HOSTS=192.168.1.10,localhost \
CORS_ALLOWED_ORIGINS=http://localhost:5173 \
docker compose up --build
```

This starts PostgreSQL, the Django API (port 8000, migrations applied on boot) and the WhatsApp
sidecar (port 3001). Create the first admin once:

```bash
docker compose exec backend python manage.py createsuperuser
# or: docker compose exec backend python manage.py seed_demo
```

On each **cashier terminal**, set `frontend/.env` →
`VITE_API_BASE_URL=http://<server-lan-ip>:8000/api`, then run `npm run dev` (dev) or build an
installer with `npm run package` (electron-builder).

The branch stack also starts a `scheduler` service that sends the daily report automatically.
Run the HQ stack at head office separately: `cd hq && docker compose up --build`.

---

## Multi-branch daily reporting (branch → HQ)

Each branch installation is configured (in `backend/.env`) with its identity and the HQ endpoint:

```
BRANCH_CODE=BR001
BRANCH_NAME=Downtown Branch
HQ_API_URL=http://<hq-host>:9000     # leave blank to disable sending
HQ_API_KEY=<api key from HQ for this branch>
REPORT_TIME=22:00                    # close-of-business, local TIME_ZONE
```

**How it flows:** at `REPORT_TIME` the branch builds an end-of-day report (sales totals, order
count, payment breakdown, top products, low-stock) and POSTs it to
`HQ_API_URL/api/ingest/daily-report/` with `X-Branch-Code` + `X-Api-Key` headers. HQ upserts it by
(branch, date) — so re-sends never double-count. Failed/missed days are retried on the next run.

**What triggers it (automatic after working hours):**
- Docker: the `scheduler` service runs `python manage.py run_scheduler` (APScheduler fires daily at
  `REPORT_TIME`).
- Bare metal: run `python manage.py run_scheduler` as a service, **or** schedule
  `python manage.py send_daily_report` with Windows Task Scheduler / cron.
- Manually / on demand: admins can click **HQ Reports → Generate & send today's report** in the
  desktop app, or run `python manage.py send_daily_report`.

The desktop app shows the branch name in the header and (for admins) an **HQ Reports** page with
each day's status (`SENT` / `PENDING` / `FAILED`), attempts and errors.

---

## Roles & permissions

| Resource                  | Super Admin | Cashier                    |
|---------------------------|-------------|----------------------------|
| Users                     | CRUD        | —                          |
| Products / Categories     | CRUD        | Read                       |
| Storage / Stock           | CRUD        | Read                       |
| Stock movements           | Create/Read | —                          |
| Customers                 | CRUD        | Create/Read/Update         |
| Orders (checkout)         | Create/Read | Create/Read                |
| Voids / refunds           | Yes         | With a manager PIN         |
| Large discounts           | Yes         | With a manager PIN         |
| Shifts (open/close/X-Z)   | Yes         | Yes (their own drawer)     |
| Cash movement history     | Yes         | —                          |
| Purchase orders / receipt | CRUD        | Read                       |
| Stock takes               | Yes         | —                          |
| Margin / cashier reports  | Yes         | —                          |
| CSV export, audit log     | Yes         | —                          |
| Suppliers                 | CRUD        | Read                       |
| Send WhatsApp             | Yes         | Yes                        |

## API overview

**Auth** — `POST /api/auth/login` · `POST /api/auth/refresh` · `GET /api/auth/me`

**CRUD routers** under `/api/{users,categories,products,storages,stock,stock-movements,
customers,suppliers,orders,returns,shifts,cash-movements,purchase-orders,goods-receipts,
stock-takes}/`

**Products**
- `GET /api/products/{id}/image/` — the photo as JPEG; `?size=thumb` for the small one. Public
  (no login), since `<img>` tags cannot send a token. Each product's `image_url` carries
  `?v=<version>`, and that URL is cached for a year; a new photo gets a new version.
- `POST /api/products/{id}/image/` (multipart field `image`) · `DELETE /api/products/{id}/image/`
  — super admin only. JPG/PNG/WebP up to 10 MB; stored as JPEG at most 1200 px, plus a 320 px
  thumbnail, with the phone's rotation applied.

**Selling**
- `GET /api/products/lookup/?barcode=…` — resolve a scanned barcode
- `POST /api/orders/` — checkout; accepts `items[]`, `payments[]`, `client_uuid` (idempotent),
  `override_pin`
- `POST /api/orders/{id}/void/` · `POST /api/orders/{id}/return/` · `GET /api/orders/{id}/returnable/`

**Shifts**
- `GET /api/shifts/current/` · `POST /api/shifts/open/` · `POST /api/shifts/{id}/close/`
- `GET /api/shifts/{id}/x-report/` · `POST /api/shifts/{id}/cash-movement/`

**Purchasing & stock**
- `POST /api/purchase-orders/{id}/send|cancel|receive/`
- `POST /api/stock-takes/start/` · `POST /api/stock-takes/{id}/count|apply/` ·
  `GET /api/stock-takes/{id}/variances/`

**Reports** — `GET /api/reports/{summary,monthly-sales,low-stock,margin,by-cashier,hourly,daily}` ·
`GET /api/reports/export/{sales,stock}.csv` · `GET /api/audit-log/`

**HQ** — `GET /api/branch` · `GET /api/daily-reports` · `POST /api/daily-reports/send-now` (admin).

HQ ingest (called by branches): `POST /api/ingest/daily-report/` (auth: `X-Branch-Code` + `X-Api-Key`).

## Tests

```bash
cd backend && python manage.py test --parallel 4   # 97 tests, ~55s
cd hq && python manage.py test                     # HQ: ingest auth, upsert, dashboard access
cd frontend && npx tsc --noEmit -p tsconfig.web.json   # renderer
cd frontend && npx tsc --noEmit -p tsconfig.node.json  # main + preload
```

Covers role permissions; checkout stock decrement + rollback; weighed vs whole-unit quantities;
discount limits (including the negative-total guard); gapless receipt numbering across a
rolled-back sale; COGS snapshotting; drawer reconciliation end-to-end (cash vs card vs split);
voids and partial returns including the double-refund guard; manager PIN enforcement; PO
over-receiving; stock-take variance; margin and CSV reports; offline replay idempotency; and the
daily HQ report build/send (mocked) + upsert.

---

## Till configuration

Set in `backend/.env`:

```
REQUIRE_OPEN_SHIFT=False      # refuse ANY sale (not just cash) with no open shift
DISCOUNT_OVERRIDE_AMOUNT=50   # discounts above this need a manager PIN
DISCOUNT_OVERRIDE_PERCENT=20  # ...or above this percentage of the sale
```

Tax is currently off (totals are untaxed) but the fields and config scaffold are in place, so it
can be switched on without a migration.

### Receipt printer

Configure per terminal in the desktop app under **Receipt Printer**, or provision a fleet with
env vars: `PRINTER_HOST`, `PRINTER_PORT` (default 9100), `PRINTER_WIDTH` (32 for 58mm, 42 for
80mm). Settings persist per machine in `printer.json` in the app's user-data directory. The page
has **Test print** and **Test drawer** buttons.

## Branding

| What | Where |
|------|-------|
| Store name and WhatsApp number | `frontend/src/renderer/src/brand/brand.ts` |
| Colours: palettes sampled from the logo (teal, gold, wood, palm green) | `frontend/src/renderer/src/brand/theme.ts` |
| Logo, header emblem, receipt logo, favicon | `frontend/src/renderer/src/assets/brand/` |
| App icon (exe, installer, window) | `frontend/build/icon.ico`, `frontend/build/icon.png` |
| Window title, installer name | `frontend/src/renderer/index.html`, `frontend/src/main/index.ts`, `frontend/electron-builder.yml` |

The WhatsApp number shows on the login screen, in the sidebar (click to chat), and on every
receipt. Thermal receipts print the name and number in the printer's own font, which has no
Arabic. The HTML receipt also carries the logo, embedded with a `?dataurl` import because it
prints from a window that cannot load app files. The header emblem is the logo's hexagon,
rebuilt as a complete shape so it reads at icon sizes.

Renaming the product does not move local data: the offline sale queue, held sales and printer
settings stay pinned to the `cashier-desktop` data folder. Keep `appId` unchanged so new
installers upgrade the old one in place.

## Languages (English / Arabic)

The desktop app runs in English or Arabic. Switch with the language button in the header or on
the login screen; the choice is remembered per terminal. Arabic lays the whole app out
right-to-left (sidebar on the right, mirrored chart) and keeps Latin digits, so prices,
receipt numbers and barcodes read the same in both languages.

- Strings live in `frontend/src/renderer/src/i18n/en.ts` and `ar.ts`. `ar.ts` is typed against
  the English set, so a missing or misspelt key fails `npm run typecheck`. Add a string to
  both files, then use it as `const { t } = useI18n(); t.section.key`.
- Wrap phone numbers, signed amounts and file paths shown in Arabic text in `ltr()`, or a
  leading `+`/`-` jumps to the far end.
- Print-dialog receipts follow the app language. Thermal (ESC/POS) receipts and X/Z reports
  stay English, because the printer's built-in font has no Arabic.
- Error messages that come from the server (e.g. a stock refusal) stay in English.

## Website on the same database

A website can read the branch database directly. Stock is live: a sale at the till updates it
in the same transaction, so an item that sells out in the store is out of stock on the site at
once. (A sale rung up while a till was offline counts once that till reconnects.)

```sql
-- Catalogue: active products, stock summed over storage locations, photo version.
SELECT p.id, p.name, p.price, p.unit, c.name AS category,
       COALESCE(s.quantity, 0)     AS quantity,
       COALESCE(s.quantity, 0) > 0 AS in_stock,
       i.checksum                  AS photo_version      -- NULL: no photo
FROM products_product p
LEFT JOIN products_category c ON c.id = p.category_id
LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity
           FROM inventory_stockitem GROUP BY product_id) s ON s.product_id = p.id
LEFT JOIN products_productimage i ON i.product_id = p.id
WHERE p.is_active;

-- One photo: JPEG bytes. data is at most 1200 px, thumbnail at most 320 px.
SELECT data, thumbnail, content_type, checksum
FROM products_productimage WHERE product_id = $1;
```

- Serve photos from the website's own route using these bytes, with `checksum` as the ETag or a
  URL version. Alternatively link to the POS server's `/api/products/{id}/image/` — but only if
  that server is reachable from the internet.
- **Read only.** If the website takes orders, create them through the POS API
  (`POST /api/orders/`). Writing `inventory_stockitem` directly would skip the stock ledger,
  receipt numbering and audit trail, and the till and website would drift apart.

## Not yet implemented

- **Tax** — fields and config exist, but no tax rules engine or per-product tax class.
- **Loyalty / store credit / layaway**, gift cards.
- **Product variants**, batch/lot + expiry tracking, serial numbers.
- **Scale integration** — weighed items are keyed in, not read from a scale.
- **Multi-currency** and cash rounding rules.
- **Per-branch data scoping** within one database (each branch currently runs its own).

## Notes

- whatsapp-web.js is **unofficial** (drives WhatsApp Web via Puppeteer) and can break on WhatsApp
  updates; it is isolated in its own service so POS is never affected. For high volume consider
  the official WhatsApp Business Cloud API.
- Local dev uses SQLite; the Docker stack uses PostgreSQL. The backend is DB-agnostic via
  `DATABASE_URL`.
