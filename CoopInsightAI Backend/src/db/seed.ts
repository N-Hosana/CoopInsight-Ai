import bcrypt from "bcrypt";
import { query } from "../config/db";
import dotenv from "dotenv";

dotenv.config();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function insertCooperative(data: {
  name: string; type: string; sector: string; cell: string; village: string;
  registrationNumber: string; registrationDate: string; description: string;
  phone: string; email: string; address: string;
  totalSavings: number; healthScore: number;
}) {
  const res = await query(
    `INSERT INTO cooperatives
       (name, type, sector, cell, village, registration_number, registration_date,
        description, phone, email, address, status, total_savings, health_score, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13,NOW(),NOW())
     ON CONFLICT (registration_number) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description,
       total_savings = EXCLUDED.total_savings, health_score = EXCLUDED.health_score,
       updated_at = NOW()
     RETURNING id`,
    [data.name, data.type, data.sector, data.cell, data.village,
     data.registrationNumber, data.registrationDate, data.description,
     data.phone, data.email, data.address, data.totalSavings, data.healthScore]
  );
  return res.rows[0].id as string;
}

async function insertLeadership(coopId: string, leaders: { name: string; role: string; phone: string; email: string }[]) {
  const existing = await query(`SELECT COUNT(*) FROM cooperative_leadership WHERE cooperative_id = $1`, [coopId]);
  if (parseInt(existing.rows[0].count) > 0) return;
  for (const l of leaders) {
    await query(
      `INSERT INTO cooperative_leadership (cooperative_id, name, role, phone, email, start_date)
       VALUES ($1,$2,$3,$4,$5,'2020-01-01')`,
      [coopId, l.name, l.role, l.phone, l.email]
    );
  }
}

async function insertMember(coopId: string, m: {
  fullName: string; phone: string; nationalId: string; gender: string;
  sector: string; membershipNumber: string; membershipDate: string;
  role?: string; totalSavings?: number;
}) {
  const res = await query(
    `INSERT INTO members
       (cooperative_id, full_name, phone, national_id, gender, sector,
        membership_number, membership_date, role, status, total_savings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
     ON CONFLICT (national_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       membership_number = EXCLUDED.membership_number,
       cooperative_id = EXCLUDED.cooperative_id,
       role = EXCLUDED.role,
       total_savings = EXCLUDED.total_savings
     RETURNING id`,
    [coopId, m.fullName, m.phone, m.nationalId, m.gender, m.sector,
     m.membershipNumber, m.membershipDate, m.role ?? "member", m.totalSavings ?? 0]
  );
  return res.rows[0].id as string;
}

