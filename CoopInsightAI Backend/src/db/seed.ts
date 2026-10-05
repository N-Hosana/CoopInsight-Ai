import bcrypt from "bcrypt";
import { query } from "../config/db";
import { PERMIT_TERMS, permanentTerm, expiryFor } from "../services/permits";
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
       total_savings = EXCLUDED.total_savings,
       -- A reseed is meant to produce a known-clean register. Without these
       -- three, a member who was archived by the exit process stayed archived
       -- and soft-deleted forever: the upsert restored their name and savings
       -- but left deleted_at set, so every register query kept skipping them
       -- and the account they belong to could never be matched again. The
       -- seed silently could not undo its own demo data.
       status = 'active',
       deleted_at = NULL,
       archived_at = NULL,
       archive_reason = NULL
     RETURNING id`,
    [coopId, m.fullName, m.phone, m.nationalId, m.gender, m.sector, m.cell ?? null,
     m.membershipNumber, m.membershipDate, m.role ?? "member", m.totalSavings ?? 0]
  );
  return res.rows[0].id as string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MEMBER REGISTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The seven cooperatives and their office-bearers are real, taken from the
 * Gasabo RCA sector register. Their rank-and-file members are not published
 * anywhere, so the rest of each roster has to be generated — but it has to look
 * like a real register, because half the screens in this app are only
 * meaningful against one.
 *
 * It previously generated "TMC Member 1" … "TMC Member 48", each holding
 * exactly n × 5,000 in savings. That produced a register nobody could read as
 * plausible and, worse, a perfectly linear savings curve that made every chart,
 * every average and every anomaly detector behave in ways real data never does.
 *
 * What follows generates Rwandan names in the usual form — family name first,
 * then a given name — and a savings distribution with the shape real
 * cooperative savings actually have: most members modest, a long tail of
 * committed savers, and a handful of recent joiners with almost nothing yet.
 *
 * Everything is DETERMINISTIC, seeded from the cooperative's id block and the
 * member's position. That matters: `pnpm seed` is run repeatedly, and a
 * register that reshuffled every time would churn every downstream figure and
 * make any screenshot or test unreproducible.
 */

/** Family names, as they appear first and usually capitalised in Rwanda. */
const FAMILY_NAMES = [
  "UWIMANA", "MUKAMANA", "NIYONZIMA", "HABIMANA", "NSHIMIYIMANA", "BIZIMANA",
  "UWAMAHORO", "NDAYISABA", "IRADUKUNDA", "MUGISHA", "GASANA", "KAYITESI",
  "NIYIGENA", "TUYISHIME", "INGABIRE", "MUNYANEZA", "HAKIZIMANA", "DUSABIMANA",
  "NYIRAHABIMANA", "MURENZI", "RUKUNDO", "KAMANZI", "UMUTONI", "ISHIMWE",
  "KWIZERA", "SHEMA", "MANZI", "KEZA", "GANZA", "RWEMA", "CYUSA", "MUTONI",
  "GATETE", "RUGAMBA", "NKURUNZIZA", "KAGABO", "MUTESI", "UWASE", "AKIMANA",
  "BYIRINGIRO", "NTWALI", "MUHIRE", "NDAYAMBAJE", "TWAGIRAYEZU", "HARERIMANA",
  "MUKESHIMANA", "UWIRINGIYIMANA", "BAMPORIKI", "RUSANGANWA", "MUKANDAYISENGA",
  "NSENGIYUMVA", "BYUKUSENGE", "NIYOMUGABO", "UWICYEZA", "MBONYUMUVUNYI",
  "SEBAHIRE", "NIRERE", "MUKANTAGANDA", "RWIGEMA", "KAREKEZI", "UMULISA",
  "NTAGANDA", "MUKARUGWIZA", "HITIMANA", "NDUWAYEZU", "MUKANTWARI",
  "BIMENYIMANA", "NYIRAMANA", "TWIZEYIMANA", "MUKARUKUNDO", "SIBOMANA",
];

/** Given names follow the family name. Split by gender, as the register does. */
const MALE_GIVEN_NAMES = [
  "Jean", "Emmanuel", "Eric", "Patrick", "Innocent", "Theoneste", "Vedaste",
  "Celestin", "Fidele", "Anastase", "Valens", "Pascal", "Felicien", "Aimable",
  "Xavier", "Venuste", "Thacien", "Alphonse", "Olivier", "Damascene", "Bosco",
  "Fabrice", "Cedric", "Arsene", "Elysee", "Straton", "Jean Baptiste",
  "Jean Claude", "Come", "Gaston", "Deogratias", "Evariste", "Protais",
  "Silas", "Moses", "Samuel", "Claude", "Augustin", "Faustin", "Gerard",
];

const FEMALE_GIVEN_NAMES = [
  "Marie", "Claudine", "Josephine", "Vestine", "Diane", "Aline", "Providence",
  "Donatha", "Clementine", "Sylvie", "Chantal", "Francine", "Epiphanie",
  "Immaculee", "Beatrice", "Jeanne", "Consolee", "Solange", "Yvonne",
  "Esperance", "Speciose", "Drocella", "Seraphine", "Jacqueline", "Agnes",
  "Divine", "Sandrine", "Gloria", "Marie Claire", "Gaudence", "Alphonsine",
  "Dative", "Mediatrice", "Nadine", "Jolie", "Liliane", "Odette", "Christine",
  "Bernadette", "Peace",
];

/**
 * Deterministic 0–1 generator (mulberry32).
 *
 * Seeded per member, so the same cooperative produces the same register on
 * every run. `Math.random()` here would mean the roster, the savings, the
 * contributions ledger and every chart drawn from them changed on each seed.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Savings for one member, in RWF.
 *
 * Shaped rather than uniform: roughly a tenth of any cooperative's register are
 * recent joiners with very little in, most sit in a broad middle band, and a
 * few long-standing members hold several times the average. Real registers look
 * like this; an arithmetic ramp does not, and an anomaly detector trained
 * against a ramp learns nothing.
 */
function generateSavings(rand: () => number, yearsInMembership: number): number {
  const roll = rand();
  let amount: number;

  if (roll < 0.12) {
    // Recent joiners, or members who have fallen behind.
    amount = 2_000 + rand() * 18_000;
  } else if (roll < 0.82) {
    // The broad middle: steady monthly contributions over a few years.
    amount = 25_000 + rand() * 135_000;
  } else if (roll < 0.97) {
    // Committed savers.
    amount = 160_000 + rand() * 190_000;
  } else {
    // The handful who have been in since the beginning and saved throughout.
    amount = 350_000 + rand() * 320_000;
  }

  // Longer membership means more time to accumulate, but not proportionally —
  // people join, pause, and resume.
  amount *= 0.72 + Math.min(yearsInMembership, 10) * 0.055;

  // Cooperatives record savings in round figures.
  return Math.round(amount / 500) * 500;
}

/**
 * Fills a cooperative's roster up to `count`.
 *
 * `idBlock` must be unique per cooperative — it seeds the national ID and phone
 * ranges so two cooperatives never collide, and it seeds the name generator so
 * two cooperatives do not end up with identical registers.
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

  // Names already used in this cooperative, so one register does not list the
  // same person twice.
  const used = new Set<string>();
  const taken = await query(
    `SELECT full_name FROM members WHERE cooperative_id = $1`,
    [coopId]
  );
  for (const row of taken.rows) used.add(String(row.full_name).toLowerCase());

  const thisYear = new Date().getFullYear();

  for (let i = 1; i <= remaining; i += 1) {
    const n = existingCount + i;
    const rand = seededRandom(options.idBlock * 100_003 + n * 31);

    const gender = rand() < 0.52 ? "female" : "male";
    const givenPool = gender === "female" ? FEMALE_GIVEN_NAMES : MALE_GIVEN_NAMES;

    // "Nyira-" and "Muka-" mean "mother of" and "wife of", so those names
    // belong to women. Handing one to a man is the sort of detail a Rwandan
    // reader notices immediately and everyone else never sees.
    const familyPool =
      gender === "female"
        ? FAMILY_NAMES
        : FAMILY_NAMES.filter((f) => !f.startsWith("NYIRA") && !f.startsWith("MUKA"));

    // Draw a name, stepping through the lists on collision rather than
    // re-rolling, so the result stays deterministic.
    let fullName = "";
    const familyStart = Math.floor(rand() * familyPool.length);
    const givenStart = Math.floor(rand() * givenPool.length);
    for (let attempt = 0; attempt < familyPool.length * givenPool.length; attempt += 1) {
      const family = familyPool[(familyStart + attempt) % familyPool.length];
      const given =
        givenPool[(givenStart + Math.floor(attempt / familyPool.length)) % givenPool.length];
      const candidate = `${family} ${given}`;
      if (!used.has(candidate.toLowerCase())) {
        fullName = candidate;
        used.add(candidate.toLowerCase());
        break;
      }
    }
    if (!fullName) fullName = `${familyPool[n % familyPool.length]} ${givenPool[n % givenPool.length]}`;

    // Members joined over the cooperative's life, not all on one morning.
    const joinYear = options.baseYear + Math.floor(rand() * Math.max(1, thisYear - options.baseYear));
    const joinMonth = 1 + Math.floor(rand() * 12);
    const joinDay = 1 + Math.floor(rand() * 28);
    const membershipDate = `${joinYear}-${String(joinMonth).padStart(2, "0")}-${String(joinDay).padStart(2, "0")}`;

    // Rwandan mobile numbers are 078/079 (MTN) and 072/073 (Airtel).
    const prefix = ["78", "79", "72", "73"][Math.floor(rand() * 4)];
    const line = String(options.idBlock * 10000 + n).padStart(7, "0").slice(-7);

    await insertMember(coopId, {
      fullName,
      phone: `+2507${prefix.slice(1)}${line}`,
      nationalId: `119${String(options.idBlock * 100000 + n).padStart(9, "0")}`,
      gender,
      sector: options.sector,
      cell: options.cell,
      membershipNumber: `${options.codePrefix}-${String(n).padStart(3, "0")}`,
      membershipDate,
      role: "member",
      totalSavings: generateSavings(rand, thisYear - joinYear),
    });
  }
}

async function insertDocument(coopId: string, d: { name: string; type: string; description: string; url?: string }) {
  await query(
    `INSERT INTO cooperative_documents (cooperative_id, name, type, description, url, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    // No file yet is recorded as no file (NULL), never as a link to nowhere.
    [coopId, d.name, d.type, d.description, d.url ?? null]
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
  // Documents are re-inserted below rather than upserted, so without this the
  // file doubles in size on every reseed.
  await query(`DELETE FROM cooperative_documents`);
  await query(`DELETE FROM cooperative_requests`);
  await query(`DELETE FROM membership_exit_requests`);
  // Support organisations and their published opportunities are not scoped to a
  // cooperative, so the cascade below leaves them behind. They are upserted by
  // name further down; the cooperative-scoped rows that point at them go here.
  await query(`DELETE FROM auditor_engagements`);
  await query(`DELETE FROM funding_disbursements`);
  await query(`DELETE FROM funding_requests`);
  await query(`DELETE FROM cooperative_partnerships`);
  await query(`DELETE FROM funding_opportunities`);
  await query(`DELETE FROM cooperative_field_visits`);
  await query(`DELETE FROM cooperative_monthly_audits`);
  await query(`DELETE FROM rca_audits`);
  await query(`DELETE FROM cooperative_permits`);
  await query(`DELETE FROM ai_insights WHERE cooperative_id IS NOT NULL`);
  await query(`DELETE FROM report_schedules WHERE cooperative_id IS NOT NULL`);
  await query(`DELETE FROM reports WHERE cooperative_id IS NOT NULL`);
  // Broadcasts carry no cooperative_id, so the cooperative-scoped delete below
  // used to leave them behind and a "fresh" seed still had old announcements
  // sitting in every inbox.
  await query(`DELETE FROM message_replies`);
  await query(`DELETE FROM messages`);
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

  // ── The statutory ordinary assemblies ────────────────────────────────────
  // The RCA brochure fixes the ordinary general assembly in March and October,
  // and the monthly audit scores governance against exactly that. A functioning
  // cooperative holds them, so the seed has to, or every cooperative in the
  // district would read as non-compliant and the signal would be worthless.
  //
  // Weaker cooperatives miss one, which is the realistic failure and gives the
  // governance dimension something to separate on.
  for (let back = MONTHS_OF_HISTORY - 1; back >= 0; back -= 1) {
    const month = monthsAgo(back);
    const monthNumber = month.getMonth() + 1;
    if (monthNumber !== 3 && monthNumber !== 10) continue;

    // The October sitting is the one a struggling cooperative lets slip; the
    // March one carries the audited accounts and is rarely skipped.
    const skipped = monthNumber === 10 && rng() > 0.45 + q * 0.5;
    if (skipped) continue;

    out.push({
      title: `Ordinary General Assembly — ${monthLabel(month)}`,
      type: "meeting",
      status: "completed",
      date: ymd(month, 12 + Math.floor(rng() * 8)),
      location: `${c.sector} Sector Office`,
      description:
        monthNumber === 3
          ? `Ordinary general assembly of ${c.name}: audited accounts for the past year, ` +
            "distribution of surplus, and the action plan and budget for the year ahead."
          : `Ordinary general assembly of ${c.name}: reports of the organs, membership ` +
            "admissions and the implementation of the action plan.",
      budget: 120000,
      actualCost: Math.round(120000 * (0.8 + rng() * 0.25)),
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
    // The sector register held only this telephone number; the name was
    // supplied afterwards by the district and matches the number on file.
    president: { name: "MUHOZA Pierre Celestin", phone: "+250788416896", gender: "male", isMember: true },
    vicePresident: { name: "MUKAMANA Emerthe", phone: "+250788749105", gender: "female", isMember: true },
    secretary: { name: "SHUMBUSHO Jean Pierre", phone: "+250788762056", gender: "male", isMember: true },
    recordKeeping: "Site logbooks and spreadsheets",
    dataGaps: [],
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
    // Post vacant — the holder left the duties recently and no successor has
    // been elected. A vacant board seat is not a record-keeping gap: it is a
    // governance one, and the RCA expects the General Assembly to fill it.
    secretary: null,
    recordKeeping: "Physical membership books",
    dataGaps: [
      "Vice President: Nyirantezimana Marie Chantal's telephone number is truncated in the sector register and could not be recorded.",
      "Secretary: the post is vacant — the holder left the duties recently and the General Assembly has not yet elected a successor.",
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

/**
 * How many months of silence to seed for the demo-dormant cooperative. Must be
 * more than the AI service's dormancy threshold (6 months) or the monthly audit
 * will not flag it and the visit list will come up empty.
 */
const DEMO_DORMANCY_MONTHS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Operating permits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a cooperative's permit history from its real registration date:
 * a temporary permit issued on registration, superseded a year later by the
 * permanent one. The permanent term is not hardcoded here — it comes from
 * `permanentTerm()`, the same function the live conversion uses, so the seeded
 * history and a permit issued today are decided by identical rules.
 *
 * `keepTemporary` leaves a cooperative stuck on its temporary permit, which is
 * what a cooperative that was never audited looks like. One is seeded that way
 * on purpose so the RCA's conversion queue has a live case to work.
 */
async function seedPermits(
  coopId: string,
  c: CoopSeed,
  seq: number,
  opts: { keepTemporary?: boolean } = {}
) {
  const registered = new Date(c.registrationDate);
  const year = registered.getFullYear();
  const temporaryExpiry = expiryFor(registered, PERMIT_TERMS.temporaryYears);

  if (opts.keepTemporary) {
    // Extended repeatedly and still unconverted — the case the audit queue exists
    // for. It is dated to expire soon so it lands in the "due" window on a fresh
    // seed rather than being an already-lapsed permit nobody can act on.
    const issuedOn = new Date();
    issuedOn.setDate(issuedOn.getDate() - (365 - 45));
    await query(
      `INSERT INTO cooperative_permits
         (cooperative_id, permit_number, permit_type, term_years, issued_on, expires_on,
          status, term_rule, basis)
       VALUES ($1,$2,'temporary',$3,$4,$5,'active','extension_after_audit',$6)
       ON CONFLICT (permit_number) DO NOTHING`,
      [
        coopId,
        `PMT/T/${year}/${String(seq).padStart(4, "0")}`,
        PERMIT_TERMS.temporaryYears,
        issuedOn.toISOString().slice(0, 10),
        expiryFor(issuedOn, PERMIT_TERMS.temporaryYears).toISOString().slice(0, 10),
        `[demo] ${c.name} was registered on ${c.registrationDate} but its temporary permit was ` +
          "never converted; it has been extended instead. It is due for a maturity audit.",
      ]
    );
    return;
  }

  await query(
    `INSERT INTO cooperative_permits
       (cooperative_id, permit_number, permit_type, term_years, issued_on, expires_on,
        status, term_rule, basis)
     VALUES ($1,$2,'temporary',$3,$4,$5,'superseded','temporary_first_year',$6)
     ON CONFLICT (permit_number) DO NOTHING`,
    [
      coopId,
      `PMT/T/${year}/${String(seq).padStart(4, "0")}`,
      PERMIT_TERMS.temporaryYears,
      c.registrationDate,
      temporaryExpiry.toISOString().slice(0, 10),
      `Temporary permit issued on registration under ${c.registrationNumber}.`,
    ]
  );

  const term = permanentTerm({ type: c.type, name: c.name, description: c.description });
  await query(
    `INSERT INTO cooperative_permits
       (cooperative_id, permit_number, permit_type, term_years, issued_on, expires_on,
        status, term_rule, basis)
     VALUES ($1,$2,'permanent',$3,$4,$5,'active',$6,$7)
     ON CONFLICT (permit_number) DO NOTHING`,
    [
      coopId,
      `PMT/P/${temporaryExpiry.getFullYear()}/${String(seq).padStart(4, "0")}`,
      term.years,
      temporaryExpiry.toISOString().slice(0, 10),
      expiryFor(temporaryExpiry, term.years).toISOString().slice(0, 10),
      term.rule,
      `${term.basis} Converted after the first-year maturity audit.`,
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// External support — the partner register
// ─────────────────────────────────────────────────────────────────────────────
//
// UNLIKE THE COOPERATIVES, THESE ORGANISATIONS ARE ILLUSTRATIVE. The seven
// cooperatives above are real entries from the Gasabo RCA sector register. The
// funders below are not: they are named after the *kind* of organisation they
// represent, precisely so that nothing here can be read as a claim about a real
// NGO's programmes, budgets or staff. What is real is the shape of the problem —
// support for Rwandan cooperatives comes from NGOs, development partners,
// government programmes, unions and banks, and it is allocated on specialisation,
// on the state of the cooperative, and on who already knows whom.
//
// Between them these entries exercise every branch of the matcher: type
// targeting, sector targeting, condition targeting in both directions (a growth
// fund that wants healthy cooperatives and a rescue fund that wants failing
// ones), a minimum-members rule and a permanent-permit requirement.

interface OrganizationSeed {
  name: string;
  type: string;
  description: string;
  focusAreas: string[];
  supportTypes: string[];
  targetBands: string[];
  minAmount: number | null;
  maxAmount: number | null;
  contactRole: string;
  eligibilityNotes: string;
  opportunities: Array<{
    title: string;
    description: string;
    supportType: string;
    amountAvailable: number | null;
    targetTypes: string[];
    targetSectors: string[];
    targetBands: string[];
    minMembers: number | null;
    minHealthScore: number | null;
    requiresPermanentPermit: boolean;
    closesInDays: number;
  }>;
}

const SUPPORT_ORGANIZATIONS: OrganizationSeed[] = [
  {
    name: "Marshland Agribusiness Support Programme",
    type: "development_partner",
    description:
      "Works with farming cooperatives on marshland and shared-plot cultivation: inputs, " +
      "post-harvest handling and collective marketing.",
    focusAreas: ["Agriculture", "Farming", "Rice"],
    supportTypes: ["grant", "equipment", "training", "market_access"],
    targetBands: ["healthy", "monitor", "at_risk"],
    minAmount: 500_000,
    maxAmount: 15_000_000,
    contactRole: "Programme Officer, Gasabo",
    eligibilityNotes:
      "Cooperatives cultivating shared or marshland plots. Priority to those already " +
      "marketing collectively.",
    opportunities: [
      {
        title: "Post-harvest handling equipment grant",
        description:
          "Drying, storage and grading equipment for farming cooperatives losing produce " +
          "between harvest and market. Covers the equipment and one season of training in " +
          "using it.",
        supportType: "equipment",
        amountAvailable: 8_000_000,
        targetTypes: ["Agriculture"],
        targetSectors: [],
        targetBands: ["healthy", "monitor"],
        minMembers: 30,
        minHealthScore: null,
        requiresPermanentPermit: false,
        closesInDays: 75,
      },
    ],
  },
  {
    name: "Urban Transport Cooperatives Development Fund",
    type: "development_partner",
    description:
      "Supports taxi and transport cooperatives in Kigali on fleet renewal, route " +
      "compliance and driver welfare schemes.",
    focusAreas: ["Transport"],
    supportTypes: ["working_capital", "training", "technical_assistance"],
    targetBands: ["healthy", "monitor"],
    minAmount: 1_000_000,
    maxAmount: 40_000_000,
    contactRole: "Fund Manager",
    eligibilityNotes:
      "Registered transport cooperatives holding a permanent operating permit and current " +
      "route authorisations.",
    opportunities: [
      {
        title: "Fleet renewal working capital facility",
        description:
          "Working capital against a fleet renewal plan, repayable over three years. Open to " +
          "transport cooperatives with a permanent permit and audited accounts.",
        supportType: "working_capital",
        amountAvailable: 35_000_000,
        targetTypes: ["Transport"],
        targetSectors: [],
        targetBands: ["healthy", "monitor"],
        minMembers: 25,
        minHealthScore: 60,
        requiresPermanentPermit: true,
        closesInDays: 40,
      },
    ],
  },
  {
    name: "Artisan Trades Skills Foundation",
    type: "ngo",
    description:
      "Skills and tooling for carpentry, construction and other artisan cooperatives, " +
      "with an emphasis on bringing younger members into the trade.",
    focusAreas: ["Carpentry", "Construction", "Services"],
    supportTypes: ["training", "equipment", "technical_assistance"],
    targetBands: ["monitor", "at_risk", "critical"],
    minAmount: 300_000,
    maxAmount: 6_000_000,
    contactRole: "Training Coordinator",
    eligibilityNotes:
      "Artisan cooperatives sharing a workshop or worksite. No minimum health score — the " +
      "programme exists for cooperatives that are struggling.",
    opportunities: [
      {
        title: "Shared workshop tooling and apprenticeship grant",
        description:
          "Replaces worn shared tooling and funds an apprenticeship intake, so that a " +
          "cooperative losing older members can bring new ones in.",
        supportType: "equipment",
        amountAvailable: 4_500_000,
        targetTypes: ["Carpentry", "Construction"],
        targetSectors: [],
        targetBands: ["monitor", "at_risk", "critical"],
        minMembers: null,
        minHealthScore: null,
        requiresPermanentPermit: false,
        closesInDays: 90,
      },
    ],
  },
  {
    name: "Cooperative Turnaround Facility",
    type: "donor",
    description:
      "Exists specifically for cooperatives that have stopped functioning: bookkeeping " +
      "rescue, governance support and bridging finance to restart trade.",
    focusAreas: ["Any"],
    supportTypes: ["technical_assistance", "grant", "training"],
    targetBands: ["at_risk", "critical"],
    minAmount: 200_000,
    maxAmount: 5_000_000,
    contactRole: "Turnaround Adviser",
    eligibilityNotes:
      "Referred by a sector cooperative officer following a field visit. Cooperatives " +
      "assessed as healthy are not eligible — they should apply to a growth programme.",
    opportunities: [
      {
        title: "Dormant cooperative rescue package",
        description:
          "For cooperatives that have gone quiet. Covers reconstruction of the books, a " +
          "facilitated general assembly, and a small grant to restart trading. Referral from " +
          "a field visit is expected.",
        supportType: "technical_assistance",
        amountAvailable: 3_000_000,
        targetTypes: [],
        targetSectors: [],
        targetBands: ["at_risk", "critical"],
        minMembers: null,
        minHealthScore: null,
        requiresPermanentPermit: false,
        closesInDays: 120,
      },
    ],
  },
  {
    name: "Gasabo Cooperative Union",
    type: "cooperative_union",
    description:
      "Umbrella body for cooperatives in Gasabo District. Collective purchasing, shared " +
      "market access and representation with the district.",
    focusAreas: ["Trading", "Services", "Any"],
    supportTypes: ["market_access", "training"],
    targetBands: [],
    minAmount: null,
    maxAmount: 2_000_000,
    contactRole: "Union Secretary",
    eligibilityNotes: "Open to any cooperative on the Gasabo register in good standing.",
    opportunities: [
      {
        title: "Collective purchasing and market linkage scheme",
        description:
          "Pools purchasing across member cooperatives and links them to buyers in the " +
          "Remera and Kimironko commercial areas. No cash grant; the benefit is price and access.",
        supportType: "market_access",
        amountAvailable: null,
        targetTypes: [],
        targetSectors: ["Remera", "Kimihurura", "Gisozi", "Kinyinya", "Nduba"],
        targetBands: [],
        minMembers: null,
        minHealthScore: null,
        requiresPermanentPermit: false,
        closesInDays: 200,
      },
    ],
  },
  {
    name: "Community Savings Bank — Cooperative Lending Window",
    type: "financial_institution",
    description:
      "Lending window for cooperatives with a trading record and audited accounts. " +
      "Commercial terms, not grant funding.",
    focusAreas: ["Any"],
    supportTypes: ["working_capital"],
    targetBands: ["healthy"],
    minAmount: 2_000_000,
    maxAmount: 50_000_000,
    contactRole: "Cooperative Banking Officer",
    eligibilityNotes:
      "Requires a permanent operating permit, a filed balance sheet and twelve months of " +
      "trading history.",
    opportunities: [
      {
        title: "Cooperative trade finance line",
        description:
          "Revolving working capital for cooperatives with a demonstrated trading record. " +
          "Priced commercially; a filed balance sheet and permanent permit are prerequisites.",
        supportType: "working_capital",
        amountAvailable: 50_000_000,
        targetTypes: [],
        targetSectors: [],
        targetBands: ["healthy"],
        minMembers: 20,
        minHealthScore: 65,
        requiresPermanentPermit: true,
        closesInDays: 300,
      },
    ],
  },
];

/**
 * The RCA keeps a list of auditors cooperatives may appoint. These entries are
 * ILLUSTRATIVE, like the partner register: named as practices rather than as
 * real firms, so nothing here is a claim about a real auditor. One is
 * deliberately left off the approved list so the eligibility gate has
 * something to refuse.
 */
async function seedIndependentAuditors() {
  const auditors: Array<[string, string, string, boolean]> = [
    ["MUKAMANA Grace", "Gasabo Audit Partners", "ICPAR/2019/0442", true],
    ["RWIGEMA Olivier", "Kigali Cooperative Audit Services", "ICPAR/2017/0188", true],
    ["UWIMANA Chantal", "Northern Province Accountancy", "ICPAR/2021/0733", true],
    ["Umurerwa & Co (pending RCA approval)", "Umurerwa & Co", "-", false],
  ];
  for (const [name, firm, registration, approved] of auditors) {
    await query(
      `INSERT INTO independent_auditors (name, firm, registration_number, on_rca_approved_list)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (name, firm) DO UPDATE SET
         registration_number = EXCLUDED.registration_number,
         on_rca_approved_list = EXCLUDED.on_rca_approved_list,
         updated_at = NOW()`,
      [name, firm, registration, approved]
    );
  }
  return auditors.length;
}

async function seedSupportOrganizations() {
  const ids = new Map<string, string>();

  for (const org of SUPPORT_ORGANIZATIONS) {
    const inserted = await query(
      `INSERT INTO support_organizations
         (name, type, country, description, focus_areas, support_types, target_bands,
          min_amount, max_amount, eligibility_notes, contact_name, contact_role, active)
       VALUES ($1,$2,'Rwanda',$3,$4,$5,$6,$7,$8,$9,NULL,$10,TRUE)
       ON CONFLICT (name) DO UPDATE SET
         type = EXCLUDED.type, description = EXCLUDED.description,
         focus_areas = EXCLUDED.focus_areas, support_types = EXCLUDED.support_types,
         target_bands = EXCLUDED.target_bands, min_amount = EXCLUDED.min_amount,
         max_amount = EXCLUDED.max_amount, eligibility_notes = EXCLUDED.eligibility_notes,
         contact_role = EXCLUDED.contact_role, updated_at = NOW()
       RETURNING id`,
      [
        org.name, org.type, org.description,
        JSON.stringify(org.focusAreas), JSON.stringify(org.supportTypes),
        JSON.stringify(org.targetBands), org.minAmount, org.maxAmount,
        org.eligibilityNotes,
        // A role, not a name. Inventing a person at an organisation is exactly the
        // kind of unverifiable detail this project refuses to put on screen.
        org.contactRole,
      ]
    );
    const orgId = inserted.rows[0].id as string;
    ids.set(org.name, orgId);

    for (const o of org.opportunities) {
      await query(
        `INSERT INTO funding_opportunities
           (organization_id, title, description, support_type, amount_available, currency,
            target_types, target_sectors, target_bands, min_members, min_health_score,
            requires_permanent_permit, opens_on, closes_on, status)
         VALUES ($1,$2,$3,$4,$5,'RWF',$6,$7,$8,$9,$10,$11,
                 CURRENT_DATE, CURRENT_DATE + ($12)::int, 'open')`,
        [
          orgId, o.title, o.description, o.supportType, o.amountAvailable,
          JSON.stringify(o.targetTypes), JSON.stringify(o.targetSectors),
          JSON.stringify(o.targetBands), o.minMembers, o.minHealthScore,
          o.requiresPermanentPermit, o.closesInDays,
        ]
      );
    }
  }

  return ids;
}

//  Main seed

async function seed() {
  console.log("Seeding database…\n");

  // ─── Money triggers off while seeding ───────────────────────────────────
  // The triggers keep every member's balance equal to their contributions
  // ledger. The seed writes target balances first and the ledger after, so
  // with the triggers on, each balance would be overwritten by the partial
  // ledger before reconcile_member_money() could record the difference as an
  // opening balance. They come back on, and everything is reconciled, at the end.
  await query(`ALTER TABLE member_contributions DISABLE TRIGGER member_contributions_money`);
  await query(`ALTER TABLE members DISABLE TRIGGER members_cooperative_savings`);

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

  // The district cooperative officer for Gasabo. Named, with a working line,
  // because every formation and dissolution in the district passes through this
  // one desk and "District Cooperative Officer" is not somebody a cooperative
  // can telephone.
  await upsertOfficer({
    name: "Froduard",
    email: "district.officer@coopinsight.rw",
    phone: "+250788821659",
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

  console.log(`✓ Admin ready; oversight hierarchy: ${sectorOfficers.size} sector officers, 1 district (Froduard), 1 RCA\n`);

  // ─── Cooperatives ─────────────────────────────────────────────────────────

  const seededIds = new Map<string, string>();

  // The weakest cooperative on the register is left on an unconverted temporary
  // permit, which is what a cooperative nobody ever went back to audit looks
  // like. It gives the RCA conversion queue a live case on a fresh seed.
  const unconvertedKey = COOPERATIVES.reduce((worst, c) =>
    c.healthScore < worst.healthScore ? c : worst
  ).key;
  let permitSeq = 0;

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
        // Office-bearers are founding members who have been contributing since
        // registration, so they sit near the top of their own register rather
        // than on the 45,000 / 40,000 / 35,000 ramp this used to produce.
        totalSavings: generateSavings(
          seededRandom(c.idBlock * 7919 + seq),
          new Date().getFullYear() - new Date(c.registrationDate).getFullYear()
        ),
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

    // ── The books a cooperative is actually expected to keep ─────────────
    // These were all filed as "other", which meant the Documents page showed
    // every cooperative as holding nothing but miscellany — and every category
    // an officer might filter by came back empty. A real cooperative's file
    // holds its constituting documents, its accounts, its minutes and its
    // returns, so the register reflects that.
    const registrationYear = new Date(c.registrationDate).getFullYear();
    const lastYear = new Date().getFullYear() - 1;

    const documents: Array<{ name: string; type: string; description: string }> = [
      {
        name: `Certificate of Legal Personality — ${c.registrationNumber}`,
        type: "registration",
        description:
          `Issued by the Rwanda Cooperative Agency on ${c.registrationDate}, establishing ` +
          `${c.name} as a legal person.`,
      },
      {
        name: "Bylaws (Amategeko Ngengamikorere)",
        type: "policy",
        description:
          `Adopted by the constituting General Assembly in ${registrationYear}. Governs ` +
          "membership, the organs, and how decisions are taken.",
      },
      {
        name: "Membership Register",
        type: "other",
        description: `Current record-keeping method: ${c.recordKeeping}. Digital copy pending upload.`,
      },
      {
        name: `Annual Financial Statements ${lastYear}`,
        type: "financial",
        description:
          `Income, expenditure and balance sheet for the year ending 31 December ${lastYear}, ` +
          "as presented to the General Assembly.",
      },
      {
        name: "Members' Savings and Shares Ledger",
        type: "financial",
        description:
          "Running record of each member's savings, share capital and special levies.",
      },
      {
        name: `Minutes — Ordinary General Assembly, March ${lastYear}`,
        type: "minutes",
        description:
          "Attendance, quorum, the accounts as approved, and the resolutions taken. Signed by " +
          "the chair and the secretary.",
      },
      {
        name: `Minutes — Ordinary General Assembly, October ${lastYear}`,
        type: "minutes",
        description: "Second ordinary assembly of the year, as required by the RCA rulebook.",
      },
      {
        name: `Annual Return to the ${c.sector} Sector Cooperative Officer`,
        type: "report",
        description:
          `Membership, activity and financial return filed for ${lastYear}.`,
      },
    ];

    for (const doc of documents) await insertDocument(coopId, doc);

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

    // ── Demo dormancy ────────────────────────────────────────────────────────
    // One cooperative is made to go quiet, the same way two of them carry a
    // "[demo anomaly]" transaction so the anomaly detector has something to
    // find. Without it the monthly audit's visit list is empty on a fresh seed
    // and the feature cannot be demonstrated at all.
    //
    // The same cooperative is the one left on an unconverted permit, so the
    // whole story hangs together: nobody audited it, it stopped trading, the
    // monthly audit catches it, and a field visit is raised before it quietly
    // dissolves itself.
    if (c.key === unconvertedKey) {
      const cutoff = monthsAgo(DEMO_DORMANCY_MONTHS);
      const cutoffDate = ymd(cutoff, 1);
      await query(
        `DELETE FROM transactions WHERE cooperative_id = $1 AND date >= $2`,
        [coopId, cutoffDate]
      );
      await query(
        `DELETE FROM activities WHERE cooperative_id = $1 AND date >= $2`,
        [coopId, cutoffDate]
      );
      await query(
        `DELETE FROM member_contributions mc
          USING members m
          WHERE mc.member_id = m.id AND m.cooperative_id = $1 AND mc.date >= $2`,
        [coopId, cutoffDate]
      );
      await insertInsight(coopId, {
        type: "anomaly",
        severity: "critical",
        title: "No activity recorded since " + monthLabel(cutoff),
        summary:
          `[demo dormancy] ${c.name} has recorded no transaction, meeting or member ` +
          `contribution since ${monthLabel(cutoff)}. A cooperative that goes quiet like this ` +
          "usually is not discovered until its members have already lost their savings.",
        detail:
          "Seeded deliberately so the monthly functionality audit has a dormant cooperative to " +
          "detect and a field visit to raise. The cooperative itself is real; this trading gap " +
          "is not.",
        confidence: 0.95,
        affectedMetric: "Months Since Last Transaction",
        currentValue: DEMO_DORMANCY_MONTHS,
        expectedValue: 1,
        recommendations: [
          "Visit the cooperative and establish whether it still operates",
          "Check whether the temporary operating permit was ever converted",
          "Refer it for turnaround support before dissolution is considered",
        ],
        modelName: "SeedData v1.0",
      });
    }

    // The licence to operate: a temporary permit on registration, converted a
    // year later — except for the one cooperative deliberately left unconverted.
    permitSeq += 1;
    await seedPermits(coopId, c, permitSeq, { keepTemporary: c.key === unconvertedKey });

    console.log(`✓ ${c.name} — ${memberCount} members, RWF ${totalSavings.toLocaleString()} savings`);
  }

  const permitSummary = await query(
    `SELECT permit_type, term_years, COUNT(*) AS n FROM cooperative_permits
      WHERE status = 'active' GROUP BY permit_type, term_years ORDER BY permit_type`
  );
  console.log(
    `\n✓ Operating permits issued: ${permitSummary.rows
      .map((r) => `${r.n} × ${r.permit_type} (${r.term_years}yr)`)
      .join(", ")}`
  );
  console.log(
    `  ${unconvertedKey} is left on an unconverted temporary permit — it appears in the ` +
      "RCA's maturity-audit queue."
  );

  // ─── External support: funders, their programmes, and existing relations ──

  const auditorCount = await seedIndependentAuditors();
  console.log(
    `✓ Independent auditor register: ${auditorCount} entries (illustrative; one awaiting RCA approval)`
  );

  const organizationIds = await seedSupportOrganizations();
  console.log(
    `✓ Partner register: ${organizationIds.size} support organisations with open programmes ` +
      "(illustrative, not real organisations)"
  );

  // A couple of existing relationships, so the matcher's third factor is visible
  // rather than every cooperative starting from a cold introduction.
  const relationships: Array<[string, string, string, number, string]> = [
    ["ZAMUKA", "Marshland Agribusiness Support Programme", "active", 78,
      "Worked together on the last two planting seasons; the programme officer visits quarterly."],
    ["COTAVOGA", "Urban Transport Cooperatives Development Fund", "introduced", 45,
      "Introduced by the Kinyinya sector cooperative officer. No funding yet."],
    ["FODECO", "Gasabo Cooperative Union", "active", 65,
      "Founder member of the union's collective purchasing scheme."],
    ["ADARWA", "Artisan Trades Skills Foundation", "completed", 55,
      "Completed a tooling grant two years ago; the relationship has since gone quiet."],
  ];
  let relationshipCount = 0;
  for (const [coopKey, orgName, status, strength, notes] of relationships) {
    const coopId = seededIds.get(coopKey);
    const orgId = organizationIds.get(orgName);
    if (!coopId || !orgId) continue;
    await query(
      `INSERT INTO cooperative_partnerships
         (organization_id, cooperative_id, status, relationship_strength,
          liaison_role, since, last_contact_on, notes)
       VALUES ($1,$2,$3,$4,'Programme Officer',
               CURRENT_DATE - INTERVAL '2 years', CURRENT_DATE - INTERVAL '3 months',$5)
       ON CONFLICT (organization_id, cooperative_id) DO UPDATE SET
         status = EXCLUDED.status, relationship_strength = EXCLUDED.relationship_strength,
         notes = EXCLUDED.notes, updated_at = NOW()`,
      [orgId, coopId, status, strength, notes]
    );
    relationshipCount += 1;
  }
  console.log(`✓ ${relationshipCount} existing funder relationships recorded\n`);

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

  // ─── One source of truth for the money ──────────────────────────────────
  // Balances, cooperative totals and the cash book's contribution income are
  // all brought into line with the contributions ledger, then the triggers that
  // keep them there are switched back on.
  const reconciled = await query(`SELECT reconcile_member_money() AS r`);
  await query(`ALTER TABLE member_contributions ENABLE TRIGGER member_contributions_money`);
  await query(`ALTER TABLE members ENABLE TRIGGER members_cooperative_savings`);
  console.log("✓ Money reconciled to the ledger", JSON.stringify(reconciled.rows[0].r));

  console.log("\n─────────────────────────────────────────────────");
  console.log(`Seeding complete — ${COOPERATIVES.length} cooperatives.\n`);
  console.log("Test Accounts:");
  console.log("  Admin:   admin@coopinsight.rw   / Admin@1234");
  console.log(`  Manager: manager@coopinsight.rw / Manager@1234  (${demo.president!.name} — ${demo.name})`);
  console.log(`  Member:  member@coopinsight.rw  / Member@1234   (${demo.secretary!.name} — ${demo.name})`);
  console.log("\nCooperative oversight chain — every request climbs it in this order:");
  console.log(
    `  1. Sector   ${`${demo.sector.toLowerCase()}.officer@coopinsight.rw`.padEnd(34)}/ Officer@1234  ` +
      `(${demo.sector} — the sector ${demo.key} is in)`
  );
  for (const [sector] of sectorOfficers) {
    if (sector === demo.sector) continue;
    console.log(`     other sector officers: ${`${sector.toLowerCase()}.officer@coopinsight.rw`.padEnd(31)}/ Officer@1234  (${sector})`);
  }
  console.log("  2. District district.officer@coopinsight.rw     / Officer@1234  (Froduard, +250788821659)");
  console.log("  3. RCA      gov@coopinsight.rw                  / Gov@1234!");
  console.log("\nRun backend: pnpm dev");
  process.exit(0);
}

seed().catch(async (err) => {
  console.error("Seed failed:", err);
  // Never leave the money triggers off: balances would silently drift.
  await query(`ALTER TABLE member_contributions ENABLE TRIGGER member_contributions_money`).catch(() => undefined);
  await query(`ALTER TABLE members ENABLE TRIGGER members_cooperative_savings`).catch(() => undefined);
  process.exit(1);
});
