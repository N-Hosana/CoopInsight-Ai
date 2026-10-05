import { Router, Request, Response } from "express";
import { query, getClient } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { uploadPhoto, buildFileUrl } from "../middleware/upload";
import { writableCooperative } from "../services/cooperativeAccess";

const router = Router();

// All routes require authentication
router.use(authenticate);


/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO MAY LOOK AT A MEMBER'S FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member's record holds their savings, their loans, their attendance and any
 * warnings against them. That is not something one member may read about
 * another, so access is decided here — on the server — rather than by hiding a
 * button in the UI:
 *
 *   • admin / generalManager  — any member.
 *   • government officers     — members of cooperatives in their scope; a
 *                               sector officer only within their own sector.
 *   • manager / cooperative   — members of their own cooperative.
 *   • member                  — themselves, and nobody else.
 *
 * A `member` user and their row in the register are separate records with no
 * foreign key between them, so "themselves" is resolved the same way
 * membership.ts does it: national ID, then phone, then name.
 */
export type MemberAccess =
  | { allowed: true; scope: "own" | "cooperative" | "oversight" | "all" }
  | { allowed: false; reason: string };

async function resolveMemberAccess(
  userId: string,
  memberId: string
): Promise<MemberAccess & { member?: any }> {
  const actorRes = await query(
    `SELECT id, name, role, sector, cooperative_id, national_id, phone, oversight_level, member_id
       FROM users WHERE id = $1`,
    [userId]
  );
  const actor = actorRes.rows[0];
  if (!actor) return { allowed: false, reason: "Not authenticated" };

  // "me" resolves to the caller's own row. The stored link (users.member_id)
  // comes first: it survives the member leaving, so a former member can still
  // read their own record — archived rows are returned here on purpose. Only
  // an account with no link yet falls back to matching, and the match it finds
  // is stored so it never has to be guessed again.
  let memberRes: { rows: any[]; rowCount: number | null };
  if (memberId === "me") {
    memberRes = actor.member_id
      ? await query(
          `SELECT m.*, c.name AS cooperative_name, c.sector AS cooperative_sector
             FROM members m
             LEFT JOIN cooperatives c ON c.id = m.cooperative_id
            WHERE m.id = $1`,
          [actor.member_id]
        )
      : { rows: [], rowCount: 0 };

    if (!memberRes.rows[0]) {
      // Within the cooperative when attached; without one, only a national id
      // or phone match counts — a name alone is too weak across the district.
      memberRes = await query(
        `SELECT m.*, c.name AS cooperative_name, c.sector AS cooperative_sector
           FROM members m
           LEFT JOIN cooperatives c ON c.id = m.cooperative_id
          WHERE ($1::uuid IS NULL OR m.cooperative_id = $1::uuid)
            AND (
              ($2::text IS NOT NULL AND m.national_id = $2)
              OR ($3::text IS NOT NULL AND m.phone = $3)
              OR ($1::uuid IS NOT NULL AND LOWER(m.full_name) = LOWER($4))
            )
          ORDER BY
            CASE WHEN m.deleted_at IS NULL THEN 0 ELSE 1 END,
            CASE
              WHEN $2::text IS NOT NULL AND m.national_id = $2 THEN 1
              WHEN $3::text IS NOT NULL AND m.phone = $3 THEN 2
              ELSE 3
            END
          LIMIT 1`,
        [actor.cooperative_id, actor.national_id, actor.phone, actor.name]
      );
      if (memberRes.rows[0] && actor.role === "member") {
        await query(`UPDATE users SET member_id = $1 WHERE id = $2 AND member_id IS NULL`, [
          memberRes.rows[0].id,
          actor.id,
        ]);
      }
    }
  } else {
    memberRes = await query(
      `SELECT m.*, c.name AS cooperative_name, c.sector AS cooperative_sector
         FROM members m
         LEFT JOIN cooperatives c ON c.id = m.cooperative_id
        WHERE m.id = $1 AND (m.deleted_at IS NULL OR m.id = $2::uuid)`,
      // A member's own archived row stays readable to them by id too.
      [memberId, actor.member_id]
    );
  }
  const member = memberRes.rows[0];
  if (!member) {
    return {
      allowed: false,
      reason:
        memberId === "me"
          ? "We could not match your account to an entry in the member register, so there is no record to show. Ask your cooperative manager to check the register."
          : "Member not found",
    };
  }
  // Resolving "me" is itself the authorisation: it only ever returns the
  // caller's own row.
  if (memberId === "me") return { allowed: true, scope: "own", member };

  if (["admin", "generalManager"].includes(actor.role)) {
    return { allowed: true, scope: "all", member };
  }

  if (actor.role === "government") {
    if (actor.oversight_level === "sector" && actor.sector && member.cooperative_sector !== actor.sector) {
      return {
        allowed: false,
        reason: `${member.full_name} belongs to a cooperative in ${member.cooperative_sector} sector, which is outside your scope.`,
        member,
      };
    }
    return { allowed: true, scope: "oversight", member };
  }

  if (["manager", "cooperative"].includes(actor.role)) {
    if (actor.cooperative_id !== member.cooperative_id) {
      return {
        allowed: false,
        reason: "This member belongs to another cooperative.",
        member,
      };
    }
    return { allowed: true, scope: "cooperative", member };
  }

  // A member. Only their own file: the stored link, or the old match.
  const isSelf =
    (actor.member_id && actor.member_id === member.id) ||
    (actor.national_id && member.national_id === actor.national_id) ||
    (actor.phone && member.phone === actor.phone) ||
    String(member.full_name).toLowerCase() === String(actor.name).toLowerCase();

  if (isSelf) return { allowed: true, scope: "own", member };

  return {
    allowed: false,
    reason:
      "You can only view your own membership record. Another member's savings, loans and " +
      "attendance are not yours to read.",
    member,
  };
}

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
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }

    res.json({ success: true, data: access.member, scope: access.scope });
  } catch (err) {
    console.error("GET /members/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// ─── GET /:id/profile ─────────────────────────────────────────────────────────
// Everything about one member in a single call: the register entry, the money,
// what they have attended, the transactions recorded against their name, and
// the record of status changes and warnings.
//
// One endpoint rather than six because the page needs all of it at once, and
// because the authorisation decision should be made once, in one place, rather
// than repeated on every sub-resource and eventually forgotten on one of them.
router.get("/:id/profile", async (req: Request, res: Response) => {
  try {
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const member = access.member;
    const id = member.id;

    const [
      contributions, loans, dividends, activities, transactions, statusLog, exitRequests, coopTotals,
    ] = await Promise.all([
      query(
        `SELECT id, amount, type, date, notes, created_at
           FROM member_contributions WHERE member_id = $1 ORDER BY date DESC`,
        [id]
      ),
      query(
        `SELECT l.id, l.amount, l.balance, l.purpose, l.interest_rate, l.status,
                l.due_at, l.issued_at, l.closed_at, l.notes,
                COALESCE((SELECT SUM(r.amount) FROM loan_repayments r WHERE r.loan_id = l.id), 0) AS repaid,
                COALESCE((SELECT json_agg(json_build_object(
                   'id', r.id, 'amount', r.amount, 'date', r.date, 'notes', r.notes) ORDER BY r.date)
                   FROM loan_repayments r WHERE r.loan_id = l.id), '[]') AS repayments
           FROM loan_records l WHERE l.member_id = $1 ORDER BY l.issued_at DESC`,
        [id]
      ),
      query(
        `SELECT id, amount, period, paid_at, notes, created_at
           FROM dividend_records WHERE member_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      query(
        `SELECT a.id, a.title, a.type, a.status, a.date, a.start_time, a.location,
                ap.role AS participant_role, ap.attended, ap.notes AS participant_notes
           FROM activity_participants ap
           JOIN activities a ON a.id = ap.activity_id
          WHERE ap.member_id = $1 AND a.deleted_at IS NULL
          ORDER BY a.date DESC`,
        [id]
      ),
      // Transactions recorded against this member by name — contributions in,
      // payouts out. This is the ledger a manager is asked about most often.
      query(
        `SELECT t.id, t.type, t.category, t.amount, t.date, t.description, t.reference,
                t.payment_method, t.status, t.created_at, u.name AS recorded_by_name
           FROM transactions t
           LEFT JOIN users u ON u.id = t.recorded_by
          WHERE t.member_id = $1
          ORDER BY t.date DESC, t.created_at DESC`,
        [id]
      ),
      // Suspensions, reinstatements and the reasons given — the member's
      // disciplinary record, such as it is.
      query(
        `SELECT s.id, s.old_status, s.new_status, s.reason, s.changed_at, u.name AS changed_by_name
           FROM member_status_log s
           LEFT JOIN users u ON u.id = s.changed_by
          WHERE s.member_id = $1 ORDER BY s.changed_at DESC`,
        [id]
      ),
      query(
        `SELECT id, status, reason_category, reason_detail, created_at, decided_at, decision_note
           FROM membership_exit_requests WHERE member_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      // Cohort figures, so "RWF 45,000 saved" can be read as a position rather
      // than a number floating on its own.
      query(
        `SELECT
           COUNT(*) AS member_count,
           COALESCE(AVG(total_savings), 0) AS avg_savings,
           COALESCE(MAX(total_savings), 0) AS max_savings
           FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL`,
        [member.cooperative_id]
      ),
    ]);

    const num = (v: unknown) => Number(v ?? 0);
    const contributionsByType: Record<string, number> = {};
    for (const c of contributions.rows) {
      contributionsByType[c.type] = (contributionsByType[c.type] ?? 0) + num(c.amount);
    }

    const outstandingLoans = loans.rows
      .filter((l) => ["active", "overdue"].includes(l.status))
      .reduce((sum, l) => sum + num(l.balance), 0);
    const overdueLoans = loans.rows.filter((l) => l.status === "overdue").length;

    const invited = activities.rowCount ?? 0;
    const attended = activities.rows.filter((a) => a.attended).length;

    const cohort = coopTotals.rows[0];
    const avgSavings = num(cohort?.avg_savings);
    const savings = num(member.total_savings);

    res.json({
      success: true,
      scope: access.scope,
      // A former member still reads their record; the page says it is history.
      former: member.deleted_at
        ? { since: member.archived_at ?? member.deleted_at, reason: member.archive_reason ?? null }
        : null,
      data: {
        member,
        financial: {
          savings,
          totalContributions: num(member.total_contributions),
          contributionsByType,
          contributionCount: contributions.rowCount ?? 0,
          lastContributionOn: contributions.rows[0]?.date ?? null,
          outstandingLoans,
          overdueLoans,
          loanCount: loans.rowCount ?? 0,
          dividendsPaid: dividends.rows.reduce((sum, d) => sum + num(d.amount), 0),
        },
        participation: {
          invited,
          attended,
          attendanceRate: invited > 0 ? Math.round((attended / invited) * 100) : null,
          lastAttendedOn: activities.rows.find((a) => a.attended)?.date ?? null,
        },
        cohort: {
          memberCount: Number(cohort?.member_count ?? 0),
          averageSavings: Math.round(avgSavings),
          highestSavings: num(cohort?.max_savings),
          savingsVsAverage: avgSavings > 0 ? Math.round(((savings - avgSavings) / avgSavings) * 100) : null,
        },
        contributions: contributions.rows,
        loans: loans.rows,
        dividends: dividends.rows,
        activities: activities.rows,
        transactions: transactions.rows,
        statusLog: statusLog.rows,
        exitRequests: exitRequests.rows,
      },
    });
  } catch (err) {
    console.error("GET /members/:id/profile error:", err);
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
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const id = access.member.id as string; // resolved, so "me" works
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

const CONTRIBUTION_TYPES = ["savings", "share_capital", "special_levy"];
const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "cheque"];

type Run = (text: string, params?: any[]) => Promise<any>;

/**
 * The cash side of a member-money event, written to the cooperative's books.
 *
 * A loan paid out, a repayment, a dividend or a contribution is money moving
 * through the cooperative. Recording it only in the member's ledger left the
 * cooperative's own accounts — and the audit's "is it trading?" — blind to it.
 * Each event now writes its member record AND this transaction, together.
 */
async function postCashTransaction(
  run: Run,
  t: {
    cooperativeId: string;
    type: "income" | "expense";
    category: string;
    amount: number;
    date: string;
    description: string;
    memberId: string | null;
    paymentMethod?: string | null;
    reference?: string | null;
    userId: string;
  }
) {
  await run(
    `INSERT INTO transactions
       (cooperative_id, type, category, amount, date, description, reference, member_id,
        payment_method, recorded_by, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',NOW(),NOW())`,
    [
      t.cooperativeId, t.type, t.category, t.amount, t.date, t.description,
      t.reference || null, t.memberId, t.paymentMethod || "cash", t.userId,
    ]
  );
}

/** Run `work` inside one database transaction: all of it lands, or none. */
async function inTransaction<T>(work: (run: Run) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await work((text, params) => client.query(text, params));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The member, and whether the caller may write to their cooperative's books. */
async function memberForWrite(req: Request, memberId: string) {
  const found = await query(
    `SELECT m.id, m.full_name, m.status, m.cooperative_id FROM members m
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [memberId]
  );
  if (found.rowCount === 0) return { ok: false as const, status: 404, message: "Member not found" };
  const access = writableCooperative(req, found.rows[0].cooperative_id);
  if (!access.ok) return access;
  return { ok: true as const, member: found.rows[0] };
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Record one contribution and roll it into the member's running totals. */
async function recordContribution(
  run: (text: string, params?: any[]) => Promise<any>,
  memberId: string,
  amount: number,
  type: string,
  date: string,
  notes: string | null,
  recordedBy: string
) {
  // The member's and the cooperative's running totals are kept by database
  // triggers on member_contributions, so every path that records money moves
  // them the same way. Adding to them here as well would count it twice.
  const result = await run(
    `INSERT INTO member_contributions (member_id, amount, type, date, notes, recorded_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
    [memberId, amount, type, date, notes, recordedBy]
  );
  return result.rows[0];
}

// ─── POST /contributions/batch ────────────────────────────────────────────────
// A collection day: every member who paid, in one go. Contributions are taken
// at a meeting, not one at a time, and entering forty of them through forty
// member pages is how they stop being entered at all.
//
// All or nothing — a sheet half-entered is worse than one not entered, because
// nobody can tell which half is missing.
router.post("/contributions/batch", async (req: Request, res: Response) => {
  const access = writableCooperative(req, req.body.cooperativeId);
  if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });

  const { date, type, notes, entries } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: "date (YYYY-MM-DD) is required." });
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ success: false, message: "A contribution cannot be recorded for a future date." });
  }
  if (!CONTRIBUTION_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: `type must be one of: ${CONTRIBUTION_TYPES.join(", ")}` });
  }
  const rows: Array<{ memberId: string; amount: number }> = Array.isArray(entries)
    ? entries.filter((e: any) => e && e.memberId && Number(e.amount) > 0).map((e: any) => ({ memberId: String(e.memberId), amount: Number(e.amount) }))
    : [];
  if (rows.length === 0) {
    return res.status(400).json({ success: false, message: "Enter an amount for at least one member." });
  }

  const owned = await query(
    `SELECT id FROM members WHERE id = ANY($1::uuid[]) AND cooperative_id = $2 AND deleted_at IS NULL`,
    [rows.map((r) => r.memberId), access.cooperativeId]
  );
  if ((owned.rowCount ?? 0) !== new Set(rows.map((r) => r.memberId)).size) {
    return res.status(403).json({ success: false, message: "Every member must belong to your cooperative." });
  }

  const paymentMethod = PAYMENT_METHODS.includes(req.body.paymentMethod) ? req.body.paymentMethod : "cash";
  const total = rows.reduce((a, r) => a + r.amount, 0);
  try {
    await inTransaction(async (run) => {
      for (const r of rows) {
        await recordContribution(run, r.memberId, r.amount, type, date, notes || null, req.user!.userId);
      }
      // One cash receipt for the collection day, as the treasurer banks it.
      await postCashTransaction(run, {
        cooperativeId: access.cooperativeId,
        type: "income",
        category: "member_contributions",
        amount: total,
        date,
        description: `${type.replace(/_/g, " ")} collected from ${rows.length} member(s)`,
        memberId: rows.length === 1 ? rows[0].memberId : null,
        paymentMethod,
        userId: req.user!.userId,
      });
    });
    res.status(201).json({
      success: true,
      message: `${rows.length} contribution(s) recorded, ${total.toLocaleString()} RWF in total.`,
      data: { recorded: rows.length, total },
    });
  } catch (err) {
    console.error("POST /members/contributions/batch error:", err);
    res.status(500).json({ success: false, message: "Internal server error — nothing was recorded." });
  }
});

