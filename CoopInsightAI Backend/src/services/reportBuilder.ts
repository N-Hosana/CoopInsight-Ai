/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BUILDING A REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A report is BUILT when it is generated: the figures are queried, shaped into
 * sections and stored on the row, so a report opened months later still shows
 * the position as it stood when it was run.
 *
 * The reports here are the papers a cooperative actually produces and is asked
 * for — by its general assembly, its sector cooperative officer, the RCA, a
 * bank or a funder:
 *
 *   financial_summary  Income and Expenditure Statement
 *   savings_growth     Members' Savings and Shares Statement
 *   loan_performance   Loan Portfolio Report
 *   member_activity    Membership Report (the register and how it moved)
 *   activities         Activities and General Assembly Report
 *   compliance         Compliance and Governance Report
 *   audit              Monthly Audit Findings
 *   budget_variance    Budget against Actual
 *   annual             Annual Report to the General Assembly
 *
 * They used to be bare tables — a dump of transactions, a list of members, a
 * column of monthly totals — with nothing saying whose they were, what they
 * meant, or who stood behind them. Each now carries the cooperative's
 * letterhead, a plain-language reading of the figures, tables with totals, and
 * the offices that sign it. Every figure comes from the same records the pages
 * show, so a report never disagrees with the screen it was generated from.
 */

import { query } from "../config/db";
import type { PdfDocumentSpec } from "./pdf";

type Cell = string | number | null;

export interface ReportSection {
  title: string;
  note?: string;
  paragraphs?: string[];
  facts?: Array<{ label: string; value: string }>;
  columns?: string[];
  rows?: Cell[][];
  /** A closing row, set in bold. */
  totals?: Cell[];
}

