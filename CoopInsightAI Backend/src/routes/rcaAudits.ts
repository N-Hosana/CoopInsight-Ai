import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { assemblyDateTime, registerAllMembers } from "../services/assemblies";
import { broadcastToCooperative, notifyOversight } from "../services/broadcast";
import {
  AUDIT_KINDS,
  AUDIT_KIND_LABEL,
  AUDIT_SCOPE,
  AUDIT_STEP_RESPONSE_DAYS,
  AuditKind,
  DISTRICT_NAME,
  FINDING_RESULTS,
  MIN_AUDIT_NOTICE_DAYS,
  MIN_REASON_LENGTH,
  OVERALL_RATINGS,
  REASON_CATEGORIES,
  REASON_CATEGORY_IDS,
  ROUND_CADENCE,
  ROUND_TYPES,
  RequesterLevel,
  RoundType,
  STATUS_LABEL,
  StepActor,
  TERMINAL_STATUSES,
  auditRoute,
  buildAuditProcess,
  isoDate,
  nextStep,
  periodOf,
  previousPeriodOf,
} from "../services/rcaAudits";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RCA AUDITS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Requested audits climb from whoever asked to the RCA officer for the district
 * and come back down; announced audits start at the RCA. Both end with the
 * cooperative telling its members, the audit being held, and the findings
 * going to everyone in the chain. The steps themselves are defined once, in
 * `services/rcaAudits.ts` — this module moves a request through them and
 * enforces who may move it.
 *
 * Everyone who will touch an audit can see it from the moment it is filed —
 * the RCA officer sees a manager's request while it is still with the sector —
 * but only the tier whose turn it is can act on it.
 */

type Tier = "admin" | "cooperative" | "sector" | "district" | "rca" | null;

interface Actor {
  id: string;
  name: string;
  role: string;
  sector: string | null;
  cooperativeId: string | null;
  oversightLevel: string | null;
}

/** The JWT may predate oversight_level, so read it from the row. */
async function loadActor(userId: string): Promise<Actor | null> {
  const res = await query(
    `SELECT id, name, role, sector, cooperative_id, oversight_level FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        role: row.role,
        sector: row.sector,
        cooperativeId: row.cooperative_id,
        oversightLevel: row.oversight_level,
      }
    : null;
}

/** Where in the chain this account sits. Members have no place in it. */
function tierOf(actor: Actor): Tier {
  if (["admin", "generalManager"].includes(actor.role)) return "admin";
  if (actor.role === "government" && actor.oversightLevel) return actor.oversightLevel as Tier;
  if (["manager", "cooperative"].includes(actor.role) && actor.cooperativeId) return "cooperative";
  return null;
}

/** May this account act as `stepActor` on this audit? */
function actsAs(actor: Actor, row: any, stepActor: StepActor): boolean {
  const tier = tierOf(actor);
  if (tier === "admin") return true;
  switch (stepActor) {
    case "requester":
      return row.requested_by === actor.id;
    case "cooperative":
      return tier === "cooperative" && actor.cooperativeId === row.cooperative_id;
    case "sector":
      return tier === "sector" && (!actor.sector || actor.sector === row.sector);
    case "district":
      return tier === "district";
    case "rca":
      return tier === "rca";
  }
}

const SELECT_AUDIT = `
  SELECT a.*,
         c.name  AS cooperative_name,
         u.name  AS requested_by_name,
         ap.name AS approved_by_name,
         act.date AS activity_date,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', x.id, 'step', x.step, 'action', x.action, 'note', x.note,
              'payload', x.payload, 'actedAt', x.acted_at, 'actorName', xu.name)
              ORDER BY x.acted_at)
              FROM audit_request_actions x
              LEFT JOIN users xu ON xu.id = x.acted_by
             WHERE x.request_id = a.id), '[]') AS actions
    FROM audit_requests a
    JOIN cooperatives c ON c.id = a.cooperative_id
    JOIN users u ON u.id = a.requested_by
    LEFT JOIN users ap ON ap.id = a.approved_by
    LEFT JOIN activities act ON act.id = a.activity_id
`;

/** Who a step is waiting on, said the way a person would say it. */
function waitingOnLabel(stepActor: StepActor | null, row: any): string | null {
  switch (stepActor) {
    case "requester":
      return row.requested_by_name;
    case "cooperative":
      return `the manager of ${row.cooperative_name}`;
    case "sector":
      return `the ${row.sector} sector cooperative officer`;
    case "district":
      return "the district cooperative officer";
    case "rca":
      return "the RCA officer";
    default:
      return null;
  }
}

/** What this viewer may do to this audit right now. */
function allowedActions(actor: Actor, row: any): string[] {
  const s = row.status as string;
  if (TERMINAL_STATUSES.includes(s)) return [];
  const route = auditRoute(row.origin, row.requester_level);
  const step = route.find((r) => r.key === row.current_step);
  const out: string[] = [];
  const at = (a: StepActor) => actsAs(actor, row, a);

  if ((s === "pending_sector" || s === "pending_district") && step && at(step.actor)) {
    out.push("forward", "return", "reject");
  }
  if (row.current_step === "rca_decision" && at("rca")) {
    if (s === "pending_rca") out.push("approve", "waitlist", "return", "reject");
    if (s === "waitlisted") out.push("approve", "reject");
    if (s === "reschedule_requested") out.push("approve", "reject");
  }
  if ((s === "relay_district" || s === "relay_sector") && step && at(step.actor)) out.push("relay");
  if (s === "awaiting_confirmation" && at("requester")) out.push("confirm", "request_reschedule");
  if (s === "returned" && at("requester")) out.push("resubmit");
  if (s === "announced" && at("cooperative")) out.push("acknowledge");
  if (s === "confirmed" && !row.activity_id && at("cooperative")) out.push("convene");
  if (s === "confirmed" && at("rca")) out.push("start");
  if (s === "in_progress" && at("rca")) out.push("complete");

  const beforeConfirmation = [
    "pending_sector", "pending_district", "pending_rca", "returned", "waitlisted",
    "relay_district", "relay_sector", "awaiting_confirmation", "reschedule_requested",
  ];
  if (row.origin === "requested" && beforeConfirmation.includes(s) && at("requester")) {
    out.push("withdraw");
  }
  const cancellable = [
    "waitlisted", "relay_district", "relay_sector", "awaiting_confirmation",
    "reschedule_requested", "announced", "confirmed",
  ];
  if (cancellable.includes(s) && at("rca")) out.push("cancel");

  return Array.from(new Set(out));
}

/**
 * Attaches the stages, the viewer's place in them, and the actions open to the
 * viewer. "Your turn", "waiting on the sector officer — yours comes after" and
 * "you have done your part" are worked out here, not in the browser.
 */
function decorate(row: any, actor: Actor) {
  const process = buildAuditProcess({
    origin: row.origin,
    requesterLevel: row.requester_level,
    status: row.status,
    currentStep: row.current_step,
    createdAt: row.created_at,
    stepDueAt: row.step_due_at,
    scheduledStart: row.scheduled_start,
    activityId: row.activity_id,
    actions: Array.isArray(row.actions) ? row.actions : [],
  });
  const actions = allowedActions(actor, row);
  const route = auditRoute(row.origin, row.requester_level);
  const currentIndex = route.findIndex((s) => s.key === row.current_step);
  const viewerSteps = route
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => tierOf(actor) !== "admin" && actsAs(actor, row, s.actor));

  let viewerPosition: "your_turn" | "upcoming" | "done_your_part" | "watching" | "closed";
  if (TERMINAL_STATUSES.includes(row.status)) viewerPosition = "closed";
  else if (actions.some((a) => !["withdraw", "cancel"].includes(a))) viewerPosition = "your_turn";
  else if (viewerSteps.some(({ i }) => i > currentIndex)) viewerPosition = "upcoming";
  else if (viewerSteps.length) viewerPosition = "done_your_part";
  else viewerPosition = "watching";

  const waitingOn = TERMINAL_STATUSES.includes(row.status)
    ? null
    : row.status === "returned"
      ? row.requested_by_name
      : waitingOnLabel(process.currentActor as StepActor | null, row);

  return {
    ...row,
    statusLabel: STATUS_LABEL[row.status] ?? row.status,
    kindLabel: AUDIT_KIND_LABEL[row.audit_kind as AuditKind],
    process,
    allowedActions: actions,
    viewerPosition,
    waitingOn,
  };
}

async function nextReference(kind: AuditKind) {
  const prefix = kind === "financial" ? "AUD-F" : "AUD-G";
  const year = new Date().getFullYear();
  const res = await query(
    `SELECT COUNT(*) AS n FROM audit_requests
      WHERE audit_kind = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [kind, year]
  );
  return `${prefix}/${year}/${String(parseInt(res.rows[0].n, 10) + 1).padStart(4, "0")}`;
}

