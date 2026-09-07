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
10. [Operating permits and the maturity audit](#10-operating-permits-and-the-maturity-audit)
11. [The monthly audit and the field-visit list](#11-the-monthly-audit-and-the-field-visit-list)
12. [External support and funding matches](#12-external-support-and-funding-matches)
13. [The district league table](#13-the-district-league-table)
14. [AI insights](#14-ai-insights)
15. [Government oversight](#15-government-oversight)
16. [Supporting features](#16-supporting-features)
17. [Failure modes worth demonstrating](#17-failure-modes-worth-demonstrating)
18. [Suggested 15-minute demo script](#18-suggested-15-minute-demo-script)

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
| AI unit tests | `cd "CoopInsightAI AI" && .\.venv\Scripts\python.exe -m pytest tests/ -q` | 54 passed |
| Backend types | `cd "CoopInsightAI Backend" && npx tsc --noEmit` | no output |
| Frontend types | `cd "CoopInsightAI UI" && npx tsc --noEmit` | no output |
| Backend build | `cd "CoopInsightAI Backend" && pnpm build` | `dist/` created |
| Frontend build | `cd "CoopInsightAI UI" && pnpm build` | `dist/` created |

The 54 unit tests cover the statistical core without needing a database —
outlier detection, forecast damping, percentile fairness, the monthly audit's
scoring rules and period selection, and several regression tests for bugs found
and fixed during development (including an audit that defaulted to a month which
had not happened yet).

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
| Submit | Full reason, exit date, savings instruction, tick the box | "TMC must call a general assembly to decide it and respond within 14 days" |
| Countdown | Look at the tracker | "Response due in 14 days" with the deadline date |
| Duplicate guard | Submit a second request | "You already have a request awaiting a response" |
| Withdraw | Withdraw this request | Returns to no open request, and any assembly called for it is cancelled |

### The general assembly decides it — not the manager

This is the part worth demonstrating carefully. Log in as **manager** →
Membership; the request is in the queue.

**Test A — the office cannot decide alone.** With no assembly called, there is no
approve button; the panel says an assembly must be convened first. Via the API:

```bash
curl -X PATCH http://localhost:5000/api/membership/exit-requests/<id>/decision \
  -H "Authorization: Bearer <manager token>" -H 'Content-Type: application/json' \
  -d '{"decision":"approved","note":"Fine by me"}'
# → "No general assembly has resolved on this request yet…"  requiresMeeting: true
```

**Test B — notice period.** Call an assembly for three days' time.
Expected: *"Members must be given at least 7 days' notice."*

**Test C — call it properly.** Pick a date at least 7 days out and a location.

Expected: *"General assembly called for … 25 of 49 members must attend for the
vote to stand."* Then check two things:

- **Activities** now shows *"General Assembly — removal request: UWIHOREYE
  Josephine"* on that date. The meeting is a real calendar entry, not a hidden
  record.
- Every member of the cooperative has a notification.

**Test D — the vote is checked, not trusted.** Try each of these when recording
the outcome:

| Figures entered | Expected |
|---|---|
| 9 present, 8 for, resolution *approve* | Refused — quorum is 25 of 49; record it as deferred |
| 30 present, 40 votes cast | Refused — more votes than attendees |
| 30 present, 10 for / 18 against, minuted as *approve* | Refused — the vote does not carry |
| Any resolution with no minute of the reasoning | Refused — the member is entitled to know why |
| 31 present, 24 for / 5 against / 2 abstain, *approve*, with a minute | Accepted, quorum met |

**Test E — the decision must match the resolution.** With the assembly having
voted to release her, try to record a rejection.

Expected: *"The general assembly resolved to approve exit (24 for, 5 against), so
this request can only be recorded as approved."*

Now record the approval. Confirm afterwards: she no longer appears in the Members
list, her login is unlinked from TMC, and `member_status_log` carries the
assembly's reasoning as the stated reason.

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

Note what final RCA approval also does now: it **issues the new cooperative's
first operating permit**, a temporary one valid for a year. The response carries
`issuedPermit`, and the cooperative appears on the Operating Permits page.

### Dissolution — deliberately harder than formation

As **manager** (*RUKUNDO Emmanuel*, who is TMC's president) → Cooperative
Requests → *Request dissolution*. Provide grounds, the assembly vote, liabilities
and an asset-disposal plan.

**Test A — only the president may file it.** Log in as any member who is not
recorded as president in the cooperative's leadership record and try.

Expected: *"Only the president of … may request its dissolution. Your account is
not recorded as holding that office…"*

**Test B — the shorter clock.** On submission the response says the target is
**14 days end-to-end**, and each stage gets a third of that rather than the three
weeks a formation enjoys. The request carries both a per-stage `response_due_at`
and an end-to-end `target_completion_at`.

**Test C — the RCA cannot approve before it audits.** Run it through sector
(`remera.officer@`) and district (`district.officer@`), then as
`gov@coopinsight.rw` try to approve.

Expected: *"A cooperative cannot be struck off before the RCA has audited the
grounds."* (`requiresAudit: true`)

**Test D — the audit catches a cooperative that is still trading.** Press
**Open the RCA audit**. Against seeded TMC the pre-assessment reads about **73%**
and flags, in plain words:

```
The cooperative traded in 12 of the last 12 complete months and ran a surplus of
RWF 5,350,000. Dissolving a cooperative that is still trading needs a stronger
explanation.
No field visit or funding referral was recorded before dissolution was requested.
```

> Money figures shift a little between seeds, because the seed generates 18
> months of history relative to the day you ran it. The *shape* of the finding —
> traded in every month, still in surplus, no support attempted — is stable.

It also confirms the vote carried: *"38 for, 6 against, 2 abstained (83% in
favour; two-thirds required)."*

**Test E — a refused audit blocks the approval.** Conclude the audit as *the
grounds do not hold*, then try to approve anyway.

Expected: *"Audit AUD/… found the grounds do not hold, so the dissolution cannot
be approved. Reject the request, or reopen the audit."*

**Test F — the full path.** Conclude the audit as *the grounds hold*, then
approve at RCA. This **strikes the cooperative off**, revokes its operating
permit, unlinks its members and cancels any queued field visit.

> This genuinely removes TMC from the active register. Run `pnpm seed` afterwards.

---

## 10. Operating permits and the maturity audit

Registration does not hand a cooperative a licence for life. The RCA issues a
one-year temporary permit; a maturity audit before it lapses converts it to a
permanent permit of 30 years — or 50 for industrial and rice-growing
cooperatives.

### What the seed gives you

Log in as **gov@coopinsight.rw** → **Operating Permits**.

Six cooperatives hold permanent 30-year permits, each with the superseded
temporary permit that preceded it, dated from its real registration. **UNITAX is
deliberately left on an unconverted temporary permit** expiring in about 45 days —
that is the case the queue exists for.

| Test | Expected |
|---|---|
| Conversion queue | UNITAX appears under *Temporary permits falling due*, with days remaining |
| Term rule is visible | Each permanent permit shows the rule that set its term and the reason |
| Cooperative view | Log in as **manager** → Operating Permits: TMC sees its own permit and a readiness score against the same criteria the RCA will use |
| Self-service | Press *Ask the RCA to audit us* — RCA officers are notified with the pre-assessment |

### Running the maturity audit

As the RCA officer, press **Open maturity audit** on UNITAX.

Expected against seeded data: roughly **50%**, recommending *extend the temporary
permit*, with the mandatory failures named — *the cooperative actually traded*
and *general assembly held* — and the evidence spelled out:

```
Income recorded in 3 month(s) since the permit was issued.
0 general assembly meeting(s) recorded in the permit year.
81% of members participated.
Balance sheet on file.
```

| Test | Expected |
|---|---|
| Conclude with no findings | Refused — at least 20 characters required |
| Conclude as *extend temporary* | A fresh one-year temporary permit is issued and the old one superseded |
| Conclude as *issue permanent* | A 30-year permanent permit is issued (50 for industry/rice), with its basis recorded |
| Conclude as *revoke* | The permit is revoked and the cooperative suspended on the register |
| Either way | The cooperative is notified, and the outcome appears in AI Insights |
| Double-open guard | Try to open a second audit — refused, one is already in progress |

### The 30 / 50-year rule

The term is decided by `services/permits.ts` from the cooperative's registered
type, falling back to its name and description — a rice cooperative is usually
registered under the general "Agriculture" type with the crop named only in its
narrative. None of the seven seeded cooperatives is recorded as rice-growing or
industrial, so all seven take the standard 30 years, and the stored basis says
exactly why. To see the extended term fire, register a formation request with a
type such as *Rice Growing* or *Agro-processing Industry* and convert it.

---

## 11. The monthly audit and the field-visit list

This is the feature that exists because cooperatives do not announce that they
have stopped working — they go quiet, and are found out a year later.

**The AI service must be running.** Log in as **gov@coopinsight.rw** →
**Monthly Audit** → *Run this month's audit*.

Expected: *"Monthly audit for 2026-08 complete: 7 cooperative(s) assessed,
1 field visit(s) raised."*

### District standings

Switch to the **District standings** tab. Six cooperatives sit in *healthy*;
**UNITAX scores about 18/100 and is banded *critical* and *dormant***, because
the seed stops its trading eight months back on purpose.

Expand UNITAX. It should list, in plain language:

```
Nothing has been recorded for 8 months — the cooperative looks dormant.
Income was recorded in only 0 of the last 6 months.
No meeting has been held in the last 6 months.
2 of 3 office-bearers are recorded by name.
The temporary operating permit expires in 52 days.
```

Note the last line — the audit reads the permit too, so one screen connects the
dormancy to the licence that was never converted.

### The visit list

The **Visit list** tab carries one priority-1 visit, automatically assigned to
the **Kimihurura sector officer** who covers UNITAX, with recommended actions
including *"Visit and establish whether the cooperative still operates at all. If
it does not, advise the president on the dissolution process before members lose
their savings."*

| Test | Expected |
|---|---|
| Re-run the audit | *"0 field visit(s) raised"* — the standings are updated in place, the open visit is not duplicated |
| Close a visit with no findings | Refused — at least 20 characters, and an outcome is required |
| Sector officer scope | Log in as `kimihurura.officer@` — sees the visit; `gisozi.officer@` does not |
| Close as *referred for funding* | TMC-style managers of that cooperative are notified to open their funding matches |

### Two honesty checks worth showing

**Evidence quality.** Expand any row: it reports how much of the band rests on
records that exist rather than on their absence. A cooperative flagged mainly on
silence is labelled *"Flagged on missing records"* — it may simply not be using
the system, and the officer is told to verify on the visit rather than conclude.

**The period default.** The audit defaults to the **last completed month**, never
the one in progress. Ask for the current month explicitly and the `note` warns
that the scores understate every cooperative that trades later in the month.
`tests/test_monthly_audit.py` pins this behaviour, including the January
roll-back into the previous year.

---

## 12. External support and funding matches

Log in as **gov@coopinsight.rw** → **External Support**.

### Who funds cooperatives

The **Who funds cooperatives** tab lists six organisations. Read the banner: they
are **illustrative**, named after the kind of funder they represent rather than
after real NGOs, so nothing on screen is a claim about a real organisation. The
seven cooperatives are real; these funders are not.

### The three-factor match

Open **Matches** and pick a cooperative. The ranking weights specialisation 45%,
the cooperative's current condition 35% and the existing relationship 20%, and
every score comes back with a reason for each factor.

**Test A — the rescue fund finds the dormant cooperative.** Pick **UNITAX**
(critical). Top match ≈ **84/100**: *Dormant cooperative rescue package* — the
programme funds any type, and *"UNITAX is currently assessed as 'critical', which
is exactly who this programme is for."*

**Test B — blockers are separated from the score.** Further down, *Fleet renewal
working capital facility* scores 0.54 but is marked **not eligible**, with what
would have to change:

```
requires a health score of at least 60; UNITAX is at 54.
is open only to cooperatives holding a permanent permit. UNITAX is still on a
temporary permit.
```

That second line ties the funding page back to the permits page — the permit that
was never converted is costing them money.

**Test C — relationship counts.** Pick **ZAMUKA**. Top match ≈ **99/100** for the
*Post-harvest handling equipment grant*: right specialisation, right condition,
and a seeded relationship at 78/100 with the programme officer. Compare it with a
cooperative that has no relationship with that funder — same specialisation, a
visibly lower score, and the reason says so.

**Test D — specialisation is not given away.** A programme that targets only
*Agriculture* scores **0** on specialisation for a Transport cooperative, not
partial credit. An empty target list means the funder did not filter on that
dimension, which is not the same as a match.

### Applying, deciding, disbursing

| Test | Expected |
|---|---|
| Apply with a two-word purpose | Refused — at least 40 characters |
| Apply to a programme you are blocked from | Refused up front, with the blockers listed — not filed to be rejected later |
| Duplicate application | Refused while the first is still open |
| Reject without a note | Refused — the funder's reason is required |
| Approve | The relationship is upgraded to *active* at strength 70, which lifts that cooperative's next match |
| Record a disbursement | The amount is **posted to the cooperative's income** at the same time; check Financials for a "Grants & Donations" transaction referencing the application |

---

## 13. The district league table

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

## 14. AI insights

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

## 15. Government oversight

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

## 16. Supporting features

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

## 17. Failure modes worth demonstrating

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
| Approve an exit with no assembly resolution | Rejected — `requiresMeeting: true` |
| Record a vote that did not reach quorum as carried | Rejected — record it as deferred |
| Approve a dissolution before the RCA audit | Rejected — `requiresAudit: true` |
| Approve a dissolution the audit refused | Rejected, naming the audit reference |
| Apply for funding you are blocked from | Rejected up front, with the blockers |
| Run the monthly audit with the AI service down | `503`, and **nothing is written** — no partial results |

---

## 18. Suggested 20-minute demo script

The strongest version of this demo follows **one cooperative — UNITAX — all the
way through**, because the seed deliberately makes it the cooperative that fell
through the cracks: never audited, still on a temporary permit, and silent for
eight months. Every feature then has a reason to exist rather than being a tab.

1. **(1 min)** Log in as **member**. Membership → *Calculate my settlement*.
   Show the breakdown and the disclaimer.
2. **(3 min)** Request removal. Then as **manager**, try to approve it — the
   system refuses: members decide, not the office. Call a general assembly, show
   it appear on the **Activities** calendar, then try to minute a vote that did
   not reach quorum. Record a proper vote and only then the decision. This is the
   sharpest governance point in the system.
3. **(3 min)** As **RCA**, open **Monthly Audit** → *Run this month's audit*.
   Six healthy, **UNITAX critical and dormant**. Expand it and read the reasons
   aloud — including that its temporary permit expires in 52 days. One priority-1
   visit is raised and auto-assigned to the Kimihurura sector officer.
4. **(2 min)** Open **Operating Permits**. UNITAX is the one temporary permit in
   the conversion queue. Open the maturity audit: ~50%, mandatory failures named
   with the evidence. Extend it, and show the new permit supersede the old.
5. **(2 min)** Open **External Support** → Matches for UNITAX. Top match is the
   turnaround fund because it is *critical*. Then show the fleet-renewal facility
   marked **not eligible** — *"open only to cooperatives holding a permanent
   permit"*. The permit nobody converted is costing them money. Then show ZAMUKA
   at 99/100 and point at the relationship factor.
6. **(3 min)** **Cooperative Requests**. File a weak formation application — show
   it predicted **not eligible at 17%** with reasons. File a strong one, attach
   documents, watch it climb to **100% eligible**. Note the confidence stays at
   0.78 and say why.
7. **(2 min)** Approve it through **sector → district → RCA**. Show the new
   cooperative appear on the register **with a temporary permit issued in the
   same act**.
8. **(2 min)** File a dissolution as TMC's president. Try to approve it at RCA —
   blocked until the audit runs. Open the audit and read what it caught: *"the
   cooperative traded in 12 of the last 12 complete months and ran a surplus of
   RWF 5.35m"*. Refuse it, and show that approval is now impossible.
9. **(2 min)** As RCA, open the **League Table** — podium, dimensions, expand a
   row for the evidence, change the month for movement. Point out the `—` cells
   and explain why missing data is excluded rather than zeroed.

Close on the honest limitations from the README — that the demo data is
generated, that the partner register is illustrative while the cooperatives are
real, that the eligibility assessor checks presence not content, and that the
statistics were chosen because the dataset has no labels to learn from. Then say
the thing that makes the monthly audit defensible: it counts silence against a
cooperative, which the rest of the system deliberately never does, and it is only
allowed to because its output is a **visit**, not a verdict.
