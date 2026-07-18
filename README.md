# Cashier / POS System

A point-of-sale system for stores: a **Django REST API** backend, an **Electron + React desktop**
frontend, and a small **Node WhatsApp sidecar**. Designed for a networked store — one server
(PostgreSQL + API + WhatsApp) with one or more Electron cashier terminals on the LAN.

For chains, each store runs its own copy (one **branch**) and automatically sends a **daily report
to a central HQ** service that aggregates and compares all branches.

## Features

- **Roles** — Super Admin (full CRUD) and Cashier (read-only catalog, can ring up sales).
- **Products & inventory** — categories, products, multiple storage locations, and a stock
  **ledger** (`StockMovement`) so every change is auditable; product stock is derived from it.
- **Orders (POS)** — transactional checkout that snapshots prices, computes totals, and
  decrements stock atomically (rolls back if any line is short).
- **Customers** — with phone, address and order history.
- **Suppliers + WhatsApp** — send a message to a supplier from inside the app via an embedded
  WhatsApp session (whatsapp-web.js); pair once by scanning a QR shown in the admin UI.
- **Dashboard** — monthly sales chart (Recharts), KPI cards, low-stock list, recent orders.
- **Receipt printing** — prints a formatted receipt after each sale (Electron print dialog / PDF).
- **HQ daily reporting** — each branch (identified by code + name) auto-sends an end-of-day report
  (sales totals, order count, payment breakdown, top products, low-stock) to a central HQ service
  that stores it and shows a cross-branch dashboard. Resilient (retry + idempotent upsert).

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
  backend/            Branch Django project (apps: accounts, products, inventory,
                      customers, suppliers, orders, whatsapp, reports, hqsync)
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

| Resource              | Super Admin | Cashier        |
|-----------------------|-------------|----------------|
| Users                 | CRUD        | —              |
| Products / Categories | CRUD        | Read           |
| Storage / Stock       | CRUD        | Read           |
| Stock movements       | Create/Read | —              |
| Customers             | CRUD        | Create/Read/Update |
| Orders (checkout)     | Create/Read | Create/Read    |
| Suppliers             | CRUD        | Read           |
| Send WhatsApp         | Yes         | Yes            |

## API overview

`POST /api/auth/login` · `POST /api/auth/refresh` · `GET /api/auth/me` ·
CRUD routers under `/api/{users,categories,products,storages,stock,stock-movements,customers,suppliers,orders}/` ·
`GET /api/whatsapp/status` · `POST /api/suppliers/{id}/whatsapp/` ·
`GET /api/reports/{summary,monthly-sales,low-stock}` ·
`GET /api/branch` · `GET /api/daily-reports` · `POST /api/daily-reports/send-now` (admin).

HQ ingest (called by branches): `POST /api/ingest/daily-report/` (auth: `X-Branch-Code` + `X-Api-Key`).

## Tests

```bash
cd backend && python manage.py test     # branch: permissions, checkout, reports, HQ sync
cd hq && python manage.py test          # HQ: ingest auth, upsert, dashboard access
```

Covers role permissions, checkout stock decrement + rollback, monthly-sales aggregation, the daily
report build/send (mocked) + idempotency, and HQ ingest auth + upsert.

---

## Suggested enhancements

1. **Supplier purchase orders / deliveries** — formal restock flow writing `PURCHASE` movements.
2. **Barcode scanning** — USB scanners act as keyboard input; add a focused field on the POS page.
3. **Low-stock automation** — the data is there (`reorder_level`); add alerts and a one-click
   "WhatsApp this supplier to reorder".
4. **Reports export** — CSV/PDF of monthly sales and inventory.
5. **Order cancellation/returns** — restock on cancel (orders are currently immutable once placed).
6. **Audit log, multi-currency/tax config, per-branch data scoping** for multiple stores.

## Notes

- whatsapp-web.js is **unofficial** (drives WhatsApp Web via Puppeteer) and can break on WhatsApp
  updates; it is isolated in its own service so POS is never affected. For high volume consider
  the official WhatsApp Business Cloud API.
- Local dev uses SQLite; the Docker stack uses PostgreSQL. The backend is DB-agnostic via
  `DATABASE_URL`.
