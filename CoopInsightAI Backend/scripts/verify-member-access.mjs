/**
 * What an ordinary member may and may not do.
 *
 * A member does not file a dissolution or a change of certificate — those
 * commit the whole cooperative and belong to its president. A member CAN apply
 * to form a cooperative, and CAN report a problem with their own. This checks
 * the server actually enforces that, and that an issue report climbs the same
 * sector -> district -> RCA chain.
 *
 * Non-destructive: files one issue report and rules on it. Nothing is dissolved.
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
  const member = await login("member@coopinsight.rw", "Member@1234");
  const manager = await login("manager@coopinsight.rw", "Manager@1234");
  const sector = await login("remera.officer@coopinsight.rw", "Officer@1234");
  const district = await login("district.officer@coopinsight.rw", "Officer@1234");
  const rca = await login("gov@coopinsight.rw", "Gov@1234!");

  console.log("\n=== 1. What a member may NOT file ===");

  const dis = await req("/cooperative-requests/dissolution", {
    method: "POST",
    token: member.token,
    body: {
      cooperativeId: member.user.cooperativeId,
      dissolutionReason: "I think the cooperative should be closed down because it is not working.",
      assetDisposalPlan: "Sell everything and split the proceeds between the remaining members.",
      membersPresent: 40,
      votesFor: 40,
      votesAgainst: 0,
      votesAbstain: 0,
      liquidatorName: "Someone",
      liquidatorQualification: "accountant",
      liquidatorPhone: "0788000000",
      monitoringCommittee: ["A"],
      contactName: member.user.name,
      contactPhone: "+250788000111",
    },
  });
  check("a member cannot file a dissolution", dis.status === 403, `status ${dis.status}`);

  for (const type of ["change_name", "change_objective", "add_activity", "duplicate_certificate"]) {
    const r = await req(`/service-requests/${type}`, {
      method: "POST",
      token: member.token,
      body: { reason: "Testing whether an ordinary member can commit the cooperative to this." },
    });
    check(`a member cannot file ${type}`, r.status === 403, `status ${r.status}`);
  }

  console.log("\n=== 2. What a member MAY file ===");

  const formation = await req("/cooperative-requests/formation", {
    method: "POST",
    token: member.token,
    body: {
      proposedName: `Test Members Cooperative ${Date.now().toString(36)}`,
      proposedType: "Services",
      sector: "Remera",
      cell: "Nyabisindu",
      memberCount: 12,
      shareCapital: 600000,
      purpose: "A group of twelve traders pooling capital to buy stock together.",
      contactName: member.user.name,
      contactPhone: "+250788000111",
    },
  });
  check(
    "a member CAN apply to form a cooperative",
    formation.status === 201,
    `status ${formation.status}`
  );
  const formationId = formation.json?.data?.id;

  console.log("\n=== 3. Reporting an issue ===");

  const rules = await req("/cooperative-requests/criteria", { token: member.token });
  const issues = rules.json?.data?.issues;
  check("the issue categories are published", (issues?.categories ?? []).length >= 6, `${issues?.categories?.length}`);
  check("the response windows are published", !!issues?.responseDays?.urgent);
  check(
    "the issue procedure is published with 4 stages",
    (rules.json?.data?.procedures?.issue_report ?? []).length === 4
  );
  check(
    "whoMayFile says dissolution is not a member's",
    !(rules.json?.data?.whoMayFile?.dissolution?.roles ?? []).includes("member")
  );
  check(
    "whoMayFile says an issue report IS a member's",
    (rules.json?.data?.whoMayFile?.issue_report?.roles ?? []).includes("member")
  );

  const tooShort = await req("/cooperative-requests/issue", {
    method: "POST",
    token: member.token,
    body: { category: "governance_failure", detail: "bad" },
  });
  check("a report with no real detail is refused", tooShort.status === 400, `status ${tooShort.status}`);

  const badCategory = await req("/cooperative-requests/issue", {
    method: "POST",
    token: member.token,
    body: { category: "not_a_category", detail: "x".repeat(60) },
  });
  check("an unknown category is refused", badCategory.status === 400);

  // Severity floor: ask for "low" on a category the RCA treats as high.
  const filed = await req("/cooperative-requests/issue", {
    method: "POST",
    token: member.token,
    body: {
      category: "financial_irregularity",
      detail:
        "The savings statement read out at the March meeting did not match the figures in my own passbook, and nobody would show us the ledger when we asked.",
      severity: "low",
      confidential: true,
      contactPhone: "+250788000111",
    },
  });
  check("a member CAN report an issue", filed.status === 201, `status ${filed.status}`);
  check(
    "a reporter cannot talk a serious category down to low",
    filed.json?.severity === "high",
    `severity came back ${filed.json?.severity}`
  );
  check(
    "the response window matches the severity",
    filed.json?.responseDays === issues.responseDays.high,
    `${filed.json?.responseDays} days`
  );
  const issueId = filed.json?.data?.id;
  check(
    "the report carries its four stages",
    (filed.json?.data?.process?.stages ?? []).length === 4
  );
  check(
    "it starts with the sector officer",
    filed.json?.data?.process?.currentStageKey === "sector",
    filed.json?.data?.process?.currentStageKey
  );

  console.log("\n  Stages:");
  for (const st of filed.json?.data?.process?.stages ?? []) {
    console.log(`    ${st.order}. ${st.state.toUpperCase().padEnd(8)} ${st.title}`);
  }

  console.log("\n=== 4. The report climbs the same chain ===");

  const sectorSees = await req("/cooperative-requests?type=issue_report", { token: sector.token });
  check(
    "the sector officer sees it",
    (sectorSees.json?.data ?? []).some((r) => r.id === issueId)
  );

  const rcaEarly = await req(`/cooperative-requests/${issueId}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: { decision: "approved" },
  });
  check("the RCA cannot rule on it out of turn", rcaEarly.status === 403, `status ${rcaEarly.status}`);

  const s1 = await req(`/cooperative-requests/${issueId}/decision`, {
    method: "PATCH",
    token: sector.token,
    body: { decision: "approved", note: "Passbook and ledger do not reconcile. Escalating." },
  });
  check("sector officer upholds and forwards", s1.status === 200, s1.json?.message?.slice(0, 70));

  const s2 = await req(`/cooperative-requests/${issueId}/decision`, {
    method: "PATCH",
    token: district.token,
    body: { decision: "approved", note: "District agrees; refer to the RCA for an audit." },
  });
  check("district officer upholds and forwards", s2.status === 200, s2.json?.message?.slice(0, 70));

  // The critical one: ruling on an issue must NOT dissolve the cooperative.
  const coopBefore = await req(`/cooperatives/${member.user.cooperativeId}`, { token: rca.token });
  const ruled = await req(`/cooperative-requests/${issueId}/decision`, {
    method: "PATCH",
    token: rca.token,
    body: {
      decision: "approved",
      note: "Upheld. An independent audit of the savings ledger is directed within 30 days.",
    },
  });
  check("the RCA rules on it", ruled.status === 200, ruled.json?.message?.slice(0, 80));

  const coopAfter = await req(`/cooperatives/${member.user.cooperativeId}`, { token: rca.token });
  check(
    "ruling on an issue did NOT dissolve the cooperative",
    coopAfter.status === 200 && coopAfter.json?.data?.status === "active",
    `status now ${coopAfter.json?.data?.status ?? "GONE"}`
  );
  check(
    "the cooperative still has its permit",
    coopBefore.json?.data?.id === coopAfter.json?.data?.id
  );
  check("the ruling was recorded on the report", !!ruled.json?.data?.issue_resolution);
  check(
    "every stage is resolved",
    (ruled.json?.data?.process?.stages ?? []).every((st) => ["done", "skipped"].includes(st.state)),
    `${ruled.json?.data?.process?.percentComplete}%`
  );

  console.log("\n=== 5. Tidy up ===");
  if (formationId) {
    const w = await req(`/cooperative-requests/${formationId}/withdraw`, {
      method: "PATCH",
      token: member.token,
    });
    check("the test formation application was withdrawn", w.status === 200);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error("\nERROR:", err);
  process.exit(1);
});
