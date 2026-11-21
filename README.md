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
  database (not on disk), and the website shows the same photos — see
  [Website](#website-appswebshop).

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
- **Deleting** — super admins delete products, categories, customers, suppliers and users, after
  a confirmation; every deletion is in the audit log. Anything sales, stock, purchase or shift
  records still point at is refused (HTTP 409) rather than erased: turn off "Active" instead.
  Nobody can delete their own account. Sales, shifts and the stock ledger are never deleted;
  voids and refunds correct them.
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
                      reports, hqsync, webshop)
  whatsapp-service/   Node + Express + whatsapp-web.js sidecar
  frontend/           Electron + Vite + React + TypeScript desktop app
  hq/                 Central HQ Django project (branches + ingest + dashboard)
  scripts/start.js    Local dev launcher behind `npm start` (backend, then frontend)
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
2. **Scan & Sell** — scan a barcode (or type one and press Enter), or search by name. A
   by-weight item asks for what the scale says before it goes on the invoice.
3. **Pay** (or F9) — quick-cash for the common case, or split across cash and card.
4. **Orders** — look up the sale, reprint it, or void/refund it (PIN `4321`).
5. **Shift & Drawer → Close shift** — enter a blind count and compare against expected.

### 2) WhatsApp sidecar (optional — sends the website's order alerts when Meta's Cloud API is not set up)

```bash
cd whatsapp-service
npm install                     # downloads Chromium via Puppeteer (large)
cp .env.example .env            # set the same WHATSAPP_SHARED_SECRET as the backend
npm start
```

Then in the desktop app open **Suppliers → WhatsApp setup** and scan the QR with
WhatsApp (Linked devices → Link a device). The session persists, so you only do this once.
To switch phones, a super admin clicks **Unlink** in the same window: WhatsApp drops the
cashier from the phone's Linked devices, and a new QR appears for the next one.

