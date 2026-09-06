# CoopInsight AI

A cooperative management and oversight platform for Gasabo District, Rwanda.

Cooperatives in Gasabo keep their records in paper ledgers, spreadsheets and, in
one case, an external hard drive. The Rwanda Cooperative Agency (RCA) supervises
them through sector officers who collect returns by hand. CoopInsight AI puts
the whole chain — member registers, finances, activities, and the RCA oversight
hierarchy above them — into one system, and adds analytics that tell an officer
where to look.

Built with real data: the seven cooperatives in this system are real
organisations from the Gasabo RCA sector register, with their real office-bearers
and sector officers.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Running it on a new machine](#running-it-on-a-new-machine)
- [Test accounts](#test-accounts)
- [Feature walkthrough](#feature-walkthrough)
- [The AI service](#the-ai-service)
- [Design decisions worth defending](#design-decisions-worth-defending)
- [Known limitations](#known-limitations)
- [Testing](#testing)
- [Project layout](#project-layout)

---

## What it does

**For a cooperative** — a manager keeps the member register, records income and
expenses, plans and runs activities, uploads governance documents, and sees the
cooperative's own health score and AI insights.

**For a member** — sees their own cooperative, their savings, and can calculate
what they would be paid out if they left, or formally request to leave.

**For a sector, district or RCA officer** — supervises every cooperative in
scope, approves or rejects applications to form and dissolve cooperatives, and
reads a monthly league table ranking every cooperative on five dimensions.

At a glance:

| | |
|---|---|
| Backend REST endpoints | 189 across 15 route modules |
| Frontend pages | 31 |
| Database tables | 38 |
| AI service endpoints | 11 |
| Seeded cooperatives | 7 real, 379 members, 18 months of history |

---

## Architecture

```
┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  React + Vite UI   │────▶│  Node/Express API   │────▶│  PostgreSQL      │
│  :5173             │ JWT │  :5000              │     │  38 tables       │
└────────────────────┘     └──────────┬──────────┘     └────────▲─────────┘
                                      │                          │
                                      │ HTTP (degrades           │ read-only
                                      │  gracefully if down)     │
                                      ▼                          │
                           ┌─────────────────────┐               │
                           │  Python FastAPI     │───────────────┘
                           │  AI service :8000   │
                           └─────────────────────┘
```

Three independent processes. **The UI never talks to the AI service directly** —
everything goes through the Node backend, which holds the auth and the role
gating. If the AI service is not running, the backend returns
`reachable: false` and the app keeps working with the AI panels empty.

The AI service reads the same PostgreSQL database **read-only**. This is forced
by the contract rather than chosen: the backend passes only a `cooperativeId`,
never the rows, so the service fetches its own features. It owns no tables and
issues no writes — anomalies it returns are persisted by the *backend*.

**Stack:** React 18 · TypeScript · Vite · Tailwind · React Router · Recharts ·
Express · PostgreSQL (raw SQL, no ORM) · JWT with OTP · FastAPI · NumPy ·
scikit-learn

---

## Running it on a new machine

Everything runs locally. You need **Node 18+**, **Python 3.11+** and
**PostgreSQL 14+** installed and on your PATH.

### 1. Clone and create the database

```bash
git clone https://github.com/N-Hosana/CoopInsight-Ai.git
cd CoopInsight-Ai

createdb coopinsight_ai
# or:  psql -U postgres -c "CREATE DATABASE coopinsight_ai;"
```

### 2. Backend

```bash
cd "CoopInsightAI Backend"
pnpm install                 # or: npm install

cp .env.example .env
#   → set DATABASE_URL to your Postgres connection string
#   → set JWT_SECRET and JWT_REFRESH_SECRET to any long random strings:
#     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

psql -d coopinsight_ai -f src/db/schema.sql   # create the 38 tables
pnpm migrate                                  # apply later additions (idempotent)
pnpm seed                                     # load the 7 cooperatives + 18 months
pnpm dev                                      # → http://localhost:5000
```

`pnpm seed` is **destructive** — it wipes all cooperative data and rebuilds it.
That is intended; it is how you get a known-good demo state.

### 3. AI service

```bash
cd "CoopInsightAI AI"
python -m venv .venv

# Windows
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
# macOS / Linux
# source .venv/bin/activate && pip install -r requirements-dev.txt

cp .env.example .env
#   → set DATABASE_URL to the SAME database as the backend

.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
# macOS/Linux: uvicorn app.main:app --reload --port 8000
```

Then fit the models once against the seeded data:

```bash
curl -X POST http://localhost:8000/retrain -H "Content-Type: application/json" -d "{}"
```

Without this, the AI pages still work but `/model-performance` reports
`not_trained` — fitted parameters live in `model_store/`, which is gitignored, so
a fresh clone starts unfitted.

### 4. Frontend

```bash
cd "CoopInsightAI UI"
pnpm install                 # or: npm install
pnpm dev                     # → http://localhost:5173
```

`.env.local` already points at `http://localhost:5000/api`. Change it only if you
moved the backend.

### Health check

Open <http://localhost:5000/> — you should see the API banner. Open
<http://localhost:8000/docs> for the AI service's interactive docs. Then log in
at <http://localhost:5173> with any account below.

> **Note on package managers.** The backend uses **pnpm**. The UI has both a
> `pnpm-lock.yaml` and a `package-lock.json`; prefer `pnpm` for consistency, but
> `npm install` works too.

---

## Test accounts

Login is two-step: password, then a 6-digit code. **In development the code is
returned in the login response and printed to the backend console** — there is no
need for a working email provider. The login screen displays it for you.

| Role | Email | Password | Sees |
|---|---|---|---|
| Admin | `admin@coopinsight.rw` | `Admin@1234` | Everything |
| Cooperative manager | `manager@coopinsight.rw` | `Manager@1234` | TMC only |
| Member | `member@coopinsight.rw` | `Member@1234` | Own membership |
| RCA officer | `gov@coopinsight.rw` | `Gov@1234!` | District-wide oversight |
| District officer | `district.officer@coopinsight.rw` | `Officer@1234` | Second approval stage |
| Sector officer | `gisozi.officer@coopinsight.rw` | `Officer@1234` | Gisozi sector |

Other sector officers follow the same pattern:
`kimihurura.officer@`, `kinyinya.officer@`, `nduba.officer@`, `remera.officer@`
— all with `Officer@1234`.

The manager and member accounts are real people from the register: **RUKUNDO
Emmanuel** (President of TMC) and **UWIHOREYE Josephine** (Secretary).

---

## Feature walkthrough

### The cooperatives

Seven real cooperatives from the Gasabo RCA sector register:

| Cooperative | Type | Sector | Members |
|---|---|---|---|
| ADARWA | Carpentry | Gisozi | 30 |
| COPCOM | Construction | Gisozi | 66 |
| UNITAX (United Taximen) | Transport | Kimihurura | 37 |
| COTAVOGA (Taximen Voiture de Gacuriro) | Transport | Kinyinya | 44 |
| ZAMUKA (Zamuka Muhinzi wa Kagunga) | Agriculture | Nduba | 92 |
| TMC (Trust Multiservices) | Services | Remera | 49 |
| FODECO (Forced Development) | Trading | Remera | 61 |

Each carries its real President, Vice President and Secretary, plus the sector
cooperative officer who supervises it.

### Core management

- **Cooperative profile** — registration details, leadership, health score,
  document repository with real file upload.
- **Member register** — add, edit, suspend members; per-member savings,
  contributions, loans, dividends and activity history.
- **Financials** — record income and expenses, transaction approval workflow,
  cancellation with reason, financial summary.
- **Activities** — plan meetings, trainings, production and sales events; track
  attendance, budget against actual cost.
- **Reports & budgets** — generate and schedule reports, plan budgets by line.
- **Messages, notifications, settings, security audit log.**

### Membership exit *(member-facing)*

A member can request removal from their cooperative with a stated reason, a
preferred exit date, and an instruction for their savings. The request is
stamped with a **14-day response deadline** that never moves, tracked with a live
countdown, and can be withdrawn any time before a decision. Managers approve or
reject with a note; approval removes the member from the register and unlinks
their login.

### Share settlement calculator

Answers "what do I walk away with?" — own funds (savings + share capital +
levies), **plus a share of what the cooperative itself is worth**, less
outstanding loans. Net worth comes from the latest balance sheet; with none on
file it is estimated from transaction history and the response says so. Every
figure is shown, with the formula and a disclaimer that the binding number is the
audited one.

### Cooperative formation and dissolution

A pipeline that escalates **sector → district → RCA**. Each level approves,
returns for more information, or rejects with a note; a request forwards
automatically to the next stage. Final RCA approval takes effect immediately —
a formation registers the cooperative, a dissolution strikes it off.

Formation applications are vetted against **11 published criteria** (minimum 7
founding members, RWF 100,000 share capital, unique name checked against the live
register, bylaws, constitutive assembly minutes, member list, and more). An
automated assessor scores the application and predicts eligibility before an
officer reads it.

### District league table

Ranks every cooperative monthly on five dimensions — finance, growth,
engagement, governance, scale — each converted to a **percentile within that
month's cohort**, then combined with published weights. Shows rank movement
month-over-month, a podium, 18 months of selectable history, CSV export, and an
expandable row per cooperative revealing the raw figures behind its score.

Restricted to RCA, district and admin roles.

---

## The AI service

Five capabilities, all reading live data:

| Capability | Method |
|---|---|
| **Anomaly detection** | Robust median/MAD z-scores against a district-wide baseline, plus IsolationForest |
| **Forecasting** | Damped trend, chosen over a flat mean by out-of-sample holdout error |
| **Member engagement** | Transparent weighted index, cohort-relative |
| **Peer benchmarking** | Ratio comparison, sector-first, reported as percentile |
| **District league table** | Percentile-ranked weighted composite |

Last measured performance against the seeded data:

| Model | Metric | Value |
|---|---|---|
| `anomaly_detector` | flag rate | 1.01% |
| `savings_forecaster` | accuracy (1 − median scaled error) | 0.94 |
| `member_engagement_scorer` | coverage | 1.00 |
| `peer_benchmarker` | coverage | 1.00 |
| `district_league` | separation | 0.83 |

Full detail, including why each method was chosen, is in
[`CoopInsightAI AI/README.md`](CoopInsightAI%20AI/README.md).

---

## Design decisions worth defending

**Why statistics and not deep learning.** There are no labels anywhere in the
schema — no row records "this transaction was fraudulent" or "this member
disengaged". Supervised learning needs a target to learn; there isn't one. With
~300 transactions across 7 cooperatives, a neural network would memorise noise
and report an accuracy that means nothing. What runs instead is robust
statistics, a fitted time-series model, one genuine unsupervised model
(IsolationForest), and two transparent scoring schemes. The model registry is
built so a trained model drops into any slot without changing an endpoint.

**Why median/MAD rather than mean/standard deviation.** A single extreme value
inflates the standard deviation enough to hide itself: the classic z-score of the
largest point in a sample of *n* can never exceed `√(n−1)`, so on 7 transactions
it *cannot* reach the usual 3.5 threshold no matter how extreme. Median/MAD does
not have this failure. There is a test pinning it.

**Why percentile ranking rather than absolute targets.** It makes a 30-member
carpentry workshop comparable with a 92-member farming cooperative. Absolute
thresholds either bunch everyone at the top or the bottom depending on where you
set them.

**Why missing data is excluded, never scored zero.** A cooperative that held no
activity in a month is not scored zero on governance — the dimension is dropped
from its composite and listed as unmeasured. Punishing poor record-keeping as if
it were poor performance would make the ranking indefensible the first time a
cooperative challenged it. The same rule applies to member engagement.

**Why the AI service is read-only.** It can never corrupt operational data, and
it can be pointed at a read replica later without a code change.

**Why the oversight hierarchy reuses the `government` role.** Sector, district
and RCA officers are `role='government'` distinguished by an `oversight_level`
column, rather than three new role values. Adding to the `users.role` check
constraint would have forced changes to authorisation and UI gating across the
whole application for no functional gain.

**Why source-data gaps are preserved rather than filled.** The RCA register does
not record COPCOM's president's name, UNITAX's vice-president's phone is
truncated, and UNITAX's secretary post is vacant. These are stored as NULL or
"(Name not recorded)" and surfaced in the UI, not invented. Fabricating them
would put unverifiable data in front of a government officer.

---

## Known limitations

Stated plainly, because a defence goes better when you raise them first.

- **The demo data is generated.** Each cooperative's monthly trading derives from
  its seeded health score, so cooperatives seeded as well-run genuinely do rank
  higher. The rankings are correctly computed and explainable, but they are not a
  discovery about real cooperatives. Two cooperatives carry a deliberately
  anomalous transaction marked `[demo anomaly]` so detection has something to
  find.
- **Formation eligibility checks that a document was attached, not what is in
  it.** Reading document contents is the natural next capability for the AI
  service.
- **Email and SMS are not wired to live providers.** OTP codes are returned in
  the dev login response. Africa's Talking and Resend keys are optional.
- **File uploads go to local disk** (`uploads/`, served at `/uploads`), not S3.
  The AWS keys in `.env.example` are placeholders.
- **Some secondary tabs still show sample data** — parts of Integrations,
  GovernmentMonitoring's agent-activity view, and SecurityAudit's encryption tab.
  These are labelled in the UI and would need new backend endpoints.
- **Export buttons produce client-side files**, not server-rendered PDFs.
- **The frontend bundle is ~1 MB** and not yet code-split.

---

## Testing

See **[docs/TESTING.md](docs/TESTING.md)** for a full manual walkthrough of every
feature and the automated checks.

Quick version:

```bash
# AI service unit tests — 29 tests, no database needed
cd "CoopInsightAI AI" && .\.venv\Scripts\python.exe -m pytest tests/ -q

# Type checking
cd "CoopInsightAI Backend" && npx tsc --noEmit
cd "CoopInsightAI UI"      && npx tsc --noEmit

# Production builds
cd "CoopInsightAI Backend" && pnpm build
cd "CoopInsightAI UI"      && pnpm build
```

All four typecheck and build clean.

---

## Project layout

```
CoopInsight AI/
├── CoopInsightAI Backend/        Node + Express + TypeScript
│   ├── src/
│   │   ├── config/db.ts          PostgreSQL pool
│   │   ├── db/
│   │   │   ├── schema.sql        38 tables — run once on a fresh database
│   │   │   ├── migrate.ts        Idempotent later additions (pnpm migrate)
│   │   │   └── seed.ts           The 7 cooperatives + 18 months of history
│   │   ├── middleware/           auth (JWT), upload (multer)
│   │   ├── routes/               15 modules, 189 endpoints
│   │   └── services/eligibility.ts  Formation criteria — single source of truth
│   └── uploads/                  Local file storage (gitignored)
│
├── CoopInsightAI UI/             React + Vite + TypeScript
│   └── src/app/
│       ├── App.tsx               Router, navigation, role gating
│       ├── contexts/             Auth (OTP flow), theme, notifications
│       ├── components/           Shared UI + shadcn primitives
│       ├── pages/                31 pages
│       └── services/api.ts       API client with token refresh
│
├── CoopInsightAI AI/             Python + FastAPI
│   ├── app/
│   │   ├── features.py           All SQL — one place per feature
│   │   ├── registry.py           Fitted parameters + metrics
│   │   ├── analytics/            anomalies, forecasting, engagement,
│   │   │                         benchmarks, rankings
│   │   └── routers/              11 endpoints
│   └── tests/                    29 tests, no database required
│
└── docs/TESTING.md               Feature-by-feature test guide
```

---

## Author

**N-Hosana** — Final Year Project, 2026.
