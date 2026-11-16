import { createClient, SupabaseClient } from "@supabase/supabase-js";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PREFERRED: OUR OWN CODE, SENT THROUGH SMTP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Supabase picks its own code and never tells us what it is, so the code in
 * the email and the code shown on the screen in development were two different
 * numbers — and Supabase's length is set in its dashboard, not here. When an
 * SMTP mailbox is configured the application generates ONE six-digit code,
 * stores it, emails it and (outside production) shows it: the same number
 * everywhere.
 *
 *   SMTP_HOST   e.g. smtp.gmail.com
 *   SMTP_PORT   587 (STARTTLS) or 465 (SSL); default 587
 *   SMTP_USER   the mailbox, e.g. coopinsight.noreply@gmail.com
 *   SMTP_PASS   its password — for Gmail, an App Password, not the login one
 *   SMTP_FROM   optional sender line, e.g. "CoopInsightAI <coopinsight.noreply@gmail.com>"
 *
 * Without these, the Supabase path below is used as before.
 */
export const smtpConfigured = (): boolean =>
  !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export const PURPOSE_TEXT: Record<"login" | "reset", { subject: string; heading: string; line: string; ignore: string }> = {
  login: {
    subject: "Your CoopInsightAI sign-in code",
    heading: "Your sign-in code",
    line: "Enter this code on the CoopInsightAI sign-in page to finish signing in.",
    ignore: "If you did not try to sign in, you can ignore this email — nobody can sign in without this code.",
  },
  reset: {
    subject: "Reset your CoopInsightAI password",
    heading: "Reset your password",
    line: "Enter this code on the CoopInsightAI password reset page, then choose a new password.",
    ignore: "If you did not ask to reset your password, you can ignore this email — your password has not changed.",
  },
};

/**
 * The one design every code email uses — the app's own (SMTP) and the
 * Supabase templates in /email-templates, which are this function's output
 * with `{{ .Token }}` in place of the code.
 *
 * Tables and inline styles only: Gmail, Outlook and phone mail apps ignore
 * flexbox and strip SVG, so the mark is drawn with a coloured cell (the brand
 * green square with the gold centre point) rather than an image.
 */
export function codeEmailHtml(purpose: "login" | "reset", code: string, expiry = "expires in 5 minutes and works once"): string {
  const t = PURPOSE_TEXT[purpose];
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#F5F1E8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:14px;border:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <tr><td style="padding:24px 28px 18px;border-bottom:3px solid #2D6A4F;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:#2D6A4F;border-radius:8px;">
              <div style="width:10px;height:10px;margin:0 auto;background:#D4A574;border-radius:5px;border:3px solid #FFFFFF;"></div>
            </td>
            <td style="padding-left:12px;">
              <div style="font-size:18px;font-weight:bold;color:#1B4332;line-height:20px;">CoopInsightAI</div>
              <div style="font-size:11px;color:#6B7280;line-height:16px;">Cooperative management and oversight platform</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;">
          <div style="font-size:20px;font-weight:bold;color:#111827;margin:0 0 8px;">${t.heading}</div>
          <div style="font-size:14px;line-height:21px;color:#374151;margin:0 0 20px;">${t.line}</div>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:18px 12px;background:#EEF5F1;border-left:4px solid #2D6A4F;border-radius:10px;color:#1B4332;font-family:'Courier New',Courier,monospace;">${code}</div>
          <div style="font-size:13px;line-height:19px;color:#6B7280;margin:18px 0 0;">The code ${expiry}. Never share it with anyone — CoopInsightAI staff will never ask for it.</div>
          <div style="font-size:13px;line-height:19px;color:#6B7280;margin:10px 0 0;">${t.ignore}</div>
        </td></tr>
        <tr><td style="padding:20px 28px 24px;">
          <div style="border-top:1px solid #E5E7EB;padding-top:14px;font-size:12px;color:#9CA3AF;">
            <span style="color:#2D6A4F;font-weight:bold;">CoopInsightAI</span> &middot; Gasabo District, Rwanda
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Email a code the application chose. Never throws. */
export async function sendOwnCode(email: string, code: string, purpose: "login" | "reset" = "login"): Promise<Delivery> {
  if (!smtpConfigured()) return { sent: false, reason: "SMTP is not configured" };
  const t = PURPOSE_TEXT[purpose];
  try {
    await smtp().sendMail({
      from: process.env.SMTP_FROM || `CoopInsightAI <${process.env.SMTP_USER}>`,
      to: email,
      subject: t.subject,
      text: `${t.heading}\n\n${t.line}\n\nYour code: ${code}\n\nThe code expires in 5 minutes and works once. ${t.ignore}\n\n— CoopInsightAI, Gasabo District`,
      html: codeEmailHtml(purpose, code),
    });
    console.log(`[EMAIL] Code sent to ${email} via SMTP`);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, reason: err?.message ?? "The mail server could not be reached" };
  }
}

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
/**
 * A sign-in code goes out through signInWithOtp, which uses the dashboard's
 * "Magic link or OTP" template. A password-reset code goes through
 * resetPasswordForEmail, which uses the "Reset password" template — so the
 * email says what it is for instead of looking like a sign-in. Both templates
 * must contain {{ .Token }} to carry a code rather than a link.
 */
export async function sendEmailCode(email: string, purpose: "login" | "reset" = "login"): Promise<Delivery> {
  if (!emailConfigured()) return { sent: false, reason: "Supabase is not configured" };
  try {
    const { error } =
      purpose === "reset"
        ? await supabase().auth.resetPasswordForEmail(email)
        : await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) return { sent: false, reason: error.message, rateLimited: error.status === 429 };
    console.log(`[EMAIL] Verification code sent to ${email}`);
    return { sent: true };
  } catch (err: any) {
    return { sent: false, reason: err?.message ?? "Supabase could not be reached" };
  }
}

/** Whether this is the code Supabase emailed to this address. A code works once. */
export async function verifyEmailCode(email: string, code: string, purpose: "login" | "reset" = "login"): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const { data, error } = await supabase().auth.verifyOtp({
      email,
      token: code,
      type: purpose === "reset" ? "recovery" : "email",
    });
    return !error && !!data.user;
  } catch {
    return false;
  }
}