// ─── POST /:id/contributions ──────────────────────────────────────────────────
router.post("/:id/contributions", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, type, date, notes, paymentMethod, reference } = req.body;

    // The member's own cooperative keeps their book; nobody else writes to it.
    const write = await memberForWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (!isDate(date) || date > todayIso()) {
      return res.status(400).json({ message: "date (YYYY-MM-DD, not in the future) is required" });
    }
    if (!CONTRIBUTION_TYPES.includes(type)) {
      return res.status(400).json({ message: `type must be one of: ${CONTRIBUTION_TYPES.join(", ")}` });
    }

    const saved = await inTransaction(async (run) => {
      const row = await recordContribution(run, id, amount, type, date, notes || null, req.user!.userId);
      await postCashTransaction(run, {
        cooperativeId: write.member.cooperative_id,
        type: "income",
        category: "member_contributions",
        amount,
        date,
        description: `${type.replace(/_/g, " ")} from ${write.member.full_name}`,
        memberId: id,
        paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "cash",
        reference,
        userId: req.user!.userId,
      });
      return row;
    });

    res.status(201).json({
      success: true,
      message: `${type.replace(/_/g, " ")} of ${amount.toLocaleString()} RWF recorded for ${write.member.full_name}.`,
      data: saved,
    });
  } catch (err) {
    console.error("POST /members/:id/contributions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/loans ───────────────────────────────────────────────────────────
router.get("/:id/loans", async (req: Request, res: Response) => {
  try {
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const id = access.member.id as string; // resolved, so "me" works

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
    const { amount, purpose, due_at, interest_rate, notes, issued_on, paymentMethod, reference } = req.body;

    const write = await memberForWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });
    if (write.member.status !== "active") {
      return res.status(400).json({ success: false, message: `${write.member.full_name} is not an active member.` });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({ message: "purpose is required" });
    }
    const issuedOn = isDate(issued_on) ? issued_on : todayIso();
    if (issuedOn > todayIso()) {
      return res.status(400).json({ message: "A loan cannot be issued on a future date." });
    }
    if (!isDate(due_at) || due_at <= issuedOn) {
      return res.status(400).json({ message: "due_at (YYYY-MM-DD) must fall after the date the loan is issued." });
    }
    const rate = interest_rate == null || interest_rate === "" ? 0 : Number(interest_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ message: "interest_rate must be a percentage between 0 and 100." });
    }

    const loan = await inTransaction(async (run) => {
      const result = await run(
        `INSERT INTO loan_records
           (member_id, cooperative_id, amount, balance, purpose, interest_rate, status,
            due_at, issued_at, notes, issued_by, created_at, updated_at)
         VALUES ($1,$2,$3,$3,$4,$5,'active',$6,$7::date,$8,$9,NOW(),NOW())
         RETURNING *`,
        [id, write.member.cooperative_id, amount, String(purpose).trim(), rate, due_at, issuedOn,
         notes || null, req.user!.userId]
      );
      // The money leaves the cooperative's account when the loan is paid out.
      await postCashTransaction(run, {
        cooperativeId: write.member.cooperative_id,
        type: "expense",
        category: "loan_disbursements",
        amount,
        date: issuedOn,
        description: `Loan to ${write.member.full_name}: ${String(purpose).trim()}`,
        memberId: id,
        paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "cash",
        reference,
        userId: req.user!.userId,
      });
      return result.rows[0];
    });

    res.status(201).json({
      success: true,
      message: `Loan of ${amount.toLocaleString()} RWF issued to ${write.member.full_name}, due ${due_at}.`,
      data: loan,
    });
  } catch (err) {
    console.error("POST /members/:id/loans error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/loans/:loanId/repayment ──────────────────────────────────────
router.patch("/:id/loans/:loanId/repayment", async (req: Request, res: Response) => {
  try {
    const { id, loanId } = req.params;
    const { amount, date, notes, paymentMethod, reference } = req.body;

    const write = await memberForWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (!isDate(date) || date > todayIso()) {
      return res.status(400).json({ message: "date (YYYY-MM-DD, not in the future) is required" });
    }

    // Verify loan exists and belongs to this member
    const loanCheck = await query(
      `SELECT id, balance FROM loan_records WHERE id = $1 AND member_id = $2 AND status <> 'repaid'`,
      [loanId, id]
    );
    if (loanCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Active loan not found for this member" });
    }
    const balance = Number(loanCheck.rows[0].balance);
    if (amount > balance) {
      return res.status(400).json({
        success: false,
        message: `The repayment (${amount.toLocaleString()} RWF) is more than the ${balance.toLocaleString()} RWF still owed.`,
      });
    }

    const updated = await inTransaction(async (run) => {
      await run(
        `INSERT INTO loan_repayments (loan_id, amount, date, notes, recorded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [loanId, amount, date, notes || null, req.user!.userId]
      );
      // Update loan balance; mark repaid if balance reaches zero
      const loan = await run(
        `UPDATE loan_records
            SET balance = GREATEST(balance - $1, 0),
                status = CASE WHEN (balance - $1) <= 0 THEN 'repaid' ELSE status END,
                closed_at = CASE WHEN (balance - $1) <= 0 THEN NOW() ELSE closed_at END,
                updated_at = NOW()
          WHERE id = $2
          RETURNING balance, status`,
        [amount, loanId]
      );
      // The money comes back into the cooperative's account.
      await postCashTransaction(run, {
        cooperativeId: write.member.cooperative_id,
        type: "income",
        category: "loan_repayments",
        amount,
        date,
        description: `Loan repayment from ${write.member.full_name}`,
        memberId: id,
        paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "cash",
        reference,
        userId: req.user!.userId,
      });
      return loan.rows[0];
    });

    const remainingBalance = Number(updated.balance);
    res.json({
      success: true,
      message:
        updated.status === "repaid"
          ? `Repayment recorded — ${write.member.full_name}'s loan is fully repaid.`
          : `Repayment recorded — ${remainingBalance.toLocaleString()} RWF still owed.`,
      data: { loanId, memberId: id, repaymentAmount: amount, date, remainingBalance, loanStatus: updated.status },
    });
  } catch (err) {
    console.error("PATCH /members/:id/loans/:loanId/repayment error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/dividends ───────────────────────────────────────────────────────
router.get("/:id/dividends", async (req: Request, res: Response) => {
  try {
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const id = access.member.id as string; // resolved, so "me" works

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
    const { amount, period, paid_at, notes, paymentMethod, reference } = req.body;

    const write = await memberForWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });
    const cooperative_id = write.member.cooperative_id;

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (!period || !String(period).trim()) {
      return res.status(400).json({ message: "period is required (e.g. 2025)" });
    }
    const paidOn = isDate(paid_at) ? paid_at : todayIso();
    if (paidOn > todayIso()) {
      return res.status(400).json({ message: "A dividend cannot be paid on a future date." });
    }

    // Check for duplicate dividend: same member + period
    const dupCheck = await query(
      `SELECT id FROM dividend_records WHERE member_id = $1 AND period = $2`,
      [id, period]
    );
    if (dupCheck.rowCount! > 0) {
      return res.status(409).json({ message: "Dividend for this member and period already exists" });
    }

    const dividend = await inTransaction(async (run) => {
      const result = await run(
        `INSERT INTO dividend_records
           (member_id, cooperative_id, amount, period, paid_at, notes, recorded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         RETURNING *`,
        [id, cooperative_id, amount, String(period).trim(), paidOn, notes || null, req.user!.userId]
      );
      // A dividend is paid out of the cooperative's surplus.
      await postCashTransaction(run, {
        cooperativeId: cooperative_id,
        type: "expense",
        category: "dividends",
        amount,
        date: paidOn,
        description: `Dividend for ${String(period).trim()} to ${write.member.full_name}`,
        memberId: id,
        paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "cash",
        reference,
        userId: req.user!.userId,
      });
      return result.rows[0];
    });

    res.status(201).json({
      success: true,
      message: `Dividend of ${amount.toLocaleString()} RWF for ${String(period).trim()} paid to ${write.member.full_name}.`,
      data: dividend,
    });
  } catch (err) {
    console.error("POST /members/:id/dividends error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/activities ──────────────────────────────────────────────────────
// ─── GET /:id/history ─────────────────────────────────────────────────────────
// One member's own history, newest first: what they paid in, borrowed and
// repaid, what they were paid, what they attended or missed, and the changes
// to their membership. This is the member's "recent activity" — the dashboard
// used to show the whole cooperative's instead, other members included.
router.get("/:id/history", async (req: Request, res: Response) => {
  try {
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const memberId = access.member.id as string;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20)));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const kind = typeof req.query.kind === "string" ? req.query.kind : null;

    const events = `
      SELECT 'contribution' AS kind, mc.id::text AS id, mc.date::timestamptz AS at,
             mc.amount, mc.type AS detail, mc.notes AS title
        FROM member_contributions mc WHERE mc.member_id = $1
      UNION ALL
      SELECT 'loan', l.id::text, l.issued_at, l.amount, l.purpose, l.status
        FROM loan_records l WHERE l.member_id = $1
      UNION ALL
      SELECT 'repayment', r.id::text, r.date::timestamptz, r.amount, l.purpose, NULL
        FROM loan_repayments r JOIN loan_records l ON l.id = r.loan_id WHERE l.member_id = $1
      UNION ALL
      SELECT 'dividend', d.id::text, COALESCE(d.paid_at::timestamptz, d.created_at), d.amount, d.period, NULL
        FROM dividend_records d WHERE d.member_id = $1
      UNION ALL
      SELECT CASE WHEN ap.attended THEN 'attended'
                  WHEN a.status = 'completed' THEN 'missed'
                  ELSE 'registered' END,
             ap.id::text, a.date::timestamptz, NULL, a.type, a.title
        FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
       WHERE ap.member_id = $1 AND a.deleted_at IS NULL AND a.status <> 'cancelled'
      UNION ALL
      SELECT 'status', s.id::text, s.changed_at, NULL, s.new_status, s.reason
        FROM member_status_log s WHERE s.member_id = $1
      UNION ALL
      SELECT 'joined', m.id::text, m.membership_date::timestamptz, NULL, NULL, NULL
        FROM members m WHERE m.id = $1 AND m.membership_date IS NOT NULL`;

    // History is what has happened; a future activity is not yet history.
    const filter = `WHERE h.at <= NOW()${kind ? " AND h.kind = $4" : ""}`;
    const params: unknown[] = [memberId, limit, (page - 1) * limit];
    if (kind) params.push(kind);

    const [rows, total] = await Promise.all([
      query(`SELECT * FROM (${events}) h ${filter} ORDER BY h.at DESC LIMIT $2 OFFSET $3`, params),
      query(
        `SELECT COUNT(*) AS n FROM (${events}) h WHERE h.at <= NOW()${kind ? " AND h.kind = $2" : ""}`,
        kind ? [memberId, kind] : [memberId]
      ),
    ]);

    const money = (v: unknown) => `${Math.round(Number(v ?? 0)).toLocaleString("en-RW")} RWF`;
    const describe = (r: any): { title: string; flow: "in" | "out" | null } => {
      switch (r.kind) {
        case "contribution":
          if (r.title === "Opening balance (reconciliation)") {
            return { title: `Savings balance brought forward: ${money(r.amount)}`, flow: "in" };
          }
          return { title: `Paid in ${money(r.amount)} — ${String(r.detail).replace(/_/g, " ")}`, flow: "in" };
        case "loan":
          return { title: `Borrowed ${money(r.amount)} for ${r.detail}`, flow: "out" };
        case "repayment":
          return { title: `Repaid ${money(r.amount)} on the loan for ${r.detail}`, flow: "in" };
        case "dividend":
          return { title: `Received a dividend of ${money(r.amount)} for ${r.detail}`, flow: "out" };
        case "attended":
          return { title: `Attended "${r.title}"`, flow: null };
        case "missed":
          return { title: `Missed "${r.title}"`, flow: null };
        case "registered":
          return { title: `Registered for "${r.title}"`, flow: null };
        case "status":
          return { title: `Membership status changed to ${r.detail}`, flow: null };
        case "joined":
          return { title: "Joined the cooperative", flow: null };
        default:
          return { title: r.kind, flow: null };
      }
    };

    res.json({
      success: true,
      data: rows.rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        at: r.at,
        amount: r.amount != null ? Number(r.amount) : null,
        note: r.kind === "status" ? r.title : null,
        ...describe(r),
      })),
      pagination: { page, limit, total: parseInt(total.rows[0].n, 10) },
    });
  } catch (err) {
    console.error("GET /members/:id/history error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.get("/:id/activities", async (req: Request, res: Response) => {
  try {
    const access = await resolveMemberAccess(req.user!.userId, req.params.id);
    if (!access.allowed) {
      return res
        .status(access.reason === "Member not found" ? 404 : 403)
        .json({ success: false, message: access.reason });
    }
    const id = access.member.id as string; // resolved, so "me" works

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
