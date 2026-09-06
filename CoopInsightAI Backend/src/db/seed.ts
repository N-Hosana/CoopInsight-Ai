import bcrypt from "bcrypt";
import { query } from "../config/db";
import dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Source of truth for this seed is the Gasabo District RCA sector register
// (7 cooperatives, with their sector cooperative officer, president, vice
// president and secretary). Everything that is not in that register — member
// rosters beyond the named leaders, activities, transactions, health scores and
// AI insights — is clearly-marked demo data generated from the real figures so
// the dashboards have something to render.
//
// Fields the register does not provide are left NULL rather than invented:
//   • COPCOM president  — phone recorded, name not recorded
//   • UNITAX vice pres. — name recorded, phone truncated in the source
//   • UNITAX secretary  — post vacant (previous holder resigned)
// ─────────────────────────────────────────────────────────────────────────────

//  Types

type Gender = "male" | "female";

interface LeaderSeed {
  name: string;
  phone: string | null;
  gender: Gender | null;
  /** false when the register records the post but not the person behind it */
  isMember: boolean;
}

interface CoopSeed {
  key: string;
  name: string;
  type: string;
  sector: string;
  cell: string;
  village: string;
  registrationNumber: string;
  registrationDate: string;
  description: string;
  address: string;
  /** Unique small integer — seeds the placeholder member ID/phone ranges. */
  idBlock: number;
  memberTarget: number;
  healthScore: number;
  health: { financial: number; engagement: number; compliance: number; docs: number };
  sectorOfficer: { name: string; phone: string };
  president: LeaderSeed | null;
  vicePresident: LeaderSeed | null;
  secretary: LeaderSeed | null;
  /** How the cooperative currently keeps its records (from the sector survey). */
  recordKeeping: string;
  /** Gaps in the RCA register that still need to be filled in by the sector officer. */
  dataGaps: string[];
}

//  Helpers

async function insertCooperative(data: {
  name: string; type: string; sector: string; cell: string; village: string;
  registrationNumber: string; registrationDate: string; description: string;
  phone: string | null; email: string; address: string; healthScore: number;
}) {
  const res = await query(
    `INSERT INTO cooperatives
       (name, type, sector, cell, village, registration_number, registration_date,
        description, phone, email, address, status, total_savings, health_score, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',0,$12,NOW(),NOW())
     ON CONFLICT (registration_number) DO UPDATE SET
       name = EXCLUDED.name, type = EXCLUDED.type, sector = EXCLUDED.sector,
       cell = EXCLUDED.cell, village = EXCLUDED.village,
       registration_date = EXCLUDED.registration_date,
       description = EXCLUDED.description, phone = EXCLUDED.phone,
       email = EXCLUDED.email, address = EXCLUDED.address,
       health_score = EXCLUDED.health_score, updated_at = NOW()
     RETURNING id`,
    [data.name, data.type, data.sector, data.cell, data.village,
     data.registrationNumber, data.registrationDate, data.description,
     data.phone, data.email, data.address, data.healthScore]
  );
  return res.rows[0].id as string;
}

