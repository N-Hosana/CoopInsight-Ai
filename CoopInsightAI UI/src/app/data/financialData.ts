export interface Transaction {
  id: string;
  type: "Income" | "Expense" | "Loan" | "Savings" | "Dividend";
  description: string;
  amount: number;
  date: string;
  status: "Completed" | "Pending" | "Failed";
  category: string;
  cooperative?: string;
  cooperativeId?: string;
  memberId?: string;
  memberName?: string;
  auditTrail?: string;
  reference?: string;
}

export interface MemberContribution {
  id: string;
  name: string;
  role: string;
  contribution: number;
  cooperative: string;
  cooperativeId: string;
  phone: string;
  status: "Active" | "Probation" | "Inactive";
  lastContribution: string;
  joinDate: string;
  membershipFee: number;
  loanBalance: number;
  savingsBalance: number;
}

export interface LoanRecord {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  date: string;
  dueDate: string;
  status: "Active" | "Paid" | "Overdue";
  interestRate: number;
  amountPaid: number;
  cooperative?: string;
  cooperativeId?: string;
}

export interface DividendRecord {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  date: string;
  status: "Pending" | "Distributed";
  period: string;
  cooperative?: string;
  cooperativeId?: string;
}

export interface CommunicationLog {
  id: string;
  memberId: string;
  memberName: string;
  type: "SMS" | "Email" | "In-Person" | "Phone";
  message: string;
  date: string;
  status: "Sent" | "Received" | "Pending";
}

export interface FinancialPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "Open" | "Closed";
  totalIncome: number;
  totalExpenses: number;
}

export interface BalanceSheet {
  period: string;
  assets: number;
  liabilities: number;
  equity: number;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
}

export interface ActivityPerformance {
  id: string;
  activityId: string;
  activityName: string;
  date: string;
  resourcesUtilized: number;
  resourcesAllocated: number;
  participantsCount: number;
  outcome: string;
  impact: string;
  status: "Planned" | "Ongoing" | "Completed";
}

export const transactions: Transaction[] = [
  {
    id: "1",
    type: "Income",
    description: "Member Contribution - March",
    amount: 2500000,
    date: "2026-04-25",
    status: "Completed",
    category: "Member Contribution",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    memberId: "member-1",
    memberName: "Sarah Johnson",
    auditTrail: "Recorded by David Mugisha",
    reference: "CONTRIB-001",
  },
  {
    id: "2",
    type: "Expense",
    description: "Office Supplies Purchase",
    amount: 350000,
    date: "2026-04-24",
    status: "Completed",
    category: "Operations",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    auditTrail: "Approved by Manager",
    reference: "EXP-001",
  },
  {
    id: "3",
    type: "Loan",
    description: "Loan Disbursement - Maria K.",
    amount: 1200000,
    date: "2026-04-23",
    status: "Completed",
    category: "Member Loan",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    memberId: "member-4",
    memberName: "Maria Garcia",
    auditTrail: "Approved by Treasurer",
    reference: "LOAN-001",
  },
  {
    id: "4",
    type: "Income",
    description: "Product Sales Revenue",
    amount: 4800000,
    date: "2026-04-22",
    status: "Completed",
    category: "Sales",
    cooperative: "Artisan Crafts Collective",
    cooperativeId: "coop-2",
    auditTrail: "Recorded by Finance Officer",
    reference: "SALES-001",
  },
  {
    id: "5",
    type: "Expense",
    description: "Training Workshop Expenses",
    amount: 600000,
    date: "2026-04-20",
    status: "Pending",
    category: "Training",
    cooperative: "Southern Dairy Cooperative",
    cooperativeId: "coop-3",
    auditTrail: "Pending approval from Manager",
    reference: "EXP-002",
  },
  {
    id: "6",
    type: "Dividend",
    description: "Q1 2026 Dividend Distribution",
    amount: 450000,
    date: "2026-04-18",
    status: "Completed",
    category: "Dividend",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    memberId: "member-1",
    memberName: "Sarah Johnson",
    auditTrail: "Distributed by Treasurer",
    reference: "DIV-001",
  },
  {
    id: "7",
    type: "Savings",
    description: "Member Savings Deposit",
    amount: 150000,
    date: "2026-04-17",
    status: "Completed",
    category: "Savings",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    memberId: "member-2",
    memberName: "Lisa Thompson",
    auditTrail: "Recorded by Cashier",
    reference: "SAV-001",
  },
];

export const members: MemberContribution[] = [
  {
    id: "member-1",
    name: "Sarah Johnson",
    role: "Producer",
    contribution: 2500000,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123456",
    status: "Active",
    lastContribution: "2026-04-25",
    joinDate: "2024-02-15",
    membershipFee: 50000,
    loanBalance: 0,
    savingsBalance: 750000,
  },
  {
    id: "member-2",
    name: "Lisa Thompson",
    role: "Coordinator",
    contribution: 2100000,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123457",
    status: "Active",
    lastContribution: "2026-04-20",
    joinDate: "2023-05-10",
    membershipFee: 50000,
    loanBalance: 500000,
    savingsBalance: 600000,
  },
  {
    id: "member-3",
    name: "Robert Martinez",
    role: "Producer",
    contribution: 1800000,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123458",
    status: "Active",
    lastContribution: "2026-04-22",
    joinDate: "2023-08-20",
    membershipFee: 50000,
    loanBalance: 800000,
    savingsBalance: 450000,
  },
  {
    id: "member-4",
    name: "Maria Garcia",
    role: "Producer",
    contribution: 0,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123459",
    status: "Inactive",
    lastContribution: "2026-03-12",
    joinDate: "2023-12-05",
    membershipFee: 50000,
    loanBalance: 1200000,
    savingsBalance: 200000,
  },
];

