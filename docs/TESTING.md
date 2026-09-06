# CoopInsight AI — Feature and Testing Guide

Everything this application does, and how to verify each piece works.

Written to be followed top to bottom in about 45 minutes for a full
demonstration, or dipped into for a single feature.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Automated checks](#2-automated-checks)
3. [Authentication and roles](#3-authentication-and-roles)
4. [Cooperative management](#4-cooperative-management)
5. [Member management](#5-member-management)
6. [Financials](#6-financials)
7. [Activities](#7-activities)
8. [Membership exit and share settlement](#8-membership-exit-and-share-settlement)
9. [Forming and dissolving cooperatives](#9-forming-and-dissolving-cooperatives)
10. [The district league table](#10-the-district-league-table)
11. [AI insights](#11-ai-insights)
12. [Government oversight](#12-government-oversight)
13. [Supporting features](#13-supporting-features)
14. [Failure modes worth demonstrating](#14-failure-modes-worth-demonstrating)
15. [Suggested 15-minute demo script](#15-suggested-15-minute-demo-script)

---

## 1. Before you start

Three processes must be running. Setup instructions are in the
[root README](../README.md).

```bash
# Terminal 1 — backend
cd "CoopInsightAI Backend" && pnpm dev            # :5000

# Terminal 2 — AI service
cd "CoopInsightAI AI" && .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# Terminal 3 — frontend
cd "CoopInsightAI UI" && pnpm dev                 # :5173
```

**Reset to a known state at any time:**

```bash
cd "CoopInsightAI Backend" && pnpm seed
curl -X POST http://localhost:8000/retrain -H "Content-Type: application/json" -d "{}"
```

This wipes and rebuilds all cooperative data, then refits the models. Do it
before a demonstration — several tests below change state permanently.

**Verify all three are alive:**

```bash
curl http://localhost:5000/          # {"message":"CoopInsightAI backend is running"...}
curl http://localhost:8000/health    # {"status":"ok","database":true,...}
```

---

## 2. Automated checks

Run these first. If any fail, fix that before demonstrating anything.

| Check | Command | Expected |
|---|---|---|
| AI unit tests | `cd "CoopInsightAI AI" && .\.venv\Scripts\python.exe -m pytest tests/ -q` | 29 passed |
| Backend types | `cd "CoopInsightAI Backend" && npx tsc --noEmit` | no output |
| Frontend types | `cd "CoopInsightAI UI" && npx tsc --noEmit` | no output |
| Backend build | `cd "CoopInsightAI Backend" && pnpm build` | `dist/` created |
| Frontend build | `cd "CoopInsightAI UI" && pnpm build` | `dist/` created |

The 29 unit tests cover the statistical core without needing a database — outlier
detection, forecast damping, percentile fairness, and two regression tests for
bugs that were found and fixed during development.

---

## 3. Authentication and roles

### Logging in

Login is **two-step**: password, then a 6-digit OTP. In development the code is
returned in the login response and shown on screen — no email provider needed.

| Account | Password |
|---|---|
| `admin@coopinsight.rw` | `Admin@1234` |
| `manager@coopinsight.rw` | `Manager@1234` |
| `member@coopinsight.rw` | `Member@1234` |
| `gov@coopinsight.rw` | `Gov@1234!` |
| `district.officer@coopinsight.rw` | `Officer@1234` |
| `gisozi.officer@coopinsight.rw` | `Officer@1234` |

**Test:** log in as the manager. Confirm the profile menu shows *RUKUNDO
Emmanuel*, role *manager*, cooperative *TMC (Trust Multiservices Cooperative)*.

### Role gating — the important test

The navigation menu changes per role, but the real check is that the **backend**
enforces it, not just the UI.

| Test | How | Expected |
|---|---|---|
| Manager sees only their cooperative | Log in as manager → Cooperatives | Only TMC listed |
| Member cannot see the member register | Member role | "Members" absent from nav |
| Manager cannot see the league table | Manager role | "League Table" absent from nav |
| **Backend enforces it** | `curl` below | `Insufficient permissions` |

```bash
# Get a manager token, then try the league table directly
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@coopinsight.rw","password":"Manager@1234"}'
# → copy userId and devOtp, then:
curl -s -X POST http://localhost:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"userId":"<userId>","otp":"<devOtp>"}'
# → copy accessToken, then:
curl -s http://localhost:5000/api/ai/rankings -H "Authorization: Bearer <token>"
# Expected: {"message":"Insufficient permissions"}
```

That distinction matters in a defence: hiding a menu item is not access control.

### Other auth flows

- **Register** — `/register` creates a member account, picks a cooperative from a
  live dropdown (served by a public endpoint, since there is no token yet).
- **Forgot password** — `/forgot-password` sends a reset OTP (dev code shown).
- **Account lockout** — repeated wrong passwords lock the account; visible in
  Security & Audit.

---

## 4. Cooperative management

Log in as **admin**.

| Test | Steps | Expected |
|---|---|---|
| List | Cooperatives | 7 cooperatives, member counts, savings, health scores |
| Filter | Use the sector / type filters | List narrows correctly |
| Expand | Click a row | Leadership panel shows President, Vice President, Secretary **and the Sector Cooperative Officer** |
| Profile | Open TMC's profile | Registration number, dates, health score, documents |
| Edit | Edit → change description → Save | Persists after refresh |
| Leadership edit | Edit a leader's name → Save | Written to `cooperative_leadership` |
| Documents | Upload a PDF | Appears in the repository, downloadable from `/uploads` |
| Export | Export Profile | Text file downloads with leadership and documents |

**Point worth making:** UNITAX shows its Secretary as **Vacant** and COPCOM's
President as **(Name not recorded)**. These are genuine gaps in the RCA register,
preserved rather than invented.

### Creating a cooperative directly

Admin → Cooperatives → New. Only the President is mandatory among leadership —
because real cooperatives have vacancies.

---

## 5. Member management

Log in as **manager** (scoped to TMC).

| Test | Steps | Expected |
|---|---|---|
| Register | Members | 49 members, searchable and filterable |
| Detail | Open *UWIHOREYE Josephine* | Savings, contributions, loans, dividends, activity history |
| Add | Members → Add Member | New member appears in the register |
| Edit | Change a member's phone | Persists |
| Status | Suspend a member with a reason | Status changes; logged to `member_status_log` |
| Contributions | Add a contribution | Appears in history; member savings update |
| Loans | Issue a loan, then record a repayment | Balance decreases |
| Export | Export members | CSV downloads |

---

## 6. Financials

| Test | Steps | Expected |
|---|---|---|
| Transactions | Financials | ~42 transactions for TMC over 18 months |
| Record | Record Transaction → income, category, amount, date | Appears in the list |
| Detail | Open a transaction | Full detail with audit trail |
| Cancel | Cancel a transaction **with a reason** | Status `cancelled`; reason required |
| Approve | Approve a pending transaction | Status `completed` |
| Summary | Financial Summary | Income, expenses, net surplus |
| Budget | Budget Planning → add lines | Saves and totals correctly |

**Verify the reason requirement:** attempt to cancel without a reason — the
backend rejects it. Financial reversals without a stated reason are not
auditable.

---

## 7. Activities

| Test | Steps | Expected |
|---|---|---|
| List | Activities | ~10 activities per cooperative across 18 months |
| Create | New Activity → meeting, date, location, budget | Appears in the list |
| Detail | Open one | Participants, attendance, budget vs actual |
| Attendance | Mark members attended | Feeds the engagement score |
| Attachments | Upload a file | Stored and downloadable |
| Complete | Mark completed with actual cost | Status and cost update |

Attendance is not decorative — it is an input to both the AI engagement score and
the league table's governance dimension.

---

## 8. Membership exit and share settlement

Log in as **member** (*UWIHOREYE Josephine*, TMC). Go to **Membership**.

### Share settlement calculator

Click **Calculate my settlement**. Expect roughly:

```
Own funds       savings + share capital        ≈  44,500
Share of coop   ~1.0% of distributable value   ≈  31,644
Gross                                          ≈  76,144
Less loans                                              0
NET PAYABLE                                RWF ≈  76,144
```

Check the panel below the table — it names the basis ("Latest balance sheet,
period ending …"). With no balance sheet on file it estimates from transaction
history and **says so**, which is the honest behaviour to demonstrate.

### Requesting removal

| Test | Steps | Expected |
|---|---|---|
| Validation — short reason | Enter under 20 characters | Rejected with a clear message |
| Validation — no acknowledgement | Leave the checkbox unticked | Rejected |
| Submit | Full reason, exit date, savings instruction, tick the box | "TMC has 14 days to respond" |
| Countdown | Look at the tracker | "Response due in 14 days" with the deadline date |
| Duplicate guard | Submit a second request | "You already have a request awaiting a response" |
| Withdraw | Withdraw this request | Returns to no open request |

### Manager side

Log in as **manager** → Membership. The request is in the queue.

| Test | Expected |
|---|---|
| Reject without a note | Rejected — a note is required |
| Mark under review | Status changes, member notified |
| Approve | Member removed from the register, login unlinked from the cooperative |

Confirm afterwards: the member no longer appears in the Members list.

> Run `pnpm seed` afterwards to restore her.

---

## 9. Forming and dissolving cooperatives

This is the sector → district → RCA approval chain.

### Applying to start a cooperative

Log in as **manager** → **Cooperative Requests**.

First read the criteria panel — 11 published requirements with weights and
whether each is mandatory. This is the "specified somewhere" the vetting uses.

**Test A — a weak application is caught.** Apply with 3 members, RWF 5,000 share
capital, and a two-word purpose.

Expected: **predicted not eligible, ~17%**, with the failing mandatory criteria
listed — minimum members, share capital, purpose statement, plus the missing
documents.

**Test B — a strong application.** Apply with:

- Name: *Gisozi Youth Joinery Cooperative*
- Type: Carpentry, Sector: Gisozi, Cell: Kiyovu
- 24 founding members, RWF 850,000 share capital
- A purpose of 120+ characters

Expected: **~52%, still not eligible** — because no documents are attached.
Now attach files against the document criteria (any small PDF or text file will
do). The score climbs to **100%, eligible**, and confidence is reported at 0.78 —
*not* 1.0, because the assessor only checks that a document exists, not what is
inside it. Say that out loud in a defence; it is the honest limit.

**Test C — duplicate name.** Apply with the name `ADARWA`. The unique-name
criterion fails: *"ADARWA matches a cooperative already on the register."*

### The approval chain

| Step | Log in as | Action | Expected |
|---|---|---|---|
| Wrong level guard | `district.officer@` | Try to approve while it sits at sector | "This request is with the Sector Cooperative Officer" |
| Sector | `gisozi.officer@` | Approve with a note | Forwarded to the District Officer |
| District | `district.officer@` | Approve | Forwarded to the RCA Officer |
| RCA | `gov@coopinsight.rw` | Approve | **Cooperative is created and appears on the register** |

Verify: log in as admin → Cooperatives → the new cooperative is there with a
registration number derived from the application reference.

Also test **Reject** (note required) and **Return for more information**
(stays at the same stage for the applicant to fix).

### Dissolution

As **manager** → Cooperative Requests → *Request dissolution*. Provide grounds,
the assembly vote, liabilities and an asset-disposal plan. Run it through the
same three stages. Final RCA approval **strikes the cooperative off** and unlinks
its members.

> This genuinely deletes TMC from the active register. Run `pnpm seed` afterwards.

---

## 10. The district league table

Log in as **gov@coopinsight.rw** → **League Table**.

Expected for the most recent month:

| # | Cooperative | Overall | Band |
|---|---|---|---|
| 1 | COPCOM | ~83 | leading |
| 2 | ZAMUKA | ~76 | leading |
| 3 | TMC | ~64 | solid |
| … | | | |
| 7 | UNITAX | ~13 | at risk |

| Test | Steps | Expected |
|---|---|---|
| Podium | Top of page | Top three with medals and movement |
| Dimensions | Look across a row | Five scores: finance, growth, engagement, governance, scale |
| Unmeasured | Find a `—` cell | Hover: excluded from the composite, not scored zero |
| Evidence | Click any row | Raw figures: income, surplus per member, contributors, attendance |
| Month selector | Pick the previous month | Ranking changes — FODECO and TMC swap places |
| Movement | Check the Move column | Arrows showing rank change |
| Scoring panel | Bottom of page | The five weights and district averages |
| Export | Export CSV | Downloads with all dimensions |
| Access | Try as manager | Not in nav; API returns 403 |

**The point to make:** every rank decomposes into five dimensions, and every
dimension decomposes into raw figures. An officer challenged by a cooperative can
show exactly why it placed where it did.

**The caveat to volunteer:** percentile ranking is zero-sum — somebody is always
last, even in a month where everyone improved. That is why district averages are
shown alongside, so absolute movement stays visible.

---

## 11. AI insights

Log in as **manager** → **AI Insights**.

| Tab | Test | Expected |
|---|---|---|
| Overview | — | Insights from `ai_insights`, filterable |
| Anomalies | Click **Run Analysis** | Detection runs against live data |
| Engagement | — | 49 members scored, ~39 distinct scores, range ~22–94 |
| Benchmarking | — | 5 ratio metrics vs peers with percentile |
| Model Performance | Log in as admin | 5 models, each with its own real metric |

### Demonstrating a real anomaly

UNITAX carries a deliberately unusual transaction. As **admin**:

```bash
# Get UNITAX's id from the cooperatives list, then:
curl -s -X POST http://localhost:8000/anomalies/detect \
  -H "Content-Type: application/json" \
  -d '{"cooperativeId":"<UNITAX_ID>"}'
```

Expected: a **warning** anomaly — an operational expense of RWF 1,953,000 flagged
at **modified z-score +5.36** against 128 comparable district transactions, with
confidence 0.86.

That is the AI finding something on its own terms, with a stated statistic and a
stated comparison set — not a hardcoded alert.

### Model performance

As **admin** or **gov**, the Model Performance tab shows each model with the
metric that is *real for it* — `flag_rate`, `accuracy`, `coverage`, `separation` —
rather than every model claiming an "accuracy" it never measured.

Refit at any time:

```bash
curl -X POST http://localhost:8000/retrain -H "Content-Type: application/json" -d "{}"
```

---

## 12. Government oversight

Log in as **gov@coopinsight.rw**.

| Test | Expected |
|---|---|
| Government Monitoring | 7 cooperatives, 379 members, ~RWF 59M district savings |
| Sector breakdown | Gisozi 2, Remera 2, Kimihurura 1, Kinyinya 1, Nduba 1 |
| Compliance view | Compliance status per cooperative |
| At-risk list | Cooperatives with health scores below threshold |
| Cross-cooperative reports | Reports across all seven |

The **oversight hierarchy** is real: sector officers are the actual people from
the register — UMULISA (Gisozi), CARINE (Kimihurura), KASINE Dorothee
(Kinyinya) — above them a district officer, above them the RCA.

---

## 13. Supporting features

| Feature | Test | Expected |
|---|---|---|
| Messages | Send a message to a cooperative | Delivered, appears for recipient |
| Notifications | Trigger any workflow | Bell updates; mark read / clear all works |
| Settings | Change notification preferences, toggle 2FA | Persists across logout |
| Security & Audit | As admin | Audit log, login activity, anomalies |
| Integrations | As admin | Connect / configure / test / disconnect / remove |
| Reports | Generate, schedule | Report is created and listed |
| Dark mode | Toggle in settings | Theme switches |
| Responsive | Narrow the browser | Sidebar collapses to a menu |

---

## 14. Failure modes worth demonstrating

Showing graceful degradation is stronger than showing only the happy path.

**Stop the AI service** (Ctrl-C in terminal 2), then:

| Page | Expected |
|---|---|
| AI Insights | Loads; panels empty; "AI service unreachable" |
| League Table | Explains the table cannot be computed |
| Everything else | Entirely unaffected |

Restart it and the pages recover with no page reload logic beyond a refresh.

**Other failure paths:**

| Test | Expected |
|---|---|
| Wrong password ×5 | Account locks; recorded in the audit log |
| Expired token | API client silently refreshes and retries |
| Direct URL to a forbidden page | Redirected home by `RoleRoute` |
| Cancel a transaction with no reason | Rejected by the backend |
| Reject an exit request with no note | Rejected by the backend |

---

## 15. Suggested 15-minute demo script

1. **(1 min)** Log in as **member**. Membership → *Calculate my settlement*.
   Show the breakdown and the disclaimer.
2. **(2 min)** Request removal. Show the 14-day countdown and the duplicate
   guard.
3. **(1 min)** Log in as **manager**. Show the request in the queue; try to
   reject without a note.
4. **(3 min)** Cooperative Requests. File a weak formation application — show it
   predicted **not eligible at 17%** with reasons. File a strong one, attach
   documents, watch it climb to **100% eligible**. Note the confidence stays at
   0.78 and say why.
5. **(3 min)** Log in as **sector officer** → approve. Then **district** →
   approve. Then **RCA** → approve, and show the new cooperative appear on the
   register.
6. **(3 min)** As RCA, open the **League Table**. Podium, dimensions, expand a
   row for the evidence, change the month to show movement. Point out the `—`
   cells and explain why missing data is excluded rather than zeroed.
7. **(2 min)** Run anomaly detection on UNITAX; show the z-score +5.36 finding.
   Open Model Performance and explain why each model reports a different metric.

Close on the honest limitations from the README — that the demo data is
generated, that the eligibility assessor checks presence not content, and that
the statistics were chosen because the dataset has no labels to learn from.
