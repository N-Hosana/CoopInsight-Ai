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
- [Governance: the RCA rulebook](#governance-the-rca-rulebook)
- [The cooperative lifecycle](#the-cooperative-lifecycle)
- [The AI service](#the-ai-service)
- [What was combined, and what was removed](#what-was-combined-and-what-was-removed)
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
| Backend REST endpoints | 230 across 19 route modules |
| Frontend pages | 35 |
| Database tables | 53 |
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

psql -d coopinsight_ai -f src/db/schema.sql   # create the 53 tables
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
need for a working email provider. The login screen displays it for you. With
`SUPABASE_URL` and `SUPABASE_ANON_KEY` set, Supabase Auth also emails a code of
its own to the address, and either code is accepted; in production only the
emailed one exists.

| Role | Email | Password | Sees |
|---|---|---|---|
| Member | `member@coopinsight.rw` | `Member@1234` | Own membership |
| Cooperative manager | `manager@coopinsight.rw` | `Manager@1234` | TMC only |
| **1.** Sector officer | `remera.officer@coopinsight.rw` | `Officer@1234` | Remera sector — the sector TMC is in |
| **2.** District officer | `district.officer@coopinsight.rw` | `Officer@1234` | Gasabo district — **Froduard**, +250 788 821 659 |
| **3.** RCA officer | `gov@coopinsight.rw` | `Gov@1234!` | District-wide oversight, final decision |
| Admin | `admin@coopinsight.rw` | `Admin@1234` | Everything, and may act at any stage |

**Rows 1 → 2 → 3 are the approval chain, in order.** Nothing reaches the RCA
until the sector officer and then the district officer have signed it off, so
demonstrating a formation or a dissolution means logging in as each of the three
in turn. The sector account is Remera's because that is the sector **TMC** sits
in, and TMC is the cooperative the manager and member accounts belong to — so
anything they file lands on that officer's desk first.

The other sector officers follow the same pattern and cover the other
cooperatives on the register: `gisozi.officer@`, `kimihurura.officer@`,
`kinyinya.officer@`, `nduba.officer@` — all with `Officer@1234`.

The manager and member accounts are real people from the register: **RUKUNDO
Emmanuel** (President of TMC) and **UWIHOREYE Josephine** (Secretary).

> Security & Audit is **not** on this list for the officer accounts. It reads
> every account's login history and the platform audit log, so it is restricted
> to `admin` and `generalManager` in the sidebar, on the route, and on every
> endpoint behind it.

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

### The cooperative register, sliced the way an officer asks for it

"Cooperatives" is not one list. An officer opening it is looking for one specific
thing, and a flat list made them scan every row to find it. It is now a tab strip,
each tab a question, each count coming from the same query that fills the list
beneath it — so a label can never claim a different rule from the one applied:

| View | What it answers |
|---|---|
| **All on the register** | Everything currently registered, whatever its licence |
| **Registered & licensed** | Active, on the register, and holding an unexpired permit — the ones entitled to trade |
| **On temporary permit** | Registered but still on the one-year permit issued at registration; each needs an RCA maturity audit |
| **No permit in force** | On the register with no permit — expired, revoked, or never issued. **Trading without a licence, and the hardest thing to see before** |
| **Suspended** | Registered but suspended from operating |
| **Flagged at risk** | Banded at risk or critical by the latest monthly audit |
| **Applications waiting** | Groups applying to become cooperatives — not on the register yet; each is a formation request in the chain |
| **Dissolution in progress** | Members have voted to dissolve; still travelling the chain, still on the register |
| **Dissolved** | Struck off, kept because the history still has to be answerable for |

The two request views list **requests, not register rows**, which is why they are
declared as a different kind: showing them as an empty cooperative list — what a
naive status filter does — reads as "there are none" when the truth is "there are
four and they are all waiting on you".

Every row now carries its **permit** as a badge, because whether a cooperative may
legally trade is the single most important fact about it and it used to be three
clicks away on another page. No permit shows in red, not as a quiet dash. Rows
also show any open request against them and their latest audit band.

The views are defined once, in
[`routes/cooperatives.ts`](CoopInsightAI%20Backend/src/routes/cooperatives.ts),
as the SQL that selects them plus the sentence that explains why they exist;
`GET /cooperatives?view=` filters by one and `GET /cooperatives/registry` counts
them all. A sector officer's counts and lists are scoped to their own sector.

### Core management

- **Cooperative profile** — registration details, leadership, health score,
  document repository with real file upload.
- **Member register** — add, edit, suspend members; and a full per-member file:
  savings against the cooperative average, contributions, loans and repayments,
  dividends, every activity they were invited to and whether they attended,
  every transaction recorded against their name, and their record of status
  changes and suspensions.

  Who may open that file is decided **server-side**, not by hiding a button: an
  administrator sees any member, an RCA or district officer any member in scope,
  a sector officer only their own sector, a manager only their own cooperative,
  and a member only themselves. A member reaches their own record through
  **My Record** (`/members/me`), which resolves the caller against the register —
  necessary because a login and a register entry are separate records with no
  foreign key between them.
- **Financials** — record income and expenses, transaction approval workflow,
  cancellation with reason, financial summary.
- **Activities** — plan meetings, trainings, production and sales events; track
  attendance, budget against actual cost. General assemblies convened to decide a
  member's exit appear here alongside everything else, rather than in a silo.
- **Operating permit** — the cooperative's own licence, its history, and a live
  readiness score against the criteria the RCA will audit it on.
- **Reports & budgets** — generate and schedule reports, plan budgets by line.
- **Messages** — a personal message to one account, a manager's announcement to
  their own cooperative, or a broadcast: district-wide from the RCA, the
  district office or an administrator, and limited to their own sector when a
  sector cooperative officer sends it. The audience is recorded on the message,
  so a sector announcement does not land in all seven cooperatives.

  Every send reports **how far it actually reached**. Messages go to user
  accounts, and most people on a cooperative's register have never been given a
  login — so a manager addressing "the whole cooperative" is told *"sent to 1
  account; 48 more are on the register without a login, use SMS for those"*
  rather than being left to assume everyone saw it.
- **Notifications, settings, security audit log.**

### Membership exit, decided by a general assembly *(member-facing)*

A member can request removal from their cooperative with a stated reason, a
preferred exit date, and an instruction for their savings. The request is stamped
with a **14-day response deadline** that never moves, tracked with a live
countdown, and can be withdrawn at any point before a decision.

What it does *not* do is let the office sign a member out. A member is a
co-owner, so the request **convenes a general assembly**. Because a removal
cannot wait for the March or October ordinary sitting, it is convened as an
**extraordinary** assembly, and the RCA's rules for one apply: at least **3
days' notice**, and **three-quarters** of those entitled to sit must attend for
the first call to be competent. The meeting is written into the activities
calendar and every member is notified.

If the first call fails, a **second call within 3 working days** needs only
**one half**. If that fails too, the matter goes to the **National Agency for
direction** — the brochure does not provide for a third assembly, and the system
refuses to call one.

The vote is checked rather than taken on trust. The system refuses to minute a
resolution where the meeting never reached quorum, where more votes were cast
than members attended, or where the arithmetic does not support the resolution.
A meeting without quorum can only be deferred. Releasing a member is *ordinary
business*, not one of the matters the brochure reserves to a three-quarters
majority, so it carries on an **absolute majority of the votes cast**.

Once the assembly has sat, two statutory clocks start: the minutes go to the
**Sector and District administrations within 3 working days** and to the **RCA
within 7 days**. Both deadlines are stamped on the meeting and shown against it.

The decision endpoint will not record an outcome the assembly did not reach: if
the members voted to release the member, "rejected" is not an option. An
administrator can override that where a cooperative genuinely cannot convene, but
only with a written reason, which is shown to the member.

#### The seven steps, named

The whole difficulty with this process was that nobody could see it. A member
was shown a status badge reading `meeting_held` and left to work out whether
their money was coming and whether they would ever get proof they had been a
member. So the procedure is now declared once, in
`services/exitProcess.ts`, and **every response that carries a request carries
its process** — the same seven steps the server enforces are the ones the portal
draws, for the member and for the office:

| | Step | Who moves it |
|---|---|---|
| 1 | **Request filed** — grounds, preferred date, payment instruction | The member |
| 2 | **Assembly convened** — and the notice broadcast to every member | The manager |
| 3 | **Assembly sits and votes** — attendance counted against quorum | The members |
| 4 | **Resolution minuted** — what was decided, and why | The manager |
| 5 | **Member's assets resolved** — savings, shares, levies, loans, payment recorded | The manager |
| 6 | **Release recorded** — the decision the assembly reached | The manager |
| 7 | **Certificate issued and record archived** | Automatic |

Steps 5 and 7 did not exist before. They were the gap that let a member be taken
off the register while the cooperative still held their money and had given them
nothing to show for their years in it.

#### Step 2 broadcasts, it does not just notify

A bell notification vanishes the moment it is dismissed. A notice of assembly has
to be readable weeks later, because a member who says they were never told is
making a claim the cooperative must be able to answer. Convening therefore writes
a **message to the whole cooperative** — carrying the four things an invitation
must state: time, date, venue and agenda, plus the quorum the sitting needs — and
a notification per account pointing at it. The response tells the manager how many
accounts it reached and how many people on the register have no login and must be
reached by SMS.

#### Step 5: the settlement is *recorded*, not just calculated

The settlement calculator used to be a screen a member could look at. It is now
also the thing the cooperative has to commit to:

- the figures are **recomputed on the server** from the same code that produces
  the member's own estimate, so the two cannot disagree, and the manager is never
  asked to retype savings and share balances the system already holds;
- the manager supplies only what the system cannot know — how it was paid, the
  transaction reference, the date;
- paying **less** than is due requires a written explanation; a mobile money or
  bank payment requires its reference; a deduction beyond the member's loans
  requires a reason, which is shown to the member;
- the member then **confirms receipt on their own portal**. This is the only
  point in the whole procedure where the member has the last word, which is
  exactly why it is there.

**There is no override on this step.** An administrator may decide a request
without an assembly resolution where a cooperative genuinely cannot convene, but
nobody may release a member without settling with them. A cooperative that cannot
yet pay in full records what it has paid and explains the balance — which at
least leaves the member a figure they can hold it to.

#### Step 7: certificate, then archive

Approving the release does three things in one act:

1. **Issues a certificate of past membership** — a numbered, printable document
   stating who the member was, which cooperative, from when to when, how many
   months, any office they held, what they contributed, what they were settled,
   and the assembly that released them. It carries a **verification code** any
   third party can check, and the holder reaches it from their own portal because
   *their login survives their membership*.
2. **Archives the register entry** rather than deleting it. Archived members stop
   counting towards the register, quorum and engagement figures, so a cooperative
   is not measured against people who have gone — but their history, their
   settlement and their certificate stay readable and answerable for. The
   manager sees them in an **Archived members** panel.
3. Unlinks the account from the cooperative and logs the assembly's reasoning in
   `member_status_log`.

### Share settlement calculator

Answers "what do I walk away with?" — own funds (savings + share capital +
levies), **plus a share of what the cooperative itself is worth**, less
outstanding loans. Net worth comes from the latest balance sheet; with none on
file it is estimated from transaction history and the response says so. Every
figure is shown as a line of the calculation, in order, with a disclaimer that
the binding number is the audited one. The same function (`services/settlement.ts`)
backs the member's estimate and the settlement the cooperative records at step 5.

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

Ranks every cooperative monthly on **three things an officer can explain to a
cooperative in one sentence** — because a ranking parameter that cannot be
explained is a ranking that will not be accepted:

| Pillar | Weight | Measures |
|---|---|---|
| **Finances** | 40% | Surplus per member this month (60%) · growth in savings per member (40%) |
| **Member engagement** | 35% | Share of members who paid in this month (60%) · attendance at activities held (40%) |
| **Activities delivered** | 25% | Share of the month's planned activities completed (70%) · activities held per 10 members (30%) |

Each of the six measures is converted to a **percentile within that month's
cohort**, rolled into its pillar, then into the composite. Percentiles rather
than fixed targets is what makes a 30-member carpentry workshop comparable with a
92-member farming cooperative.

**Two dimensions were removed**, and the removal is the point:

- *Growth* was a pillar of its own. It is a financial question, so it is now a
  measure inside Finances, where somebody asking "why is this cooperative ranked
  where it is on money" finds both halves of the answer together.
- *Scale* — accumulated savings and share capital per member — was scored at 10%.
  It measured how old and how rich a cooperative already was, not how it
  performed this month, and it systematically flattered established cooperatives
  over new ones doing better work. It is still **reported** as context in the
  figures behind each row; it no longer moves the rank.

A measure that cannot be computed for a cooperative in a month is **excluded from
its composite rather than scored zero** — punishing poor record-keeping as if it
were poor performance would only teach cooperatives not to file. But "held
nothing at all" and "filed nothing at all" are different and are treated
differently: a cooperative that recorded money moving but held no activities
scores zero on activity rate, because that is a real finding.

Shows rank movement month-over-month, a podium, 18 months of selectable history,
CSV export, and an expandable row per cooperative that breaks the composite down
into its pillars, each pillar into its measures, and each measure into the raw
figures behind it.

Restricted to RCA, district and admin roles.

---

## Governance: the RCA rulebook

Every rule about how a cooperative governs itself comes from one published
source — the Rwanda Cooperative Agency brochure *Cooperative Organs: Their
Powers and Responsibilities* — and is encoded once, in
[`services/governance.ts`](CoopInsightAI%20Backend/src/services/governance.ts).
Routes apply it; none of them carries a number of its own.

This matters for a reason worth stating plainly in a defence. The other rule
files in this project (`eligibility.ts`, `permits.ts`) are headed **CONFIGURATION,
NOT LAW** — their thresholds are what this deployment vets against and can be
changed. `governance.ts` is the opposite: each constant carries the clause it
comes from, and changing one is asserting that the *regulation* changed.

| Rule | Value | Where it binds |
|---|---|---|
| Ordinary assemblies | **March and October** | Monthly audit scores governance against this calendar, not an invented cadence |
| Notice — ordinary | **7 days** | — |
| Notice — extraordinary | **3 days** | Convening a removal assembly |
| Quorum — ordinary, first call | **two-thirds** | — |
| Quorum — extraordinary, first call | **three-quarters** | Removal assembly |
| Quorum — either, second call | **one half** | Removal assembly, second call |
| Second call — ordinary | within **7 days** | — |
| Second call — extraordinary | within **3 working days** | Enforced when scheduling |
| Two failed calls | **goes to the National Agency** | A third call is refused |
| Ordinary decisions | **absolute majority** of votes cast | Releasing a member |
| Reserved matters | **three-quarters** | Dissolution, merger, statute amendment, federation, conversion |
| Assembly of delegates | above **100 members** | Quorum counted against delegates |
| Minutes to Sector & District | **3 working days** | Stamped on every meeting held |
| Minutes to the RCA | **7 days** | Stamped on every meeting held |
| Board of Directors | **5 seats**, odd if larger | Maturity audit and monthly audit |
| First assembly after registration | **15 days** | Recorded; not yet enforced |
| Certificate changes — attendance | **three-quarters** must attend | Objective, activities, name, dissolution |
| Certificate changes — majority | **three-quarters** of those present | Same |
| Certificate fee | **RWF 1,000** | Objective, activities, name |
| RCA told of a dissolution decision | **7 days** | Checked against the assembly date |
| Supervisory Committee | list required on every certificate change | Service-request checklists |

### What this corrected

Four rules the app previously encoded were wrong against the brochure, and all
four were mine rather than the source's:

- A removal assembly required **7 days' notice**. It is extraordinary business,
  so 3 days is the requirement — the app was blocking meetings the rules allow.
- Quorum was a flat **one half**. An extraordinary first call needs
  three-quarters; one half is only the *second*-call threshold.
- Dissolution was checked against a **two-thirds** majority, described in a code
  comment as what "Rwandan cooperative bylaws generally require". The brochure
  reserves it to three-quarters. That comment was a guess presented as fact, and
  it is the kind of thing that should never have gone in without a citation.
- The board was treated as **three** office-bearers. It is five: President, Vice
  President, Secretary and two advisors.

There was also no concept of a second call, of escalation to the Agency, or of
the two reporting deadlines. All three now exist.

### Where the register falls short, and why that is left visible

The RCA sector register this project is built from records only the President,
Vice President and Secretary. The brochure puts **five** people on the Board. So
every seeded cooperative now reports *"3 of the 5 Board of Directors seats are
recorded by name"* in its monthly audit.

That is not a bug and it has not been papered over. It is a true statement about
the register, and it follows the same discipline as the missing president's name
at COPCOM and the vacant secretary post at UNITAX: source-data gaps are surfaced,
not invented. An officer reading it learns something real — the advisors are not
on file anywhere.

### RCA services beyond forming and dissolving

A second RCA brochure — *Requirements for Cooperatives Requesting Various
Services* — sets out four more things a cooperative can ask for. They are
encoded in
[`services/serviceRequests.ts`](CoopInsightAI%20Backend/src/services/serviceRequests.ts)
and reuse the existing sector → district → RCA chain rather than starting a
parallel one.

| Service | Assembly | Notarized | Fee | The distinctive requirement |
|---|---|---|---|---|
| **Change of objective** | ¾ attend, ¾ vote | yes | RWF 1,000 | RRA tax-clearance certificate |
| **Add activities** | ¾ attend, ¾ vote | no | RWF 1,000 | Must be in the same value chain |
| **Change of name** | ¾ attend, ¾ vote | yes | RWF 1,000 | Balance sheet, debtors/creditors, proof creditors were told |
| **Duplicate certificate** | none | no | none | RIB certificate explaining the loss |

All four share a spine: lists of members, Board **and Supervisory Committee**
with identities and signatures, share capital and share value, the original
certificate handed back, and submission through **CMIS**.

Filing scores the request against its checklist immediately and tells the
cooperative which lines are still outstanding — the same deterministic-rules
approach as formation eligibility, for the same reason: there are no labelled
past requests to learn from, and an officer has to be able to say exactly which
requirement failed.

**Who may file.** The president, matched against the leadership record, or an
administrator on the register's behalf. Sector, district and RCA officers
review; they do not file on their own account.

### Dissolution now runs in two stages

Law No. 057/2024 arts. 132–142 splits a dissolution in two, and the system now
follows it:

**Stage 1 — the decision.** Three-quarters of eligible members attend and
three-quarters of those present vote to dissolve. The same assembly appoints a
**liquidator** — who must be a financial auditor, an accountant, or someone
otherwise authorised — and a **committee of members to monitor them**. The RCA
must be told within **7 days**. Filing is refused without all of this.

**Stage 2 — the distribution.** The liquidator reports, loans are recovered,
creditors are paid, and what remains is shared in proportion to shares (or the
loss is borne the same way). The original certificate goes back to the RCA.

**The strike-off is blocked until both are done.** Approval at RCA level already
required the audit of the grounds; it now also requires `dissolution_stage` to
have reached `complete`. Approving earlier would remove a cooperative from the
register whose creditors and members had not been paid.

The liquidator's sixteen statutory duties are listed in `governance.ts` and
shown on the RCA Services page, so a cooperative can see what it is asking
someone to take on rather than reducing the role to a name in a box.

#### All eight stages, drawn

The oversight chain has three steps — sector, district, RCA — and the page used
to show only those three. That was accurate and useless: a president was told
their dissolution was "with the RCA" when what was actually holding it up was the
liquidator's report, which is not a stage the chain knows about. The real
procedure is declared once in
[`services/requestProcess.ts`](CoopInsightAI%20Backend/src/services/requestProcess.ts)
and returned with every request, and the page draws all of it:

| | Stage | Who moves it |
|---|---|---|
| 1 | **Committee calls the general assembly** — three-quarters must attend, three-quarters of them must vote for it | The cooperative |
| 2 | **First assembly resolves and appoints** the liquidator and the monitoring committee; the RCA is told within 7 days | The cooperative |
| 3 | **Request filed** with the minutes, member and committee lists, asset inventory and disposal plan | The cooperative |
| 4 | **Sector cooperative officer reviews** | Sector |
| 5 | **District cooperative officer reviews** | District |
| 6 | **Liquidator collects, pays and distributes**; the second assembly receives the report; the original certificate goes back | The liquidator |
| 7 | **RCA audits the grounds** | RCA |
| 8 | **RCA strikes the cooperative off** — permit revoked, queued field visits cancelled | RCA |

A stage that is **blocked** says what is blocking it. A dissolution sitting at
the RCA with the liquidation unfinished reads "Waiting on the RCA audit to
conclude and the liquidation to be completed and the certificate returned" —
rather than `pending_rca`.

Stage 6 is now recordable **in the app**. The endpoint existed but nothing
reached it, which meant a dissolution could be filed and then sit forever,
because the one thing that unblocks it could not be entered anywhere. The
cooperative now records loans recovered, creditors paid, assets distributed, the
certificate returned, the date of the second assembly and the liquidator's
report, and the stage only closes when the assets are distributed **and** the
certificate is back.

#### The RCA sees a dissolution from the moment it is filed

Closing a cooperative ends the livelihood of everyone on its register, so
waiting for the case to climb two levels before the district and the RCA even
know it exists is how a contested dissolution gets three weeks down the road
before anyone senior looks at it.

Filing a dissolution therefore **notifies all three tiers at once** and stamps
`district_informed_at` and `rca_informed_at`, and both upper tiers see every
dissolution in scope **at every stage**, not only when it reaches their desk.
They still cannot decide it out of turn — `PATCH /:id/decision` enforces the
order separately. Each forward step re-notifies every level above it.

The cooperative's own **members** are told too, both when it is filed and when
the RCA finally approves it — the second broadcast goes out *before* the accounts
are detached from the cooperative, because a moment later there would be nobody
left to tell.

### Independent auditors

An auditor may act only when **approved by the General Assembly from the list
approved by the RCA**, and six circumstances disqualify them outright — having
been an insider, being related to one, holding the cooperative's assets, owing
it money, having been expelled from a cooperative, or having direct interests
in it.

Those are checked at **engagement**, not after the report. A conflicted auditor
invalidates the audit, and refusing the engagement is far cheaper than
discovering the conflict once the accounts have been signed. The audit scope,
the auditor's duties of conduct, what they are liable for, and the other routes
to an audit (the RCA itself, or the District under agreement) are all recorded
alongside.

### Not yet modelled

The first brochure names four organs. Three are now modelled, one is not:

- **General Assembly** — modelled, with the rules above.
- **Board of Directors** — modelled as a composition and quorum rule. Its own
  meeting cycle (once a quarter, at most twice a month, two-thirds quorum), its
  five-year renewable term, the RCA's 7-working-day approval of elected members,
  and the conflict-of-interest procedure (30 days for an Agency decision) are
  encoded as constants but no workflow uses them yet.
- **Supervisory Committee** — now a recognised leadership role and a required
  list on every certificate change, but it has no election or reporting
  workflow of its own.
- **Special committees** — not modelled.

Also recognised but not built: merger and transformation into a company (named
in the brochure's introduction alongside the four services above), elections,
delegate registers for cooperatives above 100 members, and the Agency's power to
annul an assembly decision.

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
   votes for, against and abstaining. Dissolution is one of the matters the RCA
   brochure reserves to a **three-quarters** majority, alongside amending the
   statutes, joining a federation, merging and converting to a company.
3. **It escalates sector → district → RCA** like a formation, but on a shorter
   clock: the whole chain targets **14 days**, and each stage gets a third of it
   rather than the three weeks a formation enjoys. Formation is not urgent; a
   cooperative waiting to be wound up is.
4. **The RCA audits the grounds, and approval is blocked until it has.** The
   audit checks that the vote carried the **three-quarters majority the RCA
   reserves for dissolution**, that the grounds are substantiated, that
   liabilities are declared and assets have a disposal plan,
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

## What was combined, and what was removed

A system that has grown feature by feature accumulates screens nobody can tell
apart. These were the ones that could not be explained:

**Two pages that were the same errand, now one.** "Cooperative Requests" held
formation and dissolution; "RCA Services" held the four certificate services
(change of objective, added activities, change of name, duplicate certificate).
Nothing on either page said which one held the form you needed, and a president
wanting to dissolve their cooperative had no reason to prefer one name over the
other. Both are *asking the agency for something and watching it climb sector →
district → RCA*, so they are now **RCA services & requests** with three tabs.
`/cooperative-requests` redirects rather than 404s, because that path is already
sitting in notification links in people's inboxes.

**Two routes rendering the same page, now one.** `/cooperatives/profile?id=` and
`/cooperative-profile` were the identical component behind different paths, so a
fix applied to one was still missing from the other. `/cooperative-profile` is
now the only one, open to every role, and the old path redirects **carrying its
query string** — `<Navigate>` drops it, which would have landed every "View
details" link on a page with nothing selected.

**Two ranking dimensions that measured the wrong thing, removed.** *Growth*
folded into Finances where it belongs; *scale* dropped from the scoring entirely
because it ranked cooperatives by how old and rich they already were. Both
changes are argued above.

**A menu item that existed only to fail, removed.** Security & Audit was offered
to every `government` account — sector, district and RCA officers alike — while
every endpoint behind it has always been restricted to administrators. The
sidebar now agrees with the backend, and a route guard stops anyone reaching it
by typing the URL, so it is a closed door rather than a page that fills with
errors.

**A sidebar of twenty-two flat links, now five groups.** Overview · My
cooperative · Oversight · RCA · Admin. A flat list of that length is not
navigation, it is a pile.

**One dead helper deleted.** `authorizeOversight` was written, exported, and
never called — the request chain reads `users.oversight_level` from the row
rather than the token, because tokens issued before the claim existed do not
carry it. An abstraction with no callers is a liability, not an asset.

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

**Why the governance rules are held apart from the other rule files.** The
formation criteria and the permit terms are configuration — a deployment can
defensibly change them. The assembly rules are not: they come from a published
RCA brochure, and a cooperative's decision is void if they are not followed. So
`governance.ts` cites its source clause by clause and says explicitly that
editing a value asserts the regulation changed. Mixing the two kinds of rule in
one file is how a local preference quietly acquires the authority of law.

**Why silence about a source is worse than a wrong number.** The dissolution
majority was originally two-thirds, with a comment saying Rwandan bylaws
"generally require" it. The number was wrong — it is three-quarters — but the
real fault was the comment: it asserted a legal fact with no citation, which is
exactly the kind of claim nobody re-checks. Every constant in `governance.ts`
now quotes the clause it came from, so the next reader can verify it rather than
trust it.

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
- **Documents are declared, not read.** A service request is scored on whether
  the required document was attached and the required declaration made — not on
  what the RRA clearance, the RIB certificate or the balance sheet actually say.
  The same limit already applied to formation eligibility.
- **CMIS is referenced, not integrated.** Every RCA service is really submitted
  through the Agency's own CMIS portal. This system records the CMIS reference
  and checks it was given; it does not talk to CMIS.
- **The independent auditor register is illustrative**, like the partner
  register — named as practices rather than real firms, with one entry left off
  the RCA-approved list so the eligibility gate has something to refuse.
- **The register records three office-bearers; the RCA expects a board of
  five.** Every cooperative therefore reports a board shortfall in its monthly
  audit. This is a real gap in the source data, surfaced rather than filled — see
  [Governance](#governance-the-rca-rulebook).
- **Two of the four cooperative organs are not modelled.** The Supervisory
  Committee and special committees are named in the rulebook but have no tables,
  and the Board's own meeting cycle and election workflow are encoded as
  constants without a workflow behind them.
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
- **Most members have no login.** 379 people sit on the seven registers and 2
  have user accounts, because accounts are created by hand. In-app messaging
  therefore reaches almost nobody, which is why every broadcast reports its real
  reach and points at SMS. A deployment would either issue accounts at
  registration or lean on the SMS channel.
- **Email and SMS are optional.** Verification codes are emailed through
  Supabase Auth when its URL and public key are set, and a development code is
  returned in the dev login response either way. Email-address verification after registration is
  not sent by email yet. Africa's Talking keys are optional.
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
│   │   │   ├── schema.sql        53 tables — run once on a fresh database
│   │   │   ├── migrate.ts        Applies ddl.ts, idempotently (pnpm migrate)
│   │   │   ├── syncSchema.ts     Regenerates schema.sql from ddl.ts (pnpm sync-schema)
│   │   │   └── seed.ts           The 7 cooperatives + 18 months of history
│   │   ├── middleware/           auth (JWT), upload (multer)
│   │   ├── routes/               19 modules, 230 endpoints
│   │   │   ├── membership.ts     Exit requests and the general assembly that decides them
│   │   │   ├── permits.ts        Temporary → maturity audit → permanent
│   │   │   ├── serviceRequests.ts  Name / objective / activities / duplicate, auditors
│   │   │   ├── audits.ts         Monthly audit runs and the field-visit queue
│   │   │   └── funding.ts        Funders, opportunities, matching, applications
│   │   └── services/
│   │       ├── governance.ts     The RCA rulebook — assemblies, board, auditors
│   │       ├── serviceRequests.ts  What each RCA service requires
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
│       ├── pages/                35 pages, incl. Permits, MonthlyAudit, Funding, RcaServices
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
