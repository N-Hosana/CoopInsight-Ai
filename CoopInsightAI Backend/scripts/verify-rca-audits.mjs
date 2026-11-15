/**
 * Walks the RCA audit service end to end with the seeded logins:
 *
 *   A. a manager's request climbing sector → district → RCA and back down,
 *      confirmed, put on the calendar, held and reported;
 *   B. a district officer's request going straight to the RCA, waitlisted,
 *      approved, and the requester asking for another date;
 *   C. returned for more information, resubmitted, withdrawn;
 *   D. an audit the RCA announces unasked, acknowledged by the cooperative;
 *   E. the general audit programme — committees, a monthly sector round, a
 *      trimester sensitization session.
 *
 * Non-destructive: everything it creates is deleted at the end, including the
 * notices it sends, so it can be run against the demo database.
 */
import pg from "pg";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
const BASE = "http://localhost:5000/api";
const startedAt = new Date();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const a = await req("/auth/login", { method: "POST", body: { email, password } });
  const b = await req("/auth/verify-otp", {
    method: "POST",
    body: { userId: a.json.userId, otp: a.json.devOtp },
  });
  return { token: b.json.accessToken, user: b.json.user };
}

/**
 * A member's token. The demo member's password may have been changed on a
 * working database, and all this run needs is SOME member account to be
 * refused, so it signs a token for one rather than depending on a password.
 */
async function memberToken() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  await client.connect();
  const row = (await client.query(`SELECT id, email, role, cooperative_id, name FROM users WHERE role = 'member' AND status = 'active' LIMIT 1`)).rows[0];
  await client.end();
  const token = jwt.sign(
    { userId: row.id, email: row.email, role: row.role, cooperativeId: row.cooperative_id, name: row.name },
    process.env.JWT_SECRET,
    { expiresIn: "10m" }
  );
  return { token, user: row };
}

/** datetime-local string `days` from now at 09:00. */
const inDays = (days, hour = 9) => {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
};

const act = (who, id, body) => req(`/rca-audits/${id}/actions`, { method: "POST", token: who.token, body });
const view = async (who, id) => (await req(`/rca-audits/${id}`, { token: who.token })).json?.data;

const created = { audits: [], rounds: [], committees: [] };

