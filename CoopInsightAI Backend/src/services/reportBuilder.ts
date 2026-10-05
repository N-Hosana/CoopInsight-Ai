/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BUILDING A REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `POST /reports/generate` used to insert a row with `file_url = 'pending'` and
 * stop there. Nothing ever moved it off "pending", so every View and Export
 * button on the Reports page opened a file that had never been written.
 *
 * A report is now BUILT when it is generated: the figures are queried, shaped
 * into columns and rows, and stored on the row. Three things follow from that:
 *
 *   • the download endpoint has something real to serve, as CSV or JSON;
 *   • a report opened months later shows the figures as they stood when it was
 *     run, which is the whole point of generating one rather than looking at a
 *     live screen;
 *   • the row count is known, so the page can say "142 rows" instead of
 *     implying a file exists and letting the user discover otherwise.
 */

import { query } from "../config/db";

export interface ReportSection {
  title: string;
  /** Column headings, in order. */
  columns: string[];
  /** Rows, each aligned to `columns`. */
  rows: Array<Array<string | number | null>>;
  /** Optional one-line summary shown above the table. */
  note?: string;
}

export interface ReportContent {
  title: string;
  type: string;
  cooperativeName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  summary: Array<{ label: string; value: string }>;
  sections: ReportSection[];
  rowCount: number;
}

const money = (v: unknown) => `RWF ${Math.round(Number(v ?? 0)).toLocaleString()}`;
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");

/**
 * Builds one report from live data.
 *
 * `cooperativeId` may be null for a district-wide report; each builder handles
 * that by widening its scope rather than returning nothing.
 */
