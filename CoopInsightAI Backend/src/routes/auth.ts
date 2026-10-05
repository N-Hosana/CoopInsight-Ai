import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } from "../services/email";

const router = Router();

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// GET /cooperatives — public, minimal fields only, used by the registration form
router.get("/cooperatives", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, sector FROM cooperatives WHERE status = 'active' AND deleted_at IS NULL ORDER BY name`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /auth/cooperatives error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const userResult = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = userResult.rows[0];

    if (!user) {
      await query(
        "INSERT INTO login_activity (email, status, ip_address, user_agent, attempted_at) VALUES ($1, $2, $3, $4, NOW())",
        [email.toLowerCase(), "failed", req.ip, req.headers["user-agent"] || ""]
      );
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const lockCheck = await query(
      "SELECT locked_until > NOW() AS is_locked, locked_until FROM users WHERE id = $1",
      [user.id]
    );
    if (lockCheck.rows[0]?.is_locked) {
      await query(
        "INSERT INTO login_activity (user_id, email, status, ip_address, user_agent, attempted_at) VALUES ($1, $2, $3, $4, $5, NOW())",
        [user.id, user.email, "locked", req.ip, req.headers["user-agent"] || ""]
      );
      return res.status(423).json({
        success: false,
        message: "Account is temporarily locked due to too many failed attempts.",
        lockoutEndsAt: lockCheck.rows[0].locked_until,
      });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      if (newAttempts >= 5) {
        await query(
          "UPDATE users SET failed_attempts = $1, locked_until = NOW() + INTERVAL '5 minutes' WHERE id = $2",
          [newAttempts, user.id]
        );
      } else {
        await query("UPDATE users SET failed_attempts = $1 WHERE id = $2", [newAttempts, user.id]);
      }
      await query(
        "INSERT INTO login_activity (user_id, email, status, ip_address, user_agent, attempted_at) VALUES ($1, $2, $3, $4, $5, NOW())",
        [user.id, user.email, "failed", req.ip, req.headers["user-agent"] || ""]
      );
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    await query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);

    const otp = generateOTP();
    await query("DELETE FROM otp_codes WHERE user_id = $1 AND purpose = 'login'", [user.id]);
    await query(
      "INSERT INTO otp_codes (user_id, code, purpose, expires_at) VALUES ($1, $2, 'login', NOW() + INTERVAL '5 minutes')",
      [user.id, otp]
    );

    // Always log OTP to terminal for development visibility
    console.log(`[OTP] ${user.email} → ${otp}`);

    // Send OTP via email (non-blocking)
    sendOTPEmail(user.email, user.name, otp).catch((err) =>
      console.error("[EMAIL] Failed to send OTP:", err.message)
    );

    // Log login activity — non-fatal so it never blocks the OTP response
    query(
      "INSERT INTO login_activity (user_id, email, status, ip_address, user_agent, attempted_at) VALUES ($1, $2, $3, $4, $5, NOW())",
      [user.id, user.email, "success", req.ip, req.headers["user-agent"] || ""]
    ).catch((err) => console.error("[DB] Login activity log failed:", err.message));

    return res.json({
      success: true,
      message: "Verification code sent to your email.",
      otpRequired: true,
      userId: user.id,
      // Expose OTP in non-production so devs don't need to watch the terminal
      ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /send-otp
router.post("/send-otp", async (req: Request, res: Response) => {
  try {
    const { userId, email } = req.body;

    if (!userId && !email) {
      return res.status(400).json({ message: "userId or email is required" });
    }

    let user;
    if (userId) {
      const result = await query("SELECT * FROM users WHERE id = $1", [userId]);
      user = result.rows[0];
    } else {
      const result = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
      user = result.rows[0];
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otp = generateOTP();
    await query("DELETE FROM otp_codes WHERE user_id = $1 AND purpose = 'login'", [user.id]);
    await query(
      "INSERT INTO otp_codes (user_id, code, purpose, expires_at) VALUES ($1, $2, 'login', NOW() + INTERVAL '5 minutes')",
      [user.id, otp]
    );

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV OTP]", user.email, otp);
    }

    return res.json({ success: true, message: "OTP sent", expiresInMinutes: 5 });
  } catch (err) {
    console.error("Send OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /verify-otp
router.post("/verify-otp", async (req: Request, res: Response) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ message: "userId and otp are required" });
    }

    if (String(otp).length !== 6) {
      return res.status(400).json({ message: "OTP must be 6 digits" });
    }

    const otpResult = await query(
      "SELECT *, expires_at < NOW() AS is_expired FROM otp_codes WHERE user_id = $1 AND code = $2 AND purpose = 'login'",
      [userId, String(otp)]
    );
    const otpRecord = otpResult.rows[0];

    if (!otpRecord) {
      return res.status(401).json({ success: false, message: "Invalid OTP" });
    }
    if (otpRecord.is_expired) {
      await query("DELETE FROM otp_codes WHERE id = $1", [otpRecord.id]);
      return res.status(401).json({ success: false, message: "OTP expired. Please log in again." });
    }
    await query("DELETE FROM otp_codes WHERE id = $1", [otpRecord.id]);

    const userResult = await query(
      `SELECT u.id, u.name, u.email, u.role, u.cooperative_id, u.sector, u.cell,
              u.oversight_level, u.email_verified,
              c.name AS cooperative_name
       FROM users u
       LEFT JOIN cooperatives c ON c.id = u.cooperative_id
       WHERE u.id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        cooperativeId: user.cooperative_id,
        name: user.name,
        // Which tier of the oversight chain this account acts at, if any. It
        // belongs in the token because authorisation turns on it: `government`
        // alone does not say whether the holder decides at sector, district or
        // RCA level, and the request chain needs to know which.
        oversightLevel: user.oversight_level,
        sector: user.sector,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "30m" }
    );
    const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET!, { expiresIn: "7d" });

    await query("UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2", [refreshToken, user.id]);

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        cooperativeId: user.cooperative_id,
        cooperativeName: user.cooperative_name,
        sector: user.sector,
        cell: user.cell,
        oversightLevel: user.oversight_level,
        emailVerified: user.email_verified,
      },
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, role, sector, cell, cooperativeId, nationalId } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const allowedRoles = ["admin", "manager", "generalManager", "member", "government", "cooperative"];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const insertResult = await query(
      `INSERT INTO users (name, email, password_hash, phone, role, sector, cell, cooperative_id, national_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        name,
        email.toLowerCase(),
        passwordHash,
        phone || null,
        role || "member",
        sector || null,
        cell || null,
        cooperativeId || null,
        nationalId || null,
      ]
    );
    const userId = insertResult.rows[0].id;

    const token = crypto.randomBytes(32).toString("hex");
    await query(
      "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
      [userId, token]
    );

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV EMAIL VERIFICATION TOKEN]", email, token);
    }

    return res.status(201).json({
      success: true,
      message: "Account created. Please verify your email.",
      userId,
      emailSent: true,
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /verify-email
router.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const result = await query(
      `SELECT ev.*, u.email FROM email_verifications ev
       JOIN users u ON u.id = ev.user_id
       WHERE ev.token = $1`,
      [token]
    );
    const record = result.rows[0];

    if (!record) {
      return res.status(400).json({ success: false, message: "Invalid verification token" });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: "Verification token has expired" });
    }

    await query("UPDATE users SET email_verified = true WHERE id = $1", [record.user_id]);
    await query("DELETE FROM email_verifications WHERE token = $1", [token]);

    return res.json({ success: true, message: "Email verified successfully." });
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /resend-verification
router.post("/resend-verification", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const userResult = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.email_verified) {
      return res.status(400).json({ success: false, message: "Email is already verified" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await query("DELETE FROM email_verifications WHERE user_id = $1", [user.id]);
    await query(
      "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')",
      [user.id, token]
    );

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV EMAIL VERIFICATION TOKEN]", email, token);
    }

    return res.json({ success: true, message: "Verification email resent." });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const userResult = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = userResult.rows[0];

    if (user) {
      const otp = generateOTP();
      await query("DELETE FROM password_resets WHERE email = $1", [email.toLowerCase()]);
      await query(
        "INSERT INTO password_resets (email, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')",
        [email.toLowerCase(), otp]
      );

      if (process.env.NODE_ENV !== "production") {
        console.log("[DEV PASSWORD RESET OTP]", email, otp);
      }
    }

    return res.json({
      success: true,
      message: "If that email exists, a reset code has been sent.",
      otpRequired: true,
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /verify-reset-otp
router.post("/verify-reset-otp", async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const result = await query(
      "SELECT * FROM password_resets WHERE email = $1 AND code = $2 AND expires_at > NOW()",
      [email.toLowerCase(), String(otp)]
    );
    const record = result.rows[0];

    if (!record) {
      return res.status(401).json({ success: false, message: "Invalid or expired reset code" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    await query("UPDATE password_resets SET token = $1 WHERE id = $2", [resetToken, record.id]);

    return res.json({ success: true, message: "OTP verified", resetToken });
  } catch (err) {
    console.error("Verify reset OTP error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const result = await query(
      `SELECT pr.*, u.id AS user_id FROM password_resets pr
       JOIN users u ON u.email = pr.email
       WHERE pr.token = $1 AND pr.expires_at > NOW()`,
      [resetToken]
    );
    const record = result.rows[0];

    if (!record) {
      return res.status(401).json({ success: false, message: "Invalid or expired reset link" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await query(
      "UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2",
      [passwordHash, record.user_id]
    );
    await query("DELETE FROM password_resets WHERE token = $1", [resetToken]);

    return res.json({ success: true, message: "Password reset successful. You can now log in." });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /refresh-token
router.post("/refresh-token", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const userResult = await query("SELECT * FROM users WHERE id = $1 AND refresh_token = $2", [
      decoded.userId,
      refreshToken,
    ]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: "Session expired" });
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        cooperativeId: user.cooperative_id,
        name: user.name,
        // Which tier of the oversight chain this account acts at, if any. It
        // belongs in the token because authorisation turns on it: `government`
        // alone does not say whether the holder decides at sector, district or
        // RCA level, and the request chain needs to know which.
        oversightLevel: user.oversight_level,
        sector: user.sector,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "30m" }
    );

    return res.json({ success: true, accessToken, expiresIn: 1800 });
  } catch (err) {
    console.error("Refresh token error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /logout (requires authenticate middleware)
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    await query("UPDATE users SET refresh_token = NULL WHERE id = $1", [req.user!.userId]);
    return res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /me (requires authenticate middleware)
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.sector, u.cell, u.cooperative_id,
              u.oversight_level, u.email_verified, u.created_at, c.name AS cooperative_name
       FROM users u
       LEFT JOIN cooperatives c ON c.id = u.cooperative_id
       WHERE u.id = $1`,
      [req.user!.userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      sector: user.sector,
      cell: user.cell,
      cooperativeId: user.cooperative_id,
      cooperativeName: user.cooperative_name,
      oversightLevel: user.oversight_level,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
    });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /report-failed-login
router.post("/report-failed-login", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const userResult = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const newCount = (user.failed_attempts || 0) + 1;
    let lockoutEndsAt = null;

    if (newCount >= 5) {
      const updateResult = await query(
        "UPDATE users SET failed_attempts = $1, locked_until = NOW() + INTERVAL '5 minutes' WHERE id = $2 RETURNING locked_until",
        [newCount, user.id]
      );
      lockoutEndsAt = updateResult.rows[0]?.locked_until || null;
    } else {
      await query("UPDATE users SET failed_attempts = $1 WHERE id = $2", [newCount, user.id]);
    }

    return res.json({
      success: true,
      failedAttempts: newCount,
      locked: newCount >= 5,
      lockoutEndsAt,
    });
  } catch (err) {
    console.error("Report failed login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
