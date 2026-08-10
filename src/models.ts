// User & Auth
export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  phone?: string;
  nationalId?: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string;
  cooperativeName?: string;
}

// Cooperative
export interface Leadership {
  chairperson: string;
  chairpersonEmail?: string;
  chairpersonPhone?: string;
  treasurer: string;
  treasurerEmail?: string;
  treasurerPhone?: string;
  secretary: string;
  secretaryEmail?: string;
  secretaryPhone?: string;
}

export interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

export interface Cooperative {
  id: string;
  name: string;
  registrationNumber: string;
  district: string;
  sector: string;
  cell?: string;
  type: string;
  status: "Active" | "Pending" | "Inactive";
  operatingArea: string;
  membershipSize: number;
  registrationDate: string;
  healthScore: number;
  totalRevenue: string;
  leadership: Leadership;
  documents: CooperativeDocument[];
  bylawsFileName?: string;
  licenseFileName?: string;
  permitsFileName?: string;
}

// Member
export interface Member {
  id: string;
  cooperativeId: string;
  name: string;
  email: string;
  phone: string;
  nationalId: string;
  role: string;
  contribution: string;
  status: "Active" | "Probation" | "Inactive";
  joinDate: string;
}

// Transaction
export interface Transaction {
  id: string;
  cooperativeId: string;
  category: string;
  type: "income" | "expense";
  amount: number;
  date: string;
  description: string;
}

// Activity
export interface Activity {
  id: string;
  cooperativeId: string;
  type: "meeting" | "training" | "production" | "sales" | "distribution" | "planning";
  title: string;
  date: string;
  status: "Planned" | "Scheduled" | "Completed" | "Cancelled";
  details: string;
}

// Report
export interface Report {
  id: string;
  cooperativeId: string;
  type: "financial" | "member_engagement" | "compliance" | "health_score";
  title: string;
  generatedAt: string;
  data: Record<string, any>;
}