async function logAction(
  requestId: string,
  step: string,
  action: string,
  actorId: string,
  note?: string | null,
  payload?: unknown
) {
  await query(
    `INSERT INTO audit_request_actions (request_id, step, action, note, payload, acted_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [requestId, step, action, note || null, payload ? JSON.stringify(payload) : null, actorId]
  );
}

async function notifyUser(userId: string, title: string, message: string) {
  await query(
    `INSERT INTO notifications (user_id, title, message, type, link)
     VALUES ($1,$2,$3,'alert','/rca-audits')`,
    [userId, title, message]
  );
}

/** Tells the cooperative's manager account(s). */
async function notifyCooperative(cooperativeId: string, title: string, message: string) {
  const managers = await query(
    `SELECT id FROM users
      WHERE cooperative_id = $1 AND status = 'active' AND role IN ('manager','cooperative')`,
    [cooperativeId]
  );
  for (const m of managers.rows) await notifyUser(m.id, title, message);
  return managers.rowCount ?? 0;
}

/** Tells whoever acts at a step of the chain. */
async function notifyStepActor(stepActor: StepActor, row: any, title: string, message: string) {
  if (stepActor === "requester") return notifyUser(row.requested_by, title, message);
  if (stepActor === "cooperative") return notifyCooperative(row.cooperative_id, title, message);
  return notifyOversight({ levels: [stepActor], sector: row.sector, title, message, link: "/rca-audits" });
}

/** Validates the RCA's choice of checklist items and adds any custom ones. */
function resolveScope(kind: AuditKind, scopeIds: unknown, custom: unknown) {
  const ids = Array.isArray(scopeIds) ? scopeIds.map(String) : [];
  const catalogue = AUDIT_SCOPE[kind];
  const chosen = catalogue.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, custom: false }));
  const extra = (Array.isArray(custom) ? custom : [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `custom_${i + 1}`, label, detail: "Added by the RCA officer.", custom: true }));
  return [...chosen, ...extra];
}

function localDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: isoDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}:00` };
}

/** Why a proposed audit start is not acceptable, or null. */
function scheduleProblem(start: unknown, end: unknown): string | null {
  if (!start || Number.isNaN(Date.parse(String(start)))) {
    return "scheduledStart must be the date and time the audit begins.";
  }
  const days = (Date.parse(String(start)) - Date.now()) / 86_400_000;
  if (days < MIN_AUDIT_NOTICE_DAYS) {
    return `The cooperative must have at least ${MIN_AUDIT_NOTICE_DAYS} days' notice of an audit.`;
  }
  if (end && (Number.isNaN(Date.parse(String(end))) || Date.parse(String(end)) <= Date.parse(String(start)))) {
    return "scheduledEnd must be after scheduledStart.";
  }
  return null;
}

/** One open audit of a kind per cooperative, whoever opened it. */
async function openAuditFor(cooperativeId: string, kind: string) {
  const res = await query(
    `SELECT reference, status FROM audit_requests
      WHERE cooperative_id = $1 AND audit_kind = $2
        AND status NOT IN ('completed','rejected','withdrawn','cancelled')
      LIMIT 1`,
    [cooperativeId, kind]
  );
  return res.rows[0] ?? null;
}

/** The cooperatives this account may pick from when requesting or announcing. */
async function selectableCooperatives(actor: Actor) {
  const tier = tierOf(actor);
  if (tier === "cooperative") {
    return (
      await query(`SELECT id, name, sector FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`, [
        actor.cooperativeId,
      ])
    ).rows;
  }
  if (tier === "sector" && actor.sector) {
    return (
      await query(
        `SELECT id, name, sector FROM cooperatives
          WHERE sector = $1 AND deleted_at IS NULL ORDER BY name`,
        [actor.sector]
      )
    ).rows;
  }
  if (tier) {
    return (
      await query(`SELECT id, name, sector FROM cooperatives WHERE deleted_at IS NULL ORDER BY sector, name`)
    ).rows;
  }
  return [];
}

