/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A DEPARTING MEMBER IS OWED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member is a co-owner. When they leave, three things have to happen before
 * the cooperative may take them off the register:
 *
 *   1. their own money comes back    — savings, share capital, special levies
 *   2. their share of what the cooperative accumulated is valued
 *   3. what they still owe is deducted
 *
 * This module owns that arithmetic. It was previously inline in the membership
 * route and only ever used to SHOW an indicative figure on screen; it now backs
 * both the on-screen estimate and the settlement the cooperative records
 * against the member's exit, so the two can never disagree.
 *
 * The order is deliberate and is stated in the response, because a member who
 * is told "RWF 0" is entitled to see which line produced it.
 */

import { query } from "../config/db";

export interface SettlementLine {
  label: string;
  amount: number;
  note: string;
}

export interface Settlement {
  member: {
    id: string;
    fullName: string;
    membershipNumber: string | null;
    membershipDate: string | null;
  };
  cooperative: {
    id: string;
    name: string;
    memberCount: number;
    totalMemberSavings: number;
    shareCapital: number;
  };
  ownFunds: {
    savings: number;
    shareCapital: number;
    specialLevies: number;
    total: number;
  };
  shareOfCooperative: {
    distributableNetWorth: number;
    sharePercentage: number;
    amount: number;
    basis: string;
    estimated: boolean;
  };
  deductions: { outstandingLoans: number; total: number };
  grossEntitlement: number;
  netPayable: number;
  balanceOwedToCooperative: number;
  /** The calculation read top to bottom, for the member's statement. */
  lines: SettlementLine[];
  warnings: string[];
  disclaimer: string;
  calculatedAt: string;
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Prices one member's exit from the records currently held.
 *
 * Returns null when the member or the cooperative cannot be found, which the
 * caller turns into a 404 — the calculation itself never guesses.
 */
export async function calculateSettlement(
  memberId: string,
  cooperativeId: string
): Promise<Settlement | null> {
  const [memberRes, coopRes, contribRes, coopContribRes, loanRes, balanceRes, surplusRes] =
    await Promise.all([
      query(
        `SELECT id, full_name, membership_number, membership_date, total_savings, total_contributions
           FROM members WHERE id = $1`,
        [memberId]
      ),
      query(
        `SELECT id, name, total_savings,
                (SELECT COUNT(*) FROM members m
                  WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count
           FROM cooperatives c WHERE c.id = $1`,
        [cooperativeId]
      ),
      query(
        `SELECT type, COALESCE(SUM(amount),0) AS total
           FROM member_contributions WHERE member_id = $1 GROUP BY type`,
        [memberId]
      ),
      query(
        `SELECT COALESCE(SUM(mc.amount),0) AS total
           FROM member_contributions mc
           JOIN members m ON m.id = mc.member_id
          WHERE m.cooperative_id = $1 AND mc.type = 'share_capital'`,
        [cooperativeId]
      ),
      query(
        `SELECT COALESCE(SUM(balance),0) AS outstanding
           FROM loan_records
          WHERE member_id = $1 AND status IN ('active','overdue')`,
        [memberId]
      ),
      query(
        `SELECT cash, bank_balance, inventory, fixed_assets, loans_outstanding,
                external_loans, accounts_payable, member_savings, share_capital,
                retained_earnings, period_end
           FROM balance_sheets WHERE cooperative_id = $1
          ORDER BY period_end DESC LIMIT 1`,
        [cooperativeId]
      ),
      query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)  AS income,
           COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
           FROM transactions WHERE cooperative_id = $1 AND status = 'completed'`,
        [cooperativeId]
      ),
    ]);

  if (memberRes.rowCount === 0 || coopRes.rowCount === 0) return null;

  const member = memberRes.rows[0];
  const coop = coopRes.rows[0];

  const byType: Record<string, number> = {};
  for (const row of contribRes.rows) byType[row.type] = num(row.total);
  const savingsContributions = byType.savings ?? 0;
  const shareCapital = byType.share_capital ?? 0;
  const specialLevies = byType.special_levy ?? 0;

  // members.total_savings is the running balance the cooperative reports; the
  // contributions ledger may be incomplete, so take whichever is higher.
  const memberSavings = Math.max(num(member.total_savings), savingsContributions);

  const cooperativeShareCapital = num(coopContribRes.rows[0]?.total);
  const outstandingLoans = num(loanRes.rows[0]?.outstanding);

  let netWorth: number;
  let netWorthBasis: string;
  let estimated: boolean;
  const balance = balanceRes.rows[0];

  if (balance) {
    const assets =
      num(balance.cash) +
      num(balance.bank_balance) +
      num(balance.inventory) +
      num(balance.fixed_assets) +
      num(balance.loans_outstanding);
    const liabilities =
      num(balance.external_loans) + num(balance.accounts_payable) + num(balance.member_savings);
    netWorth = assets - liabilities;
    netWorthBasis =
      `Latest balance sheet, period ending ` +
      `${new Date(balance.period_end).toISOString().slice(0, 10)}: assets RWF ` +
      `${assets.toLocaleString()} less liabilities RWF ${liabilities.toLocaleString()}.`;
    estimated = false;
  } else {
    const income = num(surplusRes.rows[0]?.income);
    const expense = num(surplusRes.rows[0]?.expense);
    netWorth = income - expense - num(coop.total_savings);
    netWorthBasis =
      `No balance sheet on file. Estimated from completed transactions: income RWF ` +
      `${income.toLocaleString()} less expenses RWF ${expense.toLocaleString()}, less members' ` +
      `savings of RWF ${num(coop.total_savings).toLocaleString()} which are owed back to members.`;
    estimated = true;
  }

  const distributableNetWorth = Math.max(0, netWorth);
  const sharePercentage = cooperativeShareCapital > 0 ? shareCapital / cooperativeShareCapital : 0;
  const shareOfNetWorth = Math.round(distributableNetWorth * sharePercentage);

  const ownFunds = memberSavings + shareCapital + specialLevies;
  const grossEntitlement = ownFunds + shareOfNetWorth;
  const netPayable = Math.max(0, grossEntitlement - outstandingLoans);

  const warnings: string[] = [];
  if (cooperativeShareCapital === 0) {
    warnings.push(
      "No share capital contributions are recorded for this cooperative, so no share of retained " +
        "value can be attributed. Only the member's own funds are payable."
    );
  }
  if (estimated) {
    warnings.push(
      "No balance sheet has been filed, so the cooperative's net worth is estimated from " +
        "transaction history. File a balance sheet for an accurate figure."
    );
  }
  if (netWorth < 0) {
    warnings.push(
      `The cooperative's net worth is negative (RWF ${Math.round(netWorth).toLocaleString()}), so ` +
        "no surplus is distributable. Members may still be liable for losses under the bylaws."
    );
  }
  if (outstandingLoans > 0) {
    warnings.push(
      `RWF ${outstandingLoans.toLocaleString()} of outstanding loans must be settled and has been deducted.`
    );
  }
  if (outstandingLoans > grossEntitlement) {
    warnings.push(
      `Outstanding loans exceed the member's entitlement by RWF ` +
        `${Math.round(outstandingLoans - grossEntitlement).toLocaleString()}. The member owes this ` +
        "balance to the cooperative."
    );
  }

  const lines: SettlementLine[] = [
    {
      label: "Savings held for the member",
      amount: memberSavings,
      note: "Everything the member paid in as savings and has not withdrawn.",
    },
    {
      label: "Share capital",
      amount: shareCapital,
      note: "The member's shares in the cooperative, refunded at their paid-in value.",
    },
    {
      label: "Special levies paid",
      amount: specialLevies,
      note: "One-off levies the member contributed on top of savings and shares.",
    },
    {
      label: "Share of the cooperative's accumulated value",
      amount: shareOfNetWorth,
      note:
        `${(sharePercentage * 100).toFixed(4)}% of RWF ` +
        `${distributableNetWorth.toLocaleString()} distributable net worth. ${netWorthBasis}`,
    },
    {
      label: "Less: outstanding loans",
      amount: -outstandingLoans,
      note: "Loan balances the member still owes the cooperative, netted off what is due to them.",
    },
  ];

  return {
    member: {
      id: member.id,
      fullName: member.full_name,
      membershipNumber: member.membership_number,
      membershipDate: member.membership_date,
    },
    cooperative: {
      id: coop.id,
      name: coop.name,
      memberCount: Number(coop.member_count),
      totalMemberSavings: num(coop.total_savings),
      shareCapital: cooperativeShareCapital,
    },
    ownFunds: {
      savings: memberSavings,
      shareCapital,
      specialLevies,
      total: ownFunds,
    },
    shareOfCooperative: {
      distributableNetWorth,
      sharePercentage: Number((sharePercentage * 100).toFixed(4)),
      amount: shareOfNetWorth,
      basis: netWorthBasis,
      estimated,
    },
    deductions: { outstandingLoans, total: outstandingLoans },
    grossEntitlement,
    netPayable,
    balanceOwedToCooperative: Math.max(0, outstandingLoans - grossEntitlement),
    lines,
    warnings,
    disclaimer:
      "Indicative figure computed from the records currently held in CoopInsight. The amount " +
      "actually paid is set by the cooperative's bylaws and its audited accounts at the date of exit.",
    calculatedAt: new Date().toISOString(),
  };
}

/** How a settlement may be paid. Mirrors the CHECK constraint on the table. */
export const SETTLEMENT_METHODS = [
  "mobile_money",
  "bank_transfer",
  "cash",
  "donated_to_cooperative",
  "offset_against_loan",
  "nothing_due",
] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = {
  mobile_money: "Paid by mobile money",
  bank_transfer: "Paid by bank transfer",
  cash: "Paid in cash against a signed receipt",
  donated_to_cooperative: "Left to the cooperative at the member's request",
  offset_against_loan: "Set off against the member's outstanding loan",
  nothing_due: "Nothing was due either way",
};

/**
 * Which member instruction maps to which payment method, so the cooperative is
 * not asked to re-choose something the member already told them.
 */
export const INSTRUCTION_TO_METHOD: Record<string, SettlementMethod> = {
  refund_mobile_money: "mobile_money",
  refund_bank_transfer: "bank_transfer",
  refund_cash: "cash",
  donate_to_cooperative: "donated_to_cooperative",
  no_savings_held: "nothing_due",
};
