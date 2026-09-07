# CoopInsight AI Service

The analytics and prediction service for CoopInsight AI. FastAPI, Python 3.13.

The Node backend proxies to this service from `/api/ai/*`. When it is down the
backend degrades gracefully and the UI shows `reachable: false`, so **the route
names and response field names here are a contract** — see
`CoopInsightAI Backend/src/routes/ai.ts`.

---

## Running it

```bash
cd "CoopInsightAI AI"
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt  # macOS/Linux

cp .env.example .env        # then point DATABASE_URL at the backend's database
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Interactive docs: <http://localhost:8000/docs>

The backend's `AI_SERVICE_URL` must match the port (it defaults to
`http://localhost:8000`).

```bash
./.venv/Scripts/python.exe -m pytest tests/ -q     # 29 tests, no database needed
```

---

## Why it reads the database directly

The Node backend passes only a `cooperativeId` — never the underlying rows. The
service therefore has to fetch its own features, and connects to the same
PostgreSQL database the backend writes.

It is **read-only**: it owns no tables and issues no writes. Anomalies it returns
are persisted by the *backend* into `ai_insights`. This means the AI service can
never corrupt operational data, and can be pointed at a read replica later
without a code change.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, version, database reachability, models fitted |
| POST | `/anomalies/detect` | Anomalies for one cooperative |
| GET | `/forecasts` | Forecast a metric over a horizon |
| POST | `/forecasts/generate` | Same computation, POST form |
| GET | `/member-engagement` | Per-member engagement scores |
| GET | `/benchmarks` | Peer comparison for one cooperative |
| GET | `/rankings` | District league table for a month |
| GET | `/rankings/trend` | Rank movement over recent months |
| GET | `/monthly-audit` | Functionality and engagement audit of every cooperative, with the field-visit list |
| GET | `/monthly-audit/{cooperative_id}` | One cooperative's row, with district context |
| GET | `/model-performance` | What is fitted, and how it scored |
| POST | `/retrain` | Refit one model or all of them |
| GET | `/data-volume` | Row counts behind every fit |

### Field naming is deliberate

* **Anomalies use `snake_case`** — the backend inserts them straight into the
  `ai_insights` columns of the same name.
* **Engagement and benchmarks use `camelCase`** — the backend passes them
  through untouched and the React table reads them as-is.

Renaming a field breaks the contract silently. Don't.

---

## The methods, and why these and not others

This dataset is small: 7 cooperatives, ~380 members, ~300 completed transactions
over 18 months. **That is not enough to train a supervised model** — and more
importantly there are no labels anywhere in the system to train one *against*: no
row says "this transaction was fraudulent" or "this member was disengaged". Every
method below was chosen because it is defensible at this volume, and the code is
structured so a learned model can replace any of them without touching the
endpoints.

### Anomaly detection — `app/analytics/anomalies.py`

Modified z-score on the **median and median absolute deviation**, per
`(transaction type, category)`, against a **district-wide baseline** rather than
the cooperative's own handful of rows.

Median/MAD rather than mean/standard deviation because a single extreme value
inflates the standard deviation enough to hide itself — the classic z-score of
the largest point in a sample of *n* can never exceed `sqrt(n-1)`, so on 7 rows
it *cannot* reach the usual 3.5 threshold no matter how extreme it is. There is
a test pinning exactly this (`test_single_outlier_cannot_mask_itself`).

Threshold 3.5 follows Iglewicz & Hoaglin, *How to Detect and Handle Outliers*
(1993).

An `IsolationForest` pass over (log-amount, day-of-month, direction) runs **in
addition**, but only once there are ≥30 district transactions — below that it is
skipped rather than fitted on inadequate data. The `method` field in the response
always says which path ran.

Rule-based structural checks (expenditure exceeding income, implausibly low
savings per member) are labelled `:rule`, never presented as model output.

### Forecasting — `app/analytics/forecasting.py`

**Damped trend**: `forecast(h) = level + slope * Σ φ^k`, with `φ = 0.85`.

ARIMA and seasonal decomposition need several full seasonal cycles before their
parameters mean anything; 18 monthly points is one and a half. Damping matters
because an undamped line extrapolates to absurd values over a long horizon — the
damped sum converges to `level + slope·φ/(1-φ)` instead (tested).

The choice between `damped_trend` and a flat `mean` forecast is made by
**holdout error on the tail of the series**, so a trend is only used when it
actually beat a flat line on data the fit had not seen.

Prediction intervals are `1.96 × residual standard error × √h` — derived from the
fit's own residuals, not an invented percentage. When residual spread cannot be
estimated the interval is reported flat and the `note` says so.

