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
- [The cooperative lifecycle](#the-cooperative-lifecycle)
- [The AI service](#the-ai-service)
- [Design decisions worth defending](#design-decisions-worth-defending)
- [Known limitations](#known-limitations)
- [Testing](#testing)
- [Project layout](#project-layout)

---

## What it does

**For a cooperative** — a manager keeps the member register, records income and
expenses, plans and runs activities, uploads governance documents, tracks the
cooperative's operating permit, applies to NGOs and other funders for support,
and sees its own health score and AI insights.

**For a member** — sees their own cooperative and their savings, can calculate
what they would be paid out if they left, and can formally ask to leave — a
request that is decided by a general assembly of the members, not by the office.

**For a sector, district or RCA officer** — supervises every cooperative in
scope, approves or rejects applications to form and dissolve cooperatives, runs
the maturity audit that converts a temporary permit into a permanent one, reads a
monthly league table ranking every cooperative on five dimensions, and works a
**monthly field-visit list** of cooperatives that appear to have stopped
operating.

At a glance:

| | |
|---|---|
| Backend REST endpoints | 224 across 18 route modules |
| Frontend pages | 34 |
| Database tables | 51 |
| AI service endpoints | 13 |
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

psql -d coopinsight_ai -f src/db/schema.sql   # create the 51 tables
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

The **monthly audit** is not run by the seed, because it needs this service. Once
everything is up, sign in as the RCA officer, open **Monthly Audit** and press
*Run this month's audit*. It scores all seven cooperatives and raises the field
visits. (Or from the shell, with an RCA bearer token:
`POST /api/audits/monthly/run`.)

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
  attendance, budget against actual cost. General assemblies convened to decide a
  member's exit appear here alongside everything else, rather than in a silo.
- **Operating permit** — the cooperative's own licence, its history, and a live
  readiness score against the criteria the RCA will audit it on.
- **Reports & budgets** — generate and schedule reports, plan budgets by line.
- **Messages, notifications, settings, security audit log.**

### Membership exit, decided by a general assembly *(member-facing)*

A member can request removal from their cooperative with a stated reason, a
preferred exit date, and an instruction for their savings. The request is stamped
with a **14-day response deadline** that never moves, tracked with a live
countdown, and can be withdrawn at any point before a decision.

What it does *not* do is let the office sign a member out. A member is a
co-owner, so the request **convenes a general assembly**: the manager calls a
meeting giving at least 7 days' notice, the meeting is written into the
activities calendar and every member is notified, the members hear the stated
reasons and vote, and only then can a decision be recorded.

The vote is checked rather than taken on trust. The system refuses to minute a
resolution where the meeting never reached quorum (half the register), where more
votes were cast than members attended, or where the arithmetic does not support
the resolution being recorded. A meeting without quorum can only be deferred. And
the decision endpoint will not record an outcome the assembly did not reach: if
the members voted to release the member, "rejected" is not an option. An
administrator can override that where a cooperative genuinely cannot convene, but
only with a written reason, which is shown to the member.

Approval removes the member from the register, logs the assembly's reasoning in
`member_status_log`, and unlinks their login.

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
automatically to the next stage.

Formation applications are vetted against **11 published criteria** (minimum 7
founding members, RWF 100,000 share capital, unique name checked against the live
register, bylaws, constitutive assembly minutes, member list, and more). An
automated assessor scores the application and predicts eligibility before an
officer reads it. Final RCA approval registers the cooperative **and issues its
first operating permit in the same act** — a cooperative should never sit on the
register without a licence.

Dissolution is deliberately harder than formation, and is described in full
under [the cooperative lifecycle](#the-cooperative-lifecycle) below.

### External support — NGOs, partners and funders

Almost none of the money that reaches a Gasabo cooperative comes from the RCA. It
comes from NGOs, development partners, government programmes, unions and banks,
and everyone in the sector will tell you the same three things decide who gets
it: **what the cooperative does**, **what state it is in**, and **who it already
knows**. The system holds a register of funders and their open programmes and
ranks them for a cooperative on exactly those three factors, weighted 45 / 35 /
20 and returned with a plain-language reason for each.

Hard requirements — a minimum membership, a minimum health score, a permanent
permit — are reported separately as **blockers** rather than folded into the
score, because telling a manager they scored 0.54 on a programme they can never
win wastes their time; telling them *"this needs a permanent permit and you are
on a temporary one"* is something they can act on.

An application carries the match score and its reasons frozen at the moment of
filing, so a later decision can be read against what was known at the time. A
disbursement is posted to the cooperative's own books as income at the same time
it is recorded, so the funding record and the financials cannot disagree. And an
approval upgrades the recorded relationship, which is what lifts that
cooperative's next match — the loop closes.

### District league table

Ranks every cooperative monthly on five dimensions — finance, growth,
engagement, governance, scale — each converted to a **percentile within that
month's cohort**, then combined with published weights. Shows rank movement
month-over-month, a podium, 18 months of selectable history, CSV export, and an
expandable row per cooperative revealing the raw figures behind its score.

Restricted to RCA, district and admin roles.

---

## The cooperative lifecycle

Registration is not the end of the story and dissolution is not a form. Between
them sits a licence that has to be earned, and a monitoring loop whose whole
purpose is to reach a cooperative before it quietly dies.

```
  formation request                                      ┌──────────────────┐
  (sector → district → RCA)                              │  MONTHLY AUDIT   │
          │                                              │  every coop, AI  │
          ▼                                              └────────┬─────────┘
  ┌───────────────────┐   1 year   ┌──────────────────┐           │ flags
  │ TEMPORARY PERMIT  │ ─────────► │  MATURITY AUDIT  │           ▼
  │     1 year        │            │      (RCA)       │   ┌────────────────┐
  └───────────────────┘            └────────┬─────────┘   │  FIELD VISIT   │
                                   pass ──► │             │ sector officer │
                                            ▼             └───────┬────────┘
                                  ┌───────────────────┐           │
                                  │ PERMANENT PERMIT  │           ├─► funding referral
                                  │  30 yr — 50 yr    │           └─► advise on dissolution
                                  └───────────────────┘                     │
                                                                            ▼
                                                              ┌─────────────────────────┐
                                                              │ DISSOLUTION REQUEST     │
                                                              │ president only, then    │
                                                              │ RCA AUDIT of the grounds│
                                                              └─────────────────────────┘
```

### Operating permits: temporary, then earned

A newly registered cooperative does not get a licence for life. The RCA issues a
**temporary permit valid for one year**. Before it lapses the cooperative is
audited, and a pass converts it into a **permanent permit**:

| Cooperative | Permanent term |
|---|---|
| Most cooperatives | **30 years** |
| Industrial cooperatives | **50 years** |
| Rice-growing cooperatives | **50 years** |

The long terms are not arbitrary. Those cooperatives sink capital into plant,
milling equipment and irrigated land that will not pay back inside thirty years,
and no lender finances an asset with a life longer than the borrower's licence.
The term is decided by [`services/permits.ts`](CoopInsightAI%20Backend/src/services/permits.ts),
which reads the cooperative's registered type first and falls back to its name
and description — because a rice cooperative is usually registered under the
general "Agriculture" type, with the crop appearing only in its narrative. The
rule that fired is stored on the permit itself, so the term is still defensible
years later.

**The maturity audit** checks seven criteria: that the cooperative actually
traded (income in at least six months), that the register is maintained, that a
general assembly was held and minuted, that members are participating, that books
and a balance sheet are filed, that the office-bearers are recorded, and that the
governance documents exist. An officer sees the score, what the records actually
show, and a recommendation — but decides themselves. The three outcomes are:
convert to a permanent permit, extend the temporary permit by another year with
conditions, or revoke it and suspend the cooperative.

A cooperative does not have to wait to be chased. It sees its own readiness
against the same criteria on its permits page, and can ask the RCA to audit it.

### Dissolution: harder than formation, on purpose

Winding a cooperative up ends the livelihood of everyone on its register, so:

1. **Only the president may file it.** The filer's name is matched against the
   cooperative's leadership record; an administrator can file on the register's
   behalf, which is how a request from a cooperative with no login gets in. The
   office held is stored on the request.
2. **The members must have resolved on it** — the request carries the assembly's
   votes for, against and abstaining.
3. **It escalates sector → district → RCA** like a formation, but on a shorter
   clock: the whole chain targets **14 days**, and each stage gets a third of it
   rather than the three weeks a formation enjoys. Formation is not urgent; a
   cooperative waiting to be wound up is.
4. **The RCA audits the grounds, and approval is blocked until it has.** The
   audit checks that the vote carried a two-thirds majority, that the grounds are
   substantiated, that liabilities are declared and assets have a disposal plan,
   that a cooperative which is still trading profitably is not simply being
   abandoned, and that support was tried first — it reads the completed field
   visits and funding applications to answer that last one.
5. If the audit finds the grounds do not hold, the system **refuses to record an
   approval**. The officer can reject the request or reopen the audit.

Approval strikes the cooperative off, revokes its operating permit, unlinks every
member, and cancels any field visit still queued for it.

> Two weeks is a target, not a promise, and the system says so. A contested case
> or unsettled accounts will take longer, and the request tracks both a per-stage
> clock and an end-to-end target so an applicant can see which one is slipping.

### The monthly audit, and the visit list

This is the part that exists because of a specific failure: **cooperatives rarely
announce that they have stopped working.** They go quiet. The meetings stop, the
contributions stop, nobody files anything, and eighteen months later a sector
officer discovers a cooperative on the register that has not traded since the
year before last. By then the members have lost their savings and the only thing
left to do is dissolve it.

Once a month the AI service scores **every cooperative in the district** on two
things:

- **Functionality** — is it trading (35%), meeting and governing itself (25%),
  keeping books and a valid permit (20%), and holding its membership (20%)?
- **Engagement** — what share of members still contributed (45%) or attended
  (35%) in the last quarter, and was there anything to attend (20%)?

They combine 60/40 into a band — *healthy, monitor, at risk, critical* — and the
bottom of the district becomes a **ranked list of cooperatives to go and visit**,
each with the reasons it was flagged and what the officer should do about it. A
visit is assigned automatically to the sector officer who covers that
cooperative, and it is closed with findings and one of five outcomes: operating
normally, needs support, referred to a funder, has genuinely stopped and should
be advised on dissolution, or could not be reached.

Those closed visits then feed the dissolution audit. "Was anything tried before
this cooperative was allowed to close?" is a question the system can now answer
from its own records.

---

## The AI service

Six capabilities, all reading live data:

| Capability | Method |
|---|---|
| **Anomaly detection** | Robust median/MAD z-scores against a district-wide baseline, plus IsolationForest |
| **Forecasting** | Damped trend, chosen over a flat mean by out-of-sample holdout error |
| **Member engagement** | Transparent weighted index, cohort-relative |
| **Peer benchmarking** | Ratio comparison, sector-first, reported as percentile |
| **District league table** | Percentile-ranked weighted composite |
| **Monthly functionality audit** | Weighted index over operating and participation signals, producing a ranked field-visit list |

Last measured performance against the seeded data:

| Model | Metric | Value |
|---|---|---|
| `anomaly_detector` | flag rate | 0.73% |
| `savings_forecaster` | accuracy (1 − median scaled error) | 0.94 |
| `member_engagement_scorer` | coverage | 1.00 |
| `peer_benchmarker` | coverage | 1.00 |
| `district_league` | separation | 0.85 |
| `cooperative_functionality_auditor` | evidence quality | 0.97 |

Note what the last one reports. It is not an accuracy, and it is not a coverage:
it is the share of each band that rests on **records that exist** rather than on
their absence. That is the number that tells an officer whether to trust this
month's visit list, and it is explained below.

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
it can be pointed at a read replica later without a code change. The monthly
audit is the sharpest test of this: it produces a district-wide assessment and a
work queue, and still writes nothing. It returns the assessment; the backend
persists it and raises the visits.

**Why the monthly audit treats silence as a signal, when nothing else here
does.** Everywhere else, missing data is excluded from a score rather than
counted as zero — punishing a cooperative for poor record-keeping as if it were
poor performance would make the number indefensible the first time it was
challenged. The monthly audit deliberately breaks that rule, because a
cooperative that has recorded nothing for six months is the exact case it is
built to catch; if silence is not a signal, the audit detects nothing.

What keeps it honest is the *output*. A flagged cooperative is not marked as
failing — it is put on a list for somebody to go and look. Every row carries an
`evidenceQuality` figure saying how much of its band rests on real records, and a
cooperative flagged mainly on silence is labelled as such in the UI, so an
officer knows they may simply be visiting a cooperative that is not using the
system. The point of the audit is the visit, not the score.

**Why the audit defaults to the last completed month.** Run on the 8th, an audit
of the month in progress reports that every cooperative has stopped trading,
because most of them trade later in the month — it would manufacture a
district-wide crisis every time somebody opened the page early. The default is
the last complete month, or the last month that actually holds data if that is
earlier; auditing a month still running is possible but returns a warning saying
the scores understate everybody. There are tests pinning this.

**Why a member's exit goes to a general assembly rather than to the manager.**
A member is a co-owner, not an employee, and no clerk can sign a co-owner out of
the business they part-own. Making the assembly the decision-maker is not
ceremony: it is what makes the outcome enforceable, and it is why the decision
endpoint refuses to record an approval the members never voted for. The
administrative override exists because cooperatives genuinely fail to convene,
but it demands a written reason and shows it to the member.

**Why quorum and majority are computed rather than accepted.** The system refuses
to minute a resolution carried by four people out of forty, or one where more
votes were cast than members attended. A decision recorded against a member's
name has to survive that member disputing it a year later, and the cheapest place
to catch a bad number is at the point of entry.

**Why only the president may request a dissolution.** Dissolution ends the
livelihood of everyone on the register. Restricting it to the office that answers
for the cooperative is the same instinct as requiring a general assembly to
release one member — the decision belongs to whoever carries responsibility for
it. The check is by name against the leadership record rather than by system
role, because the president is a person on the register, not an account type.

**Why dissolution is audited but formation is only assessed.** A formation that
is wrongly refused can be refiled. A dissolution that is wrongly approved cannot
be undone: the register entry is gone, the members are unlinked, and the assets
have been disposed of. So formation gets an automated score an officer may
ignore, and dissolution gets an audit the officer cannot proceed without.

**Why the funding matcher scores relationships explicitly.** Everyone in the
sector knows that a cooperative whose secretary already knows the programme
officer gets the call. A matcher that pretended otherwise would rank
opportunities the way the world does not work, and managers would stop trusting
it. Recording the relationship as a first-class field also makes it improvable —
a sector officer can see which cooperatives have no relationship with anybody and
make the introduction.

**Why hard requirements are blockers, not low scores.** A cooperative that can
never win a programme should be told that plainly, along with what would have to
change. Folding "requires a permanent permit" into a 0.54 score hides the one
piece of information the manager can actually act on.

**Why permit terms live in one file.** The 30- and 50-year terms, the one-year
temporary period, the audit lead time and the criteria are all configuration in
`services/permits.ts`, not constants scattered through routes. They are stated as
configuration rather than law, with an explicit instruction to confirm them
against the RCA guidance in force — the same discipline the formation criteria
already followed.

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
  find, and **one cooperative is seeded as dormant** — its generated trading and
  meetings stop eight months back, and it is left on an unconverted temporary
  permit — so the monthly audit has a dormant cooperative to catch and the visit
  list is not empty on a fresh install. The seed marks it `[demo dormancy]` and
  says so in an insight. The cooperative is real; that trading gap is not.
- **The partner register is illustrative, unlike the cooperatives.** The seven
  cooperatives are real entries from the Gasabo RCA sector register. The six
  funders are not: they are named after the *kind* of organisation they represent
  ("Cooperative Turnaround Facility", "Artisan Trades Skills Foundation") rather
  than after real NGOs, precisely so nothing on screen can be read as a claim
  about a real organisation's programmes, budgets or staff. Contacts are recorded
  as role titles, never as invented people. The UI states this on the page. What
  is real is the shape of the problem and the matching logic; a deployment would
  replace the register with the district's actual partner list.
- **Permit history is reconstructed, not sourced.** Each cooperative's temporary
  and permanent permits are derived from its real registration date and the term
  rules, because the RCA register extract this project was built from carries
  registration dates but not permit numbers. The dates are consistent with the
  process; the permit numbers are generated.
- **Formation eligibility checks that a document was attached, not what is in
  it.** The same is true of the maturity and dissolution audits: they check that
  a balance sheet was filed and that minutes exist, not what those documents say.
  Reading document contents is the natural next capability for the AI service.
- **The monthly audit is triggered by hand, not by a scheduler.** An officer
  presses *Run this month's audit*, or the endpoint is called. Putting it on a
  cron is a deployment concern, not a code one, but nothing runs it automatically
  today.
- **A funder's decision is recorded by an oversight officer, not by the funder.**
  There is no funder-facing login: the sector or RCA officer brokering the
  relationship records what the funder decided. That matches how these
  relationships are actually brokered in Gasabo, but it does mean the decision
  trail is second-hand.
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
# AI service unit tests — 54 tests, no database needed
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
│   │   │   ├── ddl.ts            Every table added after the first release
│   │   │   ├── schema.sql        51 tables — run once on a fresh database
│   │   │   ├── migrate.ts        Applies ddl.ts, idempotently (pnpm migrate)
│   │   │   ├── syncSchema.ts     Regenerates schema.sql from ddl.ts (pnpm sync-schema)
│   │   │   └── seed.ts           The 7 cooperatives + 18 months of history
│   │   ├── middleware/           auth (JWT), upload (multer)
│   │   ├── routes/               18 modules, 224 endpoints
│   │   │   ├── membership.ts     Exit requests and the general assembly that decides them
│   │   │   ├── permits.ts        Temporary → maturity audit → permanent
│   │   │   ├── audits.ts         Monthly audit runs and the field-visit queue
│   │   │   └── funding.ts        Funders, opportunities, matching, applications
│   │   └── services/
│   │       ├── eligibility.ts    Formation criteria — single source of truth
│   │       ├── permits.ts        Permit terms, maturity & dissolution audit rules
│   │       ├── funding.ts        The three-factor match, with its weights
│   │       └── aiClient.ts       The one place the Python service is called
│   └── uploads/                  Local file storage (gitignored)
│
├── CoopInsightAI UI/             React + Vite + TypeScript
│   └── src/app/
│       ├── App.tsx               Router, navigation, role gating
│       ├── contexts/             Auth (OTP flow), theme, notifications
│       ├── components/           Shared UI + shadcn primitives
│       ├── pages/                34 pages, including Permits, MonthlyAudit, Funding
│       └── services/api.ts       API client with token refresh
│
├── CoopInsightAI AI/             Python + FastAPI
│   ├── app/
│   │   ├── features.py           All SQL — one place per feature
│   │   ├── registry.py           Fitted parameters + metrics
│   │   ├── analytics/            anomalies, forecasting, engagement,
│   │   │                         benchmarks, rankings, monthly_audit
│   │   └── routers/              13 endpoints
│   └── tests/                    54 tests, no database required
│
└── docs/TESTING.md               Feature-by-feature test guide
```

---

## Author

**N-Hosana** — Final Year Project, 2026.