export async function buildReport(options: {
  type: string;
  title: string;
  cooperativeId: string | null;
  from: string;
  to: string;
}): Promise<ReportContent> {
  const { type, cooperativeId, from, to } = options;

  const coop = cooperativeId
    ? await query(`SELECT name FROM cooperatives WHERE id = $1`, [cooperativeId])
    : null;
  const cooperativeName = coop?.rows[0]?.name ?? null;

  // Every builder is scoped the same way: to one cooperative when given, to
  // the whole district when not.
  const scope = cooperativeId ? "AND t.cooperative_id = $3" : "";
  const scopeParams = cooperativeId ? [from, to, cooperativeId] : [from, to];

  const base: Omit<ReportContent, "summary" | "sections" | "rowCount"> = {
    title: options.title,
    type,
    cooperativeName,
    periodFrom: from,
    periodTo: to,
    generatedAt: new Date().toISOString(),
  };

  switch (type) {
    case "financial_summary": {
      const [totals, byCategory, transactions] = await Promise.all([
        query(
          `SELECT
             COALESCE(SUM(amount) FILTER (WHERE type='income'),0)  AS income,
             COALESCE(SUM(amount) FILTER (WHERE type='expense'),0) AS expense,
             COUNT(*) AS n
             FROM transactions t
            WHERE t.status='completed' AND t.date BETWEEN $1 AND $2 ${scope}`,
          scopeParams
        ),
        query(
          `SELECT t.category, t.type, COALESCE(SUM(t.amount),0) AS total, COUNT(*) AS n
             FROM transactions t
            WHERE t.status='completed' AND t.date BETWEEN $1 AND $2 ${scope}
            GROUP BY t.category, t.type ORDER BY total DESC`,
          scopeParams
        ),
        query(
          `SELECT t.date, t.type, t.category, t.description, t.amount, c.name AS coop
             FROM transactions t JOIN cooperatives c ON c.id = t.cooperative_id
            WHERE t.status='completed' AND t.date BETWEEN $1 AND $2 ${scope}
            ORDER BY t.date DESC LIMIT 500`,
          scopeParams
        ),
      ]);

      const income = Number(totals.rows[0].income);
      const expense = Number(totals.rows[0].expense);

      return {
        ...base,
        summary: [
          { label: "Total income", value: money(income) },
          { label: "Total expenses", value: money(expense) },
          { label: "Net position", value: money(income - expense) },
          { label: "Transactions", value: String(totals.rows[0].n) },
        ],
        sections: [
          {
            title: "By category",
            columns: ["Category", "Type", "Total", "Transactions"],
            rows: byCategory.rows.map((r) => [
              r.category ?? "Uncategorised",
              r.type,
              money(r.total),
              Number(r.n),
            ]),
          },
          {
            title: "Transactions",
            note: "Most recent first, capped at 500 rows.",
            columns: ["Date", "Cooperative", "Type", "Category", "Description", "Amount"],
            rows: transactions.rows.map((r) => [
              day(r.date),
              r.coop,
              r.type,
              r.category ?? "",
              r.description ?? "",
              money(r.amount),
            ]),
          },
        ],
        rowCount: byCategory.rowCount! + transactions.rowCount!,
      };
    }

    case "member_activity": {
      const memberScope = cooperativeId ? "AND m.cooperative_id = $3" : "";
      const rows = await query(
        `SELECT m.full_name, m.membership_number, c.name AS coop, m.status,
                m.total_savings, m.membership_date,
                (SELECT COUNT(*) FROM member_contributions mc
                  WHERE mc.member_id = m.id AND mc.date BETWEEN $1 AND $2) AS contributions,
                (SELECT COUNT(*) FROM activity_participants ap
                   JOIN activities a ON a.id = ap.activity_id
                  WHERE ap.member_id = m.id AND ap.attended
                    AND a.date BETWEEN $1 AND $2) AS attended
           FROM members m JOIN cooperatives c ON c.id = m.cooperative_id
          WHERE m.deleted_at IS NULL ${memberScope}
          ORDER BY m.full_name`,
        cooperativeId ? [from, to, cooperativeId] : [from, to]
      );

      const active = rows.rows.filter((r) => Number(r.contributions) > 0).length;
      return {
        ...base,
        summary: [
          { label: "Members on the register", value: String(rows.rowCount) },
          { label: "Contributed in period", value: String(active) },
          {
            label: "Participation",
            value: rows.rowCount ? `${Math.round((active / rows.rowCount) * 100)}%` : "—",
          },
        ],
        sections: [
          {
            title: "Members",
            columns: [
              "Name", "Membership no.", "Cooperative", "Status", "Joined",
              "Savings", "Contributions in period", "Activities attended",
            ],
            rows: rows.rows.map((r) => [
              r.full_name, r.membership_number, r.coop, r.status, day(r.membership_date),
              money(r.total_savings), Number(r.contributions), Number(r.attended),
            ]),
          },
        ],
        rowCount: rows.rowCount!,
      };
    }

    case "savings_growth": {
      const monthScope = cooperativeId ? "AND m.cooperative_id = $3" : "";
      const rows = await query(
        `SELECT DATE_TRUNC('month', mc.date)::date AS month,
                COALESCE(SUM(mc.amount),0) AS total,
                COUNT(DISTINCT mc.member_id) AS contributors
           FROM member_contributions mc JOIN members m ON m.id = mc.member_id
          WHERE m.deleted_at IS NULL AND mc.date BETWEEN $1 AND $2 ${monthScope}
          GROUP BY 1 ORDER BY 1`,
        cooperativeId ? [from, to, cooperativeId] : [from, to]
      );
      const total = rows.rows.reduce((sum, r) => sum + Number(r.total), 0);
      return {
        ...base,
        summary: [
          { label: "Contributed in period", value: money(total) },
          { label: "Months covered", value: String(rows.rowCount) },
        ],
        sections: [
          {
            title: "Month by month",
            columns: ["Month", "Contributed", "Contributing members"],
            rows: rows.rows.map((r) => [
              String(r.month).slice(0, 7),
              money(r.total),
              Number(r.contributors),
            ]),
          },
        ],
        rowCount: rows.rowCount!,
      };
    }

    case "loan_performance": {
      const loanScope = cooperativeId ? "AND m.cooperative_id = $3" : "";
      const rows = await query(
        `SELECT m.full_name, c.name AS coop, l.amount, l.balance, l.status,
                l.issued_at, l.due_at, l.purpose
           FROM loan_records l
           JOIN members m ON m.id = l.member_id
           JOIN cooperatives c ON c.id = m.cooperative_id
          WHERE m.deleted_at IS NULL
            AND l.issued_at >= $1::date AND l.issued_at < ($2::date + 1) ${loanScope}
          ORDER BY l.issued_at DESC`,
        cooperativeId ? [from, to, cooperativeId] : [from, to]
      );
      const disbursed = rows.rows.reduce((s, r) => s + Number(r.amount), 0);
      const outstanding = rows.rows.reduce((s, r) => s + Number(r.balance), 0);
      const overdue = rows.rows.filter((r) => r.status === "overdue").length;
      return {
        ...base,
        summary: [
          { label: "Loans issued", value: String(rows.rowCount) },
          { label: "Total disbursed", value: money(disbursed) },
          { label: "Still outstanding", value: money(outstanding) },
          { label: "Overdue", value: String(overdue) },
        ],
        sections: [
          {
            title: "Loans",
            columns: [
              "Member", "Cooperative", "Issued", "Due", "Purpose",
              "Amount", "Balance", "Status",
            ],
            rows: rows.rows.map((r) => [
              r.full_name, r.coop, day(r.issued_at), day(r.due_at), r.purpose ?? "",
              money(r.amount), money(r.balance), r.status,
            ]),
          },
        ],
        rowCount: rows.rowCount!,
      };
    }

    case "compliance": {
      const rows = await query(
        `SELECT c.name, c.sector, c.status, c.health_score,
                (SELECT COUNT(*) FROM members m
                  WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS members,
                (SELECT p.permit_type FROM cooperative_permits p
                  WHERE p.cooperative_id = c.id AND p.status='active'
                  ORDER BY p.expires_on DESC LIMIT 1) AS permit,
                (SELECT p.expires_on FROM cooperative_permits p
                  WHERE p.cooperative_id = c.id AND p.status='active'
                  ORDER BY p.expires_on DESC LIMIT 1) AS permit_expires,
                (SELECT a.band FROM cooperative_monthly_audits a
                  WHERE a.cooperative_id = c.id ORDER BY a.period DESC LIMIT 1) AS band
           FROM cooperatives c
          WHERE c.deleted_at IS NULL ${cooperativeId ? "AND c.id = $1" : ""}
          ORDER BY c.name`,
        cooperativeId ? [cooperativeId] : []
      );
      const unlicensed = rows.rows.filter((r) => !r.permit).length;
      return {
        ...base,
        periodFrom: null,
        periodTo: null,
        summary: [
          { label: "Cooperatives", value: String(rows.rowCount) },
          { label: "No permit in force", value: String(unlicensed) },
          {
            label: "Flagged at risk",
            value: String(rows.rows.filter((r) => ["at_risk", "critical"].includes(r.band)).length),
          },
        ],
        sections: [
          {
            title: "Compliance position",
            columns: [
              "Cooperative", "Sector", "Status", "Members", "Permit",
              "Permit expires", "Health score", "Latest audit band",
            ],
            rows: rows.rows.map((r) => [
              r.name, r.sector, r.status, Number(r.members),
              r.permit ?? "NONE", day(r.permit_expires),
              Number(r.health_score), r.band ?? "not assessed",
            ]),
          },
        ],
        rowCount: rows.rowCount!,
      };
    }

    default: {
      // An honest empty report beats a fabricated one. The type is valid but
      // has no builder yet, and the report says exactly that rather than
      // inventing rows.
      return {
        ...base,
        summary: [{ label: "Status", value: "No builder for this report type yet" }],
        sections: [
          {
            title: "Not available",
            columns: ["Detail"],
            rows: [
              [
                `"${type}" is a recognised report type but no data builder has been written for ` +
                  "it, so this report has no contents. Nothing has been fabricated.",
              ],
            ],
          },
        ],
        rowCount: 0,
      };
    }
  }
}

/** Renders a built report as CSV — one block per section. */
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

  for (const item of content.summary) lines.push([esc(item.label), esc(item.value)].join(","));
  lines.push("");

  for (const section of content.sections) {
    lines.push(esc(section.title));
    if (section.note) lines.push(esc(section.note));
    lines.push(section.columns.map(esc).join(","));
    for (const row of section.rows) lines.push(row.map(esc).join(","));
    lines.push("");
  }

  return lines.join("\n");
}
