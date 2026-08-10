import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import bcrypt from "bcrypt";

const router = Router();
router.use(authenticate);

// GET / — full settings
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `SELECT us.*, u.name, u.email, u.phone, u.role, c.name AS cooperative_name, u.sector, u.email_verified
       FROM users u
       LEFT JOIN user_settings us ON us.user_id = u.id
       LEFT JOIN cooperatives c ON c.id = u.cooperative_id
       WHERE u.id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const row = result.rows[0];
    const settings = {
      profile: {
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        cooperativeName: row.cooperative_name,
        sector: row.sector,
        emailVerified: row.email_verified,
      },
      appearance: {
        theme: row.theme || "light",
        language: row.language || "en",
        fontSize: row.font_size || "medium",
        compactMode: row.compact_mode || false,
      },
      notifications: {
        emailNotifications: row.email_notifications ?? true,
        smsNotifications: row.sms_notifications ?? false,
        inAppNotifications: row.in_app_notifications ?? true,
        loanDueReminders: row.loan_due_reminders ?? true,
        activityReminders: row.activity_reminders ?? true,
        monthlyReports: row.monthly_reports ?? true,
        complianceAlerts: row.compliance_alerts ?? true,
        newMemberAlerts: row.new_member_alerts ?? false,
        loginNotifications: row.login_notifications ?? true,
        reminderDaysBefore: row.reminder_days_before || 3,
      },
      security: {
        twoFactorEnabled: row.two_factor_enabled || false,
        sessionTimeout: row.session_timeout || 30,
      },
      privacy: {
        profileVisibleToMembers: row.profile_visible_to_members ?? true,
        shareDataWithGovernment: row.share_data_with_government ?? false,
        dataExportRequested: row.data_export_requested || false,
        dataExportRequestedAt: row.data_export_requested_at,
      },
    };

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /appearance
router.patch("/appearance", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { theme, language, fontSize, compactMode } = req.body;

    const validThemes = ["light", "dark", "system"];
    const validFonts = ["small", "medium", "large"];
    if (theme && !validThemes.includes(theme)) {
      return res.status(400).json({ success: false, message: "Invalid theme" });
    }
    if (fontSize && !validFonts.includes(fontSize)) {
      return res.status(400).json({ success: false, message: "Invalid font size" });
    }

    const result = await query(
      `INSERT INTO user_settings (user_id, theme, language, font_size, compact_mode)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         theme = COALESCE($2, user_settings.theme),
         language = COALESCE($3, user_settings.language),
         font_size = COALESCE($4, user_settings.font_size),
         compact_mode = COALESCE($5, user_settings.compact_mode)
       RETURNING *`,
      [userId, theme || null, language || null, fontSize || null, compactMode ?? null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /notifications
router.patch("/notifications", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      emailNotifications,
      smsNotifications,
      inAppNotifications,
      loanDueReminders,
      activityReminders,
      monthlyReports,
      complianceAlerts,
      newMemberAlerts,
      loginNotifications,
      reminderDaysBefore,
    } = req.body;

    if (
      reminderDaysBefore !== undefined &&
      (typeof reminderDaysBefore !== "number" || reminderDaysBefore < 1 || reminderDaysBefore > 30)
    ) {
      return res.status(400).json({ success: false, message: "reminderDaysBefore must be between 1 and 30" });
    }

    const result = await query(
      `INSERT INTO user_settings (user_id, email_notifications, sms_notifications, in_app_notifications,
         loan_due_reminders, activity_reminders, monthly_reports, compliance_alerts,
         new_member_alerts, login_notifications, reminder_days_before)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id) DO UPDATE SET
         email_notifications = COALESCE($2, user_settings.email_notifications),
         sms_notifications = COALESCE($3, user_settings.sms_notifications),
         in_app_notifications = COALESCE($4, user_settings.in_app_notifications),
         loan_due_reminders = COALESCE($5, user_settings.loan_due_reminders),
         activity_reminders = COALESCE($6, user_settings.activity_reminders),
         monthly_reports = COALESCE($7, user_settings.monthly_reports),
         compliance_alerts = COALESCE($8, user_settings.compliance_alerts),
         new_member_alerts = COALESCE($9, user_settings.new_member_alerts),
         login_notifications = COALESCE($10, user_settings.login_notifications),
         reminder_days_before = COALESCE($11, user_settings.reminder_days_before)
       RETURNING *`,
      [
        userId,
        emailNotifications ?? null,
        smsNotifications ?? null,
        inAppNotifications ?? null,
        loanDueReminders ?? null,
        activityReminders ?? null,
        monthlyReports ?? null,
        complianceAlerts ?? null,
        newMemberAlerts ?? null,
        loginNotifications ?? null,
        reminderDaysBefore ?? null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /security
router.patch("/security", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { sessionTimeout } = req.body;

    const validTimeouts = [15, 30, 60, 120, 480];
    if (sessionTimeout !== undefined && !validTimeouts.includes(sessionTimeout)) {
      return res.status(400).json({
        success: false,
        message: `sessionTimeout must be one of ${validTimeouts.join(", ")}`,
      });
    }

    const result = await query(
      `INSERT INTO user_settings (user_id, session_timeout) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET session_timeout = COALESCE($2, user_settings.session_timeout)
       RETURNING *`,
      [userId, sessionTimeout ?? null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /profile
router.patch("/profile", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { phone } = req.body;

    const result = await query(
      `UPDATE users SET phone = COALESCE($1, phone) WHERE id = $2 RETURNING id, name, email, phone, role`,
      [phone || null, userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /change-password
router.patch("/change-password", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
    }

    const userResult = await query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const valid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users SET password_hash = $1, last_password_changed_at = NOW(), refresh_token = NULL WHERE id = $2`,
      [newHash, userId]
    );

    res.json({ success: true, message: "Password changed successfully. Please log in again." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /two-factor/enable
router.post("/two-factor/enable", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await query(
      `INSERT INTO otp_codes (user_id, code, purpose, expires_at) VALUES ($1, $2, '2fa_setup', $3)
       ON CONFLICT (user_id, purpose) DO UPDATE SET code = $2, expires_at = $3, used = false`,
      [userId, otp, expiresAt]
    );

    console.log(`[DEV] 2FA setup OTP for user ${userId}: ${otp}`);

    res.json({ success: true, message: "OTP sent to your registered contact. Enter it to confirm 2FA setup." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /two-factor/confirm
router.post("/two-factor/confirm", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: "OTP is required" });

    const otpResult = await query(
      `SELECT * FROM otp_codes WHERE user_id = $1 AND purpose = '2fa_setup' AND used = false AND expires_at > NOW()`,
      [userId]
    );

    if (!otpResult.rows.length || otpResult.rows[0].code !== otp) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    await query(
      `INSERT INTO user_settings (user_id, two_factor_enabled) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET two_factor_enabled = true`,
      [userId]
    );
    await query(`DELETE FROM otp_codes WHERE user_id = $1 AND purpose = '2fa_setup'`, [userId]);

    res.json({ success: true, message: "Two-factor authentication enabled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /two-factor/disable
router.post("/two-factor/disable", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: "Password is required" });

    const userResult = await query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, message: "Incorrect password" });

    await query(
      `INSERT INTO user_settings (user_id, two_factor_enabled) VALUES ($1, false)
       ON CONFLICT (user_id) DO UPDATE SET two_factor_enabled = false`,
      [userId]
    );

    res.json({ success: true, message: "Two-factor authentication disabled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /sessions
router.get("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `SELECT * FROM user_sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY last_active_at DESC`,
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /sessions — all sessions (must be before /sessions/:sessionId)
router.delete("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    await query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
    res.json({ success: true, message: "All sessions terminated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /sessions/:sessionId
router.delete("/sessions/:sessionId", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { sessionId } = req.params;
    const result = await query(
      `DELETE FROM user_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }
    res.json({ success: true, message: "Session terminated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /data-export
router.post("/data-export", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const existing = await query(
      `SELECT data_export_requested, data_export_requested_at FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    if (existing.rows.length && existing.rows[0].data_export_requested) {
      return res.status(400).json({
        success: false,
        message: "A data export has already been requested. Please wait for it to complete.",
      });
    }

    await query(
      `INSERT INTO user_settings (user_id, data_export_requested, data_export_requested_at) VALUES ($1, true, NOW())
       ON CONFLICT (user_id) DO UPDATE SET data_export_requested = true, data_export_requested_at = NOW()`,
      [userId]
    );

    res.json({ success: true, message: "Data export requested. You will be notified when your data is ready." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