export interface ReportContent {
  title: string;
  type: string;
  cooperativeName: string | null;
  /** The letterhead. Null for a district-wide report. */
  cooperative: { name: string; lines: string[] } | null;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  preparedBy: string | null;
  /** What the figures mean, in sentences. */
  narrative: string[];
  summary: Array<{ label: string; value: string }>;
  sections: ReportSection[];
  /** The offices that sign the report. */
  signatories: string[];
  rowCount: number;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => `RWF ${Math.round(n(v)).toLocaleString("en-US")}`;
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const longDay = (v: unknown) =>
  v ? new Date(v as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");
const title = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : v);

/** The cash book's category codes, as a treasurer would name them. */
const CATEGORY_LABELS: Record<string, string> = {
  member_contributions: "Member contributions",
  loan_repayments: "Loan repayments received",
  grants: "Grants",
  product_sales: "Sales of produce and products",
  service_fees: "Service income",
  donations: "Donations",
  loan_disbursements: "Loans paid out to members",
  dividends: "Dividends paid to members",
  operational_costs: "Operating costs",
  salaries: "Salaries and wages",
  training: "Training",
  equipment: "Equipment",
  utilities: "Utilities",
};
const categoryLabel = (code: string | null) => (code ? CATEGORY_LABELS[code] ?? title(code) : "Uncategorised");

const CONTRIBUTION_LABELS: Record<string, string> = {
  savings: "Savings",
  share_capital: "Share capital",
  special_levy: "Special levy",
};

const OPENING_NOTE = "Opening balance (reconciliation)";

// ── Shared lookups ───────────────────────────────────────────────────────────

interface CooperativeHeader {
  id: string;
  name: string;
  registration_number: string | null;
  registration_date: string | null;
  type: string | null;
  sector: string | null;
  district: string | null;
  cell: string | null;
  phone: string | null;
  email: string | null;
  leadership: Array<{ role: string; name: string; phone: string | null }>;
}

async function loadCooperative(id: string): Promise<CooperativeHeader | null> {
  const res = await query(
    `SELECT c.id, c.name, c.registration_number, c.registration_date, c.type, c.sector, c.district,
            c.cell, c.phone, c.email,
            COALESCE((SELECT json_agg(json_build_object('role', l.role, 'name', l.name, 'phone', l.phone)
                                      ORDER BY l.created_at)
                        FROM cooperative_leadership l
                       WHERE l.cooperative_id = c.id
                         AND (l.end_date IS NULL OR l.end_date > CURRENT_DATE)), '[]') AS leadership
       FROM cooperatives c WHERE c.id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

function letterhead(c: CooperativeHeader | null): ReportContent["cooperative"] {
  if (!c) return null;
  return {
    name: c.name,
    lines: [
      [c.registration_number ? `Registration no. ${c.registration_number}` : null, c.type ? `${c.type} cooperative` : null]
        .filter(Boolean)
        .join("  ·  "),
      [c.cell ? `${c.cell} cell` : null, c.sector ? `${c.sector} sector` : null, c.district ? `${c.district} District` : null]
        .filter(Boolean)
        .join(", "),
      [c.phone ? `Tel. ${c.phone}` : null, c.email].filter(Boolean).join("  ·  "),
    ].filter((line) => line.length > 0),
  };
}

/** `AND <column> = $n` for one cooperative, or nothing for the whole district. */
function scope(cooperativeId: string | null, column: string, params: unknown[]): string {
  if (!cooperativeId) return "";
  params.push(cooperativeId);
  return ` AND ${column} = $${params.length}`;
}

const COOP_SIGNATORIES = ["President", "Secretary", "Manager / Treasurer"];
const OVERSIGHT_SIGNATORIES = ["Prepared by", "Reviewed by"];

type Built = Pick<ReportContent, "narrative" | "summary" | "sections" | "rowCount"> & {
  signatories?: string[];
  /** Overrides the period shown, for reports that are a position rather than a period. */
  position?: boolean;
};

// ── Income and Expenditure Statement ─────────────────────────────────────────

async function incomeAndExpenditure(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const where = `t.status = 'completed' AND t.date BETWEEN $1 AND $2${scope(cooperativeId, "t.cooperative_id", params)}`;

  const [byCategory, byMonth, cashBook] = await Promise.all([
    query(
      `SELECT t.type, t.category, SUM(t.amount) AS total, COUNT(*) AS entries
         FROM transactions t WHERE ${where}
        GROUP BY t.type, t.category ORDER BY t.type DESC, total DESC`,
      params
    ),
    query(
      `SELECT TO_CHAR(DATE_TRUNC('month', t.date), 'YYYY-MM') AS month,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense
         FROM transactions t WHERE ${where}
        GROUP BY 1 ORDER BY 1`,
      params
    ),
    query(
      `SELECT t.date, t.type, t.category, t.description, t.reference, t.amount, c.name AS coop
         FROM transactions t JOIN cooperatives c ON c.id = t.cooperative_id
        WHERE ${where}
        ORDER BY t.date, t.created_at LIMIT 400`,
      params
    ),
  ]);

  const income = byCategory.rows.filter((r) => r.type === "income");
  const expense = byCategory.rows.filter((r) => r.type === "expense");
  const totalIncome = income.reduce((a, r) => a + n(r.total), 0);
  const totalExpense = expense.reduce((a, r) => a + n(r.total), 0);
  const surplus = totalIncome - totalExpense;
  const topIncome = income[0];
  const topExpense = expense[0];

  const narrative = [
    totalIncome || totalExpense
      ? `Between ${longDay(from)} and ${longDay(to)} the ${cooperativeId ? "cooperative" : "cooperatives covered"} ` +
        `received ${money(totalIncome)} and spent ${money(totalExpense)}, leaving a ` +
        `${surplus >= 0 ? "surplus" : "deficit"} of ${money(Math.abs(surplus))}.`
      : `No income or expenditure was recorded between ${longDay(from)} and ${longDay(to)}.`,
  ];
  if (topIncome) {
    narrative.push(
      `The largest source of income was ${categoryLabel(topIncome.category).toLowerCase()} ` +
        `(${money(topIncome.total)}, ${pct(n(topIncome.total), totalIncome)} of income)` +
        (topExpense
          ? `; the largest expense was ${categoryLabel(topExpense.category).toLowerCase()} ` +
            `(${money(topExpense.total)}, ${pct(n(topExpense.total), totalExpense)} of spending).`
          : ".")
    );
  }

  const cashRows: Cell[][] = cashBook.rows.map((r) => [
    day(r.date),
    ...(cooperativeId ? [] : [r.coop]),
    categoryLabel(r.category),
    r.description ?? "",
    r.reference ?? "",
    r.type === "income" ? money(r.amount) : "",
    r.type === "expense" ? money(r.amount) : "",
  ]);

  return {
    narrative,
    summary: [
      { label: "Total income", value: money(totalIncome) },
      { label: "Total expenditure", value: money(totalExpense) },
      { label: surplus >= 0 ? "Surplus" : "Deficit", value: money(Math.abs(surplus)) },
      { label: "Entries", value: String(cashBook.rowCount) },
    ],
    sections: [
      {
        title: "Income",
        columns: ["Source", "Entries", "Amount", "Share of income"],
        rows: income.map((r) => [categoryLabel(r.category), n(r.entries), money(r.total), pct(n(r.total), totalIncome)]),
        totals: ["Total income", income.reduce((a, r) => a + n(r.entries), 0), money(totalIncome), "100%"],
      },
      {
        title: "Expenditure",
        columns: ["Item", "Entries", "Amount", "Share of spending"],
        rows: expense.map((r) => [categoryLabel(r.category), n(r.entries), money(r.total), pct(n(r.total), totalExpense)]),
        totals: ["Total expenditure", expense.reduce((a, r) => a + n(r.entries), 0), money(totalExpense), "100%"],
      },
      {
        title: "Month by month",
        columns: ["Month", "Income", "Expenditure", "Surplus / (deficit)"],
        rows: byMonth.rows.map((r) => [r.month, money(r.income), money(r.expense), money(n(r.income) - n(r.expense))]),
        totals: ["Period", money(totalIncome), money(totalExpense), money(surplus)],
      },
      {
        title: "Cash book",
        note: cashBook.rowCount === 400 ? "In date order; the first 400 entries of the period." : "Every entry of the period, in date order.",
        columns: ["Date", ...(cooperativeId ? [] : ["Cooperative"]), "Category", "Description", "Reference", "Money in", "Money out"],
        rows: cashRows,
      },
    ],
    rowCount: cashBook.rowCount ?? 0,
  };
}

// ── Members' Savings and Shares Statement ────────────────────────────────────

async function savingsStatement(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const memberScope = scope(cooperativeId, "m.cooperative_id", params);

  const [members, months] = await Promise.all([
    query(
      `SELECT m.full_name, m.membership_number, c.name AS coop,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'savings' AND mc.date < $1), 0) AS opening,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'savings' AND mc.date BETWEEN $1 AND $2), 0) AS saved,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'savings' AND mc.date <= $2), 0) AS closing,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'share_capital' AND mc.date <= $2), 0) AS shares,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'special_levy' AND mc.date BETWEEN $1 AND $2), 0) AS levies,
              COUNT(mc.id) FILTER (WHERE mc.date BETWEEN $1 AND $2
                                     AND mc.notes IS DISTINCT FROM '${OPENING_NOTE}') AS payments
         FROM members m
         JOIN cooperatives c ON c.id = m.cooperative_id
         LEFT JOIN member_contributions mc ON mc.member_id = m.id
        WHERE m.deleted_at IS NULL${memberScope}
        GROUP BY m.id, c.name ORDER BY m.full_name`,
      params
    ),
    query(
      `SELECT TO_CHAR(DATE_TRUNC('month', mc.date), 'YYYY-MM') AS month,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'savings'), 0) AS savings,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'share_capital'), 0) AS shares,
              COALESCE(SUM(mc.amount) FILTER (WHERE mc.type = 'special_levy'), 0) AS levies,
              COUNT(DISTINCT mc.member_id) AS payers
         FROM member_contributions mc JOIN members m ON m.id = mc.member_id
        WHERE m.deleted_at IS NULL AND mc.date BETWEEN $1 AND $2
          AND mc.notes IS DISTINCT FROM '${OPENING_NOTE}'${memberScope}
        GROUP BY 1 ORDER BY 1`,
      params
    ),
  ]);

  const sum = (key: string) => members.rows.reduce((a, r) => a + n(r[key]), 0);
  const opening = sum("opening");
  const saved = sum("saved");
  const closing = sum("closing");
  const shares = sum("shares");
  const paying = members.rows.filter((r) => n(r.payments) > 0).length;

  return {
    narrative: [
      `Members' savings stood at ${money(opening)} on ${longDay(from)} and ${money(closing)} on ${longDay(to)}: ` +
        `${money(saved)} was paid in during the period. Share capital held stands at ${money(shares)}.`,
      `${paying} of ${members.rowCount} members (${pct(paying, members.rowCount ?? 0)}) made at least one payment in the period.` +
        (paying < (members.rowCount ?? 0) / 2 ? " More than half the register paid nothing, which the committee should follow up." : ""),
    ],
    summary: [
      { label: "Savings at start", value: money(opening) },
      { label: "Paid in during period", value: money(saved) },
      { label: "Savings at end", value: money(closing) },
      { label: "Share capital held", value: money(shares) },
    ],
    sections: [
      {
        title: "Statement by member",
        note: "Savings are money the cooperative holds for the member; share capital is their stake in it.",
        columns: ["Member", "No.", ...(cooperativeId ? [] : ["Cooperative"]), "Savings at start", "Paid in", "Savings at end", "Share capital", "Payments"],
        rows: members.rows.map((r) => [
          r.full_name, r.membership_number ?? "", ...(cooperativeId ? [] : [r.coop]),
          money(r.opening), money(r.saved), money(r.closing), money(r.shares), n(r.payments),
        ]),
        totals: ["Total", "", ...(cooperativeId ? [] : [""]), money(opening), money(saved), money(closing), money(shares), sum("payments")],
      },
      {
        title: "Collections month by month",
        columns: ["Month", "Savings", "Share capital", "Special levies", "Members who paid"],
        rows: months.rows.map((r) => [r.month, money(r.savings), money(r.shares), money(r.levies), n(r.payers)]),
        totals: [
          "Period",
          money(months.rows.reduce((a, r) => a + n(r.savings), 0)),
          money(months.rows.reduce((a, r) => a + n(r.shares), 0)),
          money(months.rows.reduce((a, r) => a + n(r.levies), 0)),
          "",
        ],
      },
    ],
    rowCount: members.rowCount ?? 0,
  };
}