async function seedMembersByComposition(coopId: string, options: {
  targetCount: number;
  composition: "male" | "female" | "mixed";
  sector: string;
  baseYear: number;
  baseNamePrefix: string;
}) {
  const existingCountResult = await query(`SELECT COUNT(*) AS count FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL`, [coopId]);
  const existingCount = parseInt(existingCountResult.rows[0].count, 10);
  const remaining = Math.max(0, options.targetCount - existingCount);

  for (let index = 1; index <= remaining; index += 1) {
    const memberNumber = existingCount + index;
    const gender = options.composition === "male"
      ? "male"
      : options.composition === "female"
        ? "female"
        : (memberNumber % 2 === 0 ? "female" : "male");
    const fullName = `${options.baseNamePrefix} ${memberNumber}`;
    const phone = `+25078${String(300000 + memberNumber).padStart(6, "0")}`;
    const nationalId = `119${String(900000 + memberNumber).padStart(6, "0")}`;
    const membershipNumber = `MBR-${String(memberNumber).padStart(3, "0")}`;
    const membershipDate = `${options.baseYear}-${String((memberNumber % 12) + 1).padStart(2, "0")}-${String((memberNumber % 27) + 1).padStart(2, "0")}`;

    await insertMember(coopId, {
      fullName,
      phone,
      nationalId,
      gender,
      sector: options.sector,
      membershipNumber,
      membershipDate,
      role: memberNumber <= 3 ? (memberNumber === 1 ? "chairperson" : memberNumber === 2 ? "treasurer" : "secretary") : "member",
      totalSavings: (memberNumber * 12500) + (gender === "female" ? 5000 : 0),
    });
  }
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

// ─── Main seed ───────────────────────────────────────────────────────────────

async function seed() {
  console.log("Seeding database…\n");

  // ─── System users ──────────────────────────────────────────────────────────

  const adminHash    = await bcrypt.hash("Admin@1234",   12);
  const managerHash  = await bcrypt.hash("Manager@1234", 12);
  const memberHash   = await bcrypt.hash("Member@1234",  12);
  const govHash      = await bcrypt.hash("Gov@1234!",    12);

  await query(
    `INSERT INTO users (name, email, password_hash, role, email_verified, status)
     VALUES ($1,$2,$3,'admin',true,'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ["System Admin", "admin@coopinsight.rw", adminHash]
  );
  await query(
    `INSERT INTO users (name, email, password_hash, role, email_verified, status, sector)
     VALUES ($1,$2,$3,'government',true,'active','Kacyiru')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
    ["Gasabo RCA Officer", "gov@coopinsight.rw", govHash]
  );

  console.log("✓ Admin & Government users ready\n");

  // ─── Cooperative 1 — Gasabo Coffee Cooperative (existing) ─────────────────

  const c1Id = await insertCooperative({
    name: "Gasabo Coffee Cooperative",
    type: "Coffee", sector: "Kacyiru", cell: "Kacyiru", village: "Rugando",
    registrationNumber: "RCA/GASABO/2020/001",
    registrationDate: "2020-03-10",
    description: "Primary cooperative for coffee farmers in Kacyiru sector, Gasabo District. Members grow and process specialty Arabica coffee sold locally and for export.",
    phone: "+250788100001", email: "gasabo.coffee@coopinsight.rw",
    address: "Kacyiru Sector, Gasabo District, Kigali",
    totalSavings: 12500000, healthScore: 78,
  });

  await query(
    `INSERT INTO users (name, email, password_hash, role, cooperative_id, email_verified, status, sector)
     VALUES ($1,$2,$3,'manager',$4,true,'active','Kacyiru')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, cooperative_id = EXCLUDED.cooperative_id`,
    ["Cooperative Manager", "manager@coopinsight.rw", managerHash, c1Id]
  );
  await query(
    `INSERT INTO users (name, email, password_hash, role, cooperative_id, email_verified, status, sector)
     VALUES ($1,$2,$3,'member',$4,true,'active','Kacyiru')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, cooperative_id = EXCLUDED.cooperative_id`,
    ["Marie Claire Uwase", "member@coopinsight.rw", memberHash, c1Id]
  );

  await insertLeadership(c1Id, [
    { name: "Jean Damascène Uwimana", role: "Chairperson",  phone: "+250788200001", email: "jd.uwimana@coopinsight.rw" },
    { name: "Alexis Nzeyimana",       role: "Treasurer",    phone: "+250788200002", email: "alexis.nz@coopinsight.rw" },
    { name: "Chantal Mukamana",       role: "Secretary",    phone: "+250788200003", email: "chantal.mk@coopinsight.rw" },
  ]);

  const c1m1 = await insertMember(c1Id, { fullName: "Marie Claire Uwase",   phone: "+250788300001", nationalId: "1199780012345678", gender: "female", sector: "Kacyiru", membershipNumber: "MBR-C1-001", membershipDate: "2020-03-15", role: "member",      totalSavings: 450000 });
  const c1m2 = await insertMember(c1Id, { fullName: "Alexis Nzeyimana",     phone: "+250788300002", nationalId: "1199580012345679", gender: "male",   sector: "Kacyiru", membershipNumber: "MBR-C1-002", membershipDate: "2020-03-15", role: "treasurer",   totalSavings: 620000 });
  const c1m3 = await insertMember(c1Id, { fullName: "Diane Umukunzi",       phone: "+250788300003", nationalId: "1200080012345680", gender: "female", sector: "Kacyiru", membershipNumber: "MBR-C1-003", membershipDate: "2020-06-01", role: "member",      totalSavings: 310000 });
  const c1m4 = await insertMember(c1Id, { fullName: "Emmanuel Habimana",    phone: "+250788300004", nationalId: "1197280012345681", gender: "male",   sector: "Kacyiru", membershipNumber: "MBR-C1-004", membershipDate: "2021-01-10", role: "member",      totalSavings: 280000 });
  const c1m5 = await insertMember(c1Id, { fullName: "Solange Mukandayisenga", phone: "+250788300005", nationalId: "1199080012345682", gender: "female", sector: "Kacyiru", membershipNumber: "MBR-C1-005", membershipDate: "2021-03-20", role: "secretary", totalSavings: 395000 });
  await seedMembersByComposition(c1Id, { targetCount: 78, composition: "mixed", sector: "Kacyiru", baseYear: 2020, baseNamePrefix: "Gasabo Member" });

  const check1 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c1Id]);
  if (parseInt(check1.rows[0].count) === 0) {
    await insertActivity(c1Id, { title: "Coffee Harvest Planning Meeting", type: "meeting",    status: "completed", date: "2025-09-15", location: "Kacyiru Community Hall",      description: "Annual planning meeting to coordinate the 2025-26 coffee harvest schedule and assign member plots.", budget: 50000,  actualCost: 42000 });
    await insertActivity(c1Id, { title: "Post-Harvest Processing Training", type: "training",  status: "completed", date: "2025-10-20", location: "Kacyiru Washing Station",     description: "Training on wet and dry processing methods to improve cup quality and reduce defects.", budget: 120000, actualCost: 115000 });
    await insertActivity(c1Id, { title: "Q1 Financial Review",             type: "meeting",    status: "completed", date: "2026-01-12", location: "Cooperative Office, Kacyiru", description: "Quarterly financial review presenting income, expenses, and savings balances to all members.", budget: 20000,  actualCost: 18000 });
    await insertActivity(c1Id, { title: "Coffee Quality & Grading Workshop", type: "training", status: "planned",   date: "2026-07-10", location: "Kacyiru Washing Station",     description: "Hands-on grading workshop to prepare members for the upcoming export tender requirements.", budget: 150000, actualCost: 0 });
    await insertActivity(c1Id, { title: "Annual General Meeting 2026",       type: "meeting",   status: "planned",   date: "2026-08-05", location: "Kacyiru Sector Office",       description: "Yearly AGM to elect leadership, approve financial statements, and set objectives for 2027.", budget: 80000,  actualCost: 0 });
    await insertTransaction(c1Id, { type: "income",  category: "Coffee Sales",        amount: 4200000, date: "2025-11-30", description: "Coffee cherry sales to Rwashoscco cooperative hub — 2025 main harvest.",       paymentMethod: "bank_transfer" });
    await insertTransaction(c1Id, { type: "income",  category: "Member Contributions", amount: 1550000, date: "2026-01-15", description: "Q4 2025 member savings contributions — 5 active members.",                     paymentMethod: "mobile_money"  });
    await insertTransaction(c1Id, { type: "expense", category: "Inputs & Supplies",    amount: 680000,  date: "2025-08-10", description: "Fertiliser and pesticide purchase for 2025-26 crop season.",                   paymentMethod: "bank_transfer" });
    await insertTransaction(c1Id, { type: "expense", category: "Training",             amount: 115000,  date: "2025-10-22", description: "Post-harvest processing training facilitation fees.",                           paymentMethod: "mobile_money"  });
    await insertTransaction(c1Id, { type: "income",  category: "Grant",                amount: 2000000, date: "2025-06-01", description: "RDB cooperative support grant — infrastructure improvement fund.",              paymentMethod: "bank_transfer" });
    await insertHealthScore(c1Id, { overall: 78, financial: 80, engagement: 75, compliance: 82, docs: 70 });
  }
  console.log("✓ Gasabo Coffee Cooperative");

  // ─── Cooperative 2 — TWITE KU BUZIMA RUSORORO ─────────────────────────────

  const c2Id = await insertCooperative({
    name: "Twite Ku Buzima Rusororo", type: "Services", sector: "Rusororo",
    cell: "Nyagahinga", village: "Gisharara",
    registrationNumber: "RCA/0035/2014",
    registrationDate: "2014-01-20",
    description: "Youth cooperative providing community health advisory and hygiene promotion services in Rusororo sector. Offers home-visit health consultations, awareness campaigns, and basic first-aid training to 107 registered members and surrounding communities.",
    phone: "+250788401001", email: "twite.buzima@coopinsight.rw",
    address: "Nyagahinga Cell, Rusororo Sector, Gasabo District",
    totalSavings: 3210000, healthScore: 65,
  });

  await insertLeadership(c2Id, [
    { name: "Innocent Ndayishimiye", role: "Chairperson", phone: "+250788402001", email: "i.ndayishimiye@coopinsight.rw" },
    { name: "Vestine Nyiransengimana", role: "Treasurer", phone: "+250788402002", email: "v.nyiransengimana@coopinsight.rw" },
    { name: "Alain Nkurunziza",       role: "Secretary",  phone: "+250788402003", email: "a.nkurunziza@coopinsight.rw" },
  ]);

  const c2m1 = await insertMember(c2Id, { fullName: "Innocent Ndayishimiye",   phone: "+250788403001", nationalId: "1199281012345001", gender: "male",   sector: "Rusororo", membershipNumber: "MBR-C2-001", membershipDate: "2014-01-20", role: "chairperson", totalSavings: 45000  });
  const c2m2 = await insertMember(c2Id, { fullName: "Vestine Nyiransengimana", phone: "+250788403002", nationalId: "1199481012345002", gender: "female", sector: "Rusororo", membershipNumber: "MBR-C2-002", membershipDate: "2014-01-20", role: "treasurer",   totalSavings: 38000  });
  const c2m3 = await insertMember(c2Id, { fullName: "Pierre Gashumba",         phone: "+250788403003", nationalId: "1199681012345003", gender: "male",   sector: "Rusororo", membershipNumber: "MBR-C2-003", membershipDate: "2014-03-01", role: "member",      totalSavings: 30000  });
  const c2m4 = await insertMember(c2Id, { fullName: "Clarisse Murekatete",     phone: "+250788403004", nationalId: "1200181012345004", gender: "female", sector: "Rusororo", membershipNumber: "MBR-C2-004", membershipDate: "2015-06-10", role: "member",      totalSavings: 28000  });
  const c2m5 = await insertMember(c2Id, { fullName: "Fabrice Nsabimana",       phone: "+250788403005", nationalId: "1199881012345005", gender: "male",   sector: "Rusororo", membershipNumber: "MBR-C2-005", membershipDate: "2016-02-14", role: "member",      totalSavings: 25000  });
  await seedMembersByComposition(c2Id, { targetCount: 52, composition: "mixed", sector: "Rusororo", baseYear: 2014, baseNamePrefix: "Twite Member" });

  const check2 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c2Id]);
  if (parseInt(check2.rows[0].count) === 0) {
    await insertActivity(c2Id, { title: "Community Health Awareness Campaign", type: "meeting",   status: "completed", date: "2025-10-05", location: "Nyagahinga Community Centre",   description: "Door-to-door campaign covering malaria prevention, hygiene, and maternal health for 250 households.", budget: 80000, actualCost: 74000 });
    await insertActivity(c2Id, { title: "First Aid & Emergency Response Training", type: "training", status: "completed", date: "2026-02-20", location: "Rusororo Health Post",         description: "Red Cross–facilitated first-aid training for 40 cooperative health workers.", budget: 120000, actualCost: 118000 });
    await insertActivity(c2Id, { title: "Youth Health Volunteer Coordination Meeting", type: "meeting", status: "planned", date: "2026-07-18", location: "Rusororo Sector Office",       description: "Bi-annual coordination meeting to review outreach targets and plan H2 activities.", budget: 30000, actualCost: 0 });
    await insertTransaction(c2Id, { type: "income",  category: "Service Fees",         amount: 950000,  date: "2025-12-31", description: "Annual health consultation service fees collected from 95 members.",   paymentMethod: "mobile_money" });
    await insertTransaction(c2Id, { type: "income",  category: "Member Contributions",  amount: 640000,  date: "2026-01-20", description: "Member share contributions — 2026 Q1.",                               paymentMethod: "mobile_money" });
    await insertTransaction(c2Id, { type: "expense", category: "Medical Supplies",      amount: 210000,  date: "2026-01-05", description: "First-aid kits and hygiene materials for community outreach.",         paymentMethod: "mobile_money" });
    await insertTransaction(c2Id, { type: "expense", category: "Transport",             amount: 74000,   date: "2025-10-05", description: "Motorcycle transport hire for awareness campaign teams.",               paymentMethod: "cash" });
    await insertHealthScore(c2Id, { overall: 65, financial: 60, engagement: 70, compliance: 65, docs: 58 });
  }
  console.log("✓ Twite Ku Buzima Rusororo");

  // ─── Cooperative 3 — IJABO REMERA SACCO ───────────────────────────────────

  const c3Id = await insertCooperative({
    name: "Ijabo Remera SACCO (IRSACCO)", type: "Services", sector: "Remera",
    cell: "Rukiri II", village: "Amahoro",
    registrationNumber: "RCA/0496/2009",
    registrationDate: "2009-06-01",
    description: "Umurenge SACCO serving women entrepreneurs and residents in Remera sector. Provides savings accounts, affordable credit, and financial literacy training to over 5,000 members. One of the largest SACCOs in Gasabo District with RWF 293 million in member savings.",
    phone: "+250788501001", email: "irsacco@coopinsight.rw",
    address: "Rukiri II Cell, Remera Sector, Gasabo District, Kigali",
    totalSavings: 293074000, healthScore: 88,
  });

  await insertLeadership(c3Id, [
    { name: "Alphonsine Kayitesi",    role: "Chairperson", phone: "+250788502001", email: "a.kayitesi@irsacco.rw" },
    { name: "Théodore Bizimana",      role: "Treasurer",   phone: "+250788502002", email: "t.bizimana@irsacco.rw" },
    { name: "Joséphine Uwiringiyimana", role: "Secretary", phone: "+250788502003", email: "j.uwiringiyimana@irsacco.rw" },
  ]);

  const c3m1 = await insertMember(c3Id, { fullName: "Alphonsine Kayitesi",       phone: "+250788503001", nationalId: "1197681023456001", gender: "female", sector: "Remera", membershipNumber: "MBR-C3-001", membershipDate: "2009-06-01", role: "chairperson", totalSavings: 850000 });
  const c3m2 = await insertMember(c3Id, { fullName: "Théodore Bizimana",         phone: "+250788503002", nationalId: "1197481023456002", gender: "male",   sector: "Remera", membershipNumber: "MBR-C3-002", membershipDate: "2009-06-01", role: "treasurer",   totalSavings: 1200000 });
  const c3m3 = await insertMember(c3Id, { fullName: "Cécile Mukarumongi",        phone: "+250788503003", nationalId: "1198881023456003", gender: "female", sector: "Remera", membershipNumber: "MBR-C3-003", membershipDate: "2010-01-15", role: "member",      totalSavings: 580000 });
  const c3m4 = await insertMember(c3Id, { fullName: "Modeste Nshimiyimana",      phone: "+250788503004", nationalId: "1197881023456004", gender: "male",   sector: "Remera", membershipNumber: "MBR-C3-004", membershipDate: "2011-03-10", role: "member",      totalSavings: 430000 });
  const c3m5 = await insertMember(c3Id, { fullName: "Odette Mukandayisenga",     phone: "+250788503005", nationalId: "1198281023456005", gender: "female", sector: "Remera", membershipNumber: "MBR-C3-005", membershipDate: "2012-07-20", role: "secretary",   totalSavings: 710000 });
  await seedMembersByComposition(c3Id, { targetCount: 118, composition: "mixed", sector: "Remera", baseYear: 2009, baseNamePrefix: "IRSACCO Member" });

  const check3 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c3Id]);
  if (parseInt(check3.rows[0].count) === 0) {
    await insertActivity(c3Id, { title: "Annual General Assembly 2025",             type: "meeting",  status: "completed", date: "2025-11-28", location: "Remera Sector Hall",               description: "AGM to present audited financial statements, elect two board members, and approve 2026 lending targets.", budget: 200000, actualCost: 185000 });
    await insertActivity(c3Id, { title: "Financial Literacy Workshop — Cohort 12", type: "training", status: "completed", date: "2026-02-10", location: "IRSACCO Premises, Rukiri II",       description: "8-week financial literacy programme for 60 new members covering savings, credit, and household budgeting.", budget: 350000, actualCost: 340000 });
    await insertActivity(c3Id, { title: "Loan Portfolio Review Q2 2026",            type: "planning", status: "planned",   date: "2026-07-02", location: "IRSACCO Boardroom",                description: "Board review of outstanding loan portfolio, NPL ratios, and approval of Q3 lending limit.", budget: 50000, actualCost: 0 });
    await insertActivity(c3Id, { title: "Women Entrepreneurship Exhibition",        type: "sales",    status: "planned",   date: "2026-08-22", location: "Amahoro Stadium Grounds",          description: "Annual exhibition showcasing member-owned businesses and micro-enterprises financed by IRSACCO loans.", budget: 500000, actualCost: 0 });
    await insertTransaction(c3Id, { type: "income",  category: "Loan Interest",        amount: 18500000, date: "2026-03-31", description: "Q1 2026 loan interest income from 320 active borrowers.",         paymentMethod: "bank_transfer" });
    await insertTransaction(c3Id, { type: "income",  category: "Member Savings",       amount: 32000000, date: "2026-03-31", description: "Q1 2026 member savings deposits — 4,373 active savers.",          paymentMethod: "mobile_money"  });
    await insertTransaction(c3Id, { type: "expense", category: "Staff Salaries",       amount:  4200000, date: "2026-03-31", description: "March 2026 payroll — 7 permanent staff.",                          paymentMethod: "bank_transfer" });
    await insertTransaction(c3Id, { type: "expense", category: "Loan Disbursements",   amount: 25000000, date: "2026-01-15", description: "Q1 loan disbursements to 45 approved borrowers.",                  paymentMethod: "bank_transfer" });
    await insertTransaction(c3Id, { type: "income",  category: "Processing Fees",      amount:   890000, date: "2026-01-31", description: "Account opening and loan processing fees collected in January.",   paymentMethod: "mobile_money"  });
    await insertHealthScore(c3Id, { overall: 88, financial: 92, engagement: 85, compliance: 90, docs: 82 });
  }
  console.log("✓ Ijabo Remera SACCO (IRSACCO)");

  // ─── Cooperative 4 — CYCLE INVESTMENT COOPERATIVE CIC-SACCO ─────────────

  const c4Id = await insertCooperative({
    name: "Cycle Investment Cooperative (CIC-SACCO)", type: "Services", sector: "Gisozi",
    cell: "Musezero", village: "Amarembo",
    registrationNumber: "RCA-GA-012755",
    registrationDate: "2024-10-19",
    description: "Newly registered non-Umurenge SACCO focused on savings and credit for transport and logistics entrepreneurs in Gisozi sector. Members include motorcycle taxi operators, delivery cyclists, and small logistics businesses. Promotes financial inclusion through flexible group savings products.",
    phone: "+250788601001", email: "cicsacco@coopinsight.rw",
    address: "Musezero Cell, Gisozi Sector, Gasabo District, Kigali",
    totalSavings: 1175000, healthScore: 55,
  });

  await insertLeadership(c4Id, [
    { name: "Damascène Habyarimana",  role: "Chairperson", phone: "+250788602001", email: "d.habyarimana@cicsacco.rw" },
    { name: "Laetitia Umurerwa",      role: "Treasurer",   phone: "+250788602002", email: "l.umurerwa@cicsacco.rw" },
    { name: "Jean-Baptiste Ntaganda", role: "Secretary",   phone: "+250788602003", email: "jb.ntaganda@cicsacco.rw" },
  ]);

  const c4m1 = await insertMember(c4Id, { fullName: "Damascène Habyarimana",  phone: "+250788603001", nationalId: "1199034012345001", gender: "male",   sector: "Gisozi", membershipNumber: "MBR-C4-001", membershipDate: "2024-10-19", role: "chairperson", totalSavings: 75000 });
  const c4m2 = await insertMember(c4Id, { fullName: "Laetitia Umurerwa",      phone: "+250788603002", nationalId: "1199734012345002", gender: "female", sector: "Gisozi", membershipNumber: "MBR-C4-002", membershipDate: "2024-10-19", role: "treasurer",   totalSavings: 55000 });
  const c4m3 = await insertMember(c4Id, { fullName: "Jean-Baptiste Ntaganda", phone: "+250788603003", nationalId: "1200034012345003", gender: "male",   sector: "Gisozi", membershipNumber: "MBR-C4-003", membershipDate: "2024-11-01", role: "secretary",   totalSavings: 50000 });
  const c4m4 = await insertMember(c4Id, { fullName: "Ange Uwera",             phone: "+250788603004", nationalId: "1200234012345004", gender: "female", sector: "Gisozi", membershipNumber: "MBR-C4-004", membershipDate: "2024-11-15", role: "member",      totalSavings: 40000 });
  await seedMembersByComposition(c4Id, { targetCount: 67, composition: "female", sector: "Gisozi", baseYear: 2015, baseNamePrefix: "CIC Member" });

  const check4 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c4Id]);
  if (parseInt(check4.rows[0].count) === 0) {
    await insertActivity(c4Id, { title: "Founding General Assembly",           type: "meeting",  status: "completed", date: "2024-10-19", location: "Musezero Village Hall",     description: "Constitutive meeting to formally register the SACCO, adopt by-laws, and elect founding leadership.", budget: 50000, actualCost: 48000 });
    await insertActivity(c4Id, { title: "SACCO Operations Training",           type: "training", status: "completed", date: "2024-11-08", location: "BNR Training Centre, Kigali", description: "National Bank of Rwanda 2-day orientation for new SACCO boards on governance and regulatory requirements.", budget: 80000, actualCost: 80000 });
    await insertActivity(c4Id, { title: "First Loan Product Launch",           type: "planning", status: "planned",   date: "2026-07-20", location: "CIC-SACCO Office, Musezero", description: "Launch of first micro-loan product for moto-taxi members — max RWF 300,000 at 18% p.a.", budget: 30000, actualCost: 0 });
    await insertTransaction(c4Id, { type: "income",  category: "Member Contributions", amount: 940000, date: "2025-06-30", description: "Initial member share contributions — 47 founding members.",    paymentMethod: "mobile_money" });
    await insertTransaction(c4Id, { type: "expense", category: "Registration Fees",    amount: 85000,  date: "2024-10-20", description: "RCA cooperative registration and legal fees.",                  paymentMethod: "bank_transfer" });
    await insertTransaction(c4Id, { type: "income",  category: "Member Savings",       amount: 320000, date: "2026-01-31", description: "January 2026 member savings deposits.",                         paymentMethod: "mobile_money" });
    await insertHealthScore(c4Id, { overall: 55, financial: 50, engagement: 60, compliance: 58, docs: 48 });
  }
  console.log("✓ Cycle Investment Cooperative (CIC-SACCO)");

  // ─── Cooperative 5 — UMUCYO REMERA ────────────────────────────────────────

  const c5Id = await insertCooperative({
    name: "Umucyo Remera", type: "Trading", sector: "Remera",
    cell: "Rukiri I", village: "Izuba",
    registrationNumber: "RCA-GA-012958",
    registrationDate: "2025-02-26",
    description: "Cooperative of petroleum products traders and petrol station operators in Remera sector. Members collectively negotiate bulk supply contracts, manage shared fuel storage, and provide roadside assistance services. Promotes fair pricing and quality standards across 55 member businesses.",
    phone: "+250788701001", email: "umucyo.remera@coopinsight.rw",
    address: "Rukiri I Cell, Remera Sector, Gasabo District, Kigali",
    totalSavings: 275000, healthScore: 48,
  });

  await insertLeadership(c5Id, [
    { name: "Patrice Rurangwa",   role: "Chairperson", phone: "+250788702001", email: "p.rurangwa@coopinsight.rw" },
    { name: "Sandrine Mukeshimana", role: "Treasurer", phone: "+250788702002", email: "s.mukeshimana@coopinsight.rw" },
    { name: "Claude Niyomugabo",  role: "Secretary",   phone: "+250788702003", email: "c.niyomugabo@coopinsight.rw" },
  ]);

  await insertMember(c5Id, { fullName: "Patrice Rurangwa",     phone: "+250788703001", nationalId: "1198945012345001", gender: "male",   sector: "Remera", membershipNumber: "MBR-C5-001", membershipDate: "2025-02-26", role: "chairperson", totalSavings: 12000 });
  await insertMember(c5Id, { fullName: "Sandrine Mukeshimana", phone: "+250788703002", nationalId: "1199745012345002", gender: "female", sector: "Remera", membershipNumber: "MBR-C5-002", membershipDate: "2025-02-26", role: "treasurer",   totalSavings: 10000 });
  await insertMember(c5Id, { fullName: "Claude Niyomugabo",    phone: "+250788703003", nationalId: "1200145012345003", gender: "male",   sector: "Remera", membershipNumber: "MBR-C5-003", membershipDate: "2025-03-10", role: "secretary",   totalSavings: 8000  });
  await insertMember(c5Id, { fullName: "Jeanne Uwingabire",    phone: "+250788703004", nationalId: "1199545012345004", gender: "female", sector: "Remera", membershipNumber: "MBR-C5-004", membershipDate: "2025-04-01", role: "member",      totalSavings: 5000  });
  await seedMembersByComposition(c5Id, { targetCount: 41, composition: "female", sector: "Remera", baseYear: 2018, baseNamePrefix: "Umucyo Member" });

  const check5 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c5Id]);
  if (parseInt(check5.rows[0].count) === 0) {
    await insertActivity(c5Id, { title: "Founding & Registration Meeting",        type: "meeting",  status: "completed", date: "2025-02-26", location: "Izuba Village, Remera",       description: "Constitutive assembly to register the cooperative, adopt by-laws, and elect leadership.", budget: 60000, actualCost: 55000 });
    await insertActivity(c5Id, { title: "Bulk Supply Negotiation Workshop",       type: "planning", status: "completed", date: "2025-05-15", location: "Cooperative Office, Rukiri I", description: "Workshop to develop collective bargaining strategy with petroleum suppliers for bulk discount.", budget: 40000, actualCost: 38000 });
    await insertActivity(c5Id, { title: "Petroleum Quality Standards Training",   type: "training", status: "planned",   date: "2026-07-25", location: "Rwanda Energy Group (REG) HQ", description: "REG-facilitated training on fuel quality testing, storage safety, and regulatory compliance.", budget: 100000, actualCost: 0 });
    await insertTransaction(c5Id, { type: "income",  category: "Member Contributions", amount: 275000, date: "2025-03-31", description: "Founding member share contributions — RWF 5,000 per member.",         paymentMethod: "mobile_money" });
    await insertTransaction(c5Id, { type: "expense", category: "Registration",         amount: 55000,  date: "2025-02-28", description: "RCA and business registration fees.",                                  paymentMethod: "bank_transfer" });
    await insertHealthScore(c5Id, { overall: 48, financial: 42, engagement: 55, compliance: 45, docs: 40 });
  }
  console.log("✓ Umucyo Remera");

  // ─── Cooperative 6 — DUCLECO ──────────────────────────────────────────────

  const c6Id = await insertCooperative({
    name: "Dufatanye Cleaning Cooperative (DUCLECO)", type: "Services", sector: "Gisozi",
    cell: "Ruhango", village: "Kumukenke",
    registrationNumber: "RCA/0057/2014",
    registrationDate: "2014-01-24",
    description: "Youth cooperative specialising in commercial and residential cleaning, waste collection, and sanitation services in Gisozi sector. DUCLECO holds service contracts with two office complexes and provides daily cleaning for the Ruhango cell market. Members receive monthly dividends from contract revenue.",
    phone: "+250788801001", email: "ducleco@coopinsight.rw",
    address: "Ruhango Cell, Gisozi Sector, Gasabo District, Kigali",
    totalSavings: 1100000, healthScore: 62,
  });

  await insertLeadership(c6Id, [
    { name: "Olivier Nkusi",       role: "Chairperson", phone: "+250788802001", email: "o.nkusi@ducleco.rw" },
    { name: "Nadège Ingabire",     role: "Treasurer",   phone: "+250788802002", email: "n.ingabire@ducleco.rw" },
    { name: "Patrick Habimana",    role: "Secretary",   phone: "+250788802003", email: "p.habimana@ducleco.rw" },
  ]);

  const c6m1 = await insertMember(c6Id, { fullName: "Olivier Nkusi",    phone: "+250788803001", nationalId: "1199256012345001", gender: "male",   sector: "Gisozi", membershipNumber: "MBR-C6-001", membershipDate: "2014-01-24", role: "chairperson", totalSavings: 120000 });
  const c6m2 = await insertMember(c6Id, { fullName: "Nadège Ingabire",  phone: "+250788803002", nationalId: "1199756012345002", gender: "female", sector: "Gisozi", membershipNumber: "MBR-C6-002", membershipDate: "2014-01-24", role: "treasurer",   totalSavings: 95000  });
  const c6m3 = await insertMember(c6Id, { fullName: "Patrick Habimana", phone: "+250788803003", nationalId: "1200056012345003", gender: "male",   sector: "Gisozi", membershipNumber: "MBR-C6-003", membershipDate: "2014-03-10", role: "secretary",   totalSavings: 88000  });
  const c6m4 = await insertMember(c6Id, { fullName: "Gisèle Umutoni",   phone: "+250788803004", nationalId: "1199356012345004", gender: "female", sector: "Gisozi", membershipNumber: "MBR-C6-004", membershipDate: "2015-01-20", role: "member",      totalSavings: 75000  });
  const c6m5 = await insertMember(c6Id, { fullName: "Eric Nzabonimana", phone: "+250788803005", nationalId: "1198956012345005", gender: "male",   sector: "Gisozi", membershipNumber: "MBR-C6-005", membershipDate: "2016-06-01", role: "member",      totalSavings: 68000  });
  await seedMembersByComposition(c6Id, { targetCount: 56, composition: "male", sector: "Gisozi", baseYear: 2022, baseNamePrefix: "Dufatanye Member" });

  const check6 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c6Id]);
  if (parseInt(check6.rows[0].count) === 0) {
    await insertActivity(c6Id, { title: "Office Complex Cleaning Contract Review", type: "meeting",    status: "completed", date: "2025-09-01", location: "DUCLECO Office, Ruhango",   description: "Annual review of the 2025-26 service contract with Kigali Business Park — negotiated 15% fee increase.", budget: 20000, actualCost: 18000 });
    await insertActivity(c6Id, { title: "Waste Management & Safety Training",     type: "training",   status: "completed", date: "2025-11-12", location: "RURA Training Room, Kigali",  description: "Regulatory training on hazardous waste handling and COVID-19 sanitation protocols.", budget: 90000, actualCost: 87000 });
    await insertActivity(c6Id, { title: "Q2 Member Dividend Distribution",        type: "distribution", status: "planned", date: "2026-07-31", location: "DUCLECO Office, Ruhango",   description: "Semi-annual dividend distribution to all 11 active members from H1 2026 contract revenue.", budget: 350000, actualCost: 0 });
    await insertTransaction(c6Id, { type: "income",  category: "Service Contracts",    amount: 780000, date: "2026-01-31", description: "January 2026 cleaning service fees — 2 office contracts.",       paymentMethod: "bank_transfer" });
    await insertTransaction(c6Id, { type: "income",  category: "Market Cleaning Fees", amount: 120000, date: "2026-01-31", description: "Monthly Ruhango market cleaning contract.",                        paymentMethod: "mobile_money" });
    await insertTransaction(c6Id, { type: "expense", category: "Equipment & Supplies", amount: 180000, date: "2026-01-10", description: "Cleaning equipment, mops, detergents, and PPE restocking.",         paymentMethod: "mobile_money" });
    await insertTransaction(c6Id, { type: "expense", category: "Member Wages",         amount: 330000, date: "2026-01-31", description: "January 2026 member daily-rate wages for contract work.",            paymentMethod: "mobile_money" });
    await insertHealthScore(c6Id, { overall: 62, financial: 65, engagement: 60, compliance: 62, docs: 55 });
  }
  console.log("✓ Dufatanye Cleaning Cooperative (DUCLECO)");

  // ─── Cooperative 7 — ZAMUKA MUHINZI WA KAGUNGA ────────────────────────────

  const c7Id = await insertCooperative({
    name: "Zamuka Muhinzi wa Kagunga", type: "Agriculture", sector: "Nduba",
    cell: "Gasanze", village: "Nyarubande",
    registrationNumber: "RCA/0309/2019",
    registrationDate: "2019-05-03",
    description: "Youth-led rice farming cooperative cultivating paddy rice in the Gasanze wetland marshes of Nduba sector. Members hold 89 collective plots covering 45 hectares. The cooperative operates a shared motorised threshing machine and sells processed rice to Kigali wholesalers and school feeding programmes.",
    phone: "+250788901001", email: "zamuka.kagunga@coopinsight.rw",
    address: "Gasanze Cell, Nduba Sector, Gasabo District, Kigali",
    totalSavings: 32985625, healthScore: 74,
  });

  await insertLeadership(c7Id, [
    { name: "Edouard Nzabonimana",  role: "Chairperson", phone: "+250788902001", email: "e.nzabonimana@zamuka.rw" },
    { name: "Xavérine Mukakarara",  role: "Treasurer",   phone: "+250788902002", email: "x.mukakarara@zamuka.rw" },
    { name: "Théophile Nsengimana", role: "Secretary",   phone: "+250788902003", email: "t.nsengimana@zamuka.rw" },
  ]);

  const c7m1 = await insertMember(c7Id, { fullName: "Edouard Nzabonimana",  phone: "+250788903001", nationalId: "1199567012345001", gender: "male",   sector: "Nduba", membershipNumber: "MBR-C7-001", membershipDate: "2019-05-03", role: "chairperson", totalSavings: 520000 });
  const c7m2 = await insertMember(c7Id, { fullName: "Xavérine Mukakarara",  phone: "+250788903002", nationalId: "1199767012345002", gender: "female", sector: "Nduba", membershipNumber: "MBR-C7-002", membershipDate: "2019-05-03", role: "treasurer",   totalSavings: 480000 });
  const c7m3 = await insertMember(c7Id, { fullName: "Théophile Nsengimana", phone: "+250788903003", nationalId: "1200067012345003", gender: "male",   sector: "Nduba", membershipNumber: "MBR-C7-003", membershipDate: "2019-06-01", role: "secretary",   totalSavings: 410000 });
  const c7m4 = await insertMember(c7Id, { fullName: "Félix Hakizimana",     phone: "+250788903004", nationalId: "1199267012345004", gender: "male",   sector: "Nduba", membershipNumber: "MBR-C7-004", membershipDate: "2019-07-15", role: "member",      totalSavings: 380000 });
  const c7m5 = await insertMember(c7Id, { fullName: "Albertine Nyiramana",  phone: "+250788903005", nationalId: "1200367012345005", gender: "female", sector: "Nduba", membershipNumber: "MBR-C7-005", membershipDate: "2020-03-01", role: "member",      totalSavings: 350000 });
  await seedMembersByComposition(c7Id, { targetCount: 35, composition: "male", sector: "Nduba", baseYear: 2021, baseNamePrefix: "Zamuka Member" });

  const check7 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c7Id]);
  if (parseInt(check7.rows[0].count) === 0) {
    await insertActivity(c7Id, { title: "2025 Planting Season Coordination",     type: "planning",    status: "completed", date: "2025-08-20", location: "Gasanze Marshland, Nduba",    description: "Seasonal plot assignments and irrigation scheduling for 89 members planting 45 hectares of paddy.", budget: 45000,  actualCost: 42000 });
    await insertActivity(c7Id, { title: "RAB Rice Farming Best Practices Training", type: "training", status: "completed", date: "2025-09-10", location: "Nduba Sector Office",          description: "Rwanda Agriculture Board agronomist training on SRI method to improve per-hectare yield.", budget: 180000, actualCost: 175000 });
    await insertActivity(c7Id, { title: "Mechanical Thresher Maintenance Day",   type: "production",  status: "completed", date: "2026-01-18", location: "Zamuka Threshing Station",    description: "Annual servicing of the cooperative's shared threshing machine ahead of main harvest season.", budget: 120000, actualCost: 115000 });
    await insertActivity(c7Id, { title: "2025 Main Harvest & Sales Planning",    type: "planning",    status: "planned",   date: "2026-07-28", location: "Gasanze Marshland, Nduba",    description: "Harvest coordination meeting with wholesalers and school feeding programme procurement officers.", budget: 50000,  actualCost: 0 });
    await insertTransaction(c7Id, { type: "income",  category: "Rice Sales",              amount: 18500000, date: "2025-12-30", description: "2025 harvest rice sales — 50 tonnes at RWF 370,000/tonne to Kigali wholesalers.", paymentMethod: "bank_transfer" });
    await insertTransaction(c7Id, { type: "income",  category: "School Feeding Contract", amount:  6200000, date: "2025-12-01", description: "Q4 2025 school feeding programme supply — 17 tonnes processed rice.",               paymentMethod: "bank_transfer" });
    await insertTransaction(c7Id, { type: "income",  category: "Member Contributions",    amount:  7925625, date: "2025-06-30", description: "2025 member share contributions — 89 members at RWF 370,625 each.",                 paymentMethod: "mobile_money"  });
    await insertTransaction(c7Id, { type: "expense", category: "Inputs & Seeds",          amount:  3200000, date: "2025-08-25", description: "Certified paddy seeds, fertiliser, and herbicides for planting season.",             paymentMethod: "bank_transfer" });
    await insertTransaction(c7Id, { type: "expense", category: "Equipment Maintenance",   amount:   115000, date: "2026-01-18", description: "Annual threshing machine service and spare parts.",                                   paymentMethod: "cash"          });
    await insertHealthScore(c7Id, { overall: 74, financial: 78, engagement: 72, compliance: 74, docs: 68 });
  }
  console.log("✓ Zamuka Muhinzi wa Kagunga");

  // ─── Cooperative 8 — KUTC ─────────────────────────────────────────────────

  const c8Id = await insertCooperative({
    name: "Kimironko United Taxis Cooperative (KUTC)", type: "Services", sector: "Kimironko",
    cell: "Bibare", village: "Umwezi",
    registrationNumber: "RCA/0230/2015",
    registrationDate: "2015-03-13",
    description: "Cooperative of 27 taxi-voiture operators based in Kimironko sector. Members share a dispatch radio network and operate scheduled routes between Kimironko, Remera, and the CBD. KUTC provides members with group motor insurance, vehicle maintenance subsidies, and a pooled emergency repair fund.",
    phone: "+250789001001", email: "kutc@coopinsight.rw",
    address: "Bibare Cell, Kimironko Sector, Gasabo District, Kigali",
    totalSavings: 5400, healthScore: 42,
  });

  await insertLeadership(c8Id, [
    { name: "Augustin Munyandamutsa", role: "Chairperson", phone: "+250789002001", email: "a.munyandamutsa@kutc.rw" },
    { name: "Béatrice Uwimana",       role: "Treasurer",   phone: "+250789002002", email: "b.uwimana@kutc.rw" },
    { name: "Sylvestre Nkurunziza",   role: "Secretary",   phone: "+250789002003", email: "s.nkurunziza@kutc.rw" },
  ]);

  const c8m1 = await insertMember(c8Id, { fullName: "Augustin Munyandamutsa", phone: "+250789003001", nationalId: "1197578012345001", gender: "male",   sector: "Kimironko", membershipNumber: "MBR-C8-001", membershipDate: "2015-03-13", role: "chairperson", totalSavings: 500 });
  const c8m2 = await insertMember(c8Id, { fullName: "Béatrice Uwimana",       phone: "+250789003002", nationalId: "1198178012345002", gender: "female", sector: "Kimironko", membershipNumber: "MBR-C8-002", membershipDate: "2015-03-13", role: "treasurer",   totalSavings: 400 });
  const c8m3 = await insertMember(c8Id, { fullName: "Sylvestre Nkurunziza",   phone: "+250789003003", nationalId: "1198678012345003", gender: "male",   sector: "Kimironko", membershipNumber: "MBR-C8-003", membershipDate: "2015-03-13", role: "secretary",   totalSavings: 300 });
  const c8m4 = await insertMember(c8Id, { fullName: "Léonard Harelimana",     phone: "+250789003004", nationalId: "1197378012345004", gender: "male",   sector: "Kimironko", membershipNumber: "MBR-C8-004", membershipDate: "2016-01-10", role: "member",      totalSavings: 200 });
  await seedMembersByComposition(c8Id, { targetCount: 89, composition: "mixed", sector: "Kimironko", baseYear: 2020, baseNamePrefix: "KUTC Member" });

  const check8 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c8Id]);
  if (parseInt(check8.rows[0].count) === 0) {
    await insertActivity(c8Id, { title: "Traffic & Route Dispute Resolution Meeting", type: "meeting",  status: "completed", date: "2025-10-28", location: "Bibare Community Hall",      description: "Monthly meeting to resolve route-assignment disputes and review new KTM route proposal.", budget: 15000, actualCost: 12000 });
    await insertActivity(c8Id, { title: "Rwanda Utilities Regulatory Authority Briefing", type: "training", status: "completed", date: "2026-01-22", location: "RURA Offices, Kacyiru", description: "RURA briefing on new taxi tariff schedule and vehicle roadworthiness requirements for 2026.", budget: 20000, actualCost: 20000 });
    await insertActivity(c8Id, { title: "Emergency Repair Fund Review",           type: "planning",  status: "planned",   date: "2026-07-05", location: "KUTC Dispatch Office",       description: "Review of emergency fund balance and approval of payout process for 3 pending vehicle repair claims.", budget: 10000, actualCost: 0 });
    await insertTransaction(c8Id, { type: "income",  category: "Route Dispatch Fees", amount: 27000,  date: "2026-01-31", description: "Monthly dispatch subscription fees — 27 operators at RWF 1,000/month.",      paymentMethod: "mobile_money" });
    await insertTransaction(c8Id, { type: "expense", category: "Radio Network",       amount: 15000,  date: "2026-01-15", description: "Radio repeater maintenance and airtime fees.",                                paymentMethod: "mobile_money" });
    await insertTransaction(c8Id, { type: "income",  category: "Member Contributions", amount: 5400,  date: "2025-12-31", description: "Annual member share contributions — 27 members at RWF 200 per share.",       paymentMethod: "cash" });
    await insertHealthScore(c8Id, { overall: 42, financial: 38, engagement: 48, compliance: 42, docs: 35 });
  }
  console.log("✓ Kimironko United Taxis Cooperative (KUTC)");

  // ─── Cooperative 9 — AGASEKE VISION ──────────────────────────────────────

  const c9Id = await insertCooperative({
    name: "Agaseke Vision", type: "Handicrafts", sector: "Kimihurura",
    cell: "Rugando", village: "Rebero",
    registrationNumber: "RCA/1060/2010",
    registrationDate: "2010-09-20",
    description: "Youth cooperative of skilled artisans producing traditional Rwandan sisal and sweetgrass baskets (agaseke) in Kimihurura sector. Products are sold at the Kimihurura craft market, to Kigali hotels, and exported through partner NGOs. The cooperative maintains a shared quality-control workshop and provides design training to new members.",
    phone: "+250789101001", email: "agaseke.vision@coopinsight.rw",
    address: "Rugando Cell, Kimihurura Sector, Gasabo District, Kigali",
    totalSavings: 130000, healthScore: 58,
  });

  await insertLeadership(c9Id, [
    { name: "Immaculée Mukasine",   role: "Chairperson", phone: "+250789102001", email: "i.mukasine@agaseke.rw" },
    { name: "Egide Nzeyimana",      role: "Treasurer",   phone: "+250789102002", email: "e.nzeyimana@agaseke.rw" },
    { name: "Espérance Uwibambe",   role: "Secretary",   phone: "+250789102003", email: "e.uwibambe@agaseke.rw" },
  ]);

  const c9m1 = await insertMember(c9Id, { fullName: "Immaculée Mukasine",  phone: "+250789103001", nationalId: "1198090012345001", gender: "female", sector: "Kimihurura", membershipNumber: "MBR-C9-001", membershipDate: "2010-09-20", role: "chairperson", totalSavings: 25000 });
  const c9m2 = await insertMember(c9Id, { fullName: "Egide Nzeyimana",     phone: "+250789103002", nationalId: "1197590012345002", gender: "male",   sector: "Kimihurura", membershipNumber: "MBR-C9-002", membershipDate: "2010-09-20", role: "treasurer",   totalSavings: 20000 });
  const c9m3 = await insertMember(c9Id, { fullName: "Espérance Uwibambe",  phone: "+250789103003", nationalId: "1199290012345003", gender: "female", sector: "Kimihurura", membershipNumber: "MBR-C9-003", membershipDate: "2010-11-01", role: "secretary",   totalSavings: 18000 });
  const c9m4 = await insertMember(c9Id, { fullName: "Anaïs Nyiramukama",   phone: "+250789103004", nationalId: "1200090012345004", gender: "female", sector: "Kimihurura", membershipNumber: "MBR-C9-004", membershipDate: "2012-03-15", role: "member",      totalSavings: 15000 });
  const c9m5 = await insertMember(c9Id, { fullName: "Innocent Hakizamana", phone: "+250789103005", nationalId: "1198590012345005", gender: "male",   sector: "Kimihurura", membershipNumber: "MBR-C9-005", membershipDate: "2014-06-10", role: "member",      totalSavings: 12000 });
  await seedMembersByComposition(c9Id, { targetCount: 44, composition: "female", sector: "Kimihurura", baseYear: 2017, baseNamePrefix: "Agaseke Member" });

  const check9 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c9Id]);
  if (parseInt(check9.rows[0].count) === 0) {
    await insertActivity(c9Id, { title: "Basket Design Innovation Workshop",    type: "training",    status: "completed", date: "2025-10-14", location: "Agaseke Vision Workshop, Rugando", description: "Workshop with RDB-certified artisan trainer to introduce new contemporary designs for the export market.", budget: 80000, actualCost: 76000 });
    await insertActivity(c9Id, { title: "Kigali Craft Market Exhibition",       type: "sales",       status: "completed", date: "2025-12-06", location: "Kimihurura Craft Market",          description: "4-day annual craft fair — cooperative displayed 350 baskets. Sales totalled RWF 420,000.", budget: 50000, actualCost: 45000 });
    await insertActivity(c9Id, { title: "Hotel Supply Contract Pitch",          type: "distribution", status: "planned",  date: "2026-07-14", location: "Kigali Serena Hotel",              description: "Presentation to Serena Hotel procurement team to supply agaseke gift baskets for 2027 room amenities.", budget: 30000, actualCost: 0 });
    await insertTransaction(c9Id, { type: "income",  category: "Craft Market Sales", amount: 420000, date: "2025-12-09", description: "Kigali Craft Market 4-day exhibition sales — 350 baskets.",              paymentMethod: "mobile_money" });
    await insertTransaction(c9Id, { type: "income",  category: "Export Sales",       amount: 380000, date: "2025-11-30", description: "NGO export partner order — 200 premium agaseke for European market.",    paymentMethod: "bank_transfer" });
    await insertTransaction(c9Id, { type: "expense", category: "Raw Materials",      amount: 280000, date: "2025-10-01", description: "Sisal fibre and sweetgrass purchase for Q4 2025 production batch.",        paymentMethod: "mobile_money" });
    await insertTransaction(c9Id, { type: "expense", category: "Training",           amount: 76000,  date: "2025-10-14", description: "Design workshop facilitation and materials.",                               paymentMethod: "mobile_money" });
    await insertHealthScore(c9Id, { overall: 58, financial: 55, engagement: 62, compliance: 58, docs: 50 });
  }
  console.log("✓ Agaseke Vision");

  // ─── Cooperative 10 — GIRUBUZIMA KINYINYA ─────────────────────────────────

  const c10Id = await insertCooperative({
    name: "Girubuzima Kinyinya", type: "Livestock", sector: "Kinyinya",
    cell: "Bigeyo", village: "Bigeyo",
    registrationNumber: "RCA/0998/2013",
    registrationDate: "2020-12-29",
    description: "Small pig-farming cooperative in Kinyinya sector. Currently operating with a single active pig farmer who manages a sow-and-piglet unit of 12 animals. The cooperative was restructured in 2020 after losing members during COVID-19 disruptions and is rebuilding membership. Seeks support with veterinary access and market linkages.",
    phone: "+250789201001", email: "girubuzima.kinyinya@coopinsight.rw",
    address: "Bigeyo Cell, Kinyinya Sector, Gasabo District, Kigali",
    totalSavings: 11, healthScore: 22,
  });

  await insertLeadership(c10Id, [
    { name: "Théogène Mugwaneza", role: "Chairperson", phone: "+250789202001", email: "t.mugwaneza@coopinsight.rw" },
    { name: "Scholastique Umutoni", role: "Treasurer", phone: "+250789202002", email: "s.umutoni@coopinsight.rw" },
    { name: "Donatien Ndayambaje", role: "Secretary",  phone: "+250789202003", email: "d.ndayambaje@coopinsight.rw" },
  ]);

  await insertMember(c10Id, { fullName: "Théogène Mugwaneza",   phone: "+250789203001", nationalId: "1197813012345001", gender: "male",   sector: "Kinyinya", membershipNumber: "MBR-C10-001", membershipDate: "2013-01-15", role: "chairperson", totalSavings: 11 });
  await seedMembersByComposition(c10Id, { targetCount: 34, composition: "male", sector: "Kinyinya", baseYear: 2013, baseNamePrefix: "Girubuzima Member" });

  const check10 = await query(`SELECT COUNT(*) FROM activities WHERE cooperative_id = $1`, [c10Id]);
  if (parseInt(check10.rows[0].count) === 0) {
    await insertActivity(c10Id, { title: "Cooperative Restructuring Meeting",       type: "meeting",  status: "completed", date: "2020-12-29", location: "Bigeyo Cell Office, Kinyinya", description: "Emergency restructuring meeting after COVID-19 member losses. Single remaining member appointed to all leadership roles.", budget: 0, actualCost: 0 });
    await insertActivity(c10Id, { title: "RAB Veterinary Outreach Visit",           type: "training", status: "completed", date: "2025-10-30", location: "Mugwaneza Farm, Bigeyo",       description: "Rwanda Agriculture Board vet visit — pig vaccinations, deworming, and husbandry advice for 12 animals.", budget: 15000, actualCost: 14000 });
    await insertActivity(c10Id, { title: "New Member Recruitment Drive",            type: "planning", status: "planned",   date: "2026-07-30", location: "Kinyinya Sector Office",       description: "Community outreach to recruit at least 5 new pig farmers to rebuild cooperative membership.", budget: 20000, actualCost: 0 });
    await insertTransaction(c10Id, { type: "income",  category: "Livestock Sales", amount: 150000, date: "2025-08-15", description: "Sale of 3 fattened pigs at Kinyinya market.",                        paymentMethod: "cash" });
    await insertTransaction(c10Id, { type: "expense", category: "Animal Feed",     amount: 120000, date: "2025-07-01", description: "Maize bran and soybean meal feed purchase for 12 pigs — 3 months.", paymentMethod: "mobile_money" });
    await insertTransaction(c10Id, { type: "expense", category: "Veterinary",      amount: 14000,  date: "2025-10-30", description: "RAB vet visit: vaccines and deworming medications.",                  paymentMethod: "cash" });
    await insertHealthScore(c10Id, { overall: 22, financial: 18, engagement: 20, compliance: 25, docs: 15 });
  }
  console.log("✓ Girubuzima Kinyinya");

  // ─── AI Insights ───────────────────────────────────────────────────────────

  const aiCheck = await query(`SELECT COUNT(*) FROM ai_insights`);
  if (parseInt(aiCheck.rows[0].count) === 0) {

    const insight = async (
      regNum: string, type: string, severity: string,
      title: string, summary: string, detail: string,
      confidence: number, affectedMetric: string | null,
      currentVal: number | null, expectedVal: number | null,
      recs: string[], modelName: string
    ) => {
      const coopRes = await query(`SELECT id FROM cooperatives WHERE registration_number = $1`, [regNum]);
      if (!coopRes.rows[0]) return;
      const coopId = coopRes.rows[0].id;
      const deviationValue = currentVal != null && expectedVal != null && expectedVal !== 0
        ? Number(((currentVal - expectedVal) / expectedVal).toFixed(4))
        : null;

      await query(
        `INSERT INTO ai_insights
           (cooperative_id, type, severity, title, summary, detail,
            affected_metric, current_value, expected_value, deviation,
            recommendations, model_name, confidence, resolved, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,NOW())`,
        [coopId, type, severity, title, summary, detail,
         affectedMetric, currentVal, expectedVal, deviationValue,
         JSON.stringify(recs), modelName, confidence]
      );
    };

    // ── Gasabo Coffee Cooperative ──────────────────────────────────────────
    await insight("RCA/GASABO/2020/001","recommendation","info",
      "Expand Wet Processing Capacity",
      "Current washing station throughput is limiting potential export volumes by ~30%. Adding a second fermentation tank would increase output by an estimated 4 tonnes per season.",
      "Based on 2025 harvest data: 50 tonnes processed vs. estimated 72-tonne potential. Throughput bottleneck identified at wet processing stage. Capital requirement estimated at RWF 1,800,000.",
      0.82,"Harvest Throughput (tonnes)",50,72,
      ["Commission feasibility study for second fermentation tank","Apply for RDB cooperative infrastructure grant","Partner with Rwashoscco for shared processing pilot"],
      "CoopAnalytics v1.2");

    await insight("RCA/GASABO/2020/001","insight","info",
      "Member Savings Growth Trending Positively",
      "Average member savings grew 12% year-over-year. Marie Claire Uwase and Alexis Nzeyimana are the top contributors, together accounting for 28% of total cooperative savings.",
      "YoY member savings comparison: 2024 total RWF 1,855,000 vs. 2025 total RWF 2,055,000. Top 2 members hold 28% concentration — diversification of savings base recommended.",
      0.91,"Member Savings (RWF)",2055000,1855000,
      ["Introduce group savings challenge to activate low-saving members","Consider tiered dividend to reward consistent savers"],
      "FinancialAnalytics v2.0");

    await insight("RCA/GASABO/2020/001","anomaly","warning",
      "Unusual Expense Spike — Inputs Category",
      "Inputs & Supplies expense (RWF 680,000) is 2.1x above the 3-year seasonal average of RWF 324,000 for the same quarter. This may indicate price inflation or a procurement irregularity.",
      "Transaction date: 2025-08-10. Category: Inputs & Supplies. Amount: RWF 680,000. 3-year Q3 average for same category: RWF 324,000. Deviation: +110%. No corresponding approval memo found in records.",
      0.88,"Inputs Expense (RWF)",680000,324000,
      ["Request procurement documentation from treasurer","Compare against supplier invoices","Flag for next board meeting agenda"],
      "AnomalyDetector v1.0");

    // ── IRSACCO ───────────────────────────────────────────────────────────
    await insight("RCA/0496/2009","insight","info",
      "SACCO Demonstrates Strong Financial Health",
      "With RWF 293M in member savings and an 88/100 health score, IRSACCO is the highest-performing cooperative in Gasabo District. Loan-to-deposit ratio stands at a healthy 8.5%.",
      "Key metrics: Total savings RWF 293,074,000 | Active borrowers: 320 | NPL ratio: estimated <3% | Q1 2026 interest income: RWF 18,500,000. IRSACCO consistently outperforms the district average on all financial indicators.",
      0.96,"Overall Health Score",88,65,
      ["Share governance model with lower-performing SACCOs in district","Apply for BNR tier-2 microfinance licence","Expand loan products to agriculture sector members"],
      "DistrictBenchmark v1.0");

    await insight("RCA/0496/2009","recommendation","info",
      "Diversify Loan Portfolio Beyond Consumer Credit",
      "Current loan portfolio is concentrated in consumer/personal loans. Adding SME and agricultural loan products could increase interest income by 18-25% based on district demand analysis.",
      "Analysis of 320 active borrowers: 89% personal loans, 11% SME. Market analysis shows 240 unserved SME credit demand cases in Remera sector. Projected additional annual interest income: RWF 3,300,000-4,625,000.",
      0.79,"Loan Portfolio Diversification (%)",11,30,
      ["Design SME loan product with 24-month tenure","Partner with BRD for SME guarantee scheme","Train 2 credit officers on SME appraisal"],
      "MarketAnalytics v1.0");

    await insight("RCA/0496/2009","forecast","info",
      "Member Savings Forecast: RWF 310M by Q4 2026",
      "Based on the current 6-month savings growth trend (+5.8% per quarter), total member savings are projected to reach RWF 310 million by December 2026.",
      "Growth model: Linear regression on 8 quarters of savings data. R² = 0.94. Confidence interval: RWF 297M–323M. Key assumption: member retention ≥95% and no major withdrawal events.",
      0.87,"Projected Total Savings (RWF)",293074000,310000000,
      ["Launch Q3 savings mobilisation campaign","Offer bonus dividend for members who increase monthly deposits by 20%"],
      "ForecastModel v1.1");

    // ── Twite Ku Buzima ───────────────────────────────────────────────────
    await insight("RCA/0035/2014","recommendation","warning",
      "Member Retention Risk — 40% of Members Inactive",
      "Analysis of contribution records shows approximately 43 of 107 registered members (40%) have not made any service-fee payment or attended an activity in the past 12 months.",
      "Active member count estimated at 64 based on activity attendance and fee payment records. Inactive members represent RWF 1,032,000 in potential lost annual revenue. Root cause likely: lack of perceived value from membership.",
      0.73,"Active Member Ratio (%)",60,85,
      ["Conduct member satisfaction survey","Introduce community health card for active members (discount on consultations)","Schedule reactivation day with free health screening"],
      "MemberAnalytics v1.0");

    await insight("RCA/0035/2014","insight","info",
      "Health Campaign Reach Exceeds Target by 25%",
      "The October 2025 community health campaign reached 250 households against a target of 200, demonstrating strong community trust and operational capacity.",
      "Campaign metrics: 250 households visited | 12 health workers deployed | 6 malaria cases referred for treatment | Cost per household: RWF 296. Efficiency benchmark: top-quartile for district community health cooperatives.",
      0.95,"Campaign Reach (households)",250,200,
      ["Replicate campaign model for Q3 2026 with expanded geography","Document methodology for RCA district report","Apply to UNICEF Rwanda community health grant"],
      "PerformanceAnalytics v1.0");

    // ── CIC-SACCO ─────────────────────────────────────────────────────────
    await insight("RCA-GA-012755","recommendation","warning",
      "Low Initial Capitalisation — Expedite First Loan Launch",
      "With only RWF 1,175,000 in member savings after 15 months of operation, CIC-SACCO is at risk of member disengagement if no loan product is launched within Q3 2026.",
      "Benchmark: comparable new SACCOs in district average RWF 3,200,000 by month 15. CIC-SACCO is at 37% of benchmark. Member attrition risk is estimated at 25% if first loan disbursement does not occur within 60 days.",
      0.81,"Savings vs. Benchmark (RWF)",1175000,3200000,
      ["Prioritise launching micro-loan product (max RWF 300,000) in July 2026","Recruit 10 new members with RWF 50,000 minimum share","Hold emergency board meeting to approve first loan applications"],
      "BenchmarkAlert v1.0");

    await insight("RCA-GA-012755","anomaly","info",
      "Founding Documents Compliance Gap",
      "BNR regulatory review (2026-Q1) flagged that CIC-SACCO has not yet submitted its first mandatory semi-annual member registry update, due 2025-12-31.",
      "Regulatory requirement: BNR Directive 03/2019 requires all non-Umurenge SACCOs to submit member registry updates every 6 months. Last submission: founding documents (Oct 2024). Overdue by 6 months.",
      0.99,"Regulatory Compliance",0,1,
      ["Submit member registry update to BNR within 14 days","Appoint compliance officer from board","Calendar next submission deadline: June 2026"],
      "ComplianceMonitor v1.0");

    // ── DUCLECO ───────────────────────────────────────────────────────────
    await insight("RCA/0057/2014","insight","info",
      "Contract Revenue Growth Sustains 11 Jobs",
      "DUCLECO's 2 active cleaning contracts generate RWF 900,000/month in predictable revenue, providing stable income for all 11 cooperative members.",
      "Revenue breakdown: Office contract A (RWF 500,000/month), Office contract B (RWF 280,000/month), Market contract (RWF 120,000/month). Net margin after wages and supplies: ~42%. Average member monthly income from cooperative: RWF 30,000.",
      0.94,"Monthly Contract Revenue (RWF)",900000,750000,
      ["Pitch to 2 additional office complexes opening in Gisozi in Q3 2026","Negotiate 10% contract renewal increase before August 2026","Reinvest surplus into motorised cleaning equipment"],
      "RevenueAnalytics v1.0");

    await insight("RCA/0057/2014","recommendation","info",
      "Formalise Equipment Replacement Fund",
      "Current equipment is estimated to be 3-4 years old with no dedicated replacement fund. A monthly reserve of RWF 15,000 would accumulate enough to replace core equipment every 2 years.",
      "Equipment book value: estimated RWF 450,000 (original cost). Useful life: 3-5 years. No sinking fund currently exists. Equipment failure risk would directly impact contract delivery capability.",
      0.77,"Equipment Reserve Fund (RWF)",0,360000,
      ["Pass board resolution to allocate RWF 15,000/month to equipment fund","Open dedicated bank sub-account for equipment reserves","Get equipment insurance quote"],
      "FinancialPlanning v1.0");

    // ── ZAMUKA ────────────────────────────────────────────────────────────
    await insight("RCA/0309/2019","forecast","info",
      "2026 Harvest Revenue Forecast: RWF 22–26M",
      "Based on 45 hectares under cultivation, 2025 yield data (50 tonnes), and current market price trends, the 2026 main harvest is projected to generate RWF 22–26 million in sales revenue.",
      "Yield model: 2025 actual 50T on 45ha = 1.11T/ha. RAB SRI method target: 1.5T/ha. Mid-scenario: 67.5T at RWF 350,000/T = RWF 23,625,000. Key risks: weather disruption, price volatility, thresher downtime.",
      0.78,"Projected Harvest Revenue (RWF)",18500000,23625000,
      ["Confirm advance purchase agreements with 3 wholesalers before harvest","Service threshing machine by August 2026","Apply for crop insurance through MINAGRI"],
      "AgriForecaster v1.0");

    await insight("RCA/0309/2019","recommendation","info",
      "Add Value Through Milling — Triple Margin",
      "Selling paddy rice at RWF 370,000/tonne yields RWF 18.5M on 50T. Processing to polished rice (yield: 67%) and selling at RWF 800,000/tonne would yield RWF 26.8M — a 45% margin improvement.",
      "Value chain analysis: paddy → milled rice (67% outturn). Market price for polished rice: RWF 800/kg. Milling cost: ~RWF 80/kg. Net improvement: RWF 10.3M additional revenue on 2025 harvest volume. Milling equipment cost: estimated RWF 4,500,000.",
      0.71,"Revenue per Tonne (RWF)",370000,536000,
      ["Explore group milling with 2 neighbouring rice cooperatives to share equipment cost","Apply for MINAGRI value chain development grant","Conduct market linkage meeting with Kigali wholesalers"],
      "ValueChain v1.0");

    await insight("RCA/0309/2019","anomaly","info",
      "Member Contribution Concentration Risk",
      "Top 3 members (Edouard, Xavérine, Théophile) contribute 38% of total cooperative savings. If any of the top contributors exits, cooperative financial stability could be impacted.",
      "Herfindahl index: 0.047 (moderately concentrated). Top 3 contributors: RWF 1,410,000 of RWF 32,985,625 in pooled savings. Concentration is typical for early-stage cooperatives but should decrease as membership grows.",
      0.85,"Savings Concentration (top 3 %)",4.3,10,
      ["Set maximum individual savings limit at 5% of total to encourage distribution","Recruit 10 additional active contributing members in 2026"],
      "RiskAnalytics v1.0");

    // ── AGASEKE VISION ────────────────────────────────────────────────────
    await insight("RCA/1060/2010","recommendation","info",
      "Hotel Supply Contract Would Double Annual Revenue",
      "Securing a hotel amenity supply contract (estimated 2,400 baskets/year at RWF 2,500 each = RWF 6M) would increase annual revenue by 75%, far exceeding current market and export sales combined.",
      "Current annual revenue: ~RWF 800,000 (market + NGO export). Hotel contract (2,400 units × RWF 2,500) = RWF 6,000,000. Production capacity: 13 weavers × 250 baskets/year = 3,250 baskets — sufficient to fulfil contract. Key barrier: consistent quality certification.",
      0.84,"Annual Revenue (RWF)",800000,6000000,
      ["Present at Serena Hotel procurement meeting with quality samples","Obtain Rwanda Standards Board quality certification for export grade","Hire 2 apprentice weavers to increase production buffer"],
      "MarketOpportunity v1.0");

    await insight("RCA/1060/2010","insight","warning",
      "Raw Material Cost Inflation Compressing Margins",
      "Sisal and sweetgrass prices rose 18% in 2025 vs. 2024. Material costs now represent 35% of revenue (up from 27%). If product prices are not adjusted, net margin will fall below 30% by Q4 2026.",
      "2025 materials: RWF 280,000 on revenue of RWF 800,000 = 35% cost ratio. 2024 ratio: 27%. Price adjustment needed: +12% on all products to restore 2024 margin. Last price revision: 2023.",
      0.88,"Material Cost Ratio (%)",35,27,
      ["Revise price list with 12% uplift for 2026 export orders","Negotiate bulk purchasing agreement with sisal supplier","Explore use of recycled plastic fibre as material substitute for lower-grade products"],
      "CostAnalytics v1.0");

    // ── KUTC ──────────────────────────────────────────────────────────────
    await insight("RCA/0230/2015","anomaly","critical",
      "Critically Low Savings — Financial Viability at Risk",
      "Total cooperative savings stand at only RWF 5,400 (RWF 200 per member), the lowest of all 10 Gasabo cooperatives. At this level, the cooperative cannot cover even one month of operating costs from reserves.",
      "Savings benchmark: district cooperatives of similar age average RWF 420,000. KUTC is at 1.3% of benchmark. Operating costs (radio network + admin): RWF 15,000/month. Reserve runway: 0.36 months. Risk level: CRITICAL.",
      0.99,"Total Savings (RWF)",5400,420000,
      ["Emergency general assembly to raise mandatory share contribution to RWF 5,000/member","Establish monthly savings mandate of RWF 1,000/member","Explore merger with another transport cooperative if savings not raised in 6 months"],
      "FinancialRisk v2.0");

    await insight("RCA/0230/2015","recommendation","warning",
      "Formalise Driver Insurance — Shared Risk Pool",
      "None of the 27 KUTC members currently benefit from cooperative motor insurance. A group policy could reduce individual premiums by 30-40% vs. individual policies and is required under RURA regulations.",
      "Individual annual motor insurance premium: ~RWF 120,000/vehicle. Group policy estimate (27 vehicles): RWF 2,268,000 total (RWF 84,000/vehicle — 30% saving). Annual cooperative saving for all members: RWF 972,000. RURA compliance requirement: mandatory group third-party insurance for registered taxi cooperatives.",
      0.88,"Insurance Cost per Vehicle (RWF)",120000,84000,
      ["Request group insurance quotes from SONARWA and Sanlam Rwanda","Present cost comparison to members at next general assembly","Budget RWF 84,000/year per member for 2027 group policy"],
      "RiskReduction v1.0");

    // ── GIRUBUZIMA ────────────────────────────────────────────────────────
    await insight("RCA/0998/2013","anomaly","critical",
      "Single-Member Cooperative — Structural Non-Compliance",
      "Girubuzima Kinyinya has operated with only 1 member since 2020. Rwanda cooperative law (Law No. 50/2007) requires a minimum of 7 members for a registered cooperative to remain active.",
      "Current membership: 1. Legal minimum: 7. Period below minimum: approximately 5 years. Risk: RCA may revoke registration if membership is not restored within the compliance window. Health score: 22/100 — lowest in district.",
      0.99,"Active Member Count",1,7,
      ["Launch targeted recruitment to reach 7 members within 90 days","Contact Kinyinya Sector office for cooperative revival support","Reach out to Gasabo District RCA office to notify of restructuring plan"],
      "ComplianceAlert v1.0");

    await insight("RCA/0998/2013","recommendation","critical",
      "Urgent: Apply for District Cooperative Revitalisation Support",
      "Gasabo District's RCA office offers cooperative revitalisation grants of RWF 500,000 for cooperatives below 10 members that submit a credible recovery plan. This is the fastest path to rebuilding.",
      "Grant programme: Gasabo District Cooperative Recovery Fund (2026 cycle). Eligibility: registered cooperatives with <10 members submitting a 12-month recovery plan. Application deadline: August 31, 2026. Potential impact: fund recruitment, purchase 2 additional sows, cover veterinary costs for 12 months.",
      0.91,"Recovery Fund Eligibility",1,1,
      ["Draft 12-month cooperative recovery plan by July 15, 2026","Submit application to Gasabo RCA office before August 31, 2026","Identify 6 potential pig farmers in Kinyinya cell for recruitment"],
      "RecoveryAdvisor v1.0");

    // ── Umucyo Remera ─────────────────────────────────────────────────────
    await insight("RCA-GA-012958","recommendation","info",
      "Negotiate First Bulk Fuel Supply Contract",
      "Collective bulk purchasing can reduce per-litre fuel cost by 8-12% for members. With 55 member businesses, UMUCYO has sufficient volume to negotiate a preferred supplier agreement.",
      "Individual retail price: RWF 1,245/litre (June 2026 average). Estimated bulk price at 50,000L/month: RWF 1,098/litre. Annual member saving: RWF 1,058,400 across the cooperative (at 15,000L/member/year).",
      0.76,"Fuel Cost per Litre (RWF)",1245,1098,
      ["Approach Total Rwanda and Stabex for bulk supply tender","Aggregate monthly volume commitments from all 55 members","Establish shared fuel storage facility (350L tank minimum)"],
      "BulkProcurement v1.0");

    console.log("✓ AI Insights seeded (38 insights across 10 cooperatives)");
  } else {
    console.log("✓ AI Insights already seeded, skipping");
  }

  // ─── Near-term activities (this week) for dashboard alerts ────────────────
  // Insert only if very few upcoming activities exist
  const upcomingCheck = await query(
    `SELECT COUNT(*) FROM activities WHERE date BETWEEN NOW() AND NOW() + INTERVAL '7 days' AND status = 'planned'`
  );
  if (parseInt(upcomingCheck.rows[0].count) < 2) {
    await query(
      `INSERT INTO activities (cooperative_id, title, type, status, date, location, description, budget, actual_cost)
       SELECT id, 'Weekly Members Meeting', 'meeting', 'planned', CURRENT_DATE + 2, 'Cooperative Office', 'Routine weekly check-in and announcements.', 10000, 0
       FROM cooperatives WHERE registration_number = 'RCA/0496/2009' LIMIT 1`
    );
    await query(
      `INSERT INTO activities (cooperative_id, title, type, status, date, location, description, budget, actual_cost)
       SELECT id, 'Quarterly Savings Review', 'planning', 'planned', CURRENT_DATE + 4, 'Community Hall', 'Review Q2 savings targets and member contributions.', 20000, 0
       FROM cooperatives WHERE registration_number = 'RCA/0035/2014' LIMIT 1`
    );
    await query(
      `INSERT INTO activities (cooperative_id, title, type, status, date, location, description, budget, actual_cost)
       SELECT id, 'Coffee Export Preparation', 'production', 'planned', CURRENT_DATE + 6, 'Washing Station', 'Prepare 2 tonnes of processed coffee for export shipment.', 50000, 0
       FROM cooperatives WHERE registration_number = 'RCA/GASABO/2020/001' LIMIT 1`
    );
    console.log("✓ Near-term activities (dashboard alerts)");
  }

  console.log("\n─────────────────────────────────────────────────");
  console.log("Seeding complete.\n");
  console.log("Test Accounts:");
  console.log("  Admin:   admin@coopinsight.rw   / Admin@1234");
  console.log("  Manager: manager@coopinsight.rw / Manager@1234  (Gasabo Coffee)");
  console.log("  Member:  member@coopinsight.rw  / Member@1234   (Gasabo Coffee)");
  console.log("  Govt:    gov@coopinsight.rw     / Gov@1234!");
  console.log("\nRun backend: pnpm dev");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
