# CoopInsight AI

**A cooperative management and oversight platform for Gasabo District, Rwanda.**

Cooperatives in Gasabo keep their records in paper ledgers and spreadsheets, and
the Rwanda Cooperative Agency (RCA) supervises them through sector officers who
collect returns by hand. Problems — a cooperative that has quietly stopped
trading, savings that do not add up, an assembly that never sat — are usually
discovered long after anything can be done about them.

CoopInsight AI puts the whole chain into one system: the cooperative's own
register, books and activities; the member's view of their savings and rights;
and the **sector → district → RCA** oversight hierarchy above them. On top of
that it adds an analytics service that tells an officer *where to look*.

The data is real. The seven cooperatives in the system come from the Gasabo RCA
sector register, with their real office-bearers and sector cooperative officers.

---

## Contents

1. [At a glance](#at-a-glance)
2. [Architecture](#architecture)
3. [Getting started](#getting-started)
4. [Test accounts](#test-accounts)
5. [Who does what](#who-does-what)
6. [Features](#features)
7. [Governance: the RCA rulebook](#governance-the-rca-rulebook)
8. [The cooperative lifecycle](#the-cooperative-lifecycle)
9. [The AI service](#the-ai-service)
10. [Design decisions](#design-decisions)
11. [Known limitations](#known-limitations)
12. [Testing](#testing)
13. [Project layout](#project-layout)

---

## At a glance

| | |
|---|---|
| Backend REST endpoints | **279** across **21** route modules |
| Frontend routes / pages | **40** |
| Database tables | **63** (PostgreSQL, raw SQL, no ORM) |
| AI service endpoints | **13** |
| AI service unit tests | **58** (no database required) |
| Seeded data | 7 real cooperatives, 379 members, 18 months of history |
| User roles | member · manager · sector / district / RCA officer · general manager · admin |

**Stack**

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 4, React Router 7, Recharts, shadcn/Radix UI |
| Backend | Node.js, Express 4, TypeScript, `pg`, JWT + one-time-code login, multer (uploads), pdfkit (PDFs) |
| Database | PostgreSQL 14+ |
| AI service | Python 3.11+, FastAPI, NumPy, scikit-learn, psycopg 3 |
| Optional | Supabase Auth (email codes), Africa's Talking (SMS) |

---

## Architecture

```
┌────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│  React + Vite UI   │─────▶│  Node / Express API  │─────▶│   PostgreSQL     │
│  :5173             │ JWT  │  :5000               │ R/W  │   63 tables      │
└────────────────────┘      └──────────┬───────────┘      └────────▲─────────┘
                                       │ HTTP                       │
                                       │ (degrades gracefully       │ read-only
                                       │  if the service is down)   │
                                       ▼                            │
                            ┌──────────────────────┐                │
                            │  Python FastAPI      │────────────────┘
                            │  AI service :8000    │
                            └──────────────────────┘
```

Three independent processes:

- **The UI never calls the AI service directly.** Every request goes through the
  Node backend, which owns authentication, role scoping and persistence. All AI
  calls pass through one client, `services/aiClient.ts`.
- **The AI service is read-only.** The backend sends it only a `cooperativeId`,
  so the service reads its own features from the same database — but it owns no
  tables and writes nothing. Anything it returns that must be kept (anomalies,
  monthly audit results, field visits) is persisted by the backend.
- **Graceful degradation.** If the AI service is not running, the backend
  returns `reachable: false` and the rest of the application keeps working with
  the AI panels empty.

---

## Getting started

You need **Node 18+**, **pnpm** (or npm), **Python 3.11+** and **PostgreSQL 14+**.

### 1. Clone and create the database

```bash
git clone https://github.com/N-Hosana/CoopInsight-Ai.git
cd CoopInsight-Ai
createdb coopinsight_ai
```

### 2. Backend — `http://localhost:5000`

```bash
cd "CoopInsightAI Backend"
pnpm install
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
psql -d coopinsight_ai -f src/db/schema.sql
pnpm migrate                  # apply later additions (idempotent)
pnpm seed                     # load the 7 cooperatives + 18 months of history
pnpm dev
```

- Generate secrets with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `pnpm seed` is **destructive**: it wipes cooperative data and rebuilds a known
  demo state.
- **Migrations do not run on server start.** After pulling changes that touch
  `src/db/ddl.ts`, run `pnpm migrate` again.

### 3. AI service — `http://localhost:8000`

```bash
cd "CoopInsightAI AI"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt     # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt    # macOS / Linux
cp .env.example .env          # DATABASE_URL must point at the SAME database
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Fit the models once against the seeded data (fitted parameters live in the
gitignored `model_store/`, so a fresh clone starts unfitted):

```bash
curl -X POST http://localhost:8000/retrain -H "Content-Type: application/json" -d "{}"
```

### 4. Frontend — `http://localhost:5173`

```bash
cd "CoopInsightAI UI"
pnpm install
pnpm dev
```

`.env.local` already points `VITE_API_URL` at `http://localhost:5000/api`.

### 5. First run

1. Open <http://localhost:5000/> (API banner) and <http://localhost:8000/docs>
   (AI service docs) to confirm both are up.
2. Sign in at <http://localhost:5173> with an account below.
3. The **monthly audit** is not run by the seed because it needs the AI service.
   Sign in as the RCA officer, open **Monthly audit** and press *Run this
   month's audit* to score every cooperative and raise field visits.

### Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Backend, AI | yes | Same PostgreSQL database for both |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Backend | yes | Token signing |
| `AI_SERVICE_URL` | Backend | no | Defaults to `http://localhost:8000` |
| `CLIENT_URL` | Backend | no | CORS origin in production |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Backend | no | Email delivery of login codes |
| `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` | Backend | no | SMS via Africa's Talking |
| `MODEL_STORE` | AI | no | Where fitted models are written |
| `VITE_API_URL` | UI | no | Backend URL including `/api` |

---

## Test accounts

Login is two steps: password, then a 6-digit code. **In development the code is
returned in the login response, shown on the login screen and printed to the
backend console**, so no email provider is needed. If Supabase is configured it
also emails a code; either is accepted.

| Role | Email | Password | Scope |
|---|---|---|---|
| Member | `member@coopinsight.rw` | `Member@1234` | Own membership (UWIHOREYE Josephine, Secretary of TMC) |
| Cooperative manager | `manager@coopinsight.rw` | `Manager@1234` | TMC only (RUKUNDO Emmanuel, President of TMC) |
| **1.** Sector officer | `remera.officer@coopinsight.rw` | `Officer@1234` | Remera sector — where TMC sits |
| **2.** District officer | `district.officer@coopinsight.rw` | `Officer@1234` | Gasabo district |
| **3.** RCA officer | `gov@coopinsight.rw` | `Gov@1234!` | District-wide oversight, final decision |
| Admin | `admin@coopinsight.rw` | `Admin@1234` | Everything; may act at any stage of a chain |

Rows **1 → 2 → 3** are the approval chain in order. Anything the TMC manager or
member files lands on the Remera officer's desk first, then the district, then
the RCA. Other sector officers follow the same pattern with `Officer@1234`:
`gisozi.officer@`, `kimihurura.officer@`, `kinyinya.officer@`, `nduba.officer@`.

---

## Who does what

**A member** sees their own cooperative, their savings, contributions, loans and
dividends (**My Record**, **My finances**), their personal AI insights, and can:
calculate what they would be paid if they left; formally request to leave (a
request decided by a general assembly); **report an issue** about their
cooperative to the oversight chain; and apply to form a new cooperative.

**A cooperative manager** keeps the member register, records income, expenses,
contributions and balance sheets, plans activities and takes attendance,
convenes general assemblies, uploads governance documents, tracks the operating
permit, applies for external funding, requests RCA services and audits, produces
reports, and reads an AI brief about their own cooperative.

**A sector, district or RCA officer** supervises every cooperative in scope:
reviews requests in the chain, runs and reads the monthly audit, works the
field-visit list, reads the district league table and oversight insights,
monitors activities, runs the RCA audit programme, and broadcasts messages to
their scope.

**An administrator / general manager** sees everything, can enter records on
behalf of any cooperative, manages integrations, and is the only role that sees
**Security & audit** (login history and platform audit log).

All of this is enforced **server-side**, not by hiding buttons. The navigation is
grouped into five sections: *Overview · My cooperative · Oversight · RCA · Admin*.

---

## Features

### The cooperatives

| Cooperative | Type | Sector | Members |
|---|---|---|---|
| ADARWA | Carpentry | Gisozi | 30 |
| COPCOM | Construction | Gisozi | 66 |
| UNITAX (United Taximen) | Transport | Kimihurura | 37 |
| COTAVOGA (Taximen Voiture de Gacuriro) | Transport | Kinyinya | 44 |
| ZAMUKA (Zamuka Muhinzi wa Kagunga) | Agriculture | Nduba | 92 |
| TMC (Trust Multiservices) | Services | Remera | 49 |
| FODECO (Forced Development) | Trading | Remera | 61 |

Each carries its real President, Vice President and Secretary and the sector
cooperative officer who supervises it. Gaps in the source register (COPCOM's
president's name, UNITAX's vacant secretary post) are stored as missing, never
invented.

### Cooperative register

The register is split into views an officer actually asks for — **active**,
**not active** (with the reason: temporary permit, no permit, suspended, under
final audit, dissolving, marked inactive), **at risk** (from the latest monthly
audit), **applications**, and **dissolved**. Every count comes from the same
query that fills its list. Each row shows the cooperative's **permit** as a
badge, any open request, and its latest audit band. A breakdown groups the
register by sector (district office) or by district and sector (RCA). Sector
officers only ever see their own sector.

### Core management

- **Cooperative profile** — registration details, leadership, health score, and a
  document repository with real file upload and access-checked download.
- **Member register** — add, edit, suspend and archive members; a per-member file
  with savings against the cooperative average, contributions, loans, repayments,
  dividends, activity attendance, transactions and status history.
- **Record keeping** — a monthly checklist of what the cooperative still has to
  file, plus entry screens for transactions, batch contributions, and balance
  sheets (which must balance). Administrators choose the cooperative on each
  screen. One rule decides who may write: a manager writes only to their own
  cooperative; officers and members write to none.
- **Financials** — income and expenses with an approval workflow, cancellation
  or reversal with a reason, cooperative-wide loan, savings and dividend lists,
  financial summary, budget planning and dashboard trends.
- **One source of truth for money.** `member_contributions` is authoritative;
  database triggers keep member and cooperative savings totals equal to it, and
  every member-money entry (contribution, loan, repayment, dividend) also writes
  its matching cash-book transaction in the same database transaction.
- **Activities** — meetings, trainings, production and sales events, with an
  attendance register, budget against actual, attachments, and `.ics` calendar
  export. Every general assembly is an activity with all active members invited.
- **Messages and notifications** — direct messages, a manager's announcement to
  their cooperative, and broadcasts scoped to a sector or the district. Every
  send reports its **real reach** ("sent to 1 account; 48 more people are on the
  register without a login — use SMS"). Real-time alerts appear on every page.
- **Reports and PDFs** — real cooperative reports (income & expenditure, savings
  & shares, loan portfolio, membership, activities, compliance, audit, budget vs
  actual, annual) rendered server-side as PDFs with letterhead, narrative, totals
  and signatories, scoped to what the caller may see. Every page export uses the
  same renderer.

### Membership exit — decided by a general assembly

A member is a co-owner, so no office can sign them out. An exit request has a
fixed **14-day response deadline** and follows seven named steps, declared once
in `services/exitProcess.ts` and drawn identically for the member and the office:

| | Step | Who moves it |
|---|---|---|
| 1 | Request filed — grounds, preferred date, payment instruction | Member |
| 2 | **Extraordinary assembly convened** — 3 days' notice, broadcast to every member | Manager |
| 3 | Assembly sits and votes — attendance checked against quorum | Members |
| 4 | Resolution minuted — the system refuses impossible arithmetic | Manager |
| 5 | **Settlement recorded** — server-computed, member confirms receipt | Manager / member |
| 6 | Release recorded — only the outcome the assembly reached | Manager |
| 7 | **Certificate of past membership** issued, register entry archived | Automatic |

- First call needs **three-quarters** attendance; a second call within **3
  working days** needs **one half**; after two failed calls the matter goes to
  the National Agency and a third call is refused.
- Release is ordinary business, carried by an **absolute majority** of votes cast.
- The settlement uses the same calculator the member sees, so the two cannot
  disagree; paying less than is due requires a written explanation. **There is no
  override on the settlement step.**
- The certificate is a numbered PDF with a verification code. The member's login
  survives their membership so they can always reach it. An exit approved in
  error can be **reversed**.

### Share settlement calculator

Answers "what do I walk away with?": savings + share capital + levies, **plus a
proportional share of the cooperative's net worth** (from the latest balance
sheet, or estimated from transactions with a warning), less outstanding loans —
shown line by line with a disclaimer that the audited figure is binding.

### Requests to the RCA — one chain for everything

Formation, dissolution, the four RCA certificate services (change of objective,
added activities, change of name, duplicate certificate) and **members' issue
reports** all travel the same **sector → district → RCA** chain. Each level
approves, returns for more information, or rejects with a note. They share one
page, **Services & requests**.

- **Formation** is vetted against 11 published criteria (minimum 7 founding
  members, RWF 100,000 share capital, a unique name checked against the live
  register, bylaws, constitutive minutes…) and scored by an automated assessor
  before an officer reads it. Final approval registers the cooperative **and
  issues its first operating permit** in the same act.
- **Dissolution** is deliberately harder — see
  [the cooperative lifecycle](#the-cooperative-lifecycle).
- **RCA services** are scored against their published checklists at filing, and
  only the president (matched by name against the leadership record) may file.
- **Issue reports** give an ordinary member a way to escalate — money that does
  not add up, a committee that has stopped governing — to the officers who
  supervise the cooperative, rather than to the office they may be complaining
  about.

### RCA audits

A workflow for **general** (governance, register, compliance) and **financial**
audits, separate from the automated monthly audit:

- **Requested audits** climb from whoever asks (manager → sector → district → RCA,
  starting at the requester's own tier). The RCA officer approves with a date and
  scope, rejects, or waitlists. The approval then **relays back down** the same
  tiers to the requester, who confirms; the manager can then put it on the
  calendar and notify every member.
- **RCA-initiated audits** are announced directly and start with the
  cooperative's acknowledgement.
- **The general audit programme** tracks the routine: a sector committee visits
  its cooperatives **monthly**, a district committee **every trimester**, plus a
  trimester **sensitization session** for all cooperative leaders. Audit
  committees and their members are recorded.
- The server computes, for each viewer, which actions are allowed and whether it
  is their turn — the UI never re-derives the chain.

### External support — funders and NGOs

A register of funders and their open programmes, ranked for a cooperative on
**what it does (45%)**, **what state it is in (35%)** and **who it already knows
(20%)**, each with a plain-language reason. Hard requirements (a minimum
membership, a health score, a permanent permit) are reported as **blockers**, not
folded into a low score. Applications freeze the match at filing time; a
disbursement is posted to the cooperative's books as income in the same act.

### District league table

Every cooperative is ranked monthly on three pillars an officer can explain in
one sentence:

| Pillar | Weight | Measures |
|---|---|---|
| **Finances** | 40% | Surplus per member (60%) · growth in savings per member (40%) |
| **Member engagement** | 35% | Share of members who paid in (60%) · attendance at activities (40%) |
| **Activities delivered** | 25% | Share of planned activities completed (70%) · activities per 10 members (30%) |

Each measure is a **percentile within that month's cohort**, so a 30-member
workshop is comparable with a 92-member farm. A measure with no data is
**excluded, not scored zero**. Rank movement, 18 months of history, CSV export
and a drill-down to the raw figures are included. Restricted to oversight roles.

### AI insights, by role

- **Member** — *My insights*: their own saving and participation patterns.
- **Manager** — a **cooperative brief**: what is going well, what needs action,
  and the remedy for each finding, from the cooperative's own records.
- **Officers** — **oversight insights** at the right altitude: a sector
  officer's cooperatives, the district sector by sector, or everything for the
  RCA. A cooperative never audited is counted as *not assessed*, not given a score.
- **Admin / officers** — anomalies, forecasts, member engagement, peer
  benchmarks and model performance from the AI service.

---

## Governance: the RCA rulebook

Every rule about how a cooperative governs itself comes from the RCA brochure
*Cooperative Organs: Their Powers and Responsibilities* and Law No. 057/2024, and
is encoded **once**, in `services/governance.ts`, with each constant citing its
clause. Routes apply it; none carries a number of its own.

| Rule | Value |
|---|---|
| Ordinary assemblies | March and October |
| Notice — ordinary / extraordinary | 7 days / 3 days |
| Quorum, first call — ordinary / extraordinary | two-thirds / three-quarters |
| Quorum, second call | one half (ordinary within 7 days, extraordinary within 3 working days) |
| Two failed calls | referred to the National Agency |
| Ordinary decisions | absolute majority of votes cast |
| Reserved matters (dissolution, merger, statute change, federation, conversion) | three-quarters |
| Minutes to Sector & District / to the RCA | 3 working days / 7 days |
| Board of Directors | 5 seats (odd if larger) |
| Certificate-change assemblies | three-quarters attend, three-quarters vote; fee RWF 1,000 |
| RCA told of a dissolution decision | within 7 days |

Two kinds of rule file are deliberately kept apart. `governance.ts` is
**regulation** — changing a value asserts the law changed. `eligibility.ts`,
`permits.ts`, `funding.ts` and `rcaAudits.ts` are headed **configuration** —
working thresholds a deployment may change.

Encoding the brochure corrected four earlier rules: removal assemblies needed 3
days' notice, not 7; extraordinary first-call quorum is three-quarters, not one
half; dissolution needs three-quarters, not two-thirds; and the board has five
seats, not three. Second calls, escalation to the Agency and the minutes
deadlines did not exist before.

**Independent auditors** may act only if approved by the General Assembly from
the RCA list, and six statutory conflicts (insider, relative of an insider,
holds the assets, owes the cooperative, expelled from a cooperative, direct
interest) are checked **at engagement**, before any work is done.

---

## The cooperative lifecycle

```
  formation request                                       ┌──────────────────┐
  (sector → district → RCA)                               │  MONTHLY AUDIT   │
          │                                               │  every coop, AI  │
          ▼                                               └────────┬─────────┘
  ┌───────────────────┐   1 year   ┌──────────────────┐            │ flags
  │ TEMPORARY PERMIT  │ ─────────► │  MATURITY AUDIT  │            ▼
  └───────────────────┘            │      (RCA)       │    ┌────────────────┐
                                   └────────┬─────────┘    │  FIELD VISIT   │
                                       pass ▼              │ sector officer │
                                  ┌───────────────────┐    └───────┬────────┘
                                  │ PERMANENT PERMIT  │            ├─► support / funding referral
                                  │  30 or 50 years   │            └─► advise on dissolution
                                  └───────────────────┘                        │
                                                                               ▼
                                                                ┌──────────────────────────┐
                                                                │ DISSOLUTION (2 stages)   │
                                                                │ decision → liquidation → │
                                                                │ RCA audit → strike-off   │
                                                                └──────────────────────────┘
```

### Operating permits

A new cooperative receives a **one-year temporary permit**. A **maturity audit**
on seven criteria (actually traded, register maintained, assembly held and
minuted, members participating, books and balance sheet filed, office-bearers
recorded, governance documents present) leads to one of three outcomes: convert
to a **permanent permit** — 30 years, or **50 years** for industrial and
rice-growing cooperatives whose capital outlives a shorter licence — extend the
temporary permit with conditions, or revoke it and suspend the cooperative. A
cooperative can see its own readiness score and request the audit itself.

### The monthly audit and the visit list

Cooperatives rarely announce that they have stopped working; they go quiet. Once
a month the AI service scores every cooperative on:

- **Functionality** — trading (35%), meeting and governing (25%), books and a valid
  permit (20%), holding its membership (20%);
- **Engagement** — members contributing (45%) and attending (35%) in the last
  quarter, and whether there was anything to attend (20%).

These combine 60/40 into a band — *healthy, monitor, at risk, critical*. Findings
carry codes (TRD, GOV, REC, PRM, MEM, ENG) that roll up by sector and district.
The weakest cooperatives become a **ranked field-visit list**, each visit
assigned to the sector officer who covers it and closed with findings and one of
five outcomes: operating normally, needs support, referred to a funder, stopped
(advise on dissolution), or unreachable. Sector officers may run the audit for
their own sector; every run is logged. The audit defaults to the **last
completed month**, so running it early in a month does not report every
cooperative as dormant.

### Dissolution — harder than formation, on purpose

1. **Only the president may file**, matched by name against the leadership record.
2. **Stage 1 — the decision.** Three-quarters attend and three-quarters of those
   present vote; the same assembly appoints a qualified **liquidator** and a
   **monitoring committee**; the RCA is told within 7 days.
3. The request climbs **sector → district → RCA** on a 14-day target — and the
   district and RCA are notified **the moment it is filed**, as are the members.
4. **Stage 2 — the liquidation**, recorded in the app: loans recovered, creditors
   paid, assets distributed in proportion to shares, original certificate returned.
5. **The RCA audits the grounds** — the three-quarters majority, substantiated
   grounds, declared liabilities, a disposal plan, and whether support was tried
   first (read from completed field visits and funding applications).
6. **Strike-off is blocked** until the audit passes *and* the liquidation is
   complete. Approval revokes the permit, unlinks members and cancels queued visits.

All eight stages are declared in `services/requestProcess.ts` and returned with
every request, so a blocked stage says *what* is blocking it.

---

## The AI service

Classical, explainable statistics — chosen because the dataset (7 cooperatives,
~380 members, a few hundred transactions over 18 months) has **no labels** and is
far too small for supervised learning.

| Capability | Method |
|---|---|
| Anomaly detection | Robust median/MAD z-scores against a district-wide baseline, plus IsolationForest when there is enough data |
| Forecasting | Damped trend (φ = 0.85), chosen over a flat mean by holdout error |
| Member engagement | Transparent weighted index, cohort-relative |
| Peer benchmarking | Ratio comparison, sector-first, reported as percentiles |
| District league table | Percentile-ranked weighted composite |
| Monthly functionality audit | Weighted index over operating and participation signals → ranked visit list |

Each model reports the metric that is honest for it, not a generic "accuracy".
Last measured against the seeded data:

| Model | Metric | Value |
|---|---|---|
| `anomaly_detector` | flag rate | 0.73% |
| `savings_forecaster` | 1 − median scaled error | 0.94 |
| `member_engagement_scorer` | coverage | 1.00 |
| `peer_benchmarker` | coverage | 1.00 |
| `district_league` | separation | 0.85 |
| `cooperative_functionality_auditor` | evidence quality | 0.97 |

*Evidence quality* is the share of each band that rests on records that exist
rather than on their absence — the number that tells an officer whether to trust
this month's visit list.

**Endpoints:** `/health`, `/anomalies/detect`, `/forecasts`, `/forecasts/generate`,
`/member-engagement`, `/benchmarks`, `/rankings`, `/rankings/trend`,
`/monthly-audit`, `/monthly-audit/{id}`, `/model-performance`, `/retrain`,
`/data-volume`. `/retrain` genuinely refits and persists parameters as JSON; a
fit that cannot honestly be made is saved as `insufficient_data` with a reason.

Response field names are a contract with the backend (anomalies are
`snake_case` because they are inserted straight into `ai_insights`; engagement
and benchmarks are `camelCase` because the UI reads them as-is). Full detail is in
[`CoopInsightAI AI/README.md`](CoopInsightAI%20AI/README.md).

---

## Design decisions

- **Statistics, not deep learning.** There is no target to learn — no row records
  "fraud" or "disengaged" — and a neural network on a few hundred rows would
  memorise noise. The model registry lets a trained model replace any slot later
  without changing an endpoint.
- **Median/MAD, not mean/standard deviation.** A classic z-score of the largest
  point in *n* values can never exceed √(n−1), so on small samples it cannot flag
  the most extreme value at all. A test pins this.
- **Percentiles, not absolute targets.** They make cooperatives of very different
  sizes comparable, and do not bunch everyone at the top or bottom.
- **Missing data is excluded, never scored zero** — except in the monthly audit,
  where silence *is* the signal. There, each row carries an evidence-quality
  figure and cooperatives flagged mainly on silence are labelled as such: the
  output is a visit, not a verdict.
- **A read-only AI service** cannot corrupt operational data and can be pointed at
  a read replica without code changes.
- **Server-computed workflows.** Exit steps, request stages and audit actions are
  computed on the server and returned with each record; the UI only draws them,
  so the screen cannot disagree with the rules.
- **Exits go to a general assembly; quorum and majority are computed**, so a
  decision recorded against a member survives that member disputing it later.
- **Dissolution is audited, formation only assessed.** A wrongly refused
  formation can be refiled; a wrongly approved dissolution cannot be undone.
- **Regulation is kept apart from configuration**, so a local preference never
  quietly acquires the authority of law — and every legal constant cites its source.
- **The oversight hierarchy reuses the `government` role** with an
  `oversight_level` (sector / district / RCA), rather than adding new roles that
  would ripple through every authorisation check.
- **Source-data gaps are preserved, not filled.** Fabricated names in front of a
  government officer would be worse than a visible blank.
- **The funding matcher scores relationships explicitly**, because that is how
  funding actually works in the sector — and recording it makes it improvable.

---

## Known limitations

- **Activity and money history is generated.** Each cooperative's 18 months of
  trading derives from its seeded health score. Two cooperatives carry a
  `[demo anomaly]` transaction and one is seeded as `[demo dormancy]` so the
  anomaly detector and monthly audit have something to find. The cooperatives and
  their leaders are real; this history is not.
- **The funder and independent-auditor registers are illustrative**, named by
  kind of organisation rather than after real NGOs or firms.
- **Documents are checked for presence, not content** — in formation, RCA
  services, and the maturity and dissolution audits. Reading documents is the
  natural next capability for the AI service.
- **CMIS is referenced, not integrated.** The CMIS reference is recorded and
  checked, but the system does not talk to the RCA's portal.
- **The register lists three office-bearers; the law expects a five-seat board**,
  so every cooperative reports a board shortfall in its audit.
- **Not all organs are fully modelled.** The Supervisory Committee is a recognised
  role and required list but has no workflow; special committees, elections,
  delegate assemblies, mergers and conversions are not built.
- **Permit numbers are reconstructed** from real registration dates and the term
  rules.
- **Audits are triggered by hand.** Nothing schedules the monthly audit yet; the
  RCA audit cadences are working configuration, not regulation.
- **Most members have no login** (2 of 379), so in-app messages reach few people;
  every broadcast says so and points to SMS.
- **Funders have no login** — an officer records the funder's decision.
- **Email and SMS are optional** and fall back to the console; email-address
  verification after registration is not sent by email yet.
- **Uploads go to local disk** (`uploads/`), not cloud storage.
- **Some secondary tabs still show sample data** (parts of Integrations, District
  monitoring's agent-activity view, Security & audit's encryption tab), labelled
  as such in the UI.
- **The frontend bundle is not code-split** (~1 MB).

---

## Testing

A full manual walkthrough of every feature, with a demo script, is in
[`docs/TESTING.md`](docs/TESTING.md) (also as
[`docs/CoopInsight-AI-Testing-Guide.docx`](docs/CoopInsight-AI-Testing-Guide.docx)).

```bash
# AI service — 58 unit tests, no database needed
cd "CoopInsightAI AI"
.\.venv\Scripts\python.exe -m pytest tests/ -q

# Type checking and builds
cd "CoopInsightAI Backend" && npx tsc --noEmit && pnpm build
cd "CoopInsightAI UI" && npx tsc --noEmit && pnpm build

# End-to-end workflow verifiers (backend running against the seeded database)
cd "CoopInsightAI Backend"
pnpm verify:exit                          # member exit to certificate, register views, lockdown
pnpm verify:audits                        # RCA audit chain, relay and programme (cleans up)
pnpm verify:session                       # stale-token handling (restores the account)
node scripts/verify-member-access.mjs     # what a member may file; issue reports
pnpm verify:dissolution                   # DESTRUCTIVE: strikes a cooperative off — reseed after
```

---

## Project layout

```
CoopInsight AI/
├── CoopInsightAI Backend/            Node + Express + TypeScript
│   ├── scripts/                      End-to-end workflow verifiers
│   └── src/
│       ├── index.ts                  App, CORS, route mounting
│       ├── config/db.ts              PostgreSQL pool
│       ├── db/
│       │   ├── schema.sql            63 tables — run once on a fresh database
│       │   ├── ddl.ts                Additions since the first release
│       │   ├── migrate.ts            Applies ddl.ts idempotently  (pnpm migrate)
│       │   ├── syncSchema.ts         Regenerates schema.sql        (pnpm sync-schema)
│       │   └── seed.ts               7 real cooperatives + 18 months of history
│       ├── middleware/               auth (JWT, roles), upload (multer)
│       ├── routes/                   21 modules, 279 endpoints
│       └── services/
│           ├── governance.ts         The RCA rulebook, clause by clause
│           ├── eligibility.ts        Formation criteria (configuration)
│           ├── permits.ts            Permit terms, maturity & dissolution audits
│           ├── exitProcess.ts        The seven exit steps
│           ├── requestProcess.ts     The stages of every RCA request
│           ├── serviceRequests.ts    RCA certificate-service checklists
│           ├── issueReports.ts       Members' issue reports
│           ├── rcaAudits.ts          RCA audit chain and programme cadences
│           ├── settlement.ts         Exit settlement calculator
│           ├── funding.ts            Three-factor funder matching
│           ├── cooperativeAccess.ts  Who may write to which cooperative
│           ├── cooperativeBrief.ts   Manager's AI brief
│           ├── oversightBrief.ts     Officers' oversight insights
│           ├── memberInsights.ts     Member's own insights
│           ├── auditRollup.ts        Monthly audit roll-up by sector/district
│           ├── reportBuilder.ts      Cooperative reports
│           ├── pdf.ts                The single PDF renderer
│           └── aiClient.ts           The one place the AI service is called
│
├── CoopInsightAI UI/                 React + Vite + TypeScript
│   └── src/app/
│       ├── App.tsx                   Router, grouped navigation, role gating
│       ├── contexts/                 Auth (two-step login), theme, notifications
│       ├── components/               Shared components + shadcn/ui primitives
│       ├── pages/                    40 pages
│       └── services/                 API client, PDF and calendar helpers
│
├── CoopInsightAI AI/                 Python + FastAPI
│   ├── app/
│   │   ├── features.py               All SQL feature extraction
│   │   ├── registry.py               Fitted parameters and metrics
│   │   ├── analytics/                anomalies, forecasting, engagement,
│   │   │                             benchmarks, rankings, monthly_audit
│   │   └── routers/                  13 endpoints
│   └── tests/                        58 tests
│
└── docs/                             Testing guide (Markdown and Word)
```

---

## Author

**N-Hosana** — Final Year Project, 2026.
