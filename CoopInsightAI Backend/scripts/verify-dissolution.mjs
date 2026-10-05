/**
 * Walks a dissolution the whole way: two assemblies, three officers, a
 * liquidation and an RCA audit. Destructive — it strikes a cooperative off, so
 * reseed afterwards.
 */
const BASE = "http://localhost:5000/api";

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

const run = async () => {
  const manager = await login("manager@coopinsight.rw", "Manager@1234");
  const member = await login("member@coopinsight.rw", "Member@1234");
  const sector = await login("remera.officer@coopinsight.rw", "Officer@1234");
  const district = await login("district.officer@coopinsight.rw", "Officer@1234");
  const rca = await login("gov@coopinsight.rw", "Gov@1234!");

  const coopId = manager.user.cooperativeId;
  console.log(`\nDissolving ${manager.user.cooperativeName} (${coopId})`);

  // How many must attend: three-quarters of the active register.
  const coop = await req(`/cooperatives/${coopId}`, { token: manager.token });
  const activeMembers = Number(coop.json?.data?.member_count ?? 0);
  const present = Math.ceil(activeMembers * 0.75);
  console.log(`  ${activeMembers} members on the register; ${present} must attend\n`);

  console.log("=== 1. Attendance and majority are enforced at filing ===");
  const tooFew = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: manager.token,
    body: {
      cooperativeId: coopId,
      dissolutionReason:
        "The cooperative has had no contracts for eighteen months and the members have voted to close it.",
      assetDisposalPlan:
        "Tools and the office lease are sold, creditors settled, the remainder shared in proportion to shares.",
      membersPresent: 2,
      votesFor: 2,
      votesAgainst: 0,
      votesAbstain: 0,
      assemblyHeldOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      liquidatorName: "MUKAMANA Alice",
      liquidatorQualification: "accountant",
      liquidatorPhone: "0788000000",
      liquidatorIsMember: false,
      monitoringCommittee: ["NIYONZIMA Jean", "UWASE Grace"],
      assetInventoryDone: true,
      contactName: manager.user.name,
      contactPhone: "+250788123456",
    },
  });
  check(
    "filing is refused without three-quarters attendance",
    tooFew.status === 409,
    tooFew.json?.message?.slice(0, 90)
  );

  const tooSplit = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: manager.token,
    body: {
      cooperativeId: coopId,
      dissolutionReason:
        "The cooperative has had no contracts for eighteen months and the members have voted to close it.",
      assetDisposalPlan:
        "Tools and the office lease are sold, creditors settled, the remainder shared in proportion to shares.",
      membersPresent: present,
      votesFor: Math.floor(present * 0.5),
      votesAgainst: Math.ceil(present * 0.5),
      votesAbstain: 0,
      assemblyHeldOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      liquidatorName: "MUKAMANA Alice",
      liquidatorQualification: "accountant",
      liquidatorPhone: "0788000000",
      liquidatorIsMember: false,
      monitoringCommittee: ["NIYONZIMA Jean"],
      assetInventoryDone: true,
      contactName: manager.user.name,
      contactPhone: "+250788123456",
    },
  });
  check(
    "filing is refused on a bare majority (it is a reserved matter)",
    tooSplit.status === 409,
    tooSplit.json?.message?.slice(0, 90)
  );

  const noLiquidator = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: manager.token,
    body: {
      cooperativeId: coopId,
      dissolutionReason:
        "The cooperative has had no contracts for eighteen months and the members have voted to close it.",
      assetDisposalPlan:
        "Tools and the office lease are sold, creditors settled, the remainder shared in proportion to shares.",
      membersPresent: present,
      votesFor: present,
      votesAgainst: 0,
      votesAbstain: 0,
      contactName: manager.user.name,
      contactPhone: "+250788123456",
    },
  });
  check(
    "filing is refused with no liquidator appointed",
    noLiquidator.status === 400,
    noLiquidator.json?.message?.slice(0, 80)
  );

  console.log("\n=== 2. A member cannot file it; the president can ===");
  const byMember = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: member.token,
    body: {
      cooperativeId: coopId,
      dissolutionReason:
        "The cooperative has had no contracts for eighteen months and the members have voted to close it.",
      assetDisposalPlan:
        "Tools and the office lease are sold, creditors settled, the remainder shared in proportion to shares.",
      membersPresent: present,
      votesFor: present,
      votesAgainst: 0,
      votesAbstain: 0,
      assemblyHeldOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      liquidatorName: "MUKAMANA Alice",
      liquidatorQualification: "accountant",
      liquidatorPhone: "0788000000",
      liquidatorIsMember: false,
      monitoringCommittee: ["NIYONZIMA Jean"],
      assetInventoryDone: true,
      contactName: member.user.name,
      contactPhone: "+250788123456",
    },
  });
  check(
    "an ordinary member is refused",
    byMember.status === 403,
    byMember.json?.message?.slice(0, 80)
  );

  const filed = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: manager.token,
    body: {
      cooperativeId: coopId,
      dissolutionReason:
        "The cooperative has had no contracts for eighteen months and the members have voted to close it.",
      assetDisposalPlan:
        "Tools and the office lease are sold, creditors settled, the remainder shared in proportion to shares.",
      membersPresent: present,
      votesFor: present,
      votesAgainst: 0,
      votesAbstain: 0,
      outstandingLiabilities: 450000,
      assemblyHeldOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      rcaNotifiedAt: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      liquidatorName: "MUKAMANA Alice",
      liquidatorQualification: "accountant",
      liquidatorPhone: "0788000000",
      liquidatorIsMember: false,
      monitoringCommittee: ["NIYONZIMA Jean", "UWASE Grace", "HABIMANA Eric"],
      assetInventoryDone: true,
      cmisReference: "CMIS/2026/TMC/001",
      contactName: manager.user.name,
      contactPhone: "+250788123456",
    },
  });
  check("the president files it", filed.status === 201, filed.json?.message?.slice(0, 80));
  const id = filed.json?.data?.id;
  check("all three tiers were notified", (filed.json?.notifiedOfficers ?? 0) >= 3, `${filed.json?.notifiedOfficers}`);
  check("the members were told", !!filed.json?.memberBroadcast?.messageId);
  check(
    "it carries all eight stages",
    (filed.json?.data?.process?.stages ?? []).length === 8,
    `${filed.json?.data?.process?.stages?.length}`
  );
  const filedStages = filed.json?.data?.process?.stages ?? [];
  const currentCount = filedStages.filter((st) => st.state === "current").length;
  check("exactly one stage reads as current", currentCount === 1, `${currentCount} current`);
  check(
    "the current stage is the sector review",
    filed.json?.data?.process?.currentStageKey === "sector",
    filed.json?.data?.process?.currentStageKey
  );

  console.log("\n  The stages as filed:");
  for (const st of filed.json?.data?.process?.stages ?? []) {
    console.log(
      `    ${st.order}. ${st.state.toUpperCase().padEnd(8)} ${st.title}` +
        (st.detail ? `\n         ${st.detail}` : "") +
        (st.blockedReason ? `\n         BLOCKED: ${st.blockedReason}` : "")
    );
  }

  console.log("\n=== 3. The RCA and district see it immediately, at sector stage ===");
  const rcaList = await req("/cooperative-requests?type=dissolution", { token: rca.token });
  const districtList = await req("/cooperative-requests?type=dissolution", { token: district.token });
  check(
    "RCA sees it while it is still with the sector officer",
    (rcaList.json?.data ?? []).some((r) => r.id === id)
  );
  check(
    "district sees it while it is still with the sector officer",
    (districtList.json?.data ?? []).some((r) => r.id === id)
  );

  console.log("\n=== 4. Nobody can decide out of turn ===");
  const rcaEarly = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: { decision: "approved" },
  });
  check(
    "the RCA cannot approve it at sector stage",
    rcaEarly.status === 403,
    rcaEarly.json?.message?.slice(0, 80)
  );

  console.log("\n=== 5. Up the chain ===");
  const s1 = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: sector.token,
    body: { decision: "approved", note: "Grounds verified against the sector register." },
  });
  check("sector officer approves", s1.status === 200, s1.json?.message?.slice(0, 80));

  const s2 = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: district.token,
    body: { decision: "approved", note: "District reviewed; forwarded to the RCA." },
  });
  check("district officer approves", s2.status === 200, s2.json?.message?.slice(0, 80));

  console.log("\n=== 6. The RCA cannot strike it off yet ===");
  const noAudit = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: { decision: "approved" },
  });
  check(
    "refused with no audit",
    noAudit.status === 409 && noAudit.json?.requiresAudit === true,
    noAudit.json?.message?.slice(0, 70)
  );

  const audit = await req(`/cooperative-requests/${id}/audit`, { method: "POST", token: rca.token });
  check("RCA opens its audit", audit.status === 201, audit.json?.message?.slice(0, 60));

  const concluded = await req(`/cooperative-requests/${id}/audit`, {
    method: "PATCH",
    token: rca.token,
    body: {
      recommendation: "allow_dissolution",
      findings:
        "The assembly resolution is in order, the liabilities are accounted for, and the cooperative has not traded for eighteen months.",
    },
  });
  check("RCA concludes the audit", concluded.status === 200, concluded.json?.message?.slice(0, 70));

  const noLiquidation = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: { decision: "approved" },
  });
  check(
    "still refused: the liquidation is unfinished",
    noLiquidation.status === 409 && noLiquidation.json?.requiresDistribution === true,
    noLiquidation.json?.message?.slice(0, 70)
  );

  console.log("\n=== 7. The liquidation, recorded in the app ===");
  const partial = await req(`/service-requests/${id}/dissolution-stage`, {
    method: "PATCH",
    token: manager.token,
    body: { loansRecovered: 1200000, creditorsPaid: 450000, creditorsNotified: true },
  });
  check("partial liquidation saves without closing the stage", partial.status === 200);
  check(
    "the stage is still distribution",
    partial.json?.data?.dissolution_stage === "distribution",
    partial.json?.data?.dissolution_stage
  );

  const closed = await req(`/service-requests/${id}/dissolution-stage`, {
    method: "PATCH",
    token: manager.token,
    body: {
      assetsDistributed: true,
      certificateReturned: true,
      secondAssemblyHeldOn: new Date().toISOString().slice(0, 10),
      liquidatorReport: {
        summary:
          "RWF 1,200,000 recovered, RWF 450,000 paid to creditors, the balance shared in proportion to shares.",
      },
    },
  });
  check("closing the liquidation moves it to complete", closed.json?.data?.dissolution_stage === "complete");

  const afterLiquidation = await req(`/cooperative-requests/${id}`, { token: rca.token });
  const stages = afterLiquidation.json?.data?.process?.stages ?? [];
  console.log("\n  The stages with the liquidation done:");
  for (const st of stages) {
    console.log(
      `    ${st.order}. ${st.state.toUpperCase().padEnd(8)} ${st.title}` +
        (st.blockedReason ? `\n         BLOCKED: ${st.blockedReason}` : "")
    );
  }
  check(
    "stage 8 is now the current step, not blocked",
    stages.find((s) => s.key === "struck_off")?.state === "current",
    stages.find((s) => s.key === "struck_off")?.state
  );

  console.log("\n=== 8. Strike-off ===");
  const struck = await req(`/cooperative-requests/${id}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: { decision: "approved", note: "Audit passed and the liquidation is complete." },
  });
  check("RCA strikes it off", struck.status === 200, struck.json?.message?.slice(0, 120));
  check(
    "every stage is now resolved",
    (struck.json?.data?.process?.stages ?? []).every((st) =>
      ["done", "skipped"].includes(st.state)
    ),
    `${struck.json?.data?.process?.percentComplete}%`
  );

  const dissolvedView = await req("/cooperatives?view=dissolved", { token: rca.token });
  check(
    "it appears in the Dissolved view",
    (dissolvedView.json?.data ?? []).some((c) => c.id === coopId),
    `${dissolvedView.json?.data?.length ?? 0} dissolved`
  );

  const registry = await req("/cooperatives/registry", { token: rca.token });
  const dissolvedCount = registry.json?.data?.find((v) => v.id === "dissolved")?.count;
  check("the registry counts it as dissolved", dissolvedCount >= 1, `${dissolvedCount}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error("\nERROR:", err);
  process.exit(1);
});