// ─── GET /meta ────────────────────────────────────────────────────────────────
// Everything the forms need: the kinds, the reasons, the checklists, the
// cadences, the cooperatives this viewer may choose from, and what they may do.
router.get("/meta", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const tier = tierOf(actor);
    const cooperatives = await selectableCooperatives(actor);
    const sectors = Array.from(new Set(cooperatives.map((c: any) => c.sector))).sort();

    res.json({
      success: true,
      data: {
        district: DISTRICT_NAME,
        kinds: AUDIT_KINDS.map((k) => ({ id: k, label: AUDIT_KIND_LABEL[k] })),
        reasonCategories: REASON_CATEGORIES,
        minReasonLength: MIN_REASON_LENGTH,
        minNoticeDays: MIN_AUDIT_NOTICE_DAYS,
        stepResponseDays: AUDIT_STEP_RESPONSE_DAYS,
        scope: AUDIT_SCOPE,
        findingResults: FINDING_RESULTS,
        overallRatings: OVERALL_RATINGS,
        cadence: ROUND_CADENCE,
        statusLabels: STATUS_LABEL,
        cooperatives,
        sectors,
        viewer: {
          tier,
          sector: actor.sector,
          // Members cannot ask for an audit; the RCA announces rather than asks.
          canRequest: ["cooperative", "sector", "district", "admin"].includes(tier ?? ""),
          canAnnounce: ["rca", "admin"].includes(tier ?? ""),
          canRunProgramme: ["sector", "district", "rca", "admin"].includes(tier ?? ""),
        },
      },
    });
  } catch (err) {
    console.error("GET /rca-audits/meta error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const tier = tierOf(actor);
    if (!tier) return res.json({ success: true, data: [] });

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (tier === "cooperative") {
      // Their own requests, and any audit of their cooperative once it has been
      // decided that it is going ahead. A request an officer filed about them is
      // not shown while it is still being considered.
      params.push(actor.id, actor.cooperativeId);
      conditions.push(
        `(a.requested_by = $1 OR (a.cooperative_id = $2 AND a.status IN
           ('announced','confirmed','in_progress','completed','awaiting_confirmation',
            'reschedule_requested','cancelled')))`
      );
    } else if (tier === "sector") {
      params.push(actor.id);
      const own = `a.requested_by = $${params.length}`;
      let inScope = "TRUE";
      if (actor.sector) {
        params.push(actor.sector);
        inScope = `a.sector = $${params.length}`;
      }
      // Anything in their sector that the chain routes through them, plus every
      // audit going ahead in their sector — including ones they never handled.
      conditions.push(
        `(${own} OR (${inScope} AND (a.requester_level = 'cooperative'
           OR a.status IN ('announced','confirmed','in_progress','completed'))))`
      );
    } else if (tier === "district") {
      params.push(actor.id);
      conditions.push(
        `(a.requested_by = $1 OR a.requester_level IN ('cooperative','sector')
           OR a.status IN ('announced','confirmed','in_progress','completed'))`
      );
    }
    // The RCA officer and administrators see every audit in the district.

    const { status, kind, cooperativeId } = req.query;
    if (status === "open") conditions.push(`a.status NOT IN ('completed','rejected','withdrawn','cancelled')`);
    if (status === "closed") conditions.push(`a.status IN ('completed','rejected','withdrawn','cancelled')`);
    if (kind) {
      params.push(kind);
      conditions.push(`a.audit_kind = $${params.length}`);
    }
    if (cooperativeId) {
      params.push(cooperativeId);
      conditions.push(`a.cooperative_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_AUDIT} ${where}
       ORDER BY CASE WHEN a.status IN ('completed','rejected','withdrawn','cancelled') THEN 1 ELSE 0 END,
                COALESCE(a.scheduled_start, a.step_due_at, a.created_at) ASC`,
      params
    );
    const data = result.rows.map((r) => decorate(r, actor));

    res.json({
      success: true,
      data,
      summary: {
        yourTurn: data.filter((d) => d.viewerPosition === "your_turn").length,
        open: data.filter((d) => !TERMINAL_STATUSES.includes(d.status)).length,
        scheduled: data.filter((d) => ["confirmed", "announced"].includes(d.status)).length,
        completed: data.filter((d) => d.status === "completed").length,
      },
    });
  } catch (err) {
    console.error("GET /rca-audits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
// Ask the RCA for an audit. Cooperative managers, sector officers and district
// officers may; members may not, and the RCA announces rather than asks.
router.post("/", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const tier = tierOf(actor);

    if (tier === null) {
      return res.status(403).json({
        success: false,
        message:
          "Only a cooperative manager or a sector or district officer may request an audit. " +
          "If you are worried about your cooperative, report an issue instead.",
      });
    }
    if (tier === "rca") {
      return res.status(400).json({
        success: false,
        message: "The RCA does not request audits from itself — announce one instead.",
      });
    }

    const { auditKind, reasonCategory, reasons, preferredDate } = req.body;
    if (!AUDIT_KINDS.includes(auditKind)) {
      return res.status(400).json({ success: false, message: "auditKind must be general or financial." });
    }
    if (!REASON_CATEGORY_IDS.includes(reasonCategory)) {
      return res.status(400).json({ success: false, message: "Choose why the audit is needed." });
    }
    const reasonText = String(reasons ?? "").trim();
    if (reasonText.length < MIN_REASON_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Explain the reasons in at least ${MIN_REASON_LENGTH} characters, so the officers can judge them.`,
      });
    }
    if (!preferredDate || Number.isNaN(Date.parse(preferredDate))) {
      return res.status(400).json({ success: false, message: "Suggest the date you would like the audit held." });
    }
    if (String(preferredDate).slice(0, 10) <= isoDate(new Date())) {
      return res.status(400).json({ success: false, message: "The suggested date must be in the future." });
    }

    const cooperativeId = tier === "cooperative" ? actor.cooperativeId : req.body.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ success: false, message: "Choose the cooperative to be audited." });
    }
    const coopRes = await query(
      `SELECT id, name, sector FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`,
      [cooperativeId]
    );
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const coop = coopRes.rows[0];
    if (tier === "sector" && actor.sector && coop.sector !== actor.sector) {
      return res.status(403).json({
        success: false,
        message: `${coop.name} is in ${coop.sector}. A sector officer requests audits for their own sector.`,
      });
    }

    const open = await openAuditFor(coop.id, auditKind);
    if (open) {
      return res.status(409).json({
        success: false,
        message: `${open.reference} — a ${auditKind} audit of ${coop.name} — is already open (${STATUS_LABEL[open.status]}).`,
      });
    }

    // An administrator files as a cooperative would, so the whole chain runs.
    const requesterLevel: RequesterLevel = tier === "admin" ? "cooperative" : tier;
    const route = auditRoute("requested", requesterLevel);
    const first = route[1];
    const reference = await nextReference(auditKind);

    const inserted = await query(
      `INSERT INTO audit_requests
         (reference, origin, audit_kind, cooperative_id, sector, district, requested_by,
          requester_level, reason_category, reasons, preferred_date, current_step, status, step_due_at)
       VALUES ($1,'requested',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               NOW() + ($13)::int * INTERVAL '1 day')
       RETURNING *`,
      [
        reference, auditKind, coop.id, coop.sector, DISTRICT_NAME, actor.id, requesterLevel,
        reasonCategory, reasonText, preferredDate, first.key, first.status, AUDIT_STEP_RESPONSE_DAYS,
      ]
    );
    const row = { ...inserted.rows[0], cooperative_name: coop.name, requested_by_name: actor.name };
    await logAction(row.id, "filed", "filed", actor.id, null, { preferredDate });

    await notifyStepActor(
      first.actor,
      row,
      `Audit request ${reference} — your review`,
      `${actor.name} asks for a ${AUDIT_KIND_LABEL[auditKind as AuditKind].toLowerCase()} of ${coop.name}. ` +
        `Suggested date: ${preferredDate}.`
    );

    res.status(201).json({
      success: true,
      message: `${reference} sent to ${waitingOnLabel(first.actor, row)}.`,
      data: { id: row.id, reference },
    });
  } catch (err) {
    console.error("POST /rca-audits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /announce ───────────────────────────────────────────────────────────
// The RCA officer schedules an audit nobody asked for — of one cooperative or
// several. Each cooperative gets its own audit and its own notice.
router.post("/announce", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!["rca", "admin"].includes(tierOf(actor) ?? "")) {
      return res.status(403).json({ success: false, message: "Only the RCA officer may announce an audit." });
    }

    const {
      auditKind, cooperativeIds, reasonCategory, reasons, scheduledStart, scheduledEnd,
      scopeIds, customScope, auditTeam, instructions,
    } = req.body;
    if (!AUDIT_KINDS.includes(auditKind)) {
      return res.status(400).json({ success: false, message: "auditKind must be general or financial." });
    }
    const ids: string[] = Array.isArray(cooperativeIds) ? cooperativeIds.map(String) : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, message: "Choose at least one cooperative." });
    }
    const category = reasonCategory && REASON_CATEGORY_IDS.includes(reasonCategory) ? reasonCategory : "routine_check";
    const reasonText = String(reasons ?? "").trim();
    if (reasonText.length < 10) {
      return res.status(400).json({ success: false, message: "Say briefly why the audit is being held." });
    }
    const problem = scheduleProblem(scheduledStart, scheduledEnd);
    if (problem) return res.status(400).json({ success: false, message: problem });
    const scope = resolveScope(auditKind, scopeIds, customScope);
    if (!scope.length) {
      return res.status(400).json({ success: false, message: "Choose at least one thing the audit will check." });
    }

    const coops = await query(
      `SELECT id, name, sector FROM cooperatives WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids]
    );
    const created: Array<{ id: string; reference: string; cooperative: string }> = [];
    const skipped: Array<{ cooperative: string; reason: string }> = [];
    const when = new Date(scheduledStart).toLocaleString("en-RW");

    for (const coop of coops.rows) {
      const open = await openAuditFor(coop.id, auditKind);
      if (open) {
        skipped.push({ cooperative: coop.name, reason: `${open.reference} is already open.` });
        continue;
      }
      const reference = await nextReference(auditKind);
      const inserted = await query(
        `INSERT INTO audit_requests
           (reference, origin, audit_kind, cooperative_id, sector, district, requested_by,
            requester_level, reason_category, reasons, preferred_date, current_step, status,
            step_due_at, scheduled_start, scheduled_end, scope, audit_team, rca_instructions,
            approved_by, approved_at)
         VALUES ($1,'rca_initiated',$2,$3,$4,$5,$6,'rca',$7,$8,($9)::timestamptz::date,'acknowledge',
                 'announced', NOW() + ($10)::int * INTERVAL '1 day', ($9)::timestamptz, $11, $12, $13, $14, $6, NOW())
         RETURNING id`,
        [
          reference, auditKind, coop.id, coop.sector, DISTRICT_NAME, actor.id, category, reasonText,
          scheduledStart, AUDIT_STEP_RESPONSE_DAYS, scheduledEnd || null, JSON.stringify(scope),
          auditTeam || null, instructions || null,
        ]
      );
      const id = inserted.rows[0].id;
      await logAction(id, "announced", "announce", actor.id, reasonText, { scheduledStart, scope });

      const label = AUDIT_KIND_LABEL[auditKind as AuditKind];
      await notifyCooperative(
        coop.id,
        `${label} announced — ${reference}`,
        `The RCA will hold a ${label.toLowerCase()} of ${coop.name} from ${when}. ` +
          `It will check: ${scope.map((s) => s.label).join(", ")}. Acknowledge it and tell your members.`
      );
      await notifyOversight({
        levels: ["sector", "district"],
        sector: coop.sector,
        title: `${label} announced — ${coop.name}`,
        message: `The RCA has announced ${reference} for ${coop.name}, from ${when}.`,
        link: "/rca-audits",
      });
      created.push({ id, reference, cooperative: coop.name });
    }

    res.status(created.length ? 201 : 409).json({
      success: created.length > 0,
      message: created.length
        ? `${created.length} audit(s) announced.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
        : "No audit was announced.",
      data: { created, skipped },
    });
  } catch (err) {
    console.error("POST /rca-audits/announce error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── General audit programme: committees and rounds ───────────────────────────
// Declared before /:id so "programme", "rounds" and "committees" are not read
// as audit ids.

/** May this account run the programme at this level (and sector)? */
function managesLevel(actor: Actor, level: "sector" | "district", sector?: string | null) {
  const tier = tierOf(actor);
  if (tier === "admin" || tier === "rca" || tier === "district") return true;
  return level === "sector" && tier === "sector" && (!actor.sector || actor.sector === sector);
}

const SELECT_ROUND = `
  SELECT r.*, cm.name AS committee_name, cu.name AS created_by_name,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'cooperativeId', rc.cooperative_id, 'name', c.name, 'sector', c.sector,
              'activityId', rc.activity_id, 'attended', rc.attended, 'rating', rc.rating,
              'observations', rc.observations) ORDER BY c.name)
              FROM general_audit_round_cooperatives rc
              JOIN cooperatives c ON c.id = rc.cooperative_id
             WHERE rc.round_id = r.id), '[]') AS cooperatives
    FROM general_audit_rounds r
    LEFT JOIN audit_committees cm ON cm.id = r.committee_id
    LEFT JOIN users cu ON cu.id = r.created_by
`;

// GET /programme — is this month's and this trimester's routine done?
router.get("/programme", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const tier = tierOf(actor);
    if (!["sector", "district", "rca", "admin"].includes(tier ?? "")) {
      return res.status(403).json({ success: false, message: "The programme is run by the oversight officers." });
    }

    const now = new Date();
    const sectorsRes = await query(
      `SELECT sector, COUNT(*) AS cooperatives FROM cooperatives
        WHERE deleted_at IS NULL GROUP BY sector ORDER BY sector`
    );
    const sectors = sectorsRes.rows.filter((s) => tier !== "sector" || !actor.sector || s.sector === actor.sector);

    /** Where a round type stands for a period: held, scheduled, or not yet. */
    const standing = async (type: RoundType, sector: string | null) => {
      const cadence = ROUND_CADENCE[type];
      const current = periodOf(now, cadence.every);
      const previous = previousPeriodOf(now, cadence.every);
      const params: unknown[] = [type, [current.label, previous.label]];
      let sectorClause = "AND sector IS NULL";
      if (sector) {
        params.push(sector);
        sectorClause = `AND sector = $3`;
      }
      const rows = (
        await query(
          `SELECT id, reference, period_label, status, scheduled_for, held_on FROM general_audit_rounds
            WHERE round_type = $1 AND period_label = ANY($2::text[]) AND status <> 'cancelled' ${sectorClause}
            ORDER BY scheduled_for`,
          params
        )
      ).rows;
      const thisPeriod = rows.filter((r) => r.period_label === current.label);
      const lastPeriod = rows.filter((r) => r.period_label === previous.label);
      const state = thisPeriod.some((r) => r.status === "held")
        ? "held"
        : thisPeriod.length
          ? "scheduled"
          : "due";
      return {
        roundType: type,
        label: cadence.label,
        every: cadence.every,
        sector,
        period: { label: current.label, name: current.name, start: isoDate(current.start), end: isoDate(current.end) },
        state,
        rounds: thisPeriod,
        // The period before is reported so a missed month or trimester is not
        // silently forgotten once the calendar rolls over.
        previousPeriod: {
          label: previous.label,
          name: previous.name,
          held: lastPeriod.some((r) => r.status === "held"),
        },
      };
    };

    const sectorRounds = [];
    for (const s of sectors) {
      sectorRounds.push({ ...(await standing("sector_general", s.sector)), cooperatives: Number(s.cooperatives) });
    }
    const district = tier === "sector" ? [] : [
      await standing("district_general", null),
      await standing("sensitization", null),
    ];

    res.json({ success: true, data: { today: isoDate(now), sectorRounds, district, cadence: ROUND_CADENCE } });
  } catch (err) {
    console.error("GET /rca-audits/programme error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /rounds — the routine's sittings. A manager sees the ones that visit them.
router.get("/rounds", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const tier = tierOf(actor);
    if (!tier) return res.json({ success: true, data: [] });

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (tier === "cooperative") {
      params.push(actor.cooperativeId);
      conditions.push(
        `EXISTS (SELECT 1 FROM general_audit_round_cooperatives rc
                  WHERE rc.round_id = r.id AND rc.cooperative_id = $${params.length})`
      );
    } else if (tier === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`(r.sector = $${params.length} OR r.sector IS NULL)`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`r.round_type = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_ROUND} ${where}
       ORDER BY CASE r.status WHEN 'scheduled' THEN 0 ELSE 1 END, r.scheduled_for DESC
       LIMIT 200`,
      params
    );
    res.json({
      success: true,
      data: result.rows.map((r) => ({
        ...r,
        typeLabel: ROUND_CADENCE[r.round_type as RoundType].label,
        canManage: managesLevel(actor, ROUND_CADENCE[r.round_type as RoundType].level, r.sector),
      })),
    });
  } catch (err) {
    console.error("GET /rca-audits/rounds error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /rounds — schedule a sitting and put it on every cooperative's calendar.
router.post("/rounds", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const { roundType, sector, scheduledFor, location, agenda, cooperativeIds } = req.body;
    if (!ROUND_TYPES.includes(roundType)) {
      return res.status(400).json({ success: false, message: `roundType must be one of ${ROUND_TYPES.join(", ")}.` });
    }
    const cadence = ROUND_CADENCE[roundType as RoundType];
    const roundSector = cadence.level === "sector" ? (sector || actor.sector) : null;
    if (cadence.level === "sector" && !roundSector) {
      return res.status(400).json({ success: false, message: "Choose the sector this round covers." });
    }
    if (!managesLevel(actor, cadence.level, roundSector)) {
      return res.status(403).json({
        success: false,
        message:
          cadence.level === "sector"
            ? "Only the officer for that sector, the district office or the RCA may schedule it."
            : "Only the district office or the RCA may schedule this.",
      });
    }
    if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
      return res.status(400).json({ success: false, message: "scheduledFor must be the date and time it sits." });
    }
    if (!String(location ?? "").trim() || !String(agenda ?? "").trim()) {
      return res.status(400).json({ success: false, message: "location and agenda are required." });
    }

    // By default a round covers every cooperative in its scope.
    const requested: string[] = Array.isArray(cooperativeIds) ? cooperativeIds.map(String) : [];
    const coopParams: unknown[] = [];
    let coopWhere = "deleted_at IS NULL";
    if (roundSector) {
      coopParams.push(roundSector);
      coopWhere += ` AND sector = $${coopParams.length}`;
    }
    if (requested.length) {
      coopParams.push(requested);
      coopWhere += ` AND id = ANY($${coopParams.length}::uuid[])`;
    }
    const coops = (await query(`SELECT id, name FROM cooperatives WHERE ${coopWhere} ORDER BY name`, coopParams)).rows;
    if (!coops.length) {
      return res.status(400).json({ success: false, message: "No cooperatives in scope for this round." });
    }

    const committee = await query(
      `SELECT id FROM audit_committees WHERE level = $1 AND COALESCE(sector,'') = COALESCE($2,'')`,
      [cadence.level, roundSector]
    );
    const period = periodOf(new Date(scheduledFor), cadence.every);
    const year = new Date().getFullYear();
    const count = await query(
      `SELECT COUNT(*) AS n FROM general_audit_rounds WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const prefix = roundType === "sensitization" ? "SEN" : roundType === "district_general" ? "GAD" : "GAS";
    const reference = `${prefix}/${year}/${String(parseInt(count.rows[0].n, 10) + 1).padStart(4, "0")}`;

    const inserted = await query(
      `INSERT INTO general_audit_rounds
         (reference, round_type, sector, committee_id, period_label, scheduled_for, location, agenda, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        reference, roundType, roundSector, committee.rows[0]?.id ?? null, period.label,
        scheduledFor, String(location).trim(), String(agenda).trim(), actor.id,
      ]
    );
    const roundId = inserted.rows[0].id;

    // Every cooperative gets the sitting on its own calendar. A sensitization
    // session is training for the leaders; a general audit is a visit.
    const { date, time } = assemblyDateTime(scheduledFor);
    const isTraining = roundType === "sensitization";
    let managersNotified = 0;
    for (const coop of coops) {
      const activity = await query(
        `INSERT INTO activities
           (cooperative_id, title, type, status, date, start_time, location, description,
            objectives, budget, actual_cost, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,'planned',$4,$5,$6,$7,$8,0,0,$9,NOW(),NOW())
         RETURNING id`,
        [
          coop.id,
          `${cadence.label} — ${period.name}`,
          isTraining ? "training" : "meeting",
          date, time, String(location).trim(), String(agenda).trim(),
          JSON.stringify([cadence.description]),
          actor.id,
        ]
      );
      await query(
        `INSERT INTO general_audit_round_cooperatives (round_id, cooperative_id, activity_id)
         VALUES ($1,$2,$3)`,
        [roundId, coop.id, activity.rows[0].id]
      );
      managersNotified += await notifyCooperative(
        coop.id,
        `${cadence.label} — ${new Date(scheduledFor).toLocaleDateString("en-RW")}`,
        isTraining
          ? `All cooperative leaders are called to a sensitization session on ${date} at ${time.slice(0, 5)}, ` +
              `${location}. Agenda: ${agenda}`
          : `The ${roundSector ? `${roundSector} sector` : "district"} committee will visit ${coop.name} ` +
              `on ${date} at ${time.slice(0, 5)}. Agenda: ${agenda}`
      );
    }

    res.status(201).json({
      success: true,
      message: `${reference} scheduled for ${coops.length} cooperative(s); ${managersNotified} manager account(s) notified.`,
      data: { id: roundId, reference, cooperatives: coops.length },
    });
  } catch (err) {
    console.error("POST /rca-audits/rounds error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/** Loads a round and checks the actor may manage it. */
async function loadManagedRound(req: Request, res: Response) {
  const actor = await loadActor(req.user!.userId);
  if (!actor) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return null;
  }
  const found = await query(`SELECT * FROM general_audit_rounds WHERE id = $1`, [req.params.id]);
  if (found.rowCount === 0) {
    res.status(404).json({ success: false, message: "Round not found" });
    return null;
  }
  const round = found.rows[0];
  if (!managesLevel(actor, ROUND_CADENCE[round.round_type as RoundType].level, round.sector)) {
    res.status(403).json({ success: false, message: "Access denied" });
    return null;
  }
  if (round.status !== "scheduled") {
    res.status(409).json({ success: false, message: `This round is already ${round.status}.` });
    return null;
  }
  return { actor, round };
}

// PATCH /rounds/:id/record — what happened, cooperative by cooperative.
router.patch("/rounds/:id/record", async (req: Request, res: Response) => {
  try {
    const loaded = await loadManagedRound(req, res);
    if (!loaded) return;
    const { actor, round } = loaded;
    const { heldOn, minutes, leadersAttended, outcomes } = req.body;
    if (!heldOn || Number.isNaN(Date.parse(heldOn))) {
      return res.status(400).json({ success: false, message: "heldOn is required." });
    }
    if (!String(minutes ?? "").trim()) {
      return res.status(400).json({ success: false, message: "Record what was found or discussed." });
    }

    await query(
      `UPDATE general_audit_rounds
          SET status = 'held', held_on = $1, minutes = $2, leaders_attended = $3,
              recorded_by = $4, updated_at = NOW()
        WHERE id = $5`,
      [heldOn, String(minutes).trim(), leadersAttended != null ? Number(leadersAttended) : null, actor.id, round.id]
    );
    for (const o of Array.isArray(outcomes) ? outcomes : []) {
      const rating = OVERALL_RATINGS.includes(o.rating) ? o.rating : null;
      await query(
        `UPDATE general_audit_round_cooperatives
            SET attended = $1, rating = $2, observations = $3
          WHERE round_id = $4 AND cooperative_id = $5`,
        [o.attended === undefined ? null : o.attended === true, rating, o.observations || null, round.id, o.cooperativeId]
      );
    }
    await query(
      `UPDATE activities SET status = 'completed', outcome = $1, updated_at = NOW()
        WHERE id IN (SELECT activity_id FROM general_audit_round_cooperatives WHERE round_id = $2)`,
      [String(minutes).trim().slice(0, 2000), round.id]
    );
    res.json({ success: true, message: `${round.reference} recorded as held.` });
  } catch (err) {
    console.error("PATCH /rca-audits/rounds/:id/record error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PATCH /rounds/:id/cancel
router.patch("/rounds/:id/cancel", async (req: Request, res: Response) => {
  try {
    const loaded = await loadManagedRound(req, res);
    if (!loaded) return;
    const { round } = loaded;
    const reason = String(req.body.reason ?? "").trim();
    if (!reason) return res.status(400).json({ success: false, message: "Say why it is cancelled." });

    await query(
      `UPDATE general_audit_rounds SET status = 'cancelled', cancel_reason = $1, updated_at = NOW() WHERE id = $2`,
      [reason, round.id]
    );
    const coops = await query(
      `UPDATE activities SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW()
        WHERE id IN (SELECT activity_id FROM general_audit_round_cooperatives WHERE round_id = $2)
        RETURNING cooperative_id`,
      [reason, round.id]
    );
    for (const c of coops.rows) {
      await notifyCooperative(
        c.cooperative_id,
        `${ROUND_CADENCE[round.round_type as RoundType].label} cancelled`,
        `${round.reference} will not take place. ${reason}`
      );
    }
    res.json({ success: true, message: `${round.reference} cancelled.` });
  } catch (err) {
    console.error("PATCH /rca-audits/rounds/:id/cancel error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /committees — the sector committees and the district committee.
router.get("/committees", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !tierOf(actor)) return res.json({ success: true, data: [] });
    const result = await query(
      `SELECT cm.*,
              COALESCE((SELECT json_agg(json_build_object(
                 'id', m.id, 'name', m.name, 'position', m.position, 'organisation', m.organisation,
                 'phone', m.phone, 'email', m.email) ORDER BY m.added_at)
                 FROM audit_committee_members m WHERE m.committee_id = cm.id), '[]') AS members
         FROM audit_committees cm
        ORDER BY CASE cm.level WHEN 'district' THEN 0 ELSE 1 END, cm.sector`
    );
    res.json({
      success: true,
      data: result.rows.map((c) => ({ ...c, canManage: managesLevel(actor, c.level, c.sector) })),
    });
  } catch (err) {
    console.error("GET /rca-audits/committees error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /committees — set up (or rename) a sector or the district committee.
router.post("/committees", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const { level, sector, name, description } = req.body;
    if (!["sector", "district"].includes(level)) {
      return res.status(400).json({ success: false, message: "level must be sector or district." });
    }
    const committeeSector = level === "sector" ? (sector || actor.sector) : null;
    if (level === "sector" && !committeeSector) {
      return res.status(400).json({ success: false, message: "Choose the sector." });
    }
    if (!managesLevel(actor, level, committeeSector)) {
      return res.status(403).json({ success: false, message: "You cannot manage this committee." });
    }
    const committeeName =
      String(name ?? "").trim() ||
      (level === "district" ? `${DISTRICT_NAME} District Audit Committee` : `${committeeSector} Sector Audit Committee`);

    const existing = await query(
      `SELECT id FROM audit_committees WHERE level = $1 AND COALESCE(sector,'') = COALESCE($2,'')`,
      [level, committeeSector]
    );
    if (existing.rowCount) {
      await query(
        `UPDATE audit_committees SET name = $1, description = $2, updated_at = NOW() WHERE id = $3`,
        [committeeName, description || null, existing.rows[0].id]
      );
      return res.json({ success: true, message: "Committee updated.", data: { id: existing.rows[0].id } });
    }
    const inserted = await query(
      `INSERT INTO audit_committees (level, sector, name, description, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [level, committeeSector, committeeName, description || null, actor.id]
    );
    res.status(201).json({ success: true, message: `${committeeName} set up.`, data: { id: inserted.rows[0].id } });
  } catch (err) {
    console.error("POST /rca-audits/committees error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

async function loadManagedCommittee(req: Request, res: Response) {
  const actor = await loadActor(req.user!.userId);
  if (!actor) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return null;
  }
  const found = await query(`SELECT * FROM audit_committees WHERE id = $1`, [req.params.id]);
  if (found.rowCount === 0) {
    res.status(404).json({ success: false, message: "Committee not found" });
    return null;
  }
  if (!managesLevel(actor, found.rows[0].level, found.rows[0].sector)) {
    res.status(403).json({ success: false, message: "You cannot manage this committee." });
    return null;
  }
  return { actor, committee: found.rows[0] };
}

// POST /committees/:id/members
router.post("/committees/:id/members", async (req: Request, res: Response) => {
  try {
    const loaded = await loadManagedCommittee(req, res);
    if (!loaded) return;
    const { name, position, organisation, phone, email } = req.body;
    if (!String(name ?? "").trim()) {
      return res.status(400).json({ success: false, message: "The member's name is required." });
    }
    const inserted = await query(
      `INSERT INTO audit_committee_members (committee_id, name, position, organisation, phone, email, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [loaded.committee.id, String(name).trim(), position || null, organisation || null, phone || null, email || null, loaded.actor.id]
    );
    res.status(201).json({ success: true, message: `${name} added.`, data: { id: inserted.rows[0].id } });
  } catch (err) {
    console.error("POST /rca-audits/committees/:id/members error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /committees/:id/members/:memberId
router.delete("/committees/:id/members/:memberId", async (req: Request, res: Response) => {
  try {
    const loaded = await loadManagedCommittee(req, res);
    if (!loaded) return;
    await query(`DELETE FROM audit_committee_members WHERE id = $1 AND committee_id = $2`, [
      req.params.memberId, loaded.committee.id,
    ]);
    res.json({ success: true, message: "Removed from the committee." });
  } catch (err) {
    console.error("DELETE /rca-audits/committees/:id/members/:memberId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !tierOf(actor)) return res.status(403).json({ success: false, message: "Access denied" });
    const result = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Audit not found" });
    const row = result.rows[0];
    const tier = tierOf(actor);
    if (tier === "cooperative" && row.cooperative_id !== actor.cooperativeId && row.requested_by !== actor.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (tier === "sector" && actor.sector && row.sector !== actor.sector && row.requested_by !== actor.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    res.json({ success: true, data: decorate(row, actor) });
  } catch (err) {
    console.error("GET /rca-audits/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/actions ────────────────────────────────────────────────────────
// Every move an audit can make, each permitted only to the tier whose turn it
// is. `allowedActions` on the row is the same test, so the buttons a person is
// shown are exactly the ones this accepts.
router.post("/:id/actions", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const found = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [req.params.id]);
    if (found.rowCount === 0) return res.status(404).json({ success: false, message: "Audit not found" });
    const row = found.rows[0];

    const action = String(req.body.action ?? "");
    const note = req.body.note ? String(req.body.note).trim() : "";
    if (!allowedActions(actor, row).includes(action)) {
      return res.status(403).json({
        success: false,
        message: `You cannot "${action}" this audit now. It is ${STATUS_LABEL[row.status]?.toLowerCase() ?? row.status}` +
          (row.status && !TERMINAL_STATUSES.includes(row.status)
            ? ` and is waiting on ${decorate(row, actor).waitingOn}.`
            : "."),
      });
    }

    const route = auditRoute(row.origin, row.requester_level);
    const step = route.find((s) => s.key === row.current_step)!;
    const kindLabel = AUDIT_KIND_LABEL[row.audit_kind as AuditKind];
    const ref = row.reference;

    /** Moves the audit to `target` and tells whoever acts there. */
    const moveTo = async (targetKey: string, extraSql = "", extraParams: unknown[] = []) => {
      const target = route.find((s) => s.key === targetKey)!;
      await query(
        `UPDATE audit_requests
            SET current_step = $1, status = $2,
                step_due_at = NOW() + ($3)::int * INTERVAL '1 day', updated_at = NOW() ${extraSql}
          WHERE id = $4`,
        [target.key, target.status, AUDIT_STEP_RESPONSE_DAYS, row.id, ...extraParams]
      );
      return target;
    };
    const requireNote = (what: string) => {
      if (note.length < 5) {
        res.status(400).json({ success: false, message: `Give a reason when you ${what}.` });
        return false;
      }
      return true;
    };

    let message = "";

    switch (action) {
      // ── Climbing the chain ────────────────────────────────────────────────
      case "forward": {
        const next = nextStep(route, step.key)!;
        await moveTo(next.key);
        await logAction(row.id, step.key, "forward", actor.id, note);
        await notifyStepActor(next.actor, row, `Audit request ${ref} — your review`,
          `${row.cooperative_name}: ${kindLabel.toLowerCase()} requested by ${row.requested_by_name}, forwarded by ${actor.name}.`);
        await notifyUser(row.requested_by, `${ref} forwarded`, `Your audit request was forwarded to ${waitingOnLabel(next.actor, row)}.`);
        message = `Forwarded to ${waitingOnLabel(next.actor, row)}.`;
        break;
      }
      case "return": {
        if (!requireNote("return it")) return;
        await query(`UPDATE audit_requests SET status = 'returned', updated_at = NOW() WHERE id = $1`, [row.id]);
        await logAction(row.id, step.key, "return", actor.id, note);
        await notifyUser(row.requested_by, `${ref} returned to you`, `${actor.name} asks for more information: ${note}`);
        message = "Returned to the requester for more information.";
        break;
      }
      case "resubmit": {
        const reasons = req.body.reasons ? String(req.body.reasons).trim() : null;
        if (reasons !== null && reasons.length < MIN_REASON_LENGTH) {
          return res.status(400).json({ success: false, message: `Reasons need at least ${MIN_REASON_LENGTH} characters.` });
        }
        await query(
          `UPDATE audit_requests
              SET status = $1, reasons = COALESCE($2, reasons), preferred_date = COALESCE($3::date, preferred_date),
                  step_due_at = NOW() + ($4)::int * INTERVAL '1 day', updated_at = NOW()
            WHERE id = $5`,
          [step.status, reasons, req.body.preferredDate || null, AUDIT_STEP_RESPONSE_DAYS, row.id]
        );
        await logAction(row.id, step.key, "resubmit", actor.id, note);
        await notifyStepActor(step.actor, row, `${ref} resubmitted`, `${row.requested_by_name} has answered your questions on ${ref}.`);
        message = `Resubmitted to ${waitingOnLabel(step.actor, row)}.`;
        break;
      }
      case "reject": {
        if (!requireNote("reject it")) return;
        await query(`UPDATE audit_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [row.id]);
        await logAction(row.id, step.key, "reject", actor.id, note);
        await notifyUser(row.requested_by, `${ref} rejected`, `${actor.name} rejected the audit request: ${note}`);
        message = "Request rejected.";
        break;
      }

      // ── The RCA's decision ─────────────────────────────────────────────────
      case "waitlist": {
        if (!requireNote("put it on the waiting list")) return;
        await query(
          `UPDATE audit_requests SET status = 'waitlisted', waitlist_until = $1, updated_at = NOW() WHERE id = $2`,
          [req.body.revisitOn || null, row.id]
        );
        await logAction(row.id, step.key, "waitlist", actor.id, note, { revisitOn: req.body.revisitOn || null });
        await notifyUser(row.requested_by, `${ref} on the RCA waiting list`, note);
        message = "Put on the waiting list.";
        break;
      }
      case "approve": {
        const { scheduledStart, scheduledEnd, scopeIds, customScope, auditTeam, instructions } = req.body;
        const problem = scheduleProblem(scheduledStart, scheduledEnd);
        if (problem) return res.status(400).json({ success: false, message: problem });
        const scope = resolveScope(row.audit_kind, scopeIds, customScope);
        if (!scope.length) {
          return res.status(400).json({ success: false, message: "Choose at least one thing the audit will check." });
        }
        // A new date after the requester asked for one goes straight back to
        // them — the tiers in between have already passed the approval on.
        const target =
          row.status === "reschedule_requested" ? route.find((s) => s.key === "confirm")! : nextStep(route, step.key)!;
        await moveTo(
          target.key,
          `, scheduled_start = $5, scheduled_end = $6, scope = $7, audit_team = $8, rca_instructions = $9,
             approved_by = $10, approved_at = NOW(), reschedule_proposed_date = NULL`,
          [scheduledStart, scheduledEnd || null, JSON.stringify(scope), auditTeam || null, instructions || null, actor.id]
        );
        await logAction(row.id, step.key, "approve", actor.id, note, { scheduledStart, scheduledEnd, scope });
        const when = new Date(scheduledStart).toLocaleString("en-RW");
        await notifyStepActor(target.actor, row, `${ref} approved by the RCA`,
          `The RCA approved the ${kindLabel.toLowerCase()} of ${row.cooperative_name} for ${when}.` +
            (target.key === "confirm" ? " Please confirm it." : " Please pass it on."));
        if (target.key !== "confirm") {
          await notifyUser(row.requested_by, `${ref} approved`,
            `The RCA approved your request for ${when}. It is being passed back down to you for confirmation.`);
        }
        message = `Approved for ${when}; now with ${waitingOnLabel(target.actor, row)}.`;
        break;
      }

      // ── Coming back down ──────────────────────────────────────────────────
      case "relay": {
        const next = nextStep(route, step.key)!;
        await moveTo(next.key);
        await logAction(row.id, step.key, "relay", actor.id, note);
        await notifyStepActor(next.actor, row, `${ref} approved by the RCA`,
          `The ${kindLabel.toLowerCase()} of ${row.cooperative_name} is going ahead on ` +
            `${new Date(row.scheduled_start).toLocaleString("en-RW")}.` +
            (next.key === "confirm" ? " Please confirm it." : " Please pass it on."));
        message = `Passed on to ${waitingOnLabel(next.actor, row)}.`;
        break;
      }
      case "confirm": {
        const next = nextStep(route, "confirm")!;
        await moveTo(next.key, ", confirmed_at = NOW()");
        await logAction(row.id, "confirm", "confirm", actor.id, note);
        await notifyCooperative(row.cooperative_id, `${kindLabel} confirmed — ${ref}`,
          `The RCA will audit ${row.cooperative_name} on ${new Date(row.scheduled_start).toLocaleString("en-RW")}. ` +
            "Put it on your calendar and tell your members.");
        await notifyOversight({ levels: ["rca"], title: `${ref} confirmed`,
          message: `${row.requested_by_name} confirmed the audit of ${row.cooperative_name}.`, link: "/rca-audits" });
        message = "Confirmed. The cooperative can now tell its members.";
        break;
      }
      case "request_reschedule": {
        const proposed = req.body.proposedDate;
        if (!proposed || Number.isNaN(Date.parse(proposed))) {
          return res.status(400).json({ success: false, message: "Propose the date that would suit you." });
        }
        if (!requireNote("ask for another date")) return;
        await query(
          `UPDATE audit_requests
              SET current_step = 'rca_decision', status = 'reschedule_requested', reschedule_proposed_date = $1,
                  step_due_at = NOW() + ($2)::int * INTERVAL '1 day', updated_at = NOW()
            WHERE id = $3`,
          [proposed, AUDIT_STEP_RESPONSE_DAYS, row.id]
        );
        await logAction(row.id, "confirm", "request_reschedule", actor.id, note, { proposedDate: proposed });
        await notifyOversight({ levels: ["rca"], title: `${ref} — another date requested`,
          message: `${actor.name} asks for ${proposed} instead: ${note}`, link: "/rca-audits" });
        message = "Your proposed date was sent to the RCA officer.";
        break;
      }
      case "withdraw": {
        await query(`UPDATE audit_requests SET status = 'withdrawn', updated_at = NOW() WHERE id = $1`, [row.id]);
        await logAction(row.id, step.key, "withdraw", actor.id, note);
        if (step.actor !== "requester") {
          await notifyStepActor(step.actor, row, `${ref} withdrawn`, `${row.requested_by_name} withdrew the audit request.`);
        }
        message = "Request withdrawn.";
        break;
      }
      case "cancel": {
        if (!requireNote("cancel it")) return;
        await query(`UPDATE audit_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [row.id]);
        await logAction(row.id, step.key, "cancel", actor.id, note);
        if (row.activity_id) {
          await query(
            `UPDATE activities SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW() WHERE id = $2`,
            [note, row.activity_id]
          );
        }
        await notifyCooperative(row.cooperative_id, `${ref} cancelled`, `The RCA cancelled the ${kindLabel.toLowerCase()}: ${note}`);
        if (row.origin === "requested") await notifyUser(row.requested_by, `${ref} cancelled`, note);
        message = "Audit cancelled.";
        break;
      }

      // ── The cooperative's part ────────────────────────────────────────────
      case "acknowledge": {
        const next = nextStep(route, "acknowledge")!;
        await moveTo(next.key, ", confirmed_at = NOW()");
        await logAction(row.id, "acknowledge", "acknowledge", actor.id, note);
        await notifyOversight({ levels: ["rca"], title: `${ref} acknowledged`,
          message: `${row.cooperative_name} acknowledged the ${kindLabel.toLowerCase()}.`, link: "/rca-audits" });
        message = "Acknowledged. Now put it on the calendar and tell your members.";
        break;
      }
      case "convene": {
        const location = String(req.body.location ?? "").trim();
        if (!location) return res.status(400).json({ success: false, message: "Where will the auditors be received?" });
        // A time the manager typed is kept as typed; the stored start is read in
        // local time, not through toISOString(), which would shift it to UTC.
        const { date, time } = req.body.scheduledFor
          ? assemblyDateTime(String(req.body.scheduledFor))
          : localDateTime(new Date(row.scheduled_start));
        const scope: Array<{ label: string }> = Array.isArray(row.scope) ? row.scope : [];

        const activity = await query(
          `INSERT INTO activities
             (cooperative_id, title, type, status, date, start_time, location, description,
              objectives, budget, actual_cost, created_by, created_at, updated_at)
           VALUES ($1,$2,'meeting','planned',$3,$4,$5,$6,$7,0,0,$8,NOW(),NOW())
           RETURNING id`,
          [
            row.cooperative_id, `${kindLabel} by the RCA (${ref})`, date, time, location,
            `The RCA is auditing the cooperative. ${row.rca_instructions ?? ""}`.trim(),
            JSON.stringify(scope.map((s) => s.label)), actor.id,
          ]
        );
        const activityId = activity.rows[0].id;
        await registerAllMembers(activityId, row.cooperative_id);
        const extra = String(req.body.message ?? "").trim();
        const notice = await broadcastToCooperative({
          cooperativeId: row.cooperative_id,
          senderId: actor.id,
          senderName: actor.name,
          subject: `Notice: ${kindLabel.toLowerCase()} by the RCA on ${date}`,
          body:
            `The Rwanda Cooperative Agency will carry out a ${kindLabel.toLowerCase()} of ${row.cooperative_name} ` +
            `on ${date} at ${time.slice(0, 5)}, at ${location}.\n\n` +
            `The auditors will look at:\n${scope.map((s) => `• ${s.label}`).join("\n")}\n\n` +
            (row.audit_team ? `Audit team: ${row.audit_team}\n\n` : "") +
            (extra ? `${extra}\n\n` : "") +
            "Please be available — the auditors may want to speak with members.",
          link: `/activities/${activityId}`,
        });
        await query(
          `UPDATE audit_requests
              SET activity_id = $1, members_notified_at = NOW(), members_reached = $2, updated_at = NOW()
            WHERE id = $3`,
          [activityId, notice.accountsReached, row.id]
        );
        await logAction(row.id, "notify_members", "convene", actor.id, note, {
          activityId, location, accountsReached: notice.accountsReached, onRegister: notice.onRegister,
        });
        await notifyOversight({ levels: ["rca"], title: `${ref} — members notified`,
          message: `${row.cooperative_name} has told ${notice.accountsReached} member account(s) about the audit.`,
          link: "/rca-audits" });
        message =
          `On the calendar for ${date} and sent to ${notice.accountsReached} member account(s).` +
          (notice.note ? ` ${notice.note}` : "");
        break;
      }

      // ── Holding the audit ─────────────────────────────────────────────────
      case "start": {
        await moveTo("conduct", ", started_at = NOW()");
        await logAction(row.id, "conduct", "start", actor.id, note);
        if (row.activity_id) {
          await query(`UPDATE activities SET status = 'ongoing', updated_at = NOW() WHERE id = $1`, [row.activity_id]);
        }
        message = "Audit marked as under way.";
        break;
      }
      case "complete": {
        const { findings, overallRating, summary, recommendations, followUpBy } = req.body;
        if (!OVERALL_RATINGS.includes(overallRating)) {
          return res.status(400).json({ success: false, message: "Give an overall rating." });
        }
        if (String(summary ?? "").trim().length < 20) {
          return res.status(400).json({ success: false, message: "Summarise what the audit found." });
        }
        const scope: Array<{ id: string; label: string }> = Array.isArray(row.scope) ? row.scope : [];
        const given: any[] = Array.isArray(findings) ? findings : [];
        const recorded = scope.map((s) => {
          const f = given.find((g) => g.scopeId === s.id);
          return {
            scopeId: s.id,
            label: s.label,
            result: FINDING_RESULTS.includes(f?.result) ? f.result : "not_checked",
            note: f?.note ? String(f.note) : null,
          };
        });
        const recs = (Array.isArray(recommendations) ? recommendations : [])
          .map((r) => String(r).trim()).filter(Boolean);

        await query(
          `UPDATE audit_requests
              SET current_step = 'report', status = 'completed', completed_at = NOW(),
                  findings = $1, overall_rating = $2, summary = $3, recommendations = $4,
                  follow_up_by = $5, step_due_at = NULL, updated_at = NOW()
            WHERE id = $6`,
          [JSON.stringify(recorded), overallRating, String(summary).trim(), JSON.stringify(recs), followUpBy || null, row.id]
        );
        await logAction(row.id, "conduct", "complete", actor.id, note, { overallRating });
        await logAction(row.id, "report", "complete", actor.id, null);
        if (row.activity_id) {
          await query(
            `UPDATE activities SET status = 'completed', outcome = $1, updated_at = NOW() WHERE id = $2`,
            [String(summary).trim().slice(0, 2000), row.activity_id]
          );
        }

        const rating = String(overallRating).replace("_", " ");
        const text = `${kindLabel} of ${row.cooperative_name}: ${rating}. ${recs.length} recommendation(s)` +
          (followUpBy ? `, to be acted on by ${followUpBy}.` : ".");
        await notifyCooperative(row.cooperative_id, `${ref} — audit findings`, text);
        await notifyOversight({ levels: ["sector", "district"], sector: row.sector, title: `${ref} — audit findings`,
          message: text, link: "/rca-audits" });
        if (row.origin === "requested") await notifyUser(row.requested_by, `${ref} — audit findings`, text);
        message = "Findings recorded and sent to everyone in the chain.";
        break;
      }

      default:
        return res.status(400).json({ success: false, message: `Unknown action "${action}".` });
    }

    const updated = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [row.id]);
    res.json({ success: true, message, data: decorate(updated.rows[0], actor) });
  } catch (err) {
    console.error("POST /rca-audits/:id/actions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