// ── Loan Portfolio Report ────────────────────────────────────────────────────

async function loanPortfolio(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const loanScope = scope(cooperativeId, "l.cooperative_id", params);

  const loans = await query(
    `SELECT m.full_name, c.name AS coop, l.amount, l.balance, l.interest_rate, l.purpose,
            l.issued_at, l.due_at,
            CASE WHEN l.status = 'active' AND l.due_at < $2::date THEN 'overdue' ELSE l.status END AS status,
            COALESCE((SELECT SUM(r.amount) FROM loan_repayments r WHERE r.loan_id = l.id AND r.date <= $2), 0) AS repaid,
            COALESCE((SELECT SUM(r.amount) FROM loan_repayments r
                       WHERE r.loan_id = l.id AND r.date BETWEEN $1 AND $2), 0) AS repaid_in_period,
            (l.issued_at::date BETWEEN $1 AND $2) AS issued_in_period
       FROM loan_records l
       JOIN members m ON m.id = l.member_id
       JOIN cooperatives c ON c.id = l.cooperative_id
      WHERE l.issued_at::date <= $2${loanScope}
        AND (l.status <> 'repaid' OR l.closed_at::date >= $1 OR l.issued_at::date >= $1)
      ORDER BY l.due_at`,
    params
  );

  const rows = loans.rows;
  const issued = rows.filter((r) => r.issued_in_period);
  const disbursed = issued.reduce((a, r) => a + n(r.amount), 0);
  const repaid = rows.reduce((a, r) => a + n(r.repaid_in_period), 0);
  const open = rows.filter((r) => r.status !== "repaid");
  const outstanding = open.reduce((a, r) => a + n(r.balance), 0);
  const overdue = open.filter((r) => r.status === "overdue");
  const atRisk = overdue.reduce((a, r) => a + n(r.balance), 0);

  return {
    narrative: [
      rows.length
        ? `${issued.length} loan(s) worth ${money(disbursed)} were paid out to members between ${longDay(from)} and ${longDay(to)}, ` +
          `and ${money(repaid)} was repaid. ${money(outstanding)} is still owed on ${open.length} loan(s).`
        : `No loans to members were open or issued between ${longDay(from)} and ${longDay(to)}.`,
      ...(open.length
        ? [
            overdue.length
              ? `${overdue.length} loan(s) are past their due date, with ${money(atRisk)} at risk — ` +
                `${pct(atRisk, outstanding)} of the portfolio. These need a repayment plan agreed with the member.`
              : "No loan is past its due date.",
          ]
        : []),
    ],
    summary: [
      { label: "Paid out in period", value: money(disbursed) },
      { label: "Repaid in period", value: money(repaid) },
      { label: "Outstanding", value: money(outstanding) },
      { label: "Portfolio at risk", value: pct(atRisk, outstanding) },
    ],
    sections: [
      {
        title: "Loans",
        note: "Open loans, and loans issued or closed in the period, in order of due date.",
        columns: ["Member", ...(cooperativeId ? [] : ["Cooperative"]), "Purpose", "Issued", "Due", "Rate", "Amount", "Repaid", "Balance", "Status"],
        rows: rows.map((r) => [
          r.full_name, ...(cooperativeId ? [] : [r.coop]), r.purpose ?? "", day(r.issued_at), day(r.due_at),
          `${n(r.interest_rate)}%`, money(r.amount), money(r.repaid), money(r.balance), title(r.status),
        ]),
        totals: [
          "Total", ...(cooperativeId ? [] : [""]), "", "", "", "",
          money(rows.reduce((a, r) => a + n(r.amount), 0)),
          money(rows.reduce((a, r) => a + n(r.repaid), 0)),
          money(outstanding), "",
        ],
      },
    ],
    rowCount: rows.length,
  };
}

// ── Membership Report ────────────────────────────────────────────────────────

