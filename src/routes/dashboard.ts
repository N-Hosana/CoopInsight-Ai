import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

const GASABO_SECTORS = [
  "Bumbogo", "Gatsata", "Gikomero", "Gisozi", "Jabana",
  "Jali", "Kacyiru", "Kimihurura", "Kimironko", "Kinyinya",
  "Ndera", "Nduba", "Remera", "Rusororo", "Rutunga",
];

// GET /stats
router.get("/stats", authenticate, async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    // Build scope filters
    let coopScope = "";
    let memberScope = "";
    let txnScope = "";
    let actScope = "";
    const coopParams: any[] = [];
    const memberParams: any[] = [];
    const txnParams: any[] = [];
    const actParams: any[] = [];

    if (role === "manager" || role === "cooperative") {
      coopScope = `AND id = $1`;
      coopParams.push(userCoopId);
      memberScope = `AND cooperative_id = $1`;
      memberParams.push(userCoopId);
      txnScope = `AND cooperative_id = $1`;
      txnParams.push(userCoopId);
      actScope = `AND cooperative_id = $1`;
      actParams.push(userCoopId);
    }

    const [coopsResult, membersResult, transResult, activResult] = await Promise.all([
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
          COALESCE(AVG(health_score), 0) AS avg_health
         FROM cooperatives WHERE deleted_at IS NULL ${coopScope}`,
        coopParams
      ),
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_this_month
         FROM members WHERE deleted_at IS NULL ${memberScope}`,
        memberParams
      ),
      query(
        `SELECT
          COALESCE(SUM(CASE WHEN type = 'income' AND date >= DATE_TRUNC('month', NOW()) THEN amount ELSE 0 END), 0) AS monthly_revenue,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
         FROM transactions WHERE status = 'completed' ${txnScope}`,
        txnParams
      ),
      query(
        `SELECT
          COUNT(*) FILTER (WHERE date BETWEEN NOW() AND NOW() + INTERVAL '7 days' AND status = 'planned') AS upcoming,
          COUNT(*) FILTER (WHERE date >= DATE_TRUNC('month', NOW()) AND status = 'completed') AS completed_this_month
         FROM activities WHERE deleted_at IS NULL ${actScope}`,
        actParams
      ),
    ]);

    const coops = coopsResult.rows[0];
    const members = membersResult.rows[0];
    const trans = transResult.rows[0];
    const activ = activResult.rows[0];

    // Savings from cooperatives table
    const savingsResult = await query(
      `SELECT COALESCE(SUM(total_savings), 0) AS total_savings FROM cooperatives WHERE deleted_at IS NULL ${coopScope}`,
      coopParams
    );

    const atRiskResult = await query(
      `SELECT COUNT(*) AS count FROM cooperatives WHERE health_score < 50 AND deleted_at IS NULL ${coopScope}`,
      coopParams
    );

    res.json({
      success: true,
      data: {
        totalCooperatives: parseInt(coops.total, 10),
        activeCooperatives: parseInt(coops.active, 10),
        suspendedCooperatives: parseInt(coops.suspended, 10),
        totalMembers: parseInt(members.total, 10),
        activeMembers: parseInt(members.active, 10),
        newMembersThisMonth: parseInt(members.new_this_month, 10),
        monthlyRevenue: parseFloat(trans.monthly_revenue),
        totalSavings: parseFloat(savingsResult.rows[0].total_savings),
        activeLoanBalance: 0,
        overdueLoans: 0,
        upcomingActivities: parseInt(activ.upcoming, 10),
        activitiesThisMonth: parseInt(activ.completed_this_month, 10),
        completionRate: 0,
        averageHealthScore: parseFloat(coops.avg_health),
        cooperativesAtRisk: parseInt(atRiskResult.rows[0].count, 10),
      },
    });
  } catch (err) {
    console.error("GET /dashboard/stats error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /recent-activity
router.get("/recent-activity", authenticate, async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;
    const limitNum = Math.min(50, Math.max(1, Number(limit)));

    let txnWhere = "";
    let memberWhere = "";
    const txnParams: any[] = [];
    const memberParams: any[] = [];

    if (role === "manager" || role === "cooperative" || role === "member") {
      txnWhere = `AND t.cooperative_id = $1`;
      txnParams.push(userCoopId);
      memberWhere = `AND m.cooperative_id = $1`;
      memberParams.push(userCoopId);
    }

    const result = await query(
      `(SELECT 'transaction' AS entity_type, t.id::text, t.description AS title, t.type AS sub_type,
               t.amount, t.created_at, c.name AS cooperative_name
        FROM transactions t
        JOIN cooperatives c ON c.id = t.cooperative_id
        WHERE 1=1 ${txnWhere}
        ORDER BY t.created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'member', m.id::text, m.full_name, 'new_member', NULL, m.created_at, c.name
        FROM members m
        JOIN cooperatives c ON c.id = m.cooperative_id
        WHERE m.deleted_at IS NULL ${memberWhere}
        ORDER BY m.created_at DESC LIMIT 5)
       ORDER BY created_at DESC
       LIMIT $${txnParams.length + memberParams.length + 1}`,
      [...txnParams, ...memberParams, limitNum]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /dashboard/recent-activity error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /alerts
router.get("/alerts", authenticate, async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    let coopScope = "";
    let actScope = "";
    const coopParams: any[] = [];
    const actParams: any[] = [];

    if (role === "manager" || role === "cooperative") {
      coopScope = `AND id = $1`;
      coopParams.push(userCoopId);
      actScope = `AND cooperative_id = $1`;
      actParams.push(userCoopId);
    }

    const [lowHealthResult, upcomingActResult] = await Promise.all([
      query(
        `SELECT id, name, health_score, sector
         FROM cooperatives
         WHERE health_score < 50 AND deleted_at IS NULL ${coopScope}
         ORDER BY health_score ASC LIMIT 10`,
        coopParams
      ),
      query(
        `SELECT id, title, date, type, cooperative_id
         FROM activities
         WHERE date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
           AND status = 'planned'
           AND deleted_at IS NULL ${actScope}
         ORDER BY date ASC LIMIT 10`,
        actParams
      ),
    ]);

    const alerts: any[] = [];

    if (lowHealthResult.rows.length > 0) {
      alerts.push({
        type: "low_health",
        severity: "warning",
        message: `${lowHealthResult.rows.length} cooperative(s) have a health score below 50`,
        items: lowHealthResult.rows,
      });
    }

    if (upcomingActResult.rows.length > 0) {
      alerts.push({
        type: "upcoming_activities",
        severity: "info",
        message: `${upcomingActResult.rows.length} activity(ies) scheduled in the next 7 days`,
        items: upcomingActResult.rows,
      });
    }

    res.json({ success: true, data: alerts });
  } catch (err) {
    console.error("GET /dashboard/alerts error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /health-overview
router.get("/health-overview", authenticate, async (req: Request, res: Response) => {
  try {
    const { sector } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const conditions: string[] = ["deleted_at IS NULL"];
    const params: any[] = [];

    if (role === "manager" || role === "cooperative") {
      conditions.push(`id = $${params.length + 1}`);
      params.push(userCoopId);
    }
    if (sector) {
      conditions.push(`sector = $${params.length + 1}`);
      params.push(sector);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [distResult, topResult, bottomResult] = await Promise.all([
      query(
        `SELECT
          COUNT(*) FILTER (WHERE health_score >= 80) AS excellent,
          COUNT(*) FILTER (WHERE health_score >= 60 AND health_score < 80) AS good,
          COUNT(*) FILTER (WHERE health_score >= 40 AND health_score < 60) AS fair,
          COUNT(*) FILTER (WHERE health_score < 40) AS poor,
          COALESCE(AVG(health_score), 0) AS average
         FROM cooperatives ${whereClause}`,
        params
      ),
      query(
        `SELECT id, name, health_score, sector FROM cooperatives ${whereClause} ORDER BY health_score DESC LIMIT 5`,
        params
      ),
      query(
        `SELECT id, name, health_score, sector FROM cooperatives ${whereClause} AND health_score < 50 ORDER BY health_score ASC LIMIT 5`.replace(
          "IS NULL AND",
          "IS NULL AND"
        ),
        params
      ),
    ]);

    const dist = distResult.rows[0];

    res.json({
      success: true,
      data: {
        distribution: {
          excellent: parseInt(dist.excellent, 10),
          good: parseInt(dist.good, 10),
          fair: parseInt(dist.fair, 10),
          poor: parseInt(dist.poor, 10),
        },
        average: parseFloat(dist.average),
        topPerformers: topResult.rows,
        atRisk: bottomResult.rows,
      },
    });
  } catch (err) {
    console.error("GET /dashboard/health-overview error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /government/overview
router.get(
  "/government/overview",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const [coopsResult, membersResult, transResult, actResult] = await Promise.all([
        query(
          `SELECT
            COUNT(*) AS total,
            COALESCE(AVG(health_score), 0) AS avg_health,
            COALESCE(SUM(total_savings), 0) AS total_savings,
            COALESCE(SUM(total_loans), 0) AS total_loans
           FROM cooperatives WHERE deleted_at IS NULL`
        ),
        query(`SELECT COUNT(*) AS total FROM members WHERE deleted_at IS NULL`),
        query(
          `SELECT COUNT(*) AS total FROM activities
           WHERE deleted_at IS NULL
             AND date >= DATE_TRUNC('quarter', NOW())`
        ),
        query(
          `SELECT sector, COUNT(*) AS count FROM cooperatives WHERE deleted_at IS NULL GROUP BY sector`
        ),
      ]);

      const coops = coopsResult.rows[0];

      res.json({
        success: true,
        data: {
          district: "Gasabo",
          totalCooperatives: parseInt(coops.total, 10),
          totalMembers: parseInt(membersResult.rows[0].total, 10),
          totalSavingsDistrict: parseFloat(coops.total_savings || 0),
          totalLoansDistrict: parseFloat(coops.total_loans || 0),
          averageHealthScore: parseFloat(coops.avg_health),
          activitiesThisQuarter: parseInt(transResult.rows[0].total, 10),
          complianceRate: 0,
          breakdownBySector: actResult.rows,
        },
      });
    } catch (err) {
      console.error("GET /dashboard/government/overview error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// GET /government/cooperatives
router.get(
  "/government/cooperatives",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { sector, type, healthMin, healthMax, search, page = 1, limit = 20 } = req.query;

      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = ["c.deleted_at IS NULL"];
      const params: any[] = [];

      if (sector) {
        conditions.push(`c.sector = $${params.length + 1}`);
        params.push(sector);
      }
      if (type) {
        conditions.push(`c.type = $${params.length + 1}`);
        params.push(type);
      }
      if (healthMin) {
        conditions.push(`c.health_score >= $${params.length + 1}`);
        params.push(Number(healthMin));
      }
      if (healthMax) {
        conditions.push(`c.health_score <= $${params.length + 1}`);
        params.push(Number(healthMax));
      }
      if (search) {
        conditions.push(`c.name ILIKE $${params.length + 1}`);
        params.push(`%${search}%`);
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const countResult = await query(
        `SELECT COUNT(*) AS total FROM cooperatives c ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total, 10);

      const dataResult = await query(
        `SELECT c.*,
          (SELECT COUNT(*) FROM members m WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count,
          (SELECT COUNT(*) FROM activities a WHERE a.cooperative_id = c.id AND a.deleted_at IS NULL AND EXTRACT(YEAR FROM a.date) = EXTRACT(YEAR FROM NOW())) AS activity_count_ytd
         FROM cooperatives c ${whereClause}
         ORDER BY c.health_score ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limitNum, offset]
      );

      res.json({
        success: true,
        data: dataResult.rows,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (err) {
      console.error("GET /dashboard/government/cooperatives error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// GET /government/compliance
router.get(
  "/government/compliance",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { sector } = req.query;

      const conditions: string[] = ["deleted_at IS NULL"];
      const params: any[] = [];

      if (sector) {
        conditions.push(`sector = $${params.length + 1}`);
        params.push(sector);
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE health_score >= 70) AS fully_compliant,
          COUNT(*) FILTER (WHERE health_score >= 40 AND health_score < 70) AS partially_compliant,
          COUNT(*) FILTER (WHERE health_score < 40) AS non_compliant
         FROM cooperatives ${whereClause}`,
        params
      );

      const row = result.rows[0];
      const total = parseInt(row.total, 10);
      const fullyCompliant = parseInt(row.fully_compliant, 10);

      const nonCompliantResult = await query(
        `SELECT id, name, health_score, sector FROM cooperatives ${whereClause} AND health_score < 40 ORDER BY health_score ASC LIMIT 20`.replace(
          "IS NULL AND",
          "IS NULL AND"
        ),
        params
      );

      res.json({
        success: true,
        data: {
          overallComplianceRate: total > 0 ? Math.round((fullyCompliant / total) * 100) : 0,
          fullyCompliant,
          partiallyCompliant: parseInt(row.partially_compliant, 10),
          nonCompliant: parseInt(row.non_compliant, 10),
          checkpoints: {
            annualReportSubmitted: 0,
            mandatoryDocuments: 0,
            meetingsHeld: 0,
            loanPortfolioHealth: 0,
          },
          nonCompliantList: nonCompliantResult.rows,
          complianceTrend: [],
        },
      });
    } catch (err) {
      console.error("GET /dashboard/government/compliance error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// GET /government/sector/:sector
router.get(
  "/government/sector/:sector",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { sector } = req.params;

      if (!GASABO_SECTORS.includes(sector)) {
        return res.status(400).json({ message: "Invalid Gasabo sector name" });
      }

      const [coopsResult, membersResult, actResult] = await Promise.all([
        query(
          `SELECT
            COUNT(*) AS total,
            COALESCE(AVG(health_score), 0) AS avg_health,
            COALESCE(SUM(total_savings), 0) AS total_savings
           FROM cooperatives WHERE sector = $1 AND deleted_at IS NULL`,
          [sector]
        ),
        query(
          `SELECT COUNT(*) AS total FROM members m
           JOIN cooperatives c ON c.id = m.cooperative_id
           WHERE c.sector = $1 AND c.deleted_at IS NULL AND m.deleted_at IS NULL`,
          [sector]
        ),
        query(
          `SELECT COUNT(*) AS total FROM activities a
           JOIN cooperatives c ON c.id = a.cooperative_id
           WHERE c.sector = $1 AND c.deleted_at IS NULL AND a.deleted_at IS NULL
             AND EXTRACT(YEAR FROM a.date) = EXTRACT(YEAR FROM NOW())`,
          [sector]
        ),
      ]);

      const coopsListResult = await query(
        `SELECT id, name, health_score, total_savings, type,
          (SELECT COUNT(*) FROM members m WHERE m.cooperative_id = cooperatives.id AND m.deleted_at IS NULL) AS member_count
         FROM cooperatives WHERE sector = $1 AND deleted_at IS NULL ORDER BY name`,
        [sector]
      );

      res.json({
        success: true,
        data: {
          sector,
          totalCooperatives: parseInt(coopsResult.rows[0].total, 10),
          totalMembers: parseInt(membersResult.rows[0].total, 10),
          totalSavings: parseFloat(coopsResult.rows[0].total_savings),
          averageHealthScore: parseFloat(coopsResult.rows[0].avg_health),
          activitiesThisYear: parseInt(actResult.rows[0].total, 10),
          cooperatives: coopsListResult.rows,
        },
      });
    } catch (err) {
      console.error("GET /dashboard/government/sector/:sector error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// GET /government/trends
router.get(
  "/government/trends",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { from, to, sector } = req.query;

      const startDate = from || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split("T")[0];
      const endDate = to || new Date().toISOString().split("T")[0];

      const coopConditions = sector ? `AND c.sector = $3` : "";
      const coopParams: any[] = [startDate, endDate];
      if (sector) coopParams.push(sector);

      const [memberGrowth, activityTrend] = await Promise.all([
        query(
          `SELECT
            DATE_TRUNC('month', m.created_at) AS month,
            COUNT(*) AS new_members
           FROM members m
           JOIN cooperatives c ON c.id = m.cooperative_id
           WHERE m.deleted_at IS NULL
             AND m.created_at BETWEEN $1 AND $2
             ${coopConditions}
           GROUP BY DATE_TRUNC('month', m.created_at)
           ORDER BY month ASC`,
          coopParams
        ),
        query(
          `SELECT
            DATE_TRUNC('month', a.date) AS month,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status = 'completed') AS completed
           FROM activities a
           JOIN cooperatives c ON c.id = a.cooperative_id
           WHERE a.deleted_at IS NULL
             AND a.date BETWEEN $1 AND $2
             ${coopConditions}
           GROUP BY DATE_TRUNC('month', a.date)
           ORDER BY month ASC`,
          coopParams
        ),
      ]);

      res.json({
        success: true,
        data: {
          memberGrowth: memberGrowth.rows,
          activityTrend: activityTrend.rows,
          savingsGrowth: [],
          healthScoreTrend: [],
          cooperativeGrowth: [],
        },
      });
    } catch (err) {
      console.error("GET /dashboard/government/trends error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// GET /government/export
router.get(
  "/government/export",
  authenticate,
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { format = "pdf" } = req.query;
      if (!["pdf", "csv"].includes(format as string)) {
        return res.status(400).json({ message: "format must be pdf or csv" });
      }

      const countResult = await query(
        `SELECT COUNT(*) AS total FROM cooperatives WHERE deleted_at IS NULL`
      );

      res.json({
        success: true,
        message: "Export pending — file generation not yet implemented",
        count: parseInt(countResult.rows[0].total, 10),
      });
    } catch (err) {
      console.error("GET /dashboard/government/export error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

export default router;