**Aggregate error is reported as a median, not a mean.** A cumulative savings
series can pass close to zero after a large one-off expense; dividing by each
point then reports a four-figure percentage error for a small absolute miss. The
fit scales error by the size of the whole holdout window and takes the median
across cooperatives, with `worst_scaled_error` reported alongside so an outlier
stays visible instead of being averaged away. Both behaviours are pinned by
tests.

### Member engagement — `app/analytics/engagement.py`

A **transparent weighted index**, not a learned model — there is no ground truth
anywhere in this system that says a member was "engaged", so there is nothing to
train against. Weights are stated in `WEIGHTS` so a manager can argue with them:

| Component | Weight |
|---|---|
| `activityFrequency` | 0.40 |
| `contributionConsistency` | 0.40 |
| `trainingParticipation` | 0.20 |

Normalisation is **relative to the cooperative's own best performer**, not an
absolute target: a cooperative that holds two activities a year should not have
every member scored near zero.

Where a component has no recorded data it is **excluded from the weighting**
rather than scored as zero. Scoring missing records as disengagement would
silently defame members whose cooperative simply keeps poor records.

### District league table — `app/analytics/rankings.py`

Monthly ranking of every cooperative, for the RCA and district officers. Five
dimensions — finance, growth, engagement, governance, scale — each converted to a
**percentile within that month's cohort**, then combined with stated weights.

Percentile rather than an absolute target, because it makes a 30-member carpentry
workshop comparable with a 92-member farming cooperative, and because absolute
thresholds either bunch everyone at the top or at the bottom depending on how
they were set.

Two fairness properties are deliberate and surfaced in the response:

* Percentile ranking is **zero-sum** — someone is always last, even in a month
  when everyone improved. `districtAverage` is returned per dimension so absolute
  movement stays visible next to relative position.
* A cooperative that held no activity in a month is **not scored zero** on
  governance; the dimension is excluded from its composite and listed in
  `unmeasured`. Punishing missing records as if they were poor performance would
  make the table unusable as evidence.

Every standing carries the raw figures behind it (`evidence`), so an officer can
defend the ranking when a cooperative challenges it.

### Benchmarking — `app/analytics/benchmarks.py`

Ratios, not totals — savings per member, share capital per member, surplus
margin, activity completion, health score. Totals only tell you which cooperative
is biggest.

Peers are same-sector when a sector has ≥3 cooperatives, district-wide otherwise,
and the response says which was used — "above average" means something different
against 2 peers than against 20. Position is reported as a **percentile**, which
stays meaningful on small samples.

### Monthly functionality audit — `app/analytics/monthly_audit.py`

The problem this exists for: **cooperatives rarely announce that they have
stopped working.** They go quiet. The meetings stop, the contributions stop,
nobody files anything, and a year and a half later a sector officer discovers a
cooperative that has not traded since the year before last. By then the members
have lost their savings.

Two indices, computed for every cooperative in the district for a given month:

| | Components |
|---|---|
| **Functionality** | trading (35%), meeting and governance (25%), record-keeping and a valid permit (20%), membership stability (20%) |
| **Engagement** | share of members contributing (45%) and attending (35%) over the last quarter, and whether anything was held to attend (20%) |

They combine 60/40 — a cooperative can have engaged members and still be
finished, but one that has stopped operating is finished regardless — into a band
of *healthy · monitor · at risk · critical*. The output is not the band. The
output is a **ranked list of cooperatives to go and visit**, each with the reasons
it was flagged and what the officer should do about it.

Deliberately a defined index rather than a learned model: there are no labelled
"this cooperative had failed by March" examples to train against, and a score
that decides whether somebody drives out to a village has to be explainable to
that village.

#### Where this one breaks the project's own rule, and why

Everywhere else here, an unmeasurable component is **excluded** from a score
rather than counted as zero. This audit counts silence against a cooperative,
because a cooperative that has recorded nothing for six months is precisely what
it is built to catch — if silence is not a signal, the audit detects nothing.

Three things keep that honest:

* Every row carries **`evidenceQuality`** — the share of components that could be
  measured from records that exist, rather than inferred from their absence.
* A row scoring ≤0.4 on that is flagged **`flaggedOnSilenceAlone`**, and the UI
  labels it: this cooperative may simply not be using the system.
* The output is a *visit*, not a verdict. Nothing is marked as failed; somebody
  is sent to look.

#### The default period is the last *completed* month

Run on the 8th, an audit of the month in progress reports that every cooperative
has stopped trading, because most of them trade later in the month — it would
manufacture a district-wide crisis every time the page was opened early. The
default is the last complete month, or the last month that holds any data if that
is earlier. An explicit in-progress period is allowed but returns a warning in
`note` and `periodComplete: false`. `tests/test_monthly_audit.py` pins this,
including the January roll-back into the previous year.