async function membershipReport(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const memberScope = scope(cooperativeId, "m.cooperative_id", params);

  const [register, movement] = await Promise.all([
    query(
      `SELECT m.full_name, m.membership_number, m.gender, m.status, m.role, m.membership_date, m.phone,
              m.total_savings, c.name AS coop,
              (SELECT COUNT(*) FROM member_contributions mc
                WHERE mc.member_id = m.id AND mc.date BETWEEN $1 AND $2
                  AND mc.notes IS DISTINCT FROM '${OPENING_NOTE}') AS payments,
              (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
                WHERE ap.member_id = m.id AND a.status = 'completed' AND a.deleted_at IS NULL
                  AND a.date BETWEEN $1 AND $2) AS invited,
              (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
                WHERE ap.member_id = m.id AND ap.attended AND a.status = 'completed' AND a.deleted_at IS NULL
                  AND a.date BETWEEN $1 AND $2) AS attended
         FROM members m JOIN cooperatives c ON c.id = m.cooperative_id
        WHERE m.deleted_at IS NULL${memberScope}
        ORDER BY m.full_name`,
      params
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE m.membership_date BETWEEN $1 AND $2) AS joined,
         COUNT(*) FILTER (WHERE m.archived_at::date BETWEEN $1 AND $2) AS left_coop,
         COUNT(*) FILTER (WHERE (m.membership_date IS NULL OR m.membership_date < $1)
                            AND (m.archived_at IS NULL OR m.archived_at::date >= $1)) AS at_start,
         COUNT(*) FILTER (WHERE (m.membership_date IS NULL OR m.membership_date <= $2)
                            AND (m.archived_at IS NULL OR m.archived_at::date > $2)) AS at_end
         FROM members m WHERE TRUE${memberScope}`,
      params
    ),
  ]);

  const rows = register.rows;
  const mv = movement.rows[0];
  const women = rows.filter((r) => String(r.gender ?? "").toLowerCase() === "female").length;
  const men = rows.filter((r) => String(r.gender ?? "").toLowerCase() === "male").length;
  const active = rows.filter((r) => r.status === "active").length;
  const paying = rows.filter((r) => n(r.payments) > 0).length;
  const invited = rows.reduce((a, r) => a + n(r.invited), 0);
  const attended = rows.reduce((a, r) => a + n(r.attended), 0);

  return {
    narrative: [
      `The register held ${n(mv.at_start)} member(s) on ${longDay(from)} and ${n(mv.at_end)} on ${longDay(to)}: ` +
        `${n(mv.joined)} joined and ${n(mv.left_coop)} left during the period.`,
      `${active} of the ${rows.length} members now on the register are active. ` +
        `${women} are women and ${men} are men${rows.length - women - men ? `; gender is not recorded for ${rows.length - women - men}` : ""}.`,
      `${paying} member(s) (${pct(paying, rows.length)}) paid a contribution in the period, and members attended ` +
        `${attended} of the ${invited} activity places they were registered for (${pct(attended, invited)}).`,
    ],
    summary: [
      { label: "Members at start", value: String(n(mv.at_start)) },
      { label: "Joined", value: String(n(mv.joined)) },
      { label: "Left", value: String(n(mv.left_coop)) },
      { label: "Members at end", value: String(n(mv.at_end)) },
    ],
    sections: [
      {
        title: "Composition",
        facts: [
          { label: "Women", value: `${women} (${pct(women, rows.length)})` },
          { label: "Men", value: `${men} (${pct(men, rows.length)})` },
          { label: "Active", value: `${active} (${pct(active, rows.length)})` },
          { label: "Suspended or inactive", value: String(rows.length - active) },
          { label: "Paid a contribution in the period", value: `${paying} (${pct(paying, rows.length)})` },
          { label: "Attendance at activities", value: `${attended} of ${invited} (${pct(attended, invited)})` },
        ],
      },
      {
        title: "Member register",
        columns: ["Member", "No.", ...(cooperativeId ? [] : ["Cooperative"]), "Gender", "Joined", "Status", "Savings", "Payments", "Attended"],
        rows: rows.map((r) => [
          r.full_name, r.membership_number ?? "", ...(cooperativeId ? [] : [r.coop]), title(String(r.gender ?? "")),
          day(r.membership_date), title(r.status), money(r.total_savings), n(r.payments),
          n(r.invited) ? `${n(r.attended)} of ${n(r.invited)}` : "-",
        ]),
        totals: [
          "Total", "", ...(cooperativeId ? [] : [""]), "", "", "",
          money(rows.reduce((a, r) => a + n(r.total_savings), 0)),
          rows.reduce((a, r) => a + n(r.payments), 0),
          `${attended} of ${invited}`,
        ],
      },
    ],
    rowCount: rows.length,
  };
}

// ── Activities and General Assembly Report ───────────────────────────────────

async function activitiesReport(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const actScope = scope(cooperativeId, "a.cooperative_id", params);

  const acts = await query(
    `SELECT a.title, a.type, a.status, a.date, a.location, a.outcome, a.cancellation_reason, c.name AS coop,
            COUNT(ap.id) AS invited, COUNT(ap.id) FILTER (WHERE ap.attended) AS attended
       FROM activities a
       JOIN cooperatives c ON c.id = a.cooperative_id
       LEFT JOIN activity_participants ap ON ap.activity_id = a.id
      WHERE a.deleted_at IS NULL AND a.date BETWEEN $1 AND $2${actScope}
      GROUP BY a.id, c.name ORDER BY a.date`,
    params
  );

  const rows = acts.rows;
  const done = rows.filter((r) => r.status === "completed");
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const overdue = rows.filter((r) => r.status === "planned" && new Date(r.date) < new Date());
  const invited = done.reduce((a, r) => a + n(r.invited), 0);
  const attended = done.reduce((a, r) => a + n(r.attended), 0);
  const assemblies = done.filter((r) => r.type === "meeting" && /assembl/i.test(r.title));
  const ordinary = done.filter((r) => r.type === "meeting" && [3, 10].includes(new Date(r.date).getMonth() + 1));

  return {
    narrative: [
      `${rows.length} activit${rows.length === 1 ? "y was" : "ies were"} scheduled between ${longDay(from)} and ${longDay(to)}: ` +
        `${done.length} held, ${cancelled.length} cancelled` +
        (overdue.length ? `, and ${overdue.length} whose date has passed without being marked held or cancelled.` : "."),
      done.length
        ? `Members took up ${attended} of the ${invited} places they were registered for at the activities held — an attendance rate of ${pct(attended, invited)}.`
        : "No activity was recorded as held, so there is no attendance to report.",
      `${ordinary.length} meeting(s) were held in March or October, the months in which the RCA requires the ordinary general assembly` +
        (assemblies.length ? `; ${assemblies.length} meeting(s) in the period were general assemblies.` : "."),
    ],
    summary: [
      { label: "Scheduled", value: String(rows.length) },
      { label: "Held", value: String(done.length) },
      { label: "Attendance", value: pct(attended, invited) },
      { label: "Not recorded", value: String(overdue.length) },
    ],
    sections: [
      {
        title: "Activities",
        columns: ["Date", ...(cooperativeId ? [] : ["Cooperative"]), "Activity", "Type", "Venue", "Status", "Registered", "Attended", "Rate"],
        rows: rows.map((r) => [
          day(r.date), ...(cooperativeId ? [] : [r.coop]), r.title, title(r.type), r.location ?? "",
          r.status === "planned" && new Date(r.date) < new Date() ? "Not recorded" : title(r.status),
          n(r.invited), r.status === "completed" ? n(r.attended) : "-",
          r.status === "completed" ? pct(n(r.attended), n(r.invited)) : "-",
        ]),
        totals: ["Held", ...(cooperativeId ? [] : [""]), `${done.length} activities`, "", "", "", invited, attended, pct(attended, invited)],
      },
      ...(done.some((r) => r.outcome)
        ? [{
            title: "Outcomes recorded",
            columns: ["Date", "Activity", "Outcome"],
            rows: done.filter((r) => r.outcome).map((r) => [day(r.date), r.title, r.outcome] as Cell[]),
          }]
        : []),
    ],
    rowCount: rows.length,
  };
}

// ── Compliance and Governance Report ─────────────────────────────────────────

async function complianceReport(cooperativeId: string | null): Promise<Built> {
  const params: unknown[] = [];
  const coopScope = scope(cooperativeId, "c.id", params);

  const res = await query(
    `SELECT c.id, c.name, c.sector, c.status,
            (SELECT COUNT(*) FROM members m WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS members,
            (SELECT row_to_json(p) FROM (
               SELECT cp.permit_number, cp.permit_type, cp.expires_on FROM cooperative_permits cp
                WHERE cp.cooperative_id = c.id AND cp.status = 'active'
                ORDER BY cp.expires_on DESC LIMIT 1) p) AS permit,
            (SELECT COUNT(*) FROM cooperative_leadership l
              WHERE l.cooperative_id = c.id AND (l.end_date IS NULL OR l.end_date > CURRENT_DATE)
                AND l.role <> 'Sector Cooperative Officer'
                AND l.name IS NOT NULL AND l.name <> '(Name not recorded)') AS board,
            (SELECT MAX(period_end) FROM balance_sheets b WHERE b.cooperative_id = c.id) AS balance_sheet,
            (SELECT COUNT(*) FROM activities a
              WHERE a.cooperative_id = c.id AND a.deleted_at IS NULL AND a.type = 'meeting'
                AND a.status = 'completed' AND EXTRACT(MONTH FROM a.date)::int IN (3, 10)
                AND a.date >= CURRENT_DATE - INTERVAL '12 months') AS assemblies,
            (SELECT COUNT(*) FROM cooperative_documents d WHERE d.cooperative_id = c.id) AS documents,
            (SELECT COUNT(*) FROM cooperative_documents d WHERE d.cooperative_id = c.id AND d.url IS NOT NULL) AS documents_on_file,
            (SELECT row_to_json(x) FROM (
               SELECT TO_CHAR(a.period, 'YYYY-MM') AS period, a.band, a.composite_score, a.signals
                 FROM cooperative_monthly_audits a WHERE a.cooperative_id = c.id
                ORDER BY a.period DESC LIMIT 1) x) AS audit
       FROM cooperatives c WHERE c.deleted_at IS NULL${coopScope}
      ORDER BY c.name`,
    params
  );

  const check = (ok: boolean) => (ok ? "Met" : "NOT MET");
  const permitText = (p: any) =>
    p ? `${title(p.permit_type)} permit ${p.permit_number}, valid to ${day(p.expires_on)}` : "No permit in force";

  if (cooperativeId && res.rows[0]) {
    const c = res.rows[0];
    const sheetAge = c.balance_sheet ? (Date.now() - new Date(c.balance_sheet).getTime()) / (365.25 * 86_400_000) : null;
    const checks: Array<[string, boolean, string]> = [
      ["Operating permit in force", !!c.permit, permitText(c.permit)],
      ["Permit is permanent", c.permit?.permit_type === "permanent", c.permit ? `${title(c.permit.permit_type)} permit` : "No permit"],
      ["Board of Directors complete (5 seats)", n(c.board) >= 5, `${n(c.board)} of 5 seats recorded by name`],
      ["Ordinary general assemblies held (March and October)", n(c.assemblies) >= 2, `${n(c.assemblies)} held in the last 12 months`],
      ["Balance sheet filed within the last year", sheetAge != null && sheetAge <= 1, c.balance_sheet ? `Last filed for the period ending ${day(c.balance_sheet)}` : "Never filed"],
      ["Governing documents on file", n(c.documents_on_file) >= 2, `${n(c.documents_on_file)} of ${n(c.documents)} listed documents have a file uploaded`],
    ];
    const met = checks.filter(([, ok]) => ok).length;
    const issues: any[] = Array.isArray(c.audit?.signals?.issues) ? c.audit.signals.issues : [];

    return {
      position: true,
      narrative: [
        `${c.name} meets ${met} of the ${checks.length} governance requirements checked here. ` +
          (met === checks.length ? "Nothing is outstanding." : `The ${checks.length - met} not met are listed below and should be put right before the next inspection.`),
        c.audit
          ? `The most recent monthly audit (${c.audit.period}) scored the cooperative ${Math.round(n(c.audit.composite_score))}/100 — "${title(c.audit.band)}".`
          : "No monthly audit has been run for this cooperative yet.",
      ],
      summary: [
        { label: "Requirements met", value: `${met} of ${checks.length}` },
        { label: "Members", value: String(n(c.members)) },
        { label: "Permit", value: c.permit ? title(c.permit.permit_type) : "None" },
        { label: "Audit rating", value: c.audit ? title(c.audit.band) : "Not assessed" },
      ],
      sections: [
        {
          title: "Governance checklist",
          columns: ["Requirement", "Result", "Evidence"],
          rows: checks.map(([requirement, ok, evidence]) => [requirement, check(ok), evidence]),
        },
        ...(issues.length
          ? [{
              title: `Findings of the ${c.audit.period} audit`,
              note: "Each finding carries its code, so the sector officer and the cooperative refer to the same thing.",
              columns: ["Code", "Finding", "Severity"],
              rows: issues.map((i) => [i.code, i.title, title(i.severity)] as Cell[]),
            }]
          : []),
      ],
      rowCount: checks.length + issues.length,
    };
  }

  const rows = res.rows;
  return {
    position: true,
    signatories: OVERSIGHT_SIGNATORIES,
    narrative: [
      `${rows.length} cooperative(s) are covered. ${rows.filter((r) => !r.permit).length} have no operating permit in force, ` +
        `${rows.filter((r) => !r.balance_sheet).length} have never filed a balance sheet, and ` +
        `${rows.filter((r) => ["at_risk", "critical"].includes(r.audit?.band)).length} are rated at risk or critical by the latest monthly audit.`,
    ],
    summary: [
      { label: "Cooperatives", value: String(rows.length) },
      { label: "No permit in force", value: String(rows.filter((r) => !r.permit).length) },
      { label: "Temporary permit", value: String(rows.filter((r) => r.permit?.permit_type === "temporary").length) },
      { label: "At risk or critical", value: String(rows.filter((r) => ["at_risk", "critical"].includes(r.audit?.band)).length) },
    ],
    sections: [
      {
        title: "Compliance position",
        columns: ["Cooperative", "Sector", "Members", "Permit", "Expires", "Board", "Assemblies (12 mo)", "Balance sheet", "Audit"],
        rows: rows.map((r) => [
          r.name, r.sector, n(r.members), r.permit ? title(r.permit.permit_type) : "NONE", r.permit ? day(r.permit.expires_on) : "",
          `${n(r.board)}/5`, `${n(r.assemblies)}/2`, r.balance_sheet ? day(r.balance_sheet) : "Never",
          r.audit ? title(r.audit.band) : "Not assessed",
        ]),
      },
    ],
    rowCount: rows.length,
  };
}

// ── Monthly Audit Findings ───────────────────────────────────────────────────

async function auditReport(cooperativeId: string | null): Promise<Built> {
  const params: unknown[] = [];
  const coopScope = scope(cooperativeId, "a.cooperative_id", params);
  // Each cooperative's own most recent audit. A sector officer may audit one
  // sector for a later month, so "the latest month overall" would leave every
  // cooperative outside that run with no audit at all.
  const res = await query(
    `SELECT DISTINCT ON (a.cooperative_id)
            TO_CHAR(a.period, 'YYYY-MM') AS period, a.functionality_score, a.engagement_score,
            a.composite_score, a.band, a.signals, a.reasons, a.recommended_actions, c.name, c.sector
       FROM cooperative_monthly_audits a JOIN cooperatives c ON c.id = a.cooperative_id
      WHERE c.deleted_at IS NULL${coopScope}
      ORDER BY a.cooperative_id, a.period DESC`,
    params
  );
  const rows = [...res.rows].sort((x, y) => n(x.composite_score) - n(y.composite_score));
  if (!rows.length) {
    return {
      position: true,
      narrative: ["No monthly audit has been run yet, so there are no findings to report."],
      summary: [{ label: "Audits on file", value: "0" }],
      sections: [],
      rowCount: 0,
    };
  }

  if (cooperativeId) {
    const a = rows[0];
    const issues: any[] = Array.isArray(a.signals?.issues) ? a.signals.issues : [];
    const components: Record<string, number> = a.signals?.components ?? {};
    const measure = (i: any) =>
      i.value == null ? "none" : i.unit === "ratio" ? `${Math.round(n(i.value) * 100)}%` : `${i.value} ${i.unit}`;
    return {
      position: true,
      narrative: [
        `In the ${a.period} audit ${a.name} scored ${Math.round(n(a.composite_score))} out of 100 and was rated "${title(a.band)}". ` +
          `The score combines whether the cooperative is operating (${Math.round(n(a.functionality_score))}/100) with whether its members are taking part (${Math.round(n(a.engagement_score))}/100).`,
        issues.length
          ? `${issues.length} finding(s) were raised, ${issues.filter((i) => i.severity === "critical").length} of them critical.`
          : "No findings were raised.",
      ],
      summary: [
        { label: "Overall score", value: `${Math.round(n(a.composite_score))} / 100` },
        { label: "Rating", value: title(a.band) },
        { label: "Operating", value: `${Math.round(n(a.functionality_score))} / 100` },
        { label: "Member participation", value: `${Math.round(n(a.engagement_score))} / 100` },
      ],
      sections: [
        {
          title: "How the score is made up",
          columns: ["Area", "Score (0-100)"],
          rows: Object.entries(components).map(([k, v]) => [title(k.replace(/([A-Z])/g, " $1").toLowerCase()), Math.round(n(v))]),
        },
        {
          title: "Findings",
          columns: ["Code", "Finding", "Severity", "Measured", "Threshold"],
          rows: issues.map((i) => [i.code, i.title, title(i.severity), measure(i), i.threshold == null ? "-" : measure({ ...i, value: i.threshold })]),
        },
        {
          title: "What to do",
          paragraphs: (Array.isArray(a.recommended_actions) ? a.recommended_actions : []).map((x: string, i: number) => `${i + 1}. ${x}`),
        },
      ],
      rowCount: issues.length,
    };
  }

  return {
    position: true,
    signatories: OVERSIGHT_SIGNATORIES,
    narrative: [
      `This shows the most recent monthly audit of each of ${rows.length} cooperative(s). ` +
        `${rows.filter((r) => ["at_risk", "critical"].includes(r.band)).length} were rated at risk or critical; they are listed first.`,
    ],
    summary: [
      { label: "Assessed", value: String(rows.length) },
      { label: "Healthy", value: String(rows.filter((r) => r.band === "healthy").length) },
      { label: "At risk", value: String(rows.filter((r) => r.band === "at_risk").length) },
      { label: "Critical", value: String(rows.filter((r) => r.band === "critical").length) },
    ],
    sections: [
      {
        title: "Standings, weakest first",
        columns: ["Cooperative", "Sector", "Audit month", "Operating", "Participation", "Overall", "Rating", "Findings"],
        rows: rows.map((r) => [
          r.name, r.sector, r.period, Math.round(n(r.functionality_score)), Math.round(n(r.engagement_score)),
          Math.round(n(r.composite_score)), title(r.band),
          Array.isArray(r.signals?.issues) ? r.signals.issues.map((i: any) => i.code).join(", ") : "",
        ]),
      },
    ],
    rowCount: rows.length,
  };
}

// ── Budget against Actual ────────────────────────────────────────────────────

async function budgetVariance(cooperativeId: string | null, from: string, to: string): Promise<Built> {
  const params: unknown[] = [from, to];
  const budgetScope = scope(cooperativeId, "b.cooperative_id", params);
  const lines = await query(
    `SELECT b.title AS budget, b.period_start, b.period_end, c.name AS coop, bl.category, bl.description,
            bl.planned_amount,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.cooperative_id = b.cooperative_id AND t.status = 'completed'
                         AND t.category = bl.category
                         AND t.date BETWEEN b.period_start AND b.period_end), 0) AS actual
       FROM budgets b
       JOIN budget_lines bl ON bl.budget_id = b.id
       JOIN cooperatives c ON c.id = b.cooperative_id
      WHERE b.period_start <= $2 AND b.period_end >= $1${budgetScope}
      ORDER BY b.period_start, bl.category`,
    params
  );
  const rows = lines.rows;
  const planned = rows.reduce((a, r) => a + n(r.planned_amount), 0);
  const actual = rows.reduce((a, r) => a + n(r.actual), 0);

  return {
    narrative: [
      rows.length
        ? `Against a budget of ${money(planned)}, ${money(actual)} has been recorded — ${pct(actual, planned)} of plan. ` +
          `Lines more than 10% over plan are the ones the committee should explain to the assembly.`
        : "No budget covers this period. A budget is prepared on the Budget Planning page and approved by the general assembly; " +
          "once one exists this report compares each line of it with what was actually recorded.",
    ],
    summary: [
      { label: "Budgeted", value: money(planned) },
      { label: "Actual", value: money(actual) },
      { label: "Used", value: pct(actual, planned) },
      { label: "Budget lines", value: String(rows.length) },
    ],
    sections: rows.length
      ? [{
          title: "Budget lines",
          columns: ["Budget", ...(cooperativeId ? [] : ["Cooperative"]), "Line", "Budgeted", "Actual", "Difference", "Used"],
          rows: rows.map((r) => [
            r.budget, ...(cooperativeId ? [] : [r.coop]), r.description || categoryLabel(r.category),
            money(r.planned_amount), money(r.actual), money(n(r.planned_amount) - n(r.actual)), pct(n(r.actual), n(r.planned_amount)),
          ]),
          totals: ["Total", ...(cooperativeId ? [] : [""]), "", money(planned), money(actual), money(planned - actual), pct(actual, planned)],
        }]
      : [],
    rowCount: rows.length,
  };
}

// ── Annual Report to the General Assembly ────────────────────────────────────

async function annualReport(cooperativeId: string | null, from: string, to: string, coop: CooperativeHeader | null): Promise<Built> {
  const [money_, savings, loans, membership, activities, compliance] = await Promise.all([
    incomeAndExpenditure(cooperativeId, from, to),
    savingsStatement(cooperativeId, from, to),
    loanPortfolio(cooperativeId, from, to),
    membershipReport(cooperativeId, from, to),
    activitiesReport(cooperativeId, from, to),
    complianceReport(cooperativeId),
  ]);

  const sheet = cooperativeId
    ? (await query(
        `SELECT * FROM balance_sheets WHERE cooperative_id = $1 AND period_end <= $2 ORDER BY period_end DESC LIMIT 1`,
        [cooperativeId, to]
      )).rows[0]
    : null;

  const pick = (built: Built, label: string) => built.summary.find((s) => s.label === label)?.value ?? "-";
  const sections: ReportSection[] = [];

  if (coop) {
    sections.push({
      title: "1. The cooperative",
      facts: [
        { label: "Name", value: coop.name },
        { label: "Registration number", value: coop.registration_number ?? "Not recorded" },
        { label: "Registered on", value: coop.registration_date ? longDay(coop.registration_date) : "Not recorded" },
        { label: "Type", value: coop.type ?? "Not recorded" },
        { label: "Location", value: [coop.cell, coop.sector && `${coop.sector} sector`, coop.district && `${coop.district} District`].filter(Boolean).join(", ") },
        ...coop.leadership.map((l) => ({ label: l.role, value: l.phone ? `${l.name} (${l.phone})` : l.name })),
      ],
    });
  }

  sections.push(
    { title: "2. Membership", paragraphs: membership.narrative, facts: membership.sections[0]?.facts },
    {
      title: "3. Income and expenditure",
      paragraphs: money_.narrative,
      columns: ["", "Amount"],
      rows: [
        ...(money_.sections[0].rows ?? []).map((r) => [`Income: ${r[0]}`, r[2]] as Cell[]),
        ...(money_.sections[1].rows ?? []).map((r) => [`Expenditure: ${r[0]}`, r[2]] as Cell[]),
      ],
      totals: [pick(money_, "Surplus") !== "-" ? "Surplus for the year" : "Deficit for the year", pick(money_, "Surplus") !== "-" ? pick(money_, "Surplus") : pick(money_, "Deficit")],
    }
  );

  if (sheet) {
    const assets = n(sheet.cash) + n(sheet.bank_balance) + n(sheet.loans_outstanding) + n(sheet.inventory) + n(sheet.fixed_assets);
    const liabilities = n(sheet.member_savings) + n(sheet.external_loans) + n(sheet.accounts_payable);
    sections.push({
      title: `4. Balance sheet at ${longDay(sheet.period_end)}`,
      columns: ["", "Amount"],
      rows: [
        ["Cash in hand", money(sheet.cash)],
        ["Bank and mobile money", money(sheet.bank_balance)],
        ["Loans owed by members", money(sheet.loans_outstanding)],
        ["Stock", money(sheet.inventory)],
        ["Fixed assets", money(sheet.fixed_assets)],
        ["TOTAL ASSETS", money(assets)],
        ["Members' savings held", money(sheet.member_savings)],
        ["Loans owed by the cooperative", money(sheet.external_loans)],
        ["Unpaid bills", money(sheet.accounts_payable)],
        ["TOTAL LIABILITIES", money(liabilities)],
        ["Share capital", money(sheet.share_capital)],
        ["Retained earnings", money(sheet.retained_earnings)],
      ],
      totals: ["LIABILITIES AND EQUITY", money(liabilities + n(sheet.share_capital) + n(sheet.retained_earnings))],
    });
  } else if (cooperativeId) {
    sections.push({
      title: "4. Balance sheet",
      paragraphs: ["No balance sheet has been filed for a period ending in or before this year. One should be filed before the report is presented."],
    });
  }

  sections.push(
    { title: "5. Members' savings and shares", paragraphs: savings.narrative, facts: savings.summary },
    { title: "6. Loans to members", paragraphs: loans.narrative, facts: loans.summary },
    { title: "7. Activities and general assemblies", paragraphs: activities.narrative, facts: activities.summary },
    {
      title: "8. Compliance and governance",
      paragraphs: compliance.narrative,
      ...(cooperativeId && compliance.sections[0]
        ? { columns: compliance.sections[0].columns, rows: compliance.sections[0].rows }
        : {}),
    }
  );

  return {
    narrative: [
      `This report is presented to the General Assembly on the affairs of the cooperative for the year ` +
        `${longDay(from)} to ${longDay(to)}. It covers the membership, the accounts, members' savings and loans, ` +
        `the activities held and the cooperative's standing with the regulator.`,
    ],
    summary: [
      { label: "Members at year end", value: pick(membership, "Members at end") },
      { label: "Total income", value: pick(money_, "Total income") },
      { label: "Total expenditure", value: pick(money_, "Total expenditure") },
      { label: "Savings at year end", value: pick(savings, "Savings at end") },
    ],
    sections,
    rowCount: sections.length,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export const REPORT_TITLES: Record<string, string> = {
  financial_summary: "Income and Expenditure Statement",
  savings_growth: "Members' Savings and Shares Statement",
  loan_performance: "Loan Portfolio Report",
  member_activity: "Membership Report",
  activities: "Activities and General Assembly Report",
  compliance: "Compliance and Governance Report",
  audit: "Monthly Audit Findings",
  budget_variance: "Budget against Actual",
  annual: "Annual Report to the General Assembly",
};

/**
 * Builds one report from live data. `cooperativeId` null means every
 * cooperative in the caller's reach — a district report for an officer.
 */
export async function buildReport(options: {
  type: string;
  title?: string;
  cooperativeId: string | null;
  from: string;
  to: string;
  preparedBy?: string | null;
}): Promise<ReportContent> {
  const { type, cooperativeId, from, to } = options;
  const coop = cooperativeId ? await loadCooperative(cooperativeId) : null;

  let built: Built;
  switch (type) {
    case "financial_summary": built = await incomeAndExpenditure(cooperativeId, from, to); break;
    case "savings_growth": built = await savingsStatement(cooperativeId, from, to); break;
    case "loan_performance": built = await loanPortfolio(cooperativeId, from, to); break;
    case "member_activity": built = await membershipReport(cooperativeId, from, to); break;
    case "activities": built = await activitiesReport(cooperativeId, from, to); break;
    case "compliance": built = await complianceReport(cooperativeId); break;
    case "audit": built = await auditReport(cooperativeId); break;
    case "budget_variance": built = await budgetVariance(cooperativeId, from, to); break;
    case "annual": built = await annualReport(cooperativeId, from, to, coop); break;
    default:
      built = {
        narrative: [`"${type}" is not a report this system produces.`],
        summary: [],
        sections: [],
        rowCount: 0,
      };
  }

  return {
    title: options.title || REPORT_TITLES[type] || title(type),
    type,
    cooperativeName: coop?.name ?? null,
    cooperative: letterhead(coop),
    periodFrom: built.position ? null : from,
    periodTo: built.position ? null : to,
    generatedAt: new Date().toISOString(),
    preparedBy: options.preparedBy ?? null,
    narrative: built.narrative,
    summary: built.summary,
    sections: built.sections,
    signatories: built.signatories ?? (coop ? COOP_SIGNATORIES : OVERSIGHT_SIGNATORIES),
    rowCount: built.rowCount,
  };
}

/** A stored report, as the document the PDF engine prints. */
export function toPdfSpec(content: ReportContent): PdfDocumentSpec {
  return {
    title: content.title,
    subtitle:
      content.periodFrom && content.periodTo
        ? `For the period ${longDay(content.periodFrom)} to ${longDay(content.periodTo)}`
        : `Position as at ${longDay(content.generatedAt)}`,
    // Reports stored before the letterhead existed still carry a name.
    organisation:
      content.cooperative ??
      (content.cooperativeName
        ? { name: content.cooperativeName, lines: [] }
        : { name: "Gasabo District — Cooperative Oversight", lines: ["All cooperatives in scope"] }),
    meta: [
      ...(content.preparedBy ? [{ label: "Prepared by", value: content.preparedBy }] : []),
      { label: "Generated", value: longDay(content.generatedAt) },
    ],
    narrative: content.narrative ?? [],
    summary: content.summary ?? [],
    sections: content.sections ?? [],
    signatories: content.signatories ?? [],
    footer: `${content.title} — generated by CoopInsight AI from the cooperative's records`,
  };
}

/** Renders a built report as CSV — one block per section — for spreadsheets. */
export function toCsv(content: ReportContent): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];

  lines.push(esc(content.title));
  if (content.cooperativeName) lines.push(esc(content.cooperativeName));
  if (content.periodFrom && content.periodTo) {
    lines.push(esc(`Period: ${content.periodFrom} to ${content.periodTo}`));
  }
  lines.push(esc(`Generated: ${content.generatedAt}`));
  lines.push("");

  for (const item of content.summary ?? []) lines.push([esc(item.label), esc(item.value)].join(","));
  lines.push("");

  for (const section of content.sections ?? []) {
    lines.push(esc(section.title));
    if (section.note) lines.push(esc(section.note));
    for (const fact of section.facts ?? []) lines.push([esc(fact.label), esc(fact.value)].join(","));
    if (section.columns) lines.push(section.columns.map(esc).join(","));
    for (const row of section.rows ?? []) lines.push(row.map(esc).join(","));
    if (section.totals) lines.push(section.totals.map(esc).join(","));
    lines.push("");
  }

  return lines.join("\n");
}