async function run() {
  const manager = await login("manager@coopinsight.rw", "Manager@1234");
  const member = await memberToken();
  const sector = await login("remera.officer@coopinsight.rw", "Officer@1234");
  const district = await login("district.officer@coopinsight.rw", "Officer@1234");
  const rca = await login("gov@coopinsight.rw", "Gov@1234!");

  const meta = (await req("/rca-audits/meta", { token: rca.token })).json.data;
  const tmc = meta.cooperatives.find((c) => c.id === manager.user.cooperativeId);
  const other = meta.cooperatives.find((c) => c.id !== tmc.id);
  console.log(`\nCooperatives: ${tmc.name} (${tmc.sector}), ${other.name} (${other.sector})`);

  const reasons =
    "Members report that the last two general assemblies had no financial report and minutes are missing.";

  // ── A. Full chain ────────────────────────────────────────────────────────
  console.log("\nA. Manager's request through the whole chain");
  const m = await req("/rca-audits", {
    method: "POST", token: member.token,
    body: { auditKind: "general", reasonCategory: "member_complaints", reasons, preferredDate: inDays(20).slice(0, 10) },
  });
  check("a member cannot request an audit", m.status === 403, `${m.status}`);

  const short = await req("/rca-audits", {
    method: "POST", token: manager.token,
    body: { auditKind: "general", reasonCategory: "other", reasons: "Too short", preferredDate: inDays(20).slice(0, 10) },
  });
  check("reasons must be explained", short.status === 400, short.json?.message);

  const a = await req("/rca-audits", {
    method: "POST", token: manager.token,
    body: { auditKind: "general", reasonCategory: "member_complaints", reasons, preferredDate: inDays(20).slice(0, 10) },
  });
  check("manager files a general audit request", a.status === 201, a.json?.message);
  const aId = a.json?.data?.id;
  created.audits.push(aId);

  const dup = await req("/rca-audits", {
    method: "POST", token: manager.token,
    body: { auditKind: "general", reasonCategory: "member_complaints", reasons, preferredDate: inDays(20).slice(0, 10) },
  });
  check("a second open general audit is refused", dup.status === 409, dup.json?.message);

  let rv = await view(rca, aId);
  check("RCA can already see it, waiting on the sector", rv?.viewerPosition === "upcoming" && /sector/.test(rv?.waitingOn ?? ""),
    `${rv?.viewerPosition}, waiting on ${rv?.waitingOn}`);
  const early = await act(rca, aId, { action: "approve" });
  check("RCA cannot act out of turn", early.status === 403, early.json?.message);
  let sv = await view(sector, aId);
  check("sector officer sees it is their turn", sv?.viewerPosition === "your_turn", sv?.allowedActions?.join(","));
  check("route for a manager's request has 10 stages", sv?.process?.stages?.length === 10, `${sv?.process?.stages?.length}`);

  check("sector forwards", (await act(sector, aId, { action: "forward", note: "Concern is credible." })).status === 200);
  check("district forwards", (await act(district, aId, { action: "forward" })).status === 200);
  const noScope = await act(rca, aId, { action: "approve", scheduledStart: inDays(14) });
  check("approval needs a checklist", noScope.status === 400, noScope.json?.message);
  const tooSoon = await act(rca, aId, { action: "approve", scheduledStart: inDays(1), scopeIds: ["gen_assembly"] });
  check("approval needs enough notice", tooSoon.status === 400, tooSoon.json?.message);
  const ap = await act(rca, aId, {
    action: "approve", scheduledStart: inDays(14), scheduledEnd: inDays(14, 16),
    scopeIds: ["gen_assembly", "gen_records", "gen_members"], customScope: ["Minutes of the last two assemblies"],
    auditTeam: "RCA Gasabo team", instructions: "Have the minutes books ready.",
  });
  check("RCA approves with date and checklist", ap.status === 200 && ap.json?.data?.status === "relay_district", ap.json?.message);
  check("the checklist includes the custom item", ap.json?.data?.scope?.length === 4);

  const mv = await view(manager, aId);
  check("manager sees approval travelling back down", mv?.viewerPosition === "upcoming" && mv?.status === "relay_district",
    `${mv?.statusLabel}; waiting on ${mv?.waitingOn}`);
  check("district relays", (await act(district, aId, { action: "relay" })).status === 200);
  check("sector relays", (await act(sector, aId, { action: "relay" })).status === 200);
  const conf = await act(manager, aId, { action: "confirm" });
  check("manager confirms", conf.status === 200 && conf.json?.data?.status === "confirmed", conf.json?.message);
  const conv = await act(manager, aId, { action: "convene", location: "TMC office, Remera", message: "Bring your share books." });
  check("manager puts it on the calendar and tells members", conv.status === 200 && conv.json?.data?.activity_id, conv.json?.message);
  check("convene not offered twice", !(conv.json?.data?.allowedActions ?? []).includes("convene"));
  const startedV = await act(rca, aId, { action: "start" });
  check("RCA starts the audit", startedV.json?.data?.status === "in_progress");
  const scope = startedV.json?.data?.scope ?? [];
  const done = await act(rca, aId, {
    action: "complete", overallRating: "needs_improvement",
    summary: "Assemblies were held but minutes were incomplete and not signed.",
    findings: scope.map((s, i) => ({ scopeId: s.id, result: i === 0 ? "concern" : "satisfactory", note: "Checked." })),
    recommendations: ["Sign and file minutes within 7 days of every assembly."],
    followUpBy: inDays(60).slice(0, 10),
  });
  check("RCA records findings", done.json?.data?.status === "completed", done.json?.message);
  check("process is 100% complete", done.json?.data?.process?.percentComplete === 100, `${done.json?.data?.process?.percentComplete}%`);
  const notified = (await req("/notifications", { token: manager.token })).json;
  const sawFindings = JSON.stringify(notified ?? {}).includes("audit findings");
  check("manager is told the findings", sawFindings);

  // ── B. District request, waitlist, reschedule ──────────────────────────────
  console.log("\nB. District officer's request");
  const b = await req("/rca-audits", {
    method: "POST", token: district.token,
    body: { auditKind: "financial", cooperativeId: other.id, reasonCategory: "financial_irregularity", reasons, preferredDate: inDays(30).slice(0, 10) },
  });
  const bId = b.json?.data?.id;
  created.audits.push(bId);
  const bv = await view(district, bId);
  check("goes straight to the RCA", bv?.status === "pending_rca", bv?.statusLabel);
  check("route has 6 stages (no sector review, no relays)", bv?.process?.stages?.length === 6, `${bv?.process?.stages?.length}`);
  check("RCA waitlists it", (await act(rca, bId, { action: "waitlist", note: "Audit team fully booked this month." })).json?.data?.status === "waitlisted");
  const bap = await act(rca, bId, { action: "approve", scheduledStart: inDays(21), scopeIds: ["fin_books", "fin_cash_bank"] });
  check("approved from the waiting list straight to the requester", bap.json?.data?.status === "awaiting_confirmation", bap.json?.data?.statusLabel);
  const rs = await act(district, bId, { action: "request_reschedule", proposedDate: inDays(28).slice(0, 10), note: "Officer on leave that week." });
  check("requester asks for another date", rs.json?.data?.status === "reschedule_requested");
  const re = await act(rca, bId, { action: "approve", scheduledStart: inDays(28), scopeIds: ["fin_books", "fin_cash_bank"] });
  check("new date goes straight back to the requester", re.json?.data?.status === "awaiting_confirmation");
  check("RCA cancels it", (await act(rca, bId, { action: "cancel", note: "Verification test." })).json?.data?.status === "cancelled");

  // ── C. Returned, resubmitted, withdrawn ──────────────────────────────────
  console.log("\nC. Return and withdraw");
  const c = await req("/rca-audits", {
    method: "POST", token: manager.token,
    body: { auditKind: "financial", reasonCategory: "routine_check", reasons, preferredDate: inDays(25).slice(0, 10) },
  });
  const cId = c.json?.data?.id;
  created.audits.push(cId);
  check("sector returns it", (await act(sector, cId, { action: "return", note: "Which financial year?" })).json?.data?.status === "returned");
  const stuck = await act(sector, cId, { action: "forward" });
  check("cannot forward while returned", stuck.status === 403);
  const resub = await act(manager, cId, { action: "resubmit", reasons: `${reasons} The concern is the 2025 financial year.` });
  check("manager resubmits", resub.json?.data?.status === "pending_sector");
  check("manager withdraws", (await act(manager, cId, { action: "withdraw" })).json?.data?.status === "withdrawn");

  // ── D. Announced by the RCA ──────────────────────────────────────────────
  console.log("\nD. RCA-announced audit");
  const notRca = await req("/rca-audits/announce", { method: "POST", token: district.token, body: {} });
  check("only the RCA announces", notRca.status === 403);
  const d = await req("/rca-audits/announce", {
    method: "POST", token: rca.token,
    body: {
      auditKind: "financial", cooperativeIds: [tmc.id], reasons: "Random financial check this quarter.",
      scheduledStart: inDays(10), scopeIds: ["fin_books", "fin_loans"], auditTeam: "RCA finance team",
    },
  });
  check("RCA announces an audit", d.status === 201, d.json?.message);
  const dId = d.json?.data?.created?.[0]?.id;
  created.audits.push(dId);
  const dv = await view(manager, dId);
  check("manager sees it and it is their turn", dv?.viewerPosition === "your_turn" && dv?.allowedActions?.includes("acknowledge"));
  check("manager acknowledges", (await act(manager, dId, { action: "acknowledge" })).json?.data?.status === "confirmed");
  const sdv = await view(sector, dId);
  check("sector officer can see it", sdv?.status === "confirmed");
  check("RCA cancels it", (await act(rca, dId, { action: "cancel", note: "Verification test." })).json?.data?.status === "cancelled");

  // ── E. Programme ─────────────────────────────────────────────────────────
  console.log("\nE. General audit programme");
  const prog = (await req("/rca-audits/programme", { token: district.token })).json?.data;
  check("programme lists every sector and the district cadences", prog?.sectorRounds?.length > 0 && prog?.district?.length === 2,
    `${prog?.sectorRounds?.length} sectors; ${prog?.district?.map((x) => `${x.label} ${x.state}`).join("; ")}`);
  const sectorProg = (await req("/rca-audits/programme", { token: sector.token })).json?.data;
  check("a sector officer sees only their sector", sectorProg?.sectorRounds?.length === 1 && sectorProg?.district?.length === 0);
  const memberProg = await req("/rca-audits/programme", { token: member.token });
  check("members cannot open the programme", memberProg.status === 403);

  const existingCommittee = (await req("/rca-audits/committees", { token: sector.token })).json?.data
    ?.find((x) => x.level === "sector" && x.sector === tmc.sector);
  const com = await req("/rca-audits/committees", { method: "POST", token: sector.token, body: { level: "sector", sector: tmc.sector } });
  check("sector officer sets up their committee", [200, 201].includes(com.status), com.json?.message);
  if (!existingCommittee) created.committees.push(com.json?.data?.id);
  const otherSector = meta.sectors.find((s) => s !== tmc.sector);
  if (otherSector) {
    const wrong = await req("/rca-audits/committees", { method: "POST", token: sector.token, body: { level: "sector", sector: otherSector } });
    check("but not another sector's", wrong.status === 403);
  }
  const mem = await req(`/rca-audits/committees/${com.json?.data?.id}/members`, {
    method: "POST", token: sector.token, body: { name: "Test Committee Member", position: "Secretary" },
  });
  check("adds a committee member", mem.status === 201);
  await req(`/rca-audits/committees/${com.json?.data?.id}/members/${mem.json?.data?.id}`, { method: "DELETE", token: sector.token });

  const r = await req("/rca-audits/rounds", {
    method: "POST", token: sector.token,
    body: { roundType: "sector_general", sector: tmc.sector, scheduledFor: inDays(5), location: "Remera sector office", agenda: "Monthly visit." },
  });
  check("sector officer schedules the monthly round", r.status === 201, r.json?.message);
  created.rounds.push(r.json?.data?.id);
  const mgrRounds = (await req("/rca-audits/rounds", { token: manager.token })).json?.data ?? [];
  check("the manager sees the visit", mgrRounds.some((x) => x.id === r.json?.data?.id));
  const rec = await req(`/rca-audits/rounds/${r.json?.data?.id}/record`, {
    method: "PATCH", token: sector.token,
    body: { heldOn: inDays(5).slice(0, 10), minutes: "All cooperatives visited.", outcomes: [{ cooperativeId: tmc.id, attended: true, rating: "satisfactory" }] },
  });
  check("records the round as held", rec.status === 200, rec.json?.message);

  const sectorSens = await req("/rca-audits/rounds", {
    method: "POST", token: sector.token,
    body: { roundType: "sensitization", scheduledFor: inDays(9), location: "x", agenda: "x" },
  });
  check("a sector officer cannot call the district sensitization", sectorSens.status === 403);
  const sens = await req("/rca-audits/rounds", {
    method: "POST", token: district.token,
    body: { roundType: "sensitization", scheduledFor: inDays(9), location: "Gasabo District Hall", agenda: "Obligations of cooperative leaders." },
  });
  check("district schedules the trimester sensitization", sens.status === 201, sens.json?.message);
  created.rounds.push(sens.json?.data?.id);
  const cancel = await req(`/rca-audits/rounds/${sens.json?.data?.id}/cancel`, { method: "PATCH", token: district.token, body: { reason: "Test." } });
  check("cancels it", cancel.status === 200);
}

