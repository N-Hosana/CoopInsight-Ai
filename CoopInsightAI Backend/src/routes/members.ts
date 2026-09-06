import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { uploadPhoto, buildFileUrl } from "../middleware/upload";

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── GET / ─────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const { cooperativeId, status, search, sector, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    // manager/cooperative roles are scoped to their own cooperative
    const restrictToOwn = ["manager", "cooperative", "member"].includes(role);
    const effectiveCoopId = restrictToOwn ? userCoopId : (cooperativeId as string) || null;

    const params: unknown[] = [
      effectiveCoopId || null,
      status || null,
      sector || null,
      search || null,
      limitNum,
      offset,
    ];

    const dataQuery = `
      SELECT m.*, c.name AS cooperative_name
      FROM members m
      LEFT JOIN cooperatives c ON c.id = m.cooperative_id
      WHERE m.deleted_at IS NULL
        AND ($1::uuid IS NULL OR m.cooperative_id = $1::uuid)
        AND ($2::text IS NULL OR m.status = $2)
        AND ($3::text IS NULL OR m.sector = $3)
        AND ($4::text IS NULL OR m.full_name ILIKE '%' || $4 || '%'
          OR m.phone ILIKE '%' || $4 || '%'
          OR m.national_id ILIKE '%' || $4 || '%')
      ORDER BY m.created_at DESC
      LIMIT $5 OFFSET $6
    `;

    const countParams: unknown[] = [
      effectiveCoopId || null,
      status || null,
      sector || null,
      search || null,
    ];

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM members m
      WHERE m.deleted_at IS NULL
        AND ($1::uuid IS NULL OR m.cooperative_id = $1::uuid)
        AND ($2::text IS NULL OR m.status = $2)
        AND ($3::text IS NULL OR m.sector = $3)
        AND ($4::text IS NULL OR m.full_name ILIKE '%' || $4 || '%'
          OR m.phone ILIKE '%' || $4 || '%'
          OR m.national_id ILIKE '%' || $4 || '%')
    `;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, params),
      query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /members error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /export ──────────────────────────────────────────────────────────────
router.get("/export", async (req: Request, res: Response) => {
  try {
    const { cooperativeId, status, sector, search, format = "csv" } = req.query;
    if (!["csv", "pdf"].includes(format as string)) {
      return res.status(400).json({ message: "Format must be csv or pdf" });
    }

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;
    const restrictToOwn = ["manager", "cooperative", "member"].includes(role);
    const effectiveCoopId = restrictToOwn ? userCoopId : (cooperativeId as string) || null;

    const params: unknown[] = [
      effectiveCoopId || null,
      status || null,
      sector || null,
      search || null,
    ];

    const result = await query(
      `
      SELECT m.*, c.name AS cooperative_name
      FROM members m
      LEFT JOIN cooperatives c ON c.id = m.cooperative_id
      WHERE m.deleted_at IS NULL
        AND ($1::uuid IS NULL OR m.cooperative_id = $1::uuid)
        AND ($2::text IS NULL OR m.status = $2)
        AND ($3::text IS NULL OR m.sector = $3)
        AND ($4::text IS NULL OR m.full_name ILIKE '%' || $4 || '%'
          OR m.phone ILIKE '%' || $4 || '%'
          OR m.national_id ILIKE '%' || $4 || '%')
      ORDER BY m.created_at DESC
      `,
      params
    );

    // TODO: Generate file and stream to client
    res.json({
      success: true,
      message: `Members export as ${format} — file generation pending`,
      count: result.rowCount,
    });
  } catch (err) {
    console.error("GET /members/export error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT m.*, c.name AS cooperative_name
      FROM members m
      LEFT JOIN cooperatives c ON c.id = m.cooperative_id
      WHERE m.id = $1 AND m.deleted_at IS NULL
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("GET /members/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      full_name, email, phone, national_id, cooperative_id,
      gender, date_of_birth, address, sector, cell, village,
      role = "member", membership_date,
    } = req.body;

    if (!full_name || !phone || !national_id || !cooperative_id) {
      return res.status(400).json({ message: "full_name, phone, national_id, and cooperative_id are required" });
    }

    const validGenders = ["male", "female", "other"];
    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({ message: "Invalid gender value" });
    }

    const validRoles = ["member", "treasurer", "secretary", "chairperson"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid member role" });
    }

    // Check duplicate national_id within this cooperative
    const dupCheck = await query(
      `SELECT id FROM members WHERE national_id = $1 AND cooperative_id = $2 AND deleted_at IS NULL`,
      [national_id, cooperative_id]
    );
    if (dupCheck.rowCount! > 0) {
      return res.status(409).json({ message: "A member with this national ID already exists in this cooperative" });
    }

    // Generate membership_number
    const coopSuffix = (cooperative_id as string).slice(-4).toUpperCase();
    const membership_number = `MBR-${coopSuffix}-${Date.now()}`;

    const result = await query(
      `
      INSERT INTO members
        (cooperative_id, full_name, email, phone, national_id, gender, date_of_birth,
         address, sector, cell, village, membership_number, membership_date,
         role, status, total_savings, total_contributions, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',0,0,NOW(),NOW())
      RETURNING *
      `,
      [
        cooperative_id, full_name, email || null, phone, national_id,
        gender || null, date_of_birth || null, address || null,
        sector || null, cell || null, village || null,
        membership_number, membership_date || null, role,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Member added successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /members error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      "full_name", "email", "phone", "gender", "date_of_birth",
      "address", "sector", "cell", "village", "role", "membership_date", "photo_url",
    ];

    const invalidFields = Object.keys(updates).filter((k) => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Fields not updatable: ${invalidFields.join(", ")}` });
    }

    const keys = Object.keys(updates).filter((k) => allowedFields.includes(k));
    if (keys.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    setClauses.push(`updated_at = NOW()`);
    const values = keys.map((k) => updates[k]);
    values.push(id);

    const result = await query(
      `UPDATE members SET ${setClauses.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    res.json({ success: true, message: "Member updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("PUT /members/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/status ────────────────────────────────────────────────────────
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = ["active", "inactive", "suspended"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: "status must be one of: active, inactive, suspended" });
    }

    // Get current status
    const current = await query(
      `SELECT status FROM members WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (current.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }
    const oldStatus = current.rows[0].status;

    // Update status
    await query(
      `UPDATE members SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    );

    // Log the status change
    await query(
      `
      INSERT INTO member_status_log
        (member_id, old_status, new_status, reason, changed_by, changed_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      `,
      [id, oldStatus, status, reason || null, req.user!.userId]
    );

    res.json({ success: true, message: `Member status updated to ${status}`, data: { id, oldStatus, status, reason } });
  } catch (err) {
    console.error("PATCH /members/:id/status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE members SET status = 'inactive', deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    res.json({ success: true, message: "Member removed from cooperative" });
  } catch (err) {
    console.error("DELETE /members/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/contributions ───────────────────────────────────────────────────
router.get("/:id/contributions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [dataResult, countResult, sumResult] = await Promise.all([
      query(
        `SELECT * FROM member_contributions WHERE member_id = $1 ORDER BY date DESC LIMIT $2 OFFSET $3`,
        [id, limitNum, offset]
      ),
      query(
        `SELECT COUNT(*) AS total FROM member_contributions WHERE member_id = $1`,
        [id]
      ),
      query(
        `SELECT COALESCE(SUM(amount), 0) AS total_amount FROM member_contributions WHERE member_id = $1`,
        [id]
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      data: dataResult.rows,
      summary: {
        totalContributed: parseFloat(sumResult.rows[0].total_amount),
        contributionCount: total,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /members/:id/contributions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/contributions ──────────────────────────────────────────────────
router.post("/:id/contributions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, type, date, notes } = req.body;

    if (!amount || !type || !date) {
      return res.status(400).json({ message: "amount, type, and date are required" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const validTypes = ["savings", "share_capital", "special_levy"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid contribution type" });
    }

    const result = await query(
      `
      INSERT INTO member_contributions
        (member_id, amount, type, date, notes, recorded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [id, amount, type, date, notes || null, req.user!.userId]
    );

    // Update member totals
    if (type === "savings") {
      await query(
        `UPDATE members SET total_savings = total_savings + $1, total_contributions = total_contributions + $1, updated_at = NOW() WHERE id = $2`,
        [amount, id]
      );
    } else {
      await query(
        `UPDATE members SET total_contributions = total_contributions + $1, updated_at = NOW() WHERE id = $2`,
        [amount, id]
      );
    }

    res.status(201).json({ success: true, message: "Contribution recorded", data: result.rows[0] });
  } catch (err) {
    console.error("POST /members/:id/contributions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/loans ───────────────────────────────────────────────────────────
router.get("/:id/loans", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [dataResult, summaryResult] = await Promise.all([
      query(
        `SELECT * FROM loan_records WHERE member_id = $1 ORDER BY issued_at DESC`,
        [id]
      ),
      query(
        `
        SELECT
          COALESCE(SUM(amount), 0) AS total_borrowed,
          COALESCE(SUM(CASE WHEN status = 'repaid' THEN amount ELSE 0 END), 0) AS total_repaid,
          COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_loans,
          COALESCE(SUM(CASE WHEN status = 'active' THEN balance ELSE 0 END), 0) AS outstanding_balance
        FROM loan_records WHERE member_id = $1
        `,
        [id]
      ),
    ]);

    const s = summaryResult.rows[0];
    res.json({
      success: true,
      data: dataResult.rows,
      summary: {
        totalBorrowed: parseFloat(s.total_borrowed),
        totalRepaid: parseFloat(s.total_repaid),
        activeLoans: parseInt(s.active_loans, 10),
        outstandingBalance: parseFloat(s.outstanding_balance),
      },
    });
  } catch (err) {
    console.error("GET /members/:id/loans error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/loans ──────────────────────────────────────────────────────────
router.post("/:id/loans", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, purpose, due_at, interest_rate, notes } = req.body;

    if (!amount || !purpose || !due_at) {
      return res.status(400).json({ message: "amount, purpose, and due_at are required" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    // Get member's cooperative_id
    const memberRow = await query(
      `SELECT cooperative_id FROM members WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
      [id]
    );
    if (memberRow.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Active member not found" });
    }
    const { cooperative_id } = memberRow.rows[0];

    const result = await query(
      `
      INSERT INTO loan_records
        (member_id, cooperative_id, amount, balance, purpose, interest_rate, status,
         due_at, issued_at, notes, issued_by, created_at, updated_at)
      VALUES ($1,$2,$3,$3,$4,$5,'active',$6,NOW(),$7,$8,NOW(),NOW())
      RETURNING *
      `,
      [
        id, cooperative_id, amount, purpose,
        interest_rate || 0, due_at, notes || null, req.user!.userId,
      ]
    );

    res.status(201).json({ success: true, message: "Loan issued successfully", data: result.rows[0] });
  } catch (err) {
    console.error("POST /members/:id/loans error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/loans/:loanId/repayment ──────────────────────────────────────
router.patch("/:id/loans/:loanId/repayment", async (req: Request, res: Response) => {
  try {
    const { id, loanId } = req.params;
    const { amount, date, notes } = req.body;

    if (!amount || !date) {
      return res.status(400).json({ message: "amount and date are required" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    // Verify loan exists and belongs to this member
    const loanCheck = await query(
      `SELECT id, balance FROM loan_records WHERE id = $1 AND member_id = $2 AND status != 'repaid'`,
      [loanId, id]
    );
    if (loanCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Active loan not found for this member" });
    }

    // Record repayment
    await query(
      `
      INSERT INTO loan_repayments
        (loan_id, amount, date, notes, recorded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      `,
      [loanId, amount, date, notes || null, req.user!.userId]
    );

    // Update loan balance; mark repaid if balance reaches zero
    const updatedLoan = await query(
      `
      UPDATE loan_records
      SET
        balance = GREATEST(balance - $1, 0),
        status = CASE WHEN (balance - $1) <= 0 THEN 'repaid' ELSE status END,
        closed_at = CASE WHEN (balance - $1) <= 0 THEN NOW() ELSE closed_at END,
        updated_at = NOW()
      WHERE id = $2
      RETURNING balance, status
      `,
      [amount, loanId]
    );

    const { balance: remainingBalance, status: loanStatus } = updatedLoan.rows[0];

    res.json({
      success: true,
      message: "Repayment recorded",
      data: { loanId, memberId: id, repaymentAmount: amount, date, remainingBalance, loanStatus },
    });
  } catch (err) {
    console.error("PATCH /members/:id/loans/:loanId/repayment error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/dividends ───────────────────────────────────────────────────────
router.get("/:id/dividends", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [dataResult, summaryResult] = await Promise.all([
      query(
        `SELECT * FROM dividend_records WHERE member_id = $1 ORDER BY paid_at DESC`,
        [id]
      ),
      query(
        `SELECT COALESCE(SUM(amount), 0) AS total, MAX(paid_at) AS last_paid_at FROM dividend_records WHERE member_id = $1`,
        [id]
      ),
    ]);

    const s = summaryResult.rows[0];
    res.json({
      success: true,
      data: dataResult.rows,
      summary: {
        totalDividendsEarned: parseFloat(s.total),
        lastPaidAt: s.last_paid_at,
      },
    });
  } catch (err) {
    console.error("GET /members/:id/dividends error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/dividends ──────────────────────────────────────────────────────
router.post("/:id/dividends", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, period, paid_at, notes } = req.body;

    if (!amount || !period) {
      return res.status(400).json({ message: "amount and period are required" });
    }

    // Get member's cooperative_id
    const memberRow = await query(
      `SELECT cooperative_id FROM members WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (memberRow.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }
    const { cooperative_id } = memberRow.rows[0];

    // Check for duplicate dividend: same member + period
    const dupCheck = await query(
      `SELECT id FROM dividend_records WHERE member_id = $1 AND period = $2`,
      [id, period]
    );
    if (dupCheck.rowCount! > 0) {
      return res.status(409).json({ message: "Dividend for this member and period already exists" });
    }

    const result = await query(
      `
      INSERT INTO dividend_records
        (member_id, cooperative_id, amount, period, paid_at, notes, recorded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      RETURNING *
      `,
      [
        id, cooperative_id, amount, period,
        paid_at || new Date().toISOString(),
        notes || null, req.user!.userId,
      ]
    );

    res.status(201).json({ success: true, message: "Dividend payment recorded", data: result.rows[0] });
  } catch (err) {
    console.error("POST /members/:id/dividends error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/activities ──────────────────────────────────────────────────────
router.get("/:id/activities", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      SELECT
        a.id, a.title, a.type, a.status, a.date, a.start_time, a.end_time, a.location,
        ap.role AS participant_role, ap.attended, ap.notes AS participant_notes
      FROM activity_participants ap
      JOIN activities a ON a.id = ap.activity_id
      WHERE ap.member_id = $1
      ORDER BY a.date DESC
      `,
      [id]
    );

    const attended = result.rows.filter((r) => r.attended).length;
    const total = result.rowCount || 0;

    res.json({
      success: true,
      data: result.rows,
      summary: {
        totalActivities: total,
        attended,
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("GET /members/:id/activities error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/photo ──────────────────────────────────────────────────────────
router.post("/:id/photo", uploadPhoto.single("photo"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: "A photo file is required" });
    }

    const photoUrl = buildFileUrl(req, "photos", req.file.filename);

    const result = await query(
      `UPDATE members SET photo_url = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING id, photo_url`,
      [photoUrl, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    res.json({
      success: true,
      message: "Photo uploaded successfully",
      data: { memberId: id, photoUrl },
    });
  } catch (err) {
    console.error("POST /members/:id/photo error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