async function replaceLeadership(
  coopId: string,
  leaders: { name: string; role: string; phone: string | null; email: string | null; startDate: string }[]
) {
  await query(`DELETE FROM cooperative_leadership WHERE cooperative_id = $1`, [coopId]);
  for (const l of leaders) {
    await query(
      `INSERT INTO cooperative_leadership (cooperative_id, name, role, phone, email, start_date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [coopId, l.name, l.role, l.phone, l.email, l.startDate]
    );
  }
}

async function insertMember(coopId: string, m: {
  fullName: string; phone: string; nationalId: string; gender: string;
  sector: string; cell?: string; membershipNumber: string; membershipDate: string;
  role?: string; totalSavings?: number;
}) {
  const res = await query(
    `INSERT INTO members
       (cooperative_id, full_name, phone, national_id, gender, sector, cell,
        membership_number, membership_date, role, status, total_savings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
     ON CONFLICT (national_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       membership_number = EXCLUDED.membership_number,
       cooperative_id = EXCLUDED.cooperative_id,
       role = EXCLUDED.role,
       total_savings = EXCLUDED.total_savings
     RETURNING id`,
    [coopId, m.fullName, m.phone, m.nationalId, m.gender, m.sector, m.cell ?? null,
     m.membershipNumber, m.membershipDate, m.role ?? "member", m.totalSavings ?? 0]
  );
  return res.rows[0].id as string;
}

/**
 * Fills a cooperative's roster up to `count` with clearly-labelled placeholder
 * members. `idBlock` must be unique per cooperative — it seeds the national ID
 * and phone ranges so two cooperatives never collide.
 */
async function seedPlaceholderMembers(coopId: string, options: {
  count: number; sector: string; cell: string; namePrefix: string;
  codePrefix: string; idBlock: number; baseYear: number;
}) {
  const existingCountResult = await query(
    `SELECT COUNT(*) AS count FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL`,
    [coopId]
  );
  const existingCount = parseInt(existingCountResult.rows[0].count, 10);
  const remaining = Math.max(0, options.count - existingCount);

  for (let i = 1; i <= remaining; i += 1) {
    const n = existingCount + i;
    const gender = n % 2 === 0 ? "female" : "male";
    await insertMember(coopId, {
      fullName: `${options.namePrefix} ${n}`,
      phone: `+250780${String(options.idBlock * 10000 + n).padStart(6, "0")}`,
      nationalId: `119${String(options.idBlock * 100000 + n).padStart(9, "0")}`,
      gender,
      sector: options.sector,
      cell: options.cell,
      membershipNumber: `${options.codePrefix}-${String(n).padStart(3, "0")}`,
      membershipDate: `${options.baseYear}-01-15`,
      role: "member",
      totalSavings: n * 5000,
    });
  }
}

async function insertDocument(coopId: string, d: { name: string; type: string; description: string; url?: string }) {
  await query(
    `INSERT INTO cooperative_documents (cooperative_id, name, type, description, url, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [coopId, d.name, d.type, d.description, d.url ?? "https://storage-placeholder.com/pending-upload.pdf"]
  );
}

async function insertActivity(coopId: string, a: {
  title: string; type: string; status: string; date: string;
  location: string; description: string; budget?: number; actualCost?: number;
}) {
  await query(
    `INSERT INTO activities
       (cooperative_id, title, type, status, date, location, description, budget, actual_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [coopId, a.title, a.type, a.status, a.date, a.location, a.description,
     a.budget ?? 0, a.actualCost ?? 0]
  );
}

async function insertTransaction(coopId: string, t: {
  type: string; category: string; amount: number; date: string;
  description: string; paymentMethod?: string;
}) {
  await query(
    `INSERT INTO transactions
       (cooperative_id, type, category, amount, date, description, payment_method, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'completed')`,
    [coopId, t.type, t.category, t.amount, t.date, t.description, t.paymentMethod ?? "mobile_money"]
  );
}

async function insertHealthScore(coopId: string, s: {
  overall: number; financial: number; engagement: number; compliance: number; docs: number;
}) {
  await query(
    `INSERT INTO cooperative_health_scores
       (cooperative_id, overall_score, financial_health, member_engagement,
        activity_compliance, document_completeness, trend, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,'stable',NOW())`,
    [coopId, s.overall, s.financial, s.engagement, s.compliance, s.docs]
  );
}

/**
 * Wipes every cooperative and all cooperative-scoped data. Tables that reference
 * cooperatives without ON DELETE CASCADE (ai_insights, reports, report_schedules,
 * messages, loan_records, dividend_records) must be cleared first, and
 * transactions/balance_sheets must go before financial_periods they point at.
 * users.cooperative_id is ON DELETE SET NULL, so those users survive and are
 * re-linked further down.
 */
async function resetCooperativeData() {
  // Formation requests carry no cooperative_id, so they survive the cascade below
  // and have to be cleared explicitly.
  await query(`DELETE FROM cooperative_requests`);
  await query(`DELETE FROM membership_exit_requests`);
  await query(`DELETE FROM ai_insights WHERE cooperative_id IS NOT NULL`);
  await query(`DELETE FROM report_schedules WHERE cooperative_id IS NOT NULL`);
  await query(`DELETE FROM reports WHERE cooperative_id IS NOT NULL`);
  await query(
    `DELETE FROM message_replies
      WHERE message_id IN (SELECT id FROM messages WHERE cooperative_id IS NOT NULL)`
  );
  await query(`DELETE FROM messages WHERE cooperative_id IS NOT NULL`);
  await query(`DELETE FROM loan_repayments`);
  await query(`DELETE FROM loan_records`);
  await query(`DELETE FROM dividend_records`);
  await query(`DELETE FROM member_contributions`);
  await query(`DELETE FROM balance_sheets`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM financial_periods`);
  await query(`DELETE FROM cooperatives`);
}

/**
 * Every member subscribes share capital — this is what gives them a claim on the
 * cooperative's retained value, and it is what the exit-settlement calculator
 * divides the net worth by. Without it every member's share reads 0%.
 */
async function seedShareCapital(coopId: string, registrationDate: string) {
  const existing = await query(
    `SELECT COUNT(*) AS count FROM member_contributions mc
       JOIN members m ON m.id = mc.member_id
      WHERE m.cooperative_id = $1 AND mc.type = 'share_capital'`,
    [coopId]
  );
  if (parseInt(existing.rows[0].count, 10) > 0) return 0;

  const members = await query(
    `SELECT id, total_savings FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL ORDER BY membership_number`,
    [coopId]
  );

  let total = 0;
  for (const m of members.rows) {
    // A flat subscription plus a slice of what the member has saved, so holdings
    // differ between members and the percentages are meaningful.
    const amount = 10000 + Math.round(Number(m.total_savings) * 0.15 / 500) * 500;
    await query(
      `INSERT INTO member_contributions (member_id, amount, type, date, notes)
       VALUES ($1,$2,'share_capital',$3,'Founding share subscription')`,
      [m.id, amount, registrationDate]
    );
    total += amount;
  }
  return total;
}

/**
 * A closing balance sheet, built so it balances by construction:
 * assets = equity (share capital + retained earnings) + liabilities.
 * The settlement calculator prefers this over estimating from transactions.
 */
async function insertBalanceSheet(coopId: string, opts: {
  memberSavings: number; shareCapital: number; retainedEarnings: number; type: string;
}) {
  const accountsPayable = Math.round(opts.retainedEarnings * 0.08);
  const equity = opts.shareCapital + opts.retainedEarnings;
  const liabilities = opts.memberSavings + accountsPayable;
  const assets = equity + liabilities;

  // Stock-holding trades carry inventory; the rest sit more in fixed assets.
  const holdsStock = ["Trading", "Carpentry", "Agriculture", "Construction"].includes(opts.type);
  const inventory = holdsStock ? Math.round(assets * 0.15) : 0;
  const fixedAssets = Math.round(assets * (holdsStock ? 0.25 : 0.3));
  const cash = Math.round(assets * 0.1);
  const bankBalance = assets - inventory - fixedAssets - cash;

  await query(
    `INSERT INTO balance_sheets
       (cooperative_id, period_start, period_end, cash, bank_balance, loans_outstanding,
        inventory, fixed_assets, member_savings, external_loans, accounts_payable,
        share_capital, retained_earnings)
     VALUES ($1,'2025-01-01','2025-12-31',$2,$3,0,$4,$5,$6,0,$7,$8,$9)`,
    [coopId, cash, bankBalance, inventory, fixedAssets, opts.memberSavings,
     accountsPayable, opts.shareCapital, opts.retainedEarnings]
  );
}

/**
 * Monthly savings contributions per member.
 *
 * This is what makes the engagement score mean anything: without a contribution
 * history every member looks identical. Discipline varies by cooperative
 * (well-run ones collect more reliably) and by member, so the league table's
 * engagement dimension has real spread to measure.
 *
 * Inserted in batches — one round trip per member-month would be thousands.
 */
async function seedMonthlyContributions(coopId: string, c: CoopSeed) {
  const existing = await query(
    `SELECT COUNT(*) AS count FROM member_contributions mc
       JOIN members m ON m.id = mc.member_id
      WHERE m.cooperative_id = $1 AND mc.type = 'savings'`,
    [coopId]
  );
  if (parseInt(existing.rows[0].count, 10) > 0) return;

  const members = await query(
    `SELECT id, total_savings FROM members
      WHERE cooperative_id = $1 AND deleted_at IS NULL ORDER BY membership_number`,
    [coopId]
  );
  if (members.rowCount === 0) return;

  const q = quality(c);
  const rng = makeRng(seedFromKey(c.key) ^ 0x5bf03635);

  const rows: Array<[string, number, string]> = [];
  for (const m of members.rows) {
    // Each member has their own reliability, centred on the cooperative's.
    const reliability = Math.min(0.95, Math.max(0.15, 0.35 + q * 0.45 + (rng() - 0.5) * 0.4));
    const monthlyAmount = Math.max(500, Math.round((Number(m.total_savings) / 24) / 100) * 100);

    for (let i = MONTHS_OF_HISTORY - 1; i >= 0; i -= 1) {
      if (rng() > reliability) continue;
      const month = monthsAgo(i);
      rows.push([m.id as string, Math.round(monthlyAmount * (0.7 + rng() * 0.6)), ymd(month, 5)]);
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk
      .map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},'savings',$${j * 3 + 3},'Monthly savings contribution')`)
      .join(",");
    await query(
      `INSERT INTO member_contributions (member_id, amount, type, date, notes) VALUES ${values}`,
      chunk.flat()
    );
  }
  return rows.length;
}

/**
 * Who actually turned up. Attendance is the other half of the engagement score
 * and the input to the governance dimension, and without these rows the AI
 * service correctly reports those components as unmeasurable.
 */
async function seedActivityAttendance(coopId: string, c: CoopSeed) {
  const existing = await query(
    `SELECT COUNT(*) AS count FROM activity_participants ap
       JOIN activities a ON a.id = ap.activity_id
      WHERE a.cooperative_id = $1`,
    [coopId]
  );
  if (parseInt(existing.rows[0].count, 10) > 0) return;

  const activities = await query(
    `SELECT id FROM activities
      WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'completed'
      ORDER BY date`,
    [coopId]
  );
  const members = await query(
    `SELECT id FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL
      ORDER BY membership_number`,
    [coopId]
  );
  if (activities.rowCount === 0 || members.rowCount === 0) return;

  const q = quality(c);
  const rng = makeRng(seedFromKey(c.key) ^ 0x27d4eb2f);

  // A member's own propensity to attend, stable across activities — so the
  // engagement score separates consistently-present members from absentees
  // rather than being pure noise.
  const propensity = new Map<string, number>();
  for (const m of members.rows) {
    propensity.set(m.id as string, Math.min(0.95, Math.max(0.05, 0.25 + q * 0.4 + (rng() - 0.5) * 0.5)));
  }

  const rows: Array<[string, string, boolean]> = [];
  for (const a of activities.rows) {
    for (const m of members.rows) {
      const p = propensity.get(m.id as string)!;
      // Invited if reasonably likely to be involved; attended is a further draw.
      if (rng() > Math.min(0.9, p + 0.25)) continue;
      rows.push([a.id as string, m.id as string, rng() < p]);
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk
      .map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`)
      .join(",");
    await query(
      `INSERT INTO activity_participants (activity_id, member_id, attended) VALUES ${values}
       ON CONFLICT (activity_id, member_id) DO NOTHING`,
      chunk.flat()
    );
  }
  return rows.length;
}

/** Keeps cooperatives.total_savings in step with the member roster it is built from. */
async function syncCooperativeSavings(coopId: string) {
  const res = await query(
    `UPDATE cooperatives c
        SET total_savings = COALESCE(
              (SELECT SUM(m.total_savings) FROM members m
                WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL), 0),
            updated_at = NOW()
      WHERE c.id = $1
      RETURNING total_savings`,
    [coopId]
  );
  return Number(res.rows[0].total_savings);
}

//  Demo-data generators (typed off the cooperative's line of business)

const TRAINING_BY_TYPE: Record<string, string> = {
  Carpentry: "Workshop Safety & Tool Maintenance Training",
  Construction: "Site Safety and RSSB Compliance Training",
  Transport: "Defensive Driving & Passenger Safety Training",
  Agriculture: "RAB Crop Husbandry Best-Practice Training",
  Services: "Customer Service & Contract Management Training",
  Trading: "Stock Control and Bookkeeping Training",
};

const REVENUE_CATEGORY_BY_TYPE: Record<string, string> = {
  Carpentry: "Product Sales",
  Construction: "Contract Revenue",
  Transport: "Fare Revenue",
  Agriculture: "Produce Sales",
  Services: "Service Revenue",
  Trading: "Product Sales",
};

/**
 * --- Monthly demo history --------------------------------------------------
 * The cooperatives are compared month by month in the district league table, so
 * the demo data has to have a real monthly shape rather than a handful of dated
 * rows. Each cooperative gets MONTHS_OF_HISTORY months of trading, contributions
 * and activities, generated from a per-cooperative "quality" derived from its
 * health score - so the ranking is explainable: cooperatives seeded as well-run
 * genuinely do score higher, for reasons visible in the underlying data.
 *
 * Generation is deterministic (seeded PRNG), so reseeding reproduces the same
 * league table rather than reshuffling it underneath you.
 */

const MONTHS_OF_HISTORY = 18;

/** mulberry32 - small, fast, deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromKey(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** First day of the month, `back` months before the current month. */
function monthsAgo(back: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - back, 1);
}

function ymd(d: Date, day = 15) {
  const dd = new Date(d.getFullYear(), d.getMonth(), day);
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const dayStr = String(dd.getDate()).padStart(2, "0");
  return `${dd.getFullYear()}-${m}-${dayStr}`;
}

function monthLabel(d: Date) {
  return d.toLocaleString("en", { month: "long", year: "numeric" });
}

/**
 * How well a cooperative is run, 0-1, taken from its seeded health score. It
 * drives income growth, cost control, contribution discipline and attendance,
 * so every ranking dimension moves together the way it would in reality.
 */
function quality(c: CoopSeed) {
  return Math.min(1, Math.max(0, (c.healthScore - 40) / 40));
}

interface GeneratedTxn {
  type: string; category: string; amount: number; date: string;
  description: string; paymentMethod?: string;
}

function monthlyTransactionsFor(c: CoopSeed, totalSavings: number): GeneratedTxn[] {
  const rng = makeRng(seedFromKey(c.key));
  const q = quality(c);
  const revenueCategory = REVENUE_CATEGORY_BY_TYPE[c.type] ?? "Service Revenue";

  // Better-run cooperatives trade more against their savings base, grow faster,
  // and keep a tighter lid on costs.
  const baseIncome = Math.max(120000, totalSavings * (0.05 + q * 0.09));
  const monthlyGrowth = -0.004 + q * 0.014;
  const expenseRatio = 0.82 - q * 0.34;

  const out: GeneratedTxn[] = [];

  for (let i = MONTHS_OF_HISTORY - 1; i >= 0; i -= 1) {
    const month = monthsAgo(i);
    const elapsed = MONTHS_OF_HISTORY - 1 - i;
    const trend = Math.pow(1 + monthlyGrowth, elapsed);
    // Mild seasonality - trading peaks around harvest and festive months.
    const seasonal = 1 + 0.12 * Math.sin((month.getMonth() / 12) * 2 * Math.PI);
    const noise = 0.85 + rng() * 0.3;

    const income = Math.round((baseIncome * trend * seasonal * noise) / 1000) * 1000;
    out.push({
      type: "income",
      category: revenueCategory,
      amount: Math.max(20000, income),
      date: ymd(month, 20),
      description: `${revenueCategory} for ${monthLabel(month)}.`,
      paymentMethod: rng() > 0.5 ? "bank_transfer" : "mobile_money",
    });

    const expense = Math.round((income * expenseRatio * (0.9 + rng() * 0.2)) / 1000) * 1000;
    out.push({
      type: "expense",
      category: "Operational Expense",
      amount: Math.max(20000, expense),
      date: ymd(month, 25),
      description: `Operating costs for ${monthLabel(month)}.`,
      paymentMethod: "cash",
    });

    // Member contribution banking, roughly quarterly.
    if (elapsed % 3 === 0) {
      out.push({
        type: "income",
        category: "Member Contributions",
        amount: Math.max(10000, Math.round((totalSavings * (0.02 + q * 0.03)) / 1000) * 1000),
        date: ymd(month, 28),
        description: `Member savings contributions banked for the quarter ending ${monthLabel(month)}.`,
        paymentMethod: "mobile_money",
      });
    }
  }

  return out;
}

/**
 * A small number of deliberately unusual transactions, so anomaly detection has
 * something real to find. Clearly demo data - each carries a marker in its
 * description so it is never mistaken for a genuine record.
 */
function anomalousTransactionsFor(c: CoopSeed, totalSavings: number): GeneratedTxn[] {
  if (!["UNITAX", "COPCOM"].includes(c.key)) return [];
  const month = monthsAgo(4);
  return [
    {
      type: "expense",
      category: "Operational Expense",
      amount: Math.round((totalSavings * 0.55) / 1000) * 1000,
      date: ymd(month, 12),
      description:
        "Emergency equipment replacement - single large outlay well outside the usual operating pattern. [demo anomaly]",
      paymentMethod: "bank_transfer",
    },
  ];
}

function activitiesFor(c: CoopSeed) {
  const rng = makeRng(seedFromKey(c.key) ^ 0x9e3779b9);
  const q = quality(c);
  const venue = `${c.cell} Cell Office, ${c.sector}`;
  const training = TRAINING_BY_TYPE[c.type] ?? "Cooperative Governance Training";

  const out: {
    title: string; type: string; status: string; date: string;
    location: string; description: string; budget: number; actualCost: number;
  }[] = [];

  // Roughly one activity every other month, more often for the better-run ones,
  // and a higher share of them actually completed.
  for (let i = MONTHS_OF_HISTORY - 1; i >= 1; i -= 1) {
    if (rng() > 0.35 + q * 0.3) continue;
    const month = monthsAgo(i);
    const kind = rng();
    const [title, type] =
      kind < 0.45
        ? [`Members' Meeting - ${monthLabel(month)}`, "meeting"]
        : kind < 0.7
          ? [training, "training"]
          : kind < 0.87
            ? ["Quarterly Planning Session", "planning"]
            : [`${REVENUE_CATEGORY_BY_TYPE[c.type] ?? "Sales"} Drive`, "sales"];

    // Well-run cooperatives complete what they plan; weaker ones let activities
    // lapse or cancel them. This is what the governance dimension picks up.
    const roll = rng();
    const status = roll < 0.55 + q * 0.35 ? "completed" : roll < 0.9 ? "planned" : "cancelled";

    const budget = 40000 + Math.round(rng() * 120000);
    out.push({
      title,
      type,
      status,
      date: ymd(month, 10 + Math.floor(rng() * 15)),
      location: type === "meeting" ? `${c.sector} Sector Office` : venue,
      description: `${title} for ${c.name}.`,
      budget,
      actualCost: status === "completed" ? Math.round(budget * (0.85 + rng() * 0.2)) : 0,
    });
  }

  // Always give every cooperative one upcoming item so the calendar is not empty.
  out.push({
    title: "Annual General Assembly",
    type: "meeting",
    status: "planned",
    date: ymd(monthsAgo(-2), 14),
    location: `${c.sector} Sector Office`,
    description: `Statutory general assembly for ${c.name}: accounts, leadership and the year ahead.`,
    budget: 120000,
    actualCost: 0,
  });

  return out;
}

async function insertInsight(coopId: string, i: {
  type: string; severity: string; title: string; summary: string; detail: string;
  confidence: number; affectedMetric: string | null;
  currentValue: number | null; expectedValue: number | null;
  recommendations: string[]; modelName: string;
}) {
  const deviation =
    i.currentValue != null && i.expectedValue != null && i.expectedValue !== 0
      ? Number(((i.currentValue - i.expectedValue) / i.expectedValue).toFixed(4))
      : null;

  await query(
    `INSERT INTO ai_insights
       (cooperative_id, type, severity, title, summary, detail,
        affected_metric, current_value, expected_value, deviation,
        recommendations, model_name, confidence, resolved, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,NOW())`,
    [coopId, i.type, i.severity, i.title, i.summary, i.detail,
     i.affectedMetric, i.currentValue, i.expectedValue, deviation,
     JSON.stringify(i.recommendations), i.modelName, i.confidence]
  );
}

const DISTRICT_AVERAGE_SAVINGS_PER_MEMBER = 62500;

async function seedInsightsFor(c: CoopSeed, coopId: string, memberCount: number, totalSavings: number) {
  const savingsPerMember = memberCount > 0 ? Math.round(totalSavings / memberCount) : 0;

  await insertInsight(coopId, {
    type: "insight",
    severity: "info",
    title: "Member Savings Position",
    summary: `${c.name} holds RWF ${totalSavings.toLocaleString()} across ${memberCount} registered members — an average of RWF ${savingsPerMember.toLocaleString()} per member.`,
    detail: `Computed from the cooperative's own member register. District reference point for ${c.sector} sector is RWF ${DISTRICT_AVERAGE_SAVINGS_PER_MEMBER.toLocaleString()} per member.`,
    confidence: 0.88,
    affectedMetric: "Savings per Member (RWF)",
    currentValue: savingsPerMember,
    expectedValue: DISTRICT_AVERAGE_SAVINGS_PER_MEMBER,
    recommendations: [
      "Publish the per-member savings position at the next general assembly",
      "Set a quarterly contribution target agreed by the members",
    ],
    modelName: "FinancialAnalytics v2.0",
  });

  await insertInsight(coopId, {
    type: "recommendation",
    severity: "info",
    title: "Digitise the Member Register",
    summary: `${c.name} currently keeps its records via ${c.recordKeeping.toLowerCase()}. Moving the register onto CoopInsight removes the single point of failure and makes the RCA returns reproducible.`,
    detail: `Record-keeping method reported to the ${c.sector} sector cooperative officer: ${c.recordKeeping}. ${memberCount} member records are in scope.`,
    confidence: 0.79,
    affectedMetric: "Members on Digital Register",
    currentValue: 0,
    expectedValue: memberCount,
    recommendations: [
      "Capture the full member register in CoopInsight before the next AGM",
      "Assign the secretary as the record owner for monthly updates",
      "Retain the paper register for one financial year as a fallback",
    ],
    modelName: "CoopAnalytics v1.2",
  });

  if (c.dataGaps.length > 0) {
    await insertInsight(coopId, {
      type: "anomaly",
      severity: "warning",
      title: "Incomplete Leadership Record",
      summary: `The RCA sector register for ${c.name} is missing ${c.dataGaps.length} leadership detail${c.dataGaps.length > 1 ? "s" : ""}, which blocks automated contact and compliance checks.`,
      detail: c.dataGaps.join(" "),
      confidence: 0.95,
      affectedMetric: "Leadership Records Complete",
      currentValue: 3 - c.dataGaps.length,
      expectedValue: 3,
      recommendations: [
        `Ask the ${c.sector} sector cooperative officer to complete the missing entries`,
        "Update the leadership record on the cooperative profile once confirmed",
      ],
      modelName: "ComplianceMonitor v1.1",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The register
// ─────────────────────────────────────────────────────────────────────────────

const COOPERATIVES: CoopSeed[] = [
  {
    key: "ADARWA",
    name: "ADARWA",
    type: "Carpentry",
    sector: "Gisozi",
    cell: "Kiyovu",
    village: "Kiyovu",
    registrationNumber: "RCA/0855/2019",
    registrationDate: "2019-08-15",
    description:
      "Carpentry cooperative operating in Kiyovu cell, Gisozi sector. Members produce furniture and joinery for the local market and share a common workshop and tooling.",
    address: "Kiyovu Cell, Gisozi Sector, Gasabo District, Kigali",
    idBlock: 15,
    memberTarget: 30,
    healthScore: 61,
    health: { financial: 58, engagement: 66, compliance: 64, docs: 52 },
    sectorOfficer: { name: "UMULISA", phone: "+250788677019" },
    president: { name: "UWIMANA Venantie", phone: "+250788485096", gender: "female", isMember: true },
    vicePresident: { name: "MUNEZA Jean Paul", phone: "+250788355770", gender: "male", isMember: true },
    secretary: { name: "NTEZIMANA Emmanuel", phone: "+250783118659", gender: "male", isMember: true },
    recordKeeping: "Hard-copy workshop ledgers",
    dataGaps: [],
  },
  {
    key: "COPCOM",
    name: "COPCOM",
    type: "Construction",
    sector: "Gisozi",
    cell: "Akabahizi",
    village: "Akabahizi",
    registrationNumber: "RCA/0966/2016",
    registrationDate: "2016-09-06",
    description:
      "Construction cooperative based in Akabahizi cell, Gisozi sector. Members take on masonry and finishing subcontracts for residential and small commercial sites in Gasabo District.",
    address: "Akabahizi Cell, Gisozi Sector, Gasabo District, Kigali",
    idBlock: 16,
    memberTarget: 66,
    healthScore: 68,
    health: { financial: 70, engagement: 68, compliance: 72, docs: 58 },
    sectorOfficer: { name: "UMULISA", phone: "+250788677019" },
    // The register records the president's phone but not their name.
    president: { name: "(Name not recorded)", phone: "+250788416896", gender: null, isMember: false },
    vicePresident: { name: "MUKAMANA Emerthe", phone: "+250788749105", gender: "female", isMember: true },
    secretary: { name: "SHUMBUSHO Jean Pierre", phone: "+250788762056", gender: "male", isMember: true },
    recordKeeping: "Site logbooks and spreadsheets",
    dataGaps: [
      "President: telephone +250788416896 is on file but the name was not recorded in the sector register.",
    ],
  },
  {
    key: "UNITAX",
    name: "UNITAX (United Taximen Cooperative)",
    type: "Transport",
    sector: "Kimihurura",
    cell: "Bibare",
    village: "Bibare",
    registrationNumber: "RCA/0411/2016",
    registrationDate: "2016-04-11",
    description:
      "Taxi operators' cooperative serving Kimihurura sector from Bibare cell. Members run scheduled and on-call passenger services and pool vehicle insurance and maintenance.",
    address: "Bibare Cell, Kimihurura Sector, Gasabo District, Kigali",
    idBlock: 11,
    memberTarget: 37,
    healthScore: 54,
    health: { financial: 52, engagement: 58, compliance: 50, docs: 46 },
    sectorOfficer: { name: "CARINE", phone: "+250785743511" },
    president: { name: "Mugiraneza Venuste", phone: "+250786540031", gender: "male", isMember: true },
    // Phone number is truncated in the source register, so it is left unset.
    vicePresident: { name: "Nyirantezimana Marie Chantal", phone: null, gender: "female", isMember: false },
    // Post vacant — the previous holder resigned shortly before the survey.
    secretary: null,
    recordKeeping: "Physical membership books",
    dataGaps: [
      "Vice President: Nyirantezimana Marie Chantal's telephone number is truncated in the sector register and could not be recorded.",
      "Secretary: the post is vacant — the previous holder resigned shortly before the survey.",
    ],
  },
  {
    key: "COTAVOGA",
    name: "COTAVOGA (Taximen Voiture de Gacuriro)",
    type: "Transport",
    sector: "Kinyinya",
    cell: "Gacuriro",
    village: "Gacuriro",
    registrationNumber: "RCA/1077/2014",
    registrationDate: "2014-10-07",
    description:
      "Taxi-voiture cooperative based in Gacuriro cell, Kinyinya sector. Members operate saloon-car passenger services on the Gacuriro–Kinyinya–CBD routes.",
    address: "Gacuriro Cell, Kinyinya Sector, Gasabo District, Kigali",
    idBlock: 17,
    memberTarget: 44,
    healthScore: 57,
    health: { financial: 55, engagement: 60, compliance: 58, docs: 48 },
    sectorOfficer: { name: "KASINE Dorothee", phone: "+250788560127" },
    president: { name: "NIYIGABA Emmanuel", phone: "+250788522238", gender: "male", isMember: true },
    vicePresident: { name: "HABIYAREMYE Vedaste", phone: "+250788504974", gender: "male", isMember: true },
    secretary: { name: "NYANDWI Theoneste", phone: "+250788251798", gender: "male", isMember: true },
    recordKeeping: "In-person meeting minutes only",
    dataGaps: [],
  },
  {
    key: "ZAMUKA",
    name: "ZAMUKA (Zamuka Muhinzi wa Kagunga)",
    type: "Agriculture",
    sector: "Nduba",
    cell: "Nduba",
    village: "Gasanze",
    registrationNumber: "RCA/0744/2021",
    registrationDate: "2021-07-04",
    description:
      "Farming cooperative working the Kagunga marshland in Nduba sector. Members cultivate shared plots, coordinate the planting calendar and market their produce collectively.",
    address: "Nduba Cell, Nduba Sector, Gasabo District, Kigali",
    idBlock: 14,
    memberTarget: 92,
    healthScore: 66,
    health: { financial: 64, engagement: 72, compliance: 66, docs: 54 },
    // The register lists the Nduba sector officer's line without a name.
    sectorOfficer: { name: "(Name not recorded)", phone: "+250722263394" },
    president: { name: "HABIMANA Evarsite", phone: "+250788622097", gender: "male", isMember: true },
    vicePresident: { name: "MUNYANEZA Xavier", phone: "+250788539850", gender: "male", isMember: true },
    secretary: { name: "Veneranda Nyirantezimana", phone: "+250783389126", gender: "female", isMember: true },
    recordKeeping: "Hard-copy plot and harvest ledgers",
    dataGaps: [],
  },
  {
    key: "TMC",
    name: "TMC (Trust Multiservices Cooperative)",
    type: "Services",
    sector: "Remera",
    cell: "Remera",
    village: "Nyarutarama",
    registrationNumber: "RCA/0522/2018",
    registrationDate: "2018-05-22",
    description:
      "Multiservices cooperative in Remera sector offering cleaning, maintenance and general support services under contract to offices and residential estates in Gasabo District.",
    address: "Remera Cell, Remera Sector, Gasabo District, Kigali",
    idBlock: 12,
    memberTarget: 49,
    healthScore: 71,
    health: { financial: 72, engagement: 74, compliance: 70, docs: 62 },
    sectorOfficer: { name: "(Name not recorded)", phone: "+250787198144" },
    president: { name: "RUKUNDO Emmanuel", phone: "+250788318092", gender: "male", isMember: true },
    vicePresident: { name: "CYEZIMANA Cleopatre", phone: "+250783081421", gender: "female", isMember: true },
    secretary: { name: "UWIHOREYE Josephine", phone: "+250789394012", gender: "female", isMember: true },
    recordKeeping: "Mobile app, external hard drive and Google Drive",
    dataGaps: [],
  },
  {
    key: "FODECO",
    name: "FODECO (Forced Development Cooperative)",
    type: "Trading",
    sector: "Remera",
    cell: "Remera",
    village: "Nyabisindu",
    registrationNumber: "RCA/0633/2017",
    registrationDate: "2017-06-03",
    description:
      "Trading cooperative in Remera sector. Members buy stock collectively and run retail outlets around Nyabisindu and the Remera commercial area.",
    address: "Remera Cell, Remera Sector, Gasabo District, Kigali",
    idBlock: 13,
    memberTarget: 61,
    healthScore: 63,
    health: { financial: 62, engagement: 66, compliance: 64, docs: 55 },
    sectorOfficer: { name: "(Name not recorded)", phone: "+250787198144" },
    president: { name: "MUNYAMAHORO Eugene", phone: "+250788270410", gender: "male", isMember: true },
    vicePresident: { name: "BYUKUSENGE Charlene", phone: "+250788620723", gender: "female", isMember: true },
    secretary: { name: "NIYIMENYA Janvier", phone: "+250788786152", gender: "male", isMember: true },
    recordKeeping: "Laptop spreadsheets and hard-copy ledgers",
    dataGaps: [],
  },
];

/** The cooperative the demo manager/member accounts belong to. */
const DEMO_COOPERATIVE_KEY = "TMC";

//  Main seed

async function seed() {
  console.log("Seeding database…\n");

  // ─── Reset ────────────────────────────────────────────────────────────────
  // Every cooperative is replaced, so cooperative-scoped data is cleared first.
  await resetCooperativeData();
  console.log("✓ Cleared existing cooperatives and cooperative-scoped data\n");

  // ─── System users ─────────────────────────────────────────────────────────

  const adminHash   = await bcrypt.hash("Admin@1234",   12);
  const managerHash = await bcrypt.hash("Manager@1234", 12);
  const memberHash  = await bcrypt.hash("Member@1234",  12);
  const govHash     = await bcrypt.hash("Gov@1234!",    12);

  await query(
    `INSERT INTO users (name, email, password_hash, role, email_verified, status)
     VALUES ($1,$2,$3,'admin',true,'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
    ["System Admin", "admin@coopinsight.rw", adminHash]
  );
  // ─── Cooperative oversight hierarchy ──────────────────────────────────────
  // Requests to form or dissolve a cooperative escalate sector → district → RCA.
  // Each level is a `government` user distinguished by oversight_level. The
  // sector officers are the real people named in the RCA sector register; where
  // the register gives only a telephone line, the post is named instead of the
  // person. Emails are system logins, not the officers' real addresses.

  const officerHash = await bcrypt.hash("Officer@1234", 12);

  const upsertOfficer = async (o: {
    name: string; email: string; phone: string | null;
    level: "sector" | "district" | "rca"; sector: string | null; hash: string;
  }) => {
    await query(
      `INSERT INTO users (name, email, password_hash, phone, role, email_verified, status, sector, oversight_level)
       VALUES ($1,$2,$3,$4,'government',true,'active',$5,$6)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, phone = EXCLUDED.phone,
         sector = EXCLUDED.sector, oversight_level = EXCLUDED.oversight_level`,
      [o.name, o.email, o.hash, o.phone, o.sector, o.level]
    );
  };

  // Sector officers, deduplicated from the cooperative register — one officer
  // covers every cooperative in their sector.
  const sectorOfficers = new Map<string, { name: string; phone: string }>();
  for (const c of COOPERATIVES) {
    if (!sectorOfficers.has(c.sector)) {
      sectorOfficers.set(c.sector, {
        name: c.sectorOfficer.name === "(Name not recorded)"
          ? `${c.sector} Sector Cooperative Officer`
          : c.sectorOfficer.name,
        phone: c.sectorOfficer.phone,
      });
    }
  }
  for (const [sector, officer] of sectorOfficers) {
    await upsertOfficer({
      name: officer.name,
      email: `${sector.toLowerCase()}.officer@coopinsight.rw`,
      phone: officer.phone,
      level: "sector",
      sector,
      hash: officerHash,
    });
  }

  await upsertOfficer({
    name: "Gasabo District Cooperative Officer",
    email: "district.officer@coopinsight.rw",
    phone: null,
    level: "district",
    sector: null,
    hash: officerHash,
  });

  await upsertOfficer({
    name: "RCA Officer — Gasabo Portfolio",
    email: "gov@coopinsight.rw",
    phone: null,
    level: "rca",
    sector: null,
    hash: govHash,
  });

  console.log(`✓ Admin ready; oversight hierarchy: ${sectorOfficers.size} sector officers, 1 district, 1 RCA\n`);

  // ─── Cooperatives ─────────────────────────────────────────────────────────

  const seededIds = new Map<string, string>();

  for (const c of COOPERATIVES) {
    const coopId = await insertCooperative({
      name: c.name,
      type: c.type,
      sector: c.sector,
      cell: c.cell,
      village: c.village,
      registrationNumber: c.registrationNumber,
      registrationDate: c.registrationDate,
      description: c.description,
      // The president's line is the cooperative's contact number of record.
      phone: c.president?.phone ?? c.sectorOfficer.phone,
      email: `${c.key.toLowerCase()}@coopinsight.rw`,
      address: c.address,
      healthScore: c.healthScore,
    });
    seededIds.set(c.key, coopId);

    // Leadership — the sector cooperative officer is recorded alongside the
    // cooperative's own office-bearers so the sector contact is never lost.
    const leadership: { name: string; role: string; phone: string | null; email: string | null; startDate: string }[] = [
      {
        name: c.sectorOfficer.name,
        role: "Sector Cooperative Officer",
        phone: c.sectorOfficer.phone,
        email: null,
        startDate: c.registrationDate,
      },
    ];
    if (c.president) {
      leadership.push({ name: c.president.name, role: "President", phone: c.president.phone, email: null, startDate: c.registrationDate });
    }
    if (c.vicePresident) {
      leadership.push({ name: c.vicePresident.name, role: "Vice President", phone: c.vicePresident.phone, email: null, startDate: c.registrationDate });
    }
    if (c.secretary) {
      leadership.push({ name: c.secretary.name, role: "Secretary", phone: c.secretary.phone, email: null, startDate: c.registrationDate });
    }
    await replaceLeadership(coopId, leadership);

    // Named members — only leaders the register identifies by both name and phone.
    // members.role has no "vice president" value, so the vice president is
    // registered as an ordinary member; the office itself lives in the
    // leadership table above.
    const namedLeaders: Array<{ leader: LeaderSeed; role: string }> = [];
    if (c.president?.isMember) namedLeaders.push({ leader: c.president, role: "chairperson" });
    if (c.vicePresident?.isMember) namedLeaders.push({ leader: c.vicePresident, role: "member" });
    if (c.secretary?.isMember) namedLeaders.push({ leader: c.secretary, role: "secretary" });

    let seq = 0;
    for (const { leader, role } of namedLeaders) {
      seq += 1;
      await insertMember(coopId, {
        fullName: leader.name,
        phone: leader.phone!,
        nationalId: `129${String(c.idBlock * 100000 + seq).padStart(9, "0")}`,
        gender: leader.gender ?? "other",
        sector: c.sector,
        cell: c.cell,
        membershipNumber: `${c.key}-${String(seq).padStart(3, "0")}`,
        membershipDate: c.registrationDate,
        role,
        totalSavings: 45000 - seq * 5000,
      });
    }

    await seedPlaceholderMembers(coopId, {
      count: c.memberTarget,
      sector: c.sector,
      cell: c.cell,
      namePrefix: `${c.key} Member`,
      codePrefix: c.key,
      idBlock: c.idBlock,
      baseYear: new Date(c.registrationDate).getFullYear(),
    });

    // total_savings is derived from the roster that was just written.
    const totalSavings = await syncCooperativeSavings(coopId);
    const memberCountRes = await query(
      `SELECT COUNT(*) AS count FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL`,
      [coopId]
    );
    const memberCount = parseInt(memberCountRes.rows[0].count, 10);

    await insertDocument(coopId, {
      name: "Membership Register",
      type: "other",
      description: `Current record-keeping method: ${c.recordKeeping}. Digital copy pending upload.`,
    });
    if (c.dataGaps.length > 0) {
      await insertDocument(coopId, {
        name: "RCA Register — Outstanding Details",
        type: "other",
        description: c.dataGaps.join(" "),
      });
    }

    for (const a of activitiesFor(c)) await insertActivity(coopId, a);

    const transactions = [
      ...monthlyTransactionsFor(c, totalSavings),
      ...anomalousTransactionsFor(c, totalSavings),
    ];
    for (const t of transactions) await insertTransaction(coopId, t);

    // Monthly behaviour: who paid in, and who turned up. These are the inputs to
    // the engagement score and to the district league table's monthly comparison.
    await seedMonthlyContributions(coopId, c);
    await seedActivityAttendance(coopId, c);

    // Share capital and a closing balance sheet — these are what the exit
    // settlement calculator prices a departing member's stake against.
    const shareCapital = await seedShareCapital(coopId, c.registrationDate);
    const retainedEarnings = transactions.reduce(
      (sum, t) => sum + (t.type === "income" ? t.amount : -t.amount), 0
    ) - totalSavings;
    await insertBalanceSheet(coopId, {
      memberSavings: totalSavings,
      shareCapital,
      retainedEarnings: Math.max(0, Math.round(retainedEarnings)),
      type: c.type,
    });

    await insertHealthScore(coopId, {
      overall: c.healthScore,
      financial: c.health.financial,
      engagement: c.health.engagement,
      compliance: c.health.compliance,
      docs: c.health.docs,
    });
    await seedInsightsFor(c, coopId, memberCount, totalSavings);

    console.log(`✓ ${c.name} — ${memberCount} members, RWF ${totalSavings.toLocaleString()} savings`);
  }

  // ─── Demo cooperative accounts ────────────────────────────────────────────
  // The manager and member logins belong to a real cooperative in the register
  // and are two of its actual office-bearers.

  const demo = COOPERATIVES.find((c) => c.key === DEMO_COOPERATIVE_KEY)!;
  const demoCoopId = seededIds.get(DEMO_COOPERATIVE_KEY)!;

  await query(
    `INSERT INTO users (name, email, password_hash, phone, role, cooperative_id, email_verified, status, sector)
     VALUES ($1,$2,$3,$4,'manager',$5,true,'active',$6)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, phone = EXCLUDED.phone,
       cooperative_id = EXCLUDED.cooperative_id, sector = EXCLUDED.sector`,
    [demo.president!.name, "manager@coopinsight.rw", managerHash, demo.president!.phone, demoCoopId, demo.sector]
  );
  await query(
    `INSERT INTO users (name, email, password_hash, phone, role, cooperative_id, email_verified, status, sector)
     VALUES ($1,$2,$3,$4,'member',$5,true,'active',$6)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, phone = EXCLUDED.phone,
       cooperative_id = EXCLUDED.cooperative_id, sector = EXCLUDED.sector`,
    [demo.secretary!.name, "member@coopinsight.rw", memberHash, demo.secretary!.phone, demoCoopId, demo.sector]
  );

  console.log(`\n✓ Manager & Member accounts linked to ${demo.name}\n`);

  // ─── Near-term activities (this week) for dashboard alerts ────────────────

  const upcomingCheck = await query(
    `SELECT COUNT(*) FROM activities
      WHERE date BETWEEN NOW() AND NOW() + INTERVAL '7 days' AND status = 'planned'`
  );
  if (parseInt(upcomingCheck.rows[0].count) < 2) {
    const nearTerm: Array<[string, string, string, number, string, string, number]> = [
      ["RCA/0522/2018", "Weekly Members Meeting",    "meeting",  2, "TMC Office, Remera",           "Routine weekly check-in and announcements.",                    10000],
      ["RCA/0744/2021", "Quarterly Savings Review",  "planning", 4, "Nduba Cell Office",            "Review Q3 savings targets and member contributions.",           20000],
      ["RCA/1077/2014", "Route Compliance Briefing", "meeting",  6, "Gacuriro Cell Office",         "Briefing on RURA route permits and passenger safety checks.",   15000],
    ];
    for (const [regNum, title, type, offsetDays, location, description, budget] of nearTerm) {
      await query(
        `INSERT INTO activities (cooperative_id, title, type, status, date, location, description, budget, actual_cost)
         SELECT id, $2, $3, 'planned', CURRENT_DATE + ($4)::int, $5, $6, $7, 0
           FROM cooperatives WHERE registration_number = $1 LIMIT 1`,
        [regNum, title, type, offsetDays, location, description, budget]
      );
    }
    console.log("✓ Near-term activities (dashboard alerts)");
  }

  console.log("\n─────────────────────────────────────────────────");
  console.log(`Seeding complete — ${COOPERATIVES.length} cooperatives.\n`);
  console.log("Test Accounts:");
  console.log("  Admin:   admin@coopinsight.rw   / Admin@1234");
  console.log(`  Manager: manager@coopinsight.rw / Manager@1234  (${demo.president!.name} — ${demo.name})`);
  console.log(`  Member:  member@coopinsight.rw  / Member@1234   (${demo.secretary!.name} — ${demo.name})`);
  console.log("\nCooperative oversight chain (formation & dissolution requests):");
  for (const [sector] of sectorOfficers) {
    console.log(`  Sector:   ${`${sector.toLowerCase()}.officer@coopinsight.rw`.padEnd(34)}/ Officer@1234  (${sector})`);
  }
  console.log("  District: district.officer@coopinsight.rw     / Officer@1234");
  console.log("  RCA:      gov@coopinsight.rw                  / Gov@1234!");
  console.log("\nRun backend: pnpm dev");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