Alerts that must arrive with every PC at the shop off go through Meta's Cloud API instead,
from the server: see [WhatsApp order alerts through Meta's Cloud API](#whatsapp-order-alerts-through-metas-cloud-api).
A supplier's **WhatsApp** button uses neither: it opens that supplier's chat in WhatsApp on the
PC, from the shop's own number.

### 3) Frontend (Electron desktop)

```bash
cd frontend
npm install                     # downloads Electron (large)
cp .env.example .env            # VITE_API_BASE_URL → your API URL
npm run dev
```

> The renderer also runs in a plain browser (http://localhost:5173) for quick UI work; token
> storage and receipt printing fall back to browser equivalents when not inside Electron.

### Running both with one command

After steps 1 and 3, `npm start` from the repo root does both: it starts the Django dev server
with `backend/venv`, waits for it on port 8000, then runs `npm run dev` in `frontend/`. Closing
the app window (or pressing Ctrl+C) stops both. When the WhatsApp sidecar is installed (step 2),
it starts too and stops with the rest; if it stops on its own, the app keeps running without
WhatsApp.

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
| Supplier's WhatsApp chat  | Yes         | Yes                        |

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

**Unknown addresses** — anything under `/api/`, and any request that asks only for JSON, gets
`404 {"code": "NOT_FOUND", "detail": "Not found."}`. A browser gets a "page not found" page in
Arabic or English (`?lang=en`) with a link to the shop (`SHOP_SITE_URL`): a bee looks for the
page, gives up and flies off. While `DEBUG` is on, Django shows its own debug page instead.

## Tests

```bash
cd backend && python manage.py test --parallel 4   # 338 tests, ~85s
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

## Languages (Arabic / English)

The desktop app starts in Arabic and also runs in English. Switch with the language button in
the header or on the login screen; the choice is remembered per terminal, so a terminal switched
to English stays in English. Arabic lays the whole app out
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

## Website (apps.webshop)

The online shop, fatheetkheer.com, and its orders admin, orders.fatheetkheer.com, are two
static sites in the separate **fatheet-kheer** repository, uploaded to cPanel. This server is
their only backend: the `apps.webshop` module serves their API under `/api/shop/`, so the
website sells from the same products, stock and photos as the tills.

- **Web orders wait for an InstaPay deposit.** An order is priced here and reserves its items
  (counted against stock for other customers, not taken from it). The customer pays a deposit
  by InstaPay and reports the reference; unpaid orders expire and release their items.
- **Staff work them from the orders admin** with their cashier login (same roles: cashiers
  work orders; settings, catalogue, videos and refunds need a super admin).
- **The cashier app does the same.** Cashiers work web orders on its Website Orders page.
  Super admins get a **Website** tab instead, with the orders admin's pages in a navbar of its
  own: board, all orders, website catalogue, videos, events, healthy swaps and settings. The
  Products page shows whether each product is on the website and opens its page there, and
  the category list links to each category's page.
- **Hand-over rings up a normal sale** through `OrderCreateSerializer`: stock leaves through
  the ledger, a receipt number is issued, the deposit is a MOBILE tender, the balance is cash,
  card or wallet (cash lands in the open shift's drawer), and discounts need the manager PIN
  as at the till (a game prize excepted, below). The web order's id is the sale's
  `client_uuid`, so it can never be sold twice.
- **Games and prizes.** The website's games are switched on and off in the settings (orders
  admin, or the Website tab), and a good score can win a share off the goods of the next web
  order, on terms a super admin sets there (`apps/webshop/prizes.py`). The score is checked
  here; the code it wins is kept to the phone number it was won with, for a week, and a
  number wins once a week. The prize comes off the goods before the deposit is worked out, and
  at hand-over it is the sale's own order discount: authorised already, it asks for no manager
  PIN, though any other discount on the sale still does, and the audit log records it like
  any other.
- Web sales appear in Orders, reports and the HQ daily report like any other sale, with the
  note "Web order FK-...".
- **WhatsApp alerts.** Every order sends the shop a WhatsApp the moment it is placed, and a
  delivery sends another when the customer reports the deposit, with the transfer screenshot
  (`apps/webshop/alerts.py`). They go to the number in the website settings (the store number
  unless another is set): through Meta's Cloud API when it is set up, straight from the
  server, so they arrive with every PC at the shop off (see
  [below](#whatsapp-order-alerts-through-metas-cloud-api)); otherwise from the account paired
  with the sidecar. Website → Settings checks that they can get through, and every one is
  logged (`WhatsAppMessage`, in the Django admin), sent or failed.

Configure it in `backend/.env` (see `.env.example`): `SHOP_SITE_URL`, `SHOP_ORDERS_URL` (both
are allowed through CORS automatically), and optionally `SHOP_STORAGE_ID`, `SHOP_TERMINAL`,
`SHOP_VIDEO_MAX_MB`. Uploaded videos are stored under `MEDIA_ROOT` and streamed from `/media/`.

**The server must be reachable from the internet** for the website to work: run it on cPanel
(see [The server on cPanel](#the-server-on-cpanel)), or keep it at the shop and publish it as
`api.fatheetkheer.com` through a Cloudflare Tunnel (add that name to `ALLOWED_HOSTS` and set
`SHOP_NUM_PROXIES=1`; the fatheet-kheer README has those steps).

## WhatsApp order alerts through Meta's Cloud API

With the Cloud API set up, the server hands the website's order alerts to Meta over HTTPS, so
they arrive with every PC at the shop off, and the sidecar is not needed for them. Meta delivers
a business's messages only as templates it has approved, so each alert is a fixed Arabic
template with the order filled in (`apps/webshop/alerts.py`): a new pickup, a new delivery, and
a reported deposit. The deposit one comes under the transfer screenshot when there is one, and
carries what checking the transfer needs (the address and items were in the first alert). If
the screenshot cannot go, the alert still goes as text. Meta charges each alert at its utility
rate for Egypt (see Meta's rate card); a busy or briefly unreachable Meta is tried again.

One-time setup:

1. **A number to send from**, not on WhatsApp: a new SIM is simplest. The alerts go to the
   shop's WhatsApp Business number (+20 15 53211120, or the number set in Website → Settings),
   and a number cannot message itself. Keep the shop's number off the API: Meta takes a WhatsApp
   Business app number onto it only once it is deleted from the app, catalogue and chats
   included, unless onboarded through a Meta partner that offers "coexistence".
2. **A Meta app**: at [developers.facebook.com](https://developers.facebook.com) create an app of
   type Business, add the **WhatsApp** product and connect a WhatsApp Business Account. Under
   WhatsApp → API Setup add the number and verify it by SMS or call. Note the **Phone number
   ID** and **WhatsApp Business Account ID** shown there, and the **App ID**.
3. **In WhatsApp Manager** ([business.facebook.com](https://business.facebook.com)): set the
   number's display name (e.g. فاتحة خير) and **add a payment method**; without one Meta
   delivers no template.
4. **A token that does not expire**: Business settings → Users → System users → Add (Admin).
   Assign it the app and the WhatsApp account (full control), then Generate token for the app
   with `whatsapp_business_messaging` and `whatsapp_business_management`, set to never expire.
   Keep it only in `.env`: it can send as the shop.
5. **In `backend/.env`** (on cPanel, the server's `.env`), then restart the server:

   ```
   WHATSAPP_CLOUD_TOKEN=<the system user's token>
   WHATSAPP_CLOUD_PHONE_ID=<Phone number ID>
   WHATSAPP_CLOUD_WABA_ID=<WhatsApp Business Account ID>
   WHATSAPP_CLOUD_APP_ID=<App ID>
   ```

6. **Templates, then a test**:

   ```bash
   python manage.py whatsapp_cloud templates   # once: submits them for Meta's review
   python manage.py whatsapp_cloud status      # the sending number, where alerts go, each template's status
   python manage.py whatsapp_cloud test        # a sample alert to the alert number (or --to 01xxxxxxxxx)
   ```

   Meta reviews within minutes, at most a day. Website → Settings in the cashier app turns green
   once the three templates an alert needs are approved.

To change an alert's wording, change it in `alerts.py` and edit that template the same way in
WhatsApp Manager (Meta reviews it again), or give it a new name and run `whatsapp_cloud
templates`. Without `WHATSAPP_CLOUD_TOKEN` and `WHATSAPP_CLOUD_PHONE_ID`, alerts go through the
sidecar as before.

## The server on cPanel

The backend runs on a cPanel host as a Python app, so the website and the tills reach it at
`https://api.fatheetkheer.com` whether or not anything at the shop is on. The plan needs **Setup
Python App** (Python 3.10 or newer, 3.12 if offered), **PostgreSQL Databases**, **Terminal** (or
SSH) and **Cron Jobs**. The WhatsApp sidecar cannot run there (it keeps Chromium running day and
night), so order alerts go through [Meta's Cloud API](#whatsapp-order-alerts-through-metas-cloud-api).

1. **Subdomain**: Domains → create `api.fatheetkheer.com`, and turn on AutoSSL for it.
2. **Database**: PostgreSQL Databases → create a database and a user, and add the user to it.
3. **Code**: put this repo's `backend/` folder in your home folder, outside `public_html`, e.g.
   `~/cashier/backend` (Git Version Control, or upload it).
4. **Python app**: Setup Python App → Create: Python 3.12, application root `cashier/backend`,
   application URL `api.fatheetkheer.com`, startup file `passenger_wsgi.py`, entry point
   `application`.
5. **Settings**: create `~/cashier/backend/.env` (the server reads it by itself):

   ```
   DEBUG=False
   SECRET_KEY=<a long random string>
   ALLOWED_HOSTS=api.fatheetkheer.com
   DATABASE_URL=postgres://<db user>:<password>@localhost:5432/<database>
   SHOP_SITE_URL=https://fatheetkheer.com
   SHOP_ORDERS_URL=https://orders.fatheetkheer.com
   SHOP_NUM_PROXIES=0     # 1 when the subdomain goes through Cloudflare's proxy (orange cloud)
   STATIC_ROOT=/home/<cpanel user>/api.fatheetkheer.com/static
   MEDIA_ROOT=/home/<cpanel user>/cashier/media
   WHATSAPP_CLOUD_TOKEN=...   # and the other Cloud API settings, above
   ```

6. **Install**: in Terminal, run the command Setup Python App shows at the top of the app's page
   (it enters the app's virtualenv and folder), then:

   ```bash
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py collectstatic --noinput
   python manage.py createsuperuser
   ```

   Restart the app in Setup Python App. `https://api.fatheetkheer.com/api/` should answer with
   JSON saying you are not signed in.
7. **Cron Jobs**, only with HQ reporting: once a day at `REPORT_TIME`,
   `cd ~/cashier/backend && <the virtualenv's python> manage.py send_daily_report`.
8. **Tills**: set `VITE_API_BASE_URL=https://api.fatheetkheer.com/api` in `frontend/.env` and
   publish a release ([RELEASE.md](RELEASE.md)). Every till switches as it updates, so move the
   data first. Installed tills need no CORS setting; a dev run (`npm run dev`) against this
   server needs `CORS_ALLOWED_ORIGINS=http://localhost:5173`.

**Moving data** from a server already in use, while no till is selling: on the old one
`python manage.py dumpdata --natural-foreign --natural-primary -e contenttypes -e auth.permission
-e sessions -o data.json`, and on cPanel, after `migrate`, `python manage.py loaddata data.json`.
Copy the old `MEDIA_ROOT` (website videos) too.

**Updating**: put the new code in place, then in the virtualenv run `pip install -r
requirements.txt`, `python manage.py migrate` and `python manage.py collectstatic --noinput`,
and restart the app (Setup Python App, or `touch tmp/restart.txt` in the application root).

With the server online rather than on the shop's network, the tills need the internet for
everything except ringing up sales, which they bank offline and send when it is back. If a
website video will not upload, the host's upload limit (often ModSecurity) is lower than
`SHOP_VIDEO_MAX_MB`: raise it, or switch ModSecurity off for the API subdomain.

## Not yet implemented

- **Tax** — fields and config exist, but no tax rules engine or per-product tax class.
- **Loyalty / store credit / layaway**, gift cards.
- **Product variants**, batch/lot + expiry tracking, serial numbers.
- **Scale integration** — weighed items are keyed in, not read from a scale.
- **Multi-currency** and cash rounding rules.
- **Per-branch data scoping** within one database (each branch currently runs its own).

## Notes

- whatsapp-web.js is **unofficial** (drives WhatsApp Web via Puppeteer) and can break on WhatsApp
  updates; it is isolated in its own service so POS is never affected. Order alerts can go
  through Meta's official Cloud API instead, which needs no sidecar (see above).
- Local dev uses SQLite; the Docker stack uses PostgreSQL. The backend is DB-agnostic via
  `DATABASE_URL`.
