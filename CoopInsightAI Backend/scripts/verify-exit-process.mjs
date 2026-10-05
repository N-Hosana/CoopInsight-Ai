/**
 * End-to-end smoke test of the reworked processes, against a running backend.
 *
 * Drives the real HTTP API the way the app does: log in as each account, walk a
 * member exit all the way to the certificate, and check that the register views,
 * the dissolution visibility rules and the security lockdown all behave.
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
  const step1 = await req("/auth/login", { method: "POST", body: { email, password } });
  if (!step1.json?.devOtp) throw new Error(`login failed for ${email}: ${JSON.stringify(step1.json)}`);
  const step2 = await req("/auth/verify-otp", {
    method: "POST",
    body: { userId: step1.json.userId, otp: step1.json.devOtp },
  });
  if (!step2.json?.accessToken) throw new Error(`otp failed for ${email}`);
  return { token: step2.json.accessToken, user: step2.json.user };
}

const run = async () => {
  console.log("\n=== 1. Every tier of the chain can log in ===");
  const member = await login("member@coopinsight.rw", "Member@1234");
  const manager = await login("manager@coopinsight.rw", "Manager@1234");
  const sector = await login("remera.officer@coopinsight.rw", "Officer@1234");
  const district = await login("district.officer@coopinsight.rw", "Officer@1234");
  const rca = await login("gov@coopinsight.rw", "Gov@1234!");
  const admin = await login("admin@coopinsight.rw", "Admin@1234");

  check("member logs in", !!member.token);
  check("manager logs in", !!manager.token);
  check("sector officer logs in", !!sector.token);
  check("district officer logs in", !!district.token);
  check("RCA officer logs in", !!rca.token);

  check(
    "sector officer carries oversightLevel=sector",
    sector.user.oversightLevel === "sector",
    `got ${sector.user.oversightLevel}`
  );
  check(
    "sector officer is scoped to Remera (TMC's sector)",
    sector.user.sector === "Remera",
    `got ${sector.user.sector}`
  );
  check(
    "district officer is Froduard",
    district.user.name === "Froduard",
    `got ${district.user.name}`
  );
  check(
    "district officer carries oversightLevel=district",
    district.user.oversightLevel === "district"
  );
  check("RCA officer carries oversightLevel=rca", rca.user.oversightLevel === "rca");

  console.log("\n=== 2. Security console is closed to officers ===");
  for (const [name, who] of [
    ["sector", sector],
    ["district", district],
    ["RCA", rca],
  ]) {
    const r = await req("/security/audit-logs", { token: who.token });
    check(`${name} officer is refused /security/audit-logs`, r.status === 403, `status ${r.status}`);
  }
  const adminSec = await req("/security/audit-logs", { token: admin.token });
  check("admin still reaches /security/audit-logs", adminSec.status === 200);

  console.log("\n=== 3. The register, sliced ===");
  const registry = await req("/cooperatives/registry", { token: rca.token });
  const views = registry.json?.data ?? [];
  check("registry returns five categories", views.length === 5, `${views.length} views`);
  for (const id of ["active", "not_active", "at_risk", "applications", "dissolved"]) {
    check(`view "${id}" is present`, views.some((v) => v.id === id));
  }
  for (const v of views) {
    console.log(`        ${v.label.padEnd(28)} ${String(v.count).padStart(3)}  (${v.kind})`);
  }
  const notActive = views.find((v) => v.id === "not_active");
  check("not active carries its reasons", (notActive?.reasons ?? []).length > 0);
  const onRegister = ["active", "not_active", "at_risk"]
    .map((id) => views.find((v) => v.id === id)?.count ?? 0)
    .reduce((a, b) => a + b, 0);
  check(
    "active + not active + at risk = the whole register",
    onRegister === registry.json?.onRegister,
    `${onRegister} vs ${registry.json?.onRegister}`
  );

  const licensed = await req("/cooperatives?view=active&limit=100", { token: rca.token });
  check("active view returns rows", (licensed.json?.data ?? []).length > 0);
  const firstRow = licensed.json?.data?.[0];
  check("rows carry their permit", firstRow ? firstRow.permit !== undefined : false);
  check(
    "rows carry an archived-member count",
    firstRow ? firstRow.archived_member_count !== undefined : false
  );

  const requestsView = await req("/cooperatives?view=applications", { token: rca.token });
  check(
    "a requests view refuses to be read as cooperatives",
    requestsView.status === 400 && !!requestsView.json?.redirectTo,
    `status ${requestsView.status}`
  );

  console.log("\n=== 4. The exit process, end to end ===");
  const policy = await req("/membership/policy", { token: member.token });
  check(
    "policy publishes the seven steps",
    (policy.json?.data?.process?.steps ?? []).length === 7,
    `${policy.json?.data?.process?.steps?.length} steps`
  );
  check(
    "policy publishes the settlement methods",
    (policy.json?.data?.settlement?.methods ?? []).length === 6
  );

  // Clear any request left by an earlier run so the test is repeatable.
  const mine = await req("/membership/exit-requests/mine", { token: member.token });
  for (const r of mine.json?.data ?? []) {
    if (["pending", "under_review", "meeting_scheduled", "meeting_held"].includes(r.status)) {
      await req(`/membership/exit-requests/${r.id}/withdraw`, {
        method: "PATCH",
        token: member.token,
      });
    }
  }

  const filed = await req("/membership/exit-requests", {
    method: "POST",
    token: member.token,
    body: {
      reasonCategory: "relocation",
      reasonDetail: "I am moving to Musanze for work and can no longer take part in the cooperative.",
      savingsInstruction: "refund_mobile_money",
      contactPhone: "+250788000111",
      acknowledgedTerms: true,
    },
  });
  check("member files a request", filed.status === 201, `status ${filed.status}`);
  const requestId = filed.json?.data?.id;
  check("the filed request carries its process", !!filed.json?.data?.process);
  check(
    "step 1 is done, step 2 is next",
    filed.json?.data?.process?.steps?.[0]?.state === "done" &&
      filed.json?.data?.process?.currentStepKey === "assembly_called",
    `current=${filed.json?.data?.process?.currentStepKey}`
  );

  // Releasing before an assembly must be refused.
  const early = await req(`/membership/exit-requests/${requestId}/decision`, {
    method: "PATCH",
    token: manager.token,
    body: { decision: "approved" },
  });
  check(
    "release is refused with no assembly",
    early.status === 409 && early.json?.requiresMeeting === true,
    `status ${early.status}`
  );

  // Settling before an assembly must also be refused.
  const earlySettle = await req(`/membership/exit-requests/${requestId}/settlement`, {
    method: "POST",
    token: manager.token,
    body: { settlementMethod: "mobile_money" },
  });
  check(
    "settlement is refused before the assembly votes",
    earlySettle.status === 409,
    `status ${earlySettle.status}`
  );

  // Call the assembly. 4 days out clears the 3-day notice requirement.
  const when = new Date(Date.now() + 4 * 86_400_000);
  const meeting = await req(`/membership/exit-requests/${requestId}/meeting`, {
    method: "POST",
    token: manager.token,
    body: {
      scheduledFor: when.toISOString(),
      location: "TMC Office, Remera",
    },
  });
  check("manager calls the assembly", meeting.status === 201, JSON.stringify(meeting.json?.message));
  check(
    "convening broadcasts to the members",
    !!meeting.json?.broadcast && meeting.json.broadcast.messageId,
    `reached ${meeting.json?.broadcast?.accountsReached}`
  );
  const meetingId = meeting.json?.meetingId;

  // The broadcast must be readable as a message, not just a notification.
  const inbox = await req("/messages?limit=20", { token: member.token });
  const notice = (inbox.json?.data ?? []).find((m) =>
    String(m.subject ?? "").startsWith("Notice of general assembly")
  );
  check("the member can read the notice in Messages", !!notice, notice?.subject ?? "not found");

  // Record the vote. TMC's quorum is three-quarters of its active members.
  const detail = await req(`/membership/exit-requests/${requestId}`, { token: manager.token });
  const scheduled = (detail.json?.data?.meetings ?? []).find((m) => m.status === "scheduled");
  const present = scheduled?.quorumRequired ?? 0;
  const forVotes = Math.ceil(present * 0.8);
  const recorded = await req(`/membership/exit-requests/${requestId}/meeting/${meetingId}`, {
    method: "PATCH",
    token: manager.token,
    body: {
      membersPresent: present,
      votesFor: forVotes,
      votesAgainst: present - forVotes,
      votesAbstain: 0,
      resolution: "approve_exit",
      resolutionNote: "The assembly accepted that the member is relocating and released them.",
    },
  });
  check("assembly vote is recorded", recorded.status === 200, JSON.stringify(recorded.json?.message));
  check("quorum was met", recorded.json?.quorum?.met === true);

  // Release must still be refused: nothing has been settled.
  const beforeSettle = await req(`/membership/exit-requests/${requestId}/decision`, {
    method: "PATCH",
    token: manager.token,
    body: { decision: "approved" },
  });
  check(
    "release is refused with no settlement recorded",
    beforeSettle.status === 409 && beforeSettle.json?.requiresSettlement === true,
    `status ${beforeSettle.status}`
  );

  // Price it, then settle.
  const preview = await req(`/membership/exit-requests/${requestId}/settlement`, {
    token: manager.token,
  });
  check("settlement preview computes the figures", !!preview.json?.data?.calculated);
  check(
    "the preview suggests the method the member asked for",
    preview.json?.data?.suggestedMethod === "mobile_money",
    preview.json?.data?.suggestedMethod
  );
  const netPayable = preview.json?.data?.calculated?.netPayable ?? 0;
  console.log(`        net payable computed as RWF ${netPayable.toLocaleString()}`);

  // Paying more than is due must be refused.
  const overpay = await req(`/membership/exit-requests/${requestId}/settlement`, {
    method: "POST",
    token: manager.token,
    body: {
      settlementMethod: "mobile_money",
      paymentReference: "MOMO-TEST-1",
      amountPaid: netPayable + 50_000,
    },
  });
  check("overpayment is refused", overpay.status === 400, `status ${overpay.status}`);

  // Underpaying without a reason must be refused.
  if (netPayable > 0) {
    const underpay = await req(`/membership/exit-requests/${requestId}/settlement`, {
      method: "POST",
      token: manager.token,
      body: {
        settlementMethod: "mobile_money",
        paymentReference: "MOMO-TEST-2",
        amountPaid: Math.max(0, netPayable - 1),
      },
    });
    check("unexplained underpayment is refused", underpay.status === 400, `status ${underpay.status}`);
  }

  const settled = await req(`/membership/exit-requests/${requestId}/settlement`, {
    method: "POST",
    token: manager.token,
    body: {
      settlementMethod: "mobile_money",
      paymentReference: "MOMO-TEST-3",
      amountPaid: netPayable,
      notes: "Paid in full to the number on the request.",
    },
  });
  check("settlement is recorded", settled.status === 201, JSON.stringify(settled.json?.message));
  check("step 5 now reads done", settled.json?.data?.process?.steps?.[4]?.state === "done");

  // Member confirms receipt.
  const ack = await req(`/membership/exit-requests/${requestId}/settlement/acknowledge`, {
    method: "PATCH",
    token: member.token,
  });
  check("member confirms receipt", ack.status === 200, JSON.stringify(ack.json?.message));

  // Now the release goes through, and issues the certificate.
  const released = await req(`/membership/exit-requests/${requestId}/decision`, {
    method: "PATCH",
    token: manager.token,
    body: { decision: "approved", note: "Released by the assembly; settled in full." },
  });
  check("release is recorded", released.status === 200, JSON.stringify(released.json?.message));
  const certificate = released.json?.certificate;
  check("a certificate was issued", !!certificate?.certificate_number, certificate?.certificate_number);
  check("the certificate carries a verification code", !!certificate?.verification_code);
  check(
    "the certificate states the membership period",
    !!certificate?.statement && certificate.statement.includes("registered member")
  );
  check("the member was archived", !!released.json?.data?.member_archived_at);
  check(
    "all seven steps are now done",
    (released.json?.data?.process?.steps ?? []).every((s) =>
      ["done", "skipped"].includes(s.state)
    ),
    `${released.json?.data?.process?.percentComplete}%`
  );

  // The departed member still reaches their certificate.
  const heldCerts = await req("/membership/certificates", { token: member.token });
  check(
    "the departed member can still open their certificate",
    (heldCerts.json?.data ?? []).some((c) => c.certificate_number === certificate.certificate_number)
  );

  // Anyone can verify the code.
  const verified = await req(`/membership/certificates/verify/${certificate.verification_code}`, {
    token: sector.token,
  });
  check("the code verifies", verified.status === 200 && verified.json?.valid === true);

  // The archive shows them.
  const archive = await req("/membership/archive", { token: manager.token });
  check(
    "the archived member appears in the archive",
    (archive.json?.data ?? []).some((m) => m.certificate_number === certificate.certificate_number),
    `${archive.json?.data?.length ?? 0} archived`
  );

  console.log("\n=== 5. Dissolution visibility ===");
  const dissolutionsRca = await req("/cooperative-requests?type=dissolution", { token: rca.token });
  const dissolutionsDistrict = await req("/cooperative-requests?type=dissolution", {
    token: district.token,
  });
  check("RCA can list dissolutions", dissolutionsRca.status === 200);
  check("district can list dissolutions", dissolutionsDistrict.status === 200);

  const anyRequest = await req("/cooperative-requests", { token: sector.token });
  const withProcess = (anyRequest.json?.data ?? [])[0];
  if (withProcess) {
    check("requests carry their named stages", !!withProcess.process?.stages?.length);
    console.log(
      `        ${withProcess.reference}: ${withProcess.process.stages.length} stages, ` +
        `${withProcess.process.percentComplete}% — ${withProcess.process.nextAction ?? "no action"}`
    );
  } else {
    console.log("        (no requests on file to inspect — skipped)");
  }

  const criteria = await req("/cooperative-requests/criteria", { token: sector.token });
  check(
    "the dissolution procedure is published with 8 stages",
    (criteria.json?.data?.procedures?.dissolution ?? []).length === 8,
    `${criteria.json?.data?.procedures?.dissolution?.length} stages`
  );
  check(
    "the formation procedure is published",
    (criteria.json?.data?.procedures?.formation ?? []).length === 4
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error("\nSMOKE TEST ERROR:", err);
  process.exit(1);
});
