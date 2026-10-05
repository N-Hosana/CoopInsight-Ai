/**
 * A token is a cache; the row is the truth.
 *
 * Reproduces the bug that had the header showing "TMC (Trust Multiservices
 * Cooperative)" while the same page reported "Your account is not linked to a
 * cooperative" and "we could not match your account to an entry in the member
 * register" — a live session holding a JWT whose `cooperativeId` claim had gone
 * stale because the account changed underneath it.
 *
 * Needs DB access as well as HTTP, so it runs through ts-node:
 *     npx ts-node scripts/verify-stale-session.ts
 *
 * Non-destructive: it detaches the account, checks, and puts it back.
 */
import { query } from "../src/config/db";

const BASE = "http://localhost:5000/api";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function req(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

async function post(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as any;
}

async function login(email: string, password: string) {
  const a = await post("/auth/login", { email, password });
  const b = await post("/auth/verify-otp", { userId: a.userId, otp: a.devOtp });
  return { token: b.accessToken as string, user: b.user };
}

(async () => {
  const member = await login("member@coopinsight.rw", "Member@1234");
  const userId = member.user.id as string;
  const original = member.user.cooperativeId as string;

  console.log(`\nToken minted while the account was in ${member.user.cooperativeName}`);
  check("the session starts attached to a cooperative", Boolean(original));

  const ok = await req("/membership/settlement", member.token);
  check("settlement works while token and row agree", ok.status === 200, `status ${ok.status}`);

  // ── Now change the row, exactly as an approved exit does, and keep using
  //    the token that was minted before the change.
  console.log("\n--- row changed underneath the live session (as an approved exit does) ---");
  await query(`UPDATE users SET cooperative_id = NULL WHERE id = $1`, [userId]);

  const detached = await req("/membership/settlement", member.token);
  check(
    "the stale token no longer claims a cooperative the row does not have",
    detached.status === 400,
    `status ${detached.status} — "${detached.json?.message ?? ""}"`
  );

  const me = await req("/auth/me", member.token);
  check(
    "/auth/me reports the row, so the header cannot contradict the page",
    me.status === 200 && me.json?.cooperativeId === null,
    `cooperativeId=${JSON.stringify(me.json?.cooperativeId)}`
  );

  // ── Put it back, still on the same old token, and confirm it recovers
  //    WITHOUT the user having to sign out and in again.
  console.log("\n--- row restored; the same old token should recover on its own ---");
  await query(`UPDATE users SET cooperative_id = $2 WHERE id = $1`, [userId, original]);

  const recovered = await req("/membership/settlement", member.token);
  check(
    "the same token works again once the row is right",
    recovered.status === 200,
    `status ${recovered.status}`
  );

  const mine = await req("/membership/exit-requests/mine", member.token);
  check(
    "the account matches its entry in the member register",
    mine.status === 200 && mine.json?.memberRecord != null,
    mine.json?.memberRecord ? `matched ${mine.json.memberRecord.membership_number}` : "NOT matched"
  );

  // ── And a suspended account is stopped at the door rather than part-way in.
  console.log("\n--- a suspended account ---");
  await query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [userId]);
  const suspended = await req("/membership/settlement", member.token);
  check(
    "a suspended account is refused on its existing token",
    suspended.status === 403,
    `status ${suspended.status}`
  );
  await query(`UPDATE users SET status = 'active' WHERE id = $1`, [userId]);

  const restored = await req("/membership/settlement", member.token);
  check("un-suspending restores access immediately", restored.status === 200);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