`latest_period_with_data()` also excludes future-dated rows, because the
activities calendar carries meetings planned weeks ahead and an unbounded `MAX`
pointed the audit at a month that had not happened yet.

---

## The model registry

`/retrain` genuinely refits against the current database and persists parameters
and metrics to `model_store/*.json` (inspectable by hand; JSON not pickle, so
loading is safe). `/model-performance` reports what was actually fitted and when.

**Each model reports the metric that is real for it**, with `metric_name`
alongside — it does not claim an "accuracy" it never measured:

| Model | Headline metric | Why |
|---|---|---|
| `anomaly_detector` | `flag_rate` | No labelled anomalies exist, so accuracy is undefined. The share of transactions flagged is checkable. |
| `savings_forecaster` | `accuracy` (= 1 − MAPE) | Genuine out-of-sample error on a held-out tail. |
| `member_engagement_scorer` | `coverage` | It is a defined index, not an estimate. Coverage tells you if it means anything yet. |
| `peer_benchmarker` | `coverage` | Positional comparison; nothing is learned. |
| `district_league` | `separation` | Whether the composite actually distinguishes cooperatives. A scheme scoring everyone alike reads near 0. |
| `cooperative_functionality_auditor` | `evidence_quality` | Not an accuracy: the share of each band resting on records that exist rather than on their absence. It is the number that says whether to trust this month's visit list. |

A fit that cannot honestly be made is saved as `insufficient_data` with an
explanation, rather than as a success with a meaningless number.

---

## Current state against real data

Run `GET /data-volume` for live counts. As of the last seed:

```
cooperatives 7 · members 379 · transactions 296 · activities 71
contributions 4,601 · activity_participants 1,813 · 18 months of history
```

Last fit (`POST /retrain`):

| Model | Metric | Value |
|---|---|---|
| `anomaly_detector` | flag_rate | 0.0073 |
| `savings_forecaster` | accuracy | 0.9429 |
| `member_engagement_scorer` | coverage | 1.00 |
| `peer_benchmarker` | coverage | 1.00 |
| `district_league` | separation | 0.8477 |
| `cooperative_functionality_auditor` | evidence_quality | 0.9714 |

A sub-1% flag rate is what you want from an outlier detector: rare enough to be
worth an officer's attention. `separation` at 0.85 means the league table
genuinely distinguishes cooperatives rather than bunching them. Evidence quality
at 0.97 means the monthly audit is reading real records for almost every
component of almost every cooperative — the bands are not being driven by gaps.

### Demo data caveat

The seed generates each cooperative's monthly trading from a "quality" derived
from its health score, so cooperatives seeded as well-run genuinely do rank
higher — the rankings are explainable, but they are not a discovery. Two
cooperatives carry one deliberately anomalous transaction each, marked
`[demo anomaly]` in the description, so anomaly detection has something real to
find.

For the same reason **one cooperative is seeded as dormant**: its generated
trading, meetings and contributions stop eight months back and it is left on an
unconverted temporary permit, so the monthly audit has a genuinely dormant
cooperative to catch and the visit list is not empty on a fresh install. The seed
marks it `[demo dormancy]` and records an insight saying so. The cooperative is
real; that trading gap is not.

Replace the seed with real returns and everything recomputes; no service change
is needed, just `POST /retrain`.

---

## Extending it

* **New metric to forecast** — add a branch to `features.get_monthly_series`.
* **New anomaly rule** — add to `_structural_checks`, suffix the model name with
  `:rule` so it is not mistaken for model output.
* **A real learned model** — implement `fit()` returning the same dict shape,
  register it in `FITTERS` in `app/routers/admin.py`, and save a `joblib`
  artefact next to the JSON record. Nothing else changes.
* **Formation eligibility** — the rules engine currently lives on the Node side
  in `src/services/eligibility.ts`. Moving it here would let it read the uploaded
  documents rather than only checking that a file was attached; that is the
  natural next capability for this service.

---

## Layout

```
app/
  main.py            FastAPI app, CORS, lifespan
  config.py          Settings from environment
  db.py              Read-only connection pool
  schemas.py         Response contract (do not rename fields)
  features.py        All SQL — one place per feature
  registry.py        Fitted params + metrics persistence
  analytics/         The methods
    anomalies.py  forecasting.py  engagement.py  benchmarks.py
    rankings.py   monthly_audit.py
  routers/           One module per endpoint group
tests/               Statistical core, no database required
```