export const loanRecords: LoanRecord[] = [
  {
    id: "loan-1",
    memberId: "member-2",
    memberName: "Lisa Thompson",
    amount: 500000,
    date: "2026-02-15",
    dueDate: "2026-08-15",
    status: "Active",
    interestRate: 10,
    amountPaid: 0,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
  {
    id: "loan-2",
    memberId: "member-3",
    memberName: "Robert Martinez",
    amount: 800000,
    date: "2026-01-20",
    dueDate: "2026-07-20",
    status: "Active",
    interestRate: 10,
    amountPaid: 200000,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
  {
    id: "loan-3",
    memberId: "member-4",
    memberName: "Maria Garcia",
    amount: 1200000,
    date: "2026-04-23",
    dueDate: "2026-10-23",
    status: "Active",
    interestRate: 10,
    amountPaid: 0,
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
];

export const dividendRecords: DividendRecord[] = [
  {
    id: "div-1",
    memberId: "member-1",
    memberName: "Sarah Johnson",
    amount: 450000,
    date: "2026-04-18",
    status: "Distributed",
    period: "Q1 2026",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
  {
    id: "div-2",
    memberId: "member-2",
    memberName: "Lisa Thompson",
    amount: 400000,
    date: "2026-04-18",
    status: "Distributed",
    period: "Q1 2026",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
  {
    id: "div-3",
    memberId: "member-3",
    memberName: "Robert Martinez",
    amount: 380000,
    date: "2026-04-18",
    status: "Distributed",
    period: "Q1 2026",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
  },
];

export const communicationLogs: CommunicationLog[] = [
  {
    id: "comm-1",
    memberId: "member-1",
    memberName: "Sarah Johnson",
    type: "SMS",
    message: "Your membership fee is due. Please pay before month end.",
    date: "2026-04-20",
    status: "Sent",
  },
  {
    id: "comm-2",
    memberId: "member-2",
    memberName: "Lisa Thompson",
    type: "Email",
    message: "Loan payment reminder - Due on 2026-08-15",
    date: "2026-04-19",
    status: "Sent",
  },
  {
    id: "comm-3",
    memberId: "member-1",
    memberName: "Sarah Johnson",
    type: "In-Person",
    message: "Attended member meeting and provided feedback",
    date: "2026-04-15",
    status: "Received",
  },
];

export const financialPeriods: FinancialPeriod[] = [
  {
    id: "period-1",
    name: "Q1 2026",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    status: "Closed",
    totalIncome: 12700000,
    totalExpenses: 5200000,
  },
  {
    id: "period-2",
    name: "Q2 2026",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    status: "Open",
    totalIncome: 7300000,
    totalExpenses: 1400000,
  },
];

export const balanceSheets: BalanceSheet[] = [
  {
    period: "Q1 2026",
    assets: 45000000,
    liabilities: 8000000,
    equity: 37000000,
    totalIncome: 12700000,
    totalExpenses: 5200000,
    netProfit: 7500000,
  },
  {
    period: "Q2 2026 (Current)",
    assets: 52300000,
    liabilities: 7200000,
    equity: 45100000,
    totalIncome: 7300000,
    totalExpenses: 1400000,
    netProfit: 5900000,
  },
];

export const activityPerformance: ActivityPerformance[] = [
  {
    id: "perf-1",
    activityId: "1",
    activityName: "Monthly Cooperative Meeting",
    date: "2026-05-10",
    resourcesUtilized: 8500000,
    resourcesAllocated: 10000000,
    participantsCount: 45,
    outcome: "Discussed financial performance and member concerns",
    impact: "Members voted on new cooperative policies",
    status: "Completed",
  },
  {
    id: "perf-2",
    activityId: "2",
    activityName: "Training Workshop",
    date: "2026-04-15",
    resourcesUtilized: 5500000,
    resourcesAllocated: 6000000,
    participantsCount: 32,
    outcome: "30 members trained on new production techniques",
    impact: "Expected 25% increase in production yield",
    status: "Completed",
  },
];

export const savingsBalance = 32750000;
export const activeLoanBalance = 12300000;

export const formatFrw = (value: number) => `RWF ${value.toLocaleString("en-RW")}`;

export const getFinancialStats = () => {
  const totalIncome = transactions.filter((item) => item.type === "Income").reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = transactions.filter((item) => item.type === "Expense").reduce((sum, item) => sum + item.amount, 0);
  const totalLoans = transactions.filter((item) => item.type === "Loan").reduce((sum, item) => sum + item.amount, 0);
  const totalDividends = transactions.filter((item) => item.type === "Dividend").reduce((sum, item) => sum + item.amount, 0);
  const totalSavings = transactions.filter((item) => item.type === "Savings").reduce((sum, item) => sum + item.amount, 0);
  const netProfit = totalIncome - totalExpenses;
  return {
    totalIncome,
    totalExpenses,
    totalLoans,
    totalDividends,
    totalSavings,
    netProfit,
  };
};

export const getMemberLoanHistory = (memberId: string) => {
  return loanRecords.filter((loan) => loan.memberId === memberId);
};

export const getMemberDividendHistory = (memberId: string) => {
  return dividendRecords.filter((div) => div.memberId === memberId);
};

export const getMemberCommunicationLog = (memberId: string) => {
  return communicationLogs.filter((log) => log.memberId === memberId);
};

export const getMemberContributionHistory = (memberId: string) => {
  return transactions.filter(
    (trans) =>
      trans.memberId === memberId &&
      (trans.type === "Income" || trans.type === "Savings")
  );
};