/** Removes everything the run created, including the notices it sent. */
async function cleanup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  await client.connect();
  const audits = created.audits.filter(Boolean);
  const rounds = created.rounds.filter(Boolean);
  const activityIds = [
    ...(await client.query(`SELECT activity_id FROM audit_requests WHERE id = ANY($1::uuid[]) AND activity_id IS NOT NULL`, [audits])).rows,
    ...(await client.query(`SELECT activity_id FROM general_audit_round_cooperatives WHERE round_id = ANY($1::uuid[]) AND activity_id IS NOT NULL`, [rounds])).rows,
  ].map((r) => r.activity_id);
  await client.query(`DELETE FROM audit_requests WHERE id = ANY($1::uuid[])`, [audits]);
  await client.query(`DELETE FROM general_audit_rounds WHERE id = ANY($1::uuid[])`, [rounds]);
  await client.query(`DELETE FROM audit_committees WHERE id = ANY($1::uuid[])`, [created.committees.filter(Boolean)]);
  await client.query(`DELETE FROM activities WHERE id = ANY($1::uuid[])`, [activityIds]);
  await client.query(`DELETE FROM messages WHERE created_at >= $1 AND subject LIKE 'Notice: %audit by the RCA%'`, [startedAt]);
  const n = await client.query(
    `DELETE FROM notifications WHERE created_at >= $1
       AND (link = '/rca-audits' OR title LIKE 'Notice: %audit by the RCA%' OR title LIKE 'Sector general audit%' OR title LIKE 'Sensitization session%')`,
    [startedAt]
  );
  await client.end();
  console.log(`\nCleaned up ${audits.length} audits, ${rounds.length} rounds, ${activityIds.length} calendar entries, ${n.rowCount} notifications.`);
}

run()
  .catch((err) => {
    console.error("\nERROR:", err);
    failures += 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (err) {
      console.error("Cleanup failed:", err.message);
    }
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
