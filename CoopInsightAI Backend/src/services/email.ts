import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFICATION CODES BY EMAIL, THROUGH SUPABASE AUTH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Supabase has no "send this email" call; what it has is Supabase Auth, which
 * generates a one-time code, emails it, and later says whether a code is right.
 * That is all this application needs email for, so Supabase does both halves:
 *
 *   sendEmailCode(email)          Supabase generates a code and emails it
 *   verifyEmailCode(email, code)  Supabase says whether the code is the one sent
 *
 * The application never sees the code. Accounts, passwords and sessions stay in
 * this application's own database; the Supabase user that is created for each
 * address exists only so that Supabase has somewhere to send to.
 *
 * Who sends the email, what it says and how long a code lasts are set in the
 * Supabase dashboard (Authentication → Emails), not here. The templates must
 * contain {{ .Token }} or the email carries a link instead of a code.
 */

let client: SupabaseClient | null = null;

export const emailConfigured = (): boolean => !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;

function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      // A server holds no Supabase session: every call stands alone.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export type Delivery = { sent: true } | { sent: false; reason: string; rateLimited?: boolean };

/** Ask Supabase to email a fresh code to this address. Never throws. */
export async function sendEmailCode(email: string): Promise<Delivery> {
  if (!emailConfigured()) return { sent: false, reason: "Supabase is not configured" };
  try {
    const { error } = await supabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) return { sent: false, reason: error.message, rateLimited: error.status === 429 };
    console.log(`[EMAIL] Verification code sent to ${email}`);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, reason: err?.message ?? "Supabase could not be reached" };
  }
}

/** Whether this is the code Supabase emailed to this address. A code works once. */
export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const { data, error } = await supabase().auth.verifyOtp({ email, token: code, type: "email" });
    return !error && !!data.user;
  } catch {
    return false;
  }
}
