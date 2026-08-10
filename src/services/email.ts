import { Resend } from "resend";

const FROM_EMAIL = `${process.env.SENDGRID_FROM_NAME || "CoopInsight AI"} <${process.env.SENDGRID_FROM_EMAIL || "onboarding@resend.dev"}>`;

const isConfigured = (): boolean =>
  !!process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.startsWith("re_placeholder");

const getClient = () => new Resend(process.env.RESEND_API_KEY!);

export async function sendOTPEmail(
  toEmail: string,
  toName: string,
  otp: string
): Promise<void> {
  const subject = "Your CoopInsight AI Login Code";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #1d4ed8; font-size: 24px; margin: 0;">CoopInsight AI</h1>
        <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Gasabo District Cooperative Platform</p>
      </div>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; text-align: center;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 8px;">Hello <strong>${toName}</strong>,</p>
        <p style="color: #374151; font-size: 14px; margin: 0 0 24px;">
          Use the code below to complete your login. It expires in <strong>5 minutes</strong>.
        </p>
        <div style="background: #1d4ed8; border-radius: 8px; padding: 20px; display: inline-block; min-width: 160px;">
          <span style="color: #ffffff; font-size: 36px; font-weight: bold; letter-spacing: 10px; font-family: monospace;">
            ${otp}
          </span>
        </div>
        <p style="color: #9ca3af; font-size: 12px; margin: 20px 0 0;">
          If you did not request this code, please ignore this email.
        </p>
      </div>
      <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 24px;">
        © 2025 CoopInsight AI — Gasabo District, Rwanda
      </p>
    </div>
  `;

  if (!isConfigured()) {
    console.log(`[EMAIL — Resend not configured, OTP not sent]`);
    console.log(`  To: ${toEmail} | OTP: ${otp}`);
    return;
  }

  const { error } = await getClient().emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject,
    html,
  });

  if (error) throw new Error(error.message);
  console.log(`[EMAIL] OTP sent to ${toEmail}`);
}

export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  resetLink: string
): Promise<void> {
  const subject = "Reset your CoopInsight AI password";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #1d4ed8;">CoopInsight AI</h1>
      <p>Hello <strong>${toName}</strong>,</p>
      <p>Click the button below to reset your password. This link expires in 1 hour.</p>
      <a href="${resetLink}"
         style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;
                border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
        Reset Password
      </a>
      <p style="color:#9ca3af;font-size:12px;">If you did not request this, ignore this email.</p>
    </div>
  `;

  if (!isConfigured()) {
    console.log(`[EMAIL] Password reset link for ${toEmail}: ${resetLink}`);
    return;
  }

  const { error } = await getClient().emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject,
    html,
  });

  if (error) throw new Error(error.message);
}

export async function sendWelcomeEmail(
  toEmail: string,
  toName: string,
  verificationLink: string
): Promise<void> {
  const subject = "Welcome to CoopInsight AI — Verify your email";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #1d4ed8;">Welcome to CoopInsight AI</h1>
      <p>Hello <strong>${toName}</strong>,</p>
      <p>Your account has been created. Click below to verify your email address.</p>
      <a href="${verificationLink}"
         style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;
                border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
        Verify Email
      </a>
      <p style="color:#9ca3af;font-size:12px;">This link expires in 24 hours.</p>
    </div>
  `;

  if (!isConfigured()) {
    console.log(`[EMAIL] Welcome/verify link for ${toEmail}: ${verificationLink}`);
    return;
  }

  const { error } = await getClient().emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject,
    html,
  });

  if (error) throw new Error(error.message);
}
