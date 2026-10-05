import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import {
  SERVICE_REQUESTS,
  SERVICE_PASS_MARK,
  SERVICE_ATTENDANCE_FRACTION,
  SERVICE_MAJORITY_FRACTION,
  CERTIFICATE_FEE_RWF,
  NEW_SERVICE_TYPES,
  LIQUIDATOR_QUALIFICATIONS,
  RCA_NOTIFICATION_DAYS,
  assessServiceRequest,
  ServiceRequestType,
  ServiceAssessmentInput,
} from "../services/serviceRequests";
import {
  AUDITOR_DISQUALIFICATIONS,
  AUDIT_SCOPE,
  AUDITOR_CONDUCT,
  OTHER_AUDIT_ROUTES,
  LIQUIDATOR_DUTIES,
  DELEGATE_THRESHOLD_MEMBERS,
  auditorEligibility,
} from "../services/governance";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RCA SERVICE REQUESTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Change of objective, added activities, change of name, and replacement of a
 * lost certificate. They reuse the sector → district → RCA chain in
 * `cooperativeRequests.ts` — this module owns filing them and scoring them
 * against the RCA checklists in `services/serviceRequests.ts`.
 *
 * Formation and dissolution keep their own endpoints, because each carries
 * workflow the others do not: formation creates a cooperative and issues a
 * permit; dissolution runs two assemblies and a liquidation.
 *
 * WHO FILES WHAT — the brochure ties these to the cooperative's own leadership,
 * so the same president check that guards dissolution guards these.
 */

const PRESIDENT_TITLES = ["president", "chairperson", "chairman", "chairwoman"];
const OVERSIGHT_ROLES = ["admin", "generalManager", "government"];

async function loadActor(userId: string) {
  const res = await query(
    `SELECT id, name, role, sector, cooperative_id, oversight_level FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return row
    ? {
        id: row.id as string,
        name: row.name as string,
        role: row.role as string,
        sector: row.sector as string | null,
        cooperativeId: row.cooperative_id as string | null,
        oversightLevel: row.oversight_level as string | null,
      }
    : null;
}

/**
 * Only the president may commit the cooperative to a certificate change, the
 * same rule dissolution follows. Administrators may file on the register's
 * behalf; that is how a cooperative with no login gets a request in.
 */
async function assertPresident(
  cooperativeId: string,
  actor: { name: string; role: string },
  cooperativeName: string
): Promise<string | null> {
  if (["admin", "generalManager"].includes(actor.role)) {
    return `${actor.role} filing on behalf of the president`;
  }
  const office = await query(
    `SELECT role FROM cooperative_leadership
      WHERE cooperative_id = $1
        AND (end_date IS NULL OR end_date > CURRENT_DATE)
        AND LOWER(name) = LOWER($2)`,
    [cooperativeId, actor.name]
  );
  const held = office.rows.find((r) =>
    PRESIDENT_TITLES.some((t) => String(r.role).toLowerCase().includes(t))
  );
  if (!held) {
    throw new Error(
      `Only the president of ${cooperativeName} may file this request. Your account is not ` +
        "recorded as holding that office in the cooperative's leadership record."
    );
  }
  return held.role as string;
}

/** Members entitled to sit: delegates above the threshold, otherwise the register. */
async function eligibleAssemblySize(cooperativeId: string) {
  const res = await query(
    `SELECT
       (SELECT COUNT(*) FROM members
         WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active') AS members,
       (SELECT delegate_count FROM cooperatives WHERE id = $1) AS delegates`,
    [cooperativeId]
  );
  const members = parseInt(res.rows[0].members, 10);
  const delegates = res.rows[0].delegates as number | null;
  const usesDelegates = members > DELEGATE_THRESHOLD_MEMBERS;
  return {
    members,
    delegates,
    usesDelegates,
    eligible: usesDelegates ? delegates : members,
    basis: usesDelegates ? "delegates" : "members",
  };
}

async function nextReference(type: ServiceRequestType) {
  const prefixes: Record<string, string> = {
    change_objective: "OBJ",
    add_activity: "ACT",
    change_name: "NAM",
    duplicate_certificate: "DUP",
  };
  const prefix = prefixes[type] ?? "SRV";
  const year = new Date().getFullYear();
  const res = await query(
    `SELECT COUNT(*) AS n FROM cooperative_requests
      WHERE request_type = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [type, year]
  );
  const n = parseInt(res.rows[0].n, 10) + 1;
  return `${prefix}/${year}/${String(n).padStart(4, "0")}`;
}

/** Turns a stored request row into the shape the assessor wants. */
function toAssessmentInput(r: any, extra: Partial<ServiceAssessmentInput> = {}): ServiceAssessmentInput {
  return {
    membersEligible: r.assembly_members_eligible,
    membersPresent: r.assembly_members_present,
    votesFor: r.votes_for,
    votesAgainst: r.votes_against,
    votesAbstain: r.votes_abstain,
    reason: r.purpose ?? r.dissolution_reason,
    minutesNotarized: r.minutes_notarized === true,
    certificateReturned: r.certificate_returned === true,
    feePaidRwf: r.fee_paid_rwf != null ? Number(r.fee_paid_rwf) : null,
    rraClearance: r.rra_clearance === true,
    creditorsNotified: r.creditors_notified === true,
    cmisReference: r.cmis_reference,
    shareCapital: r.share_capital_value != null ? Number(r.share_capital_value) : null,
    shareValue: r.share_unit_value != null ? Number(r.share_unit_value) : null,
    proposedName: r.proposed_new_name,
    proposedObjective: r.proposed_new_objective,
    addedActivities: Array.isArray(r.added_activities) ? r.added_activities : [],
    sameValueChainJustification: r.value_chain_justification,
    lossCircumstances: r.loss_circumstances,
    liquidatorName: r.liquidator_name,
    liquidatorQualification: r.liquidator_qualification,
    monitoringCommittee: Array.isArray(r.monitoring_committee) ? r.monitoring_committee : [],
    rcaNotifiedAt: r.rca_notified_at,
    decisionAt: r.decision_taken_at,
    assetInventoryDone: r.asset_inventory_done === true,
    assetsDistributed: r.assets_distributed === true,
    attachedDocumentIds: (r.documents ?? []).map((d: any) => d.criterionId).filter(Boolean),
    ...extra,
  };
}

// ─── GET /catalogue ───────────────────────────────────────────────────────────
// Every service the RCA offers, what it requires, and who may ask for it.
router.get("/catalogue", async (req: Request, res: Response) => {
  const actor = await loadActor(req.user!.userId);
  const isOversight = OVERSIGHT_ROLES.includes(actor?.role ?? "");

  res.json({
    success: true,
    data: {
      services: Object.values(SERVICE_REQUESTS),
      newServices: NEW_SERVICE_TYPES,
      passMark: SERVICE_PASS_MARK,
      attendanceFraction: SERVICE_ATTENDANCE_FRACTION,
      majorityFraction: SERVICE_MAJORITY_FRACTION,
      certificateFeeRwf: CERTIFICATE_FEE_RWF,
      liquidator: {
        qualifications: LIQUIDATOR_QUALIFICATIONS,
        duties: LIQUIDATOR_DUTIES,
        notificationDays: RCA_NOTIFICATION_DAYS,
      },
      auditor: {
        disqualifications: AUDITOR_DISQUALIFICATIONS,
        scope: AUDIT_SCOPE,
        conduct: AUDITOR_CONDUCT,
        otherRoutes: OTHER_AUDIT_ROUTES,
      },
      // The brochure ties each service to the cooperative's leadership; the
      // review side is the officer chain that already exists.
      whoMayFile: {
        president:
          "Change of objective, added activities, change of name, duplicate certificate, " +
          "and dissolution are filed by the cooperative's president.",
        administrator: "An administrator may file any of them on the register's behalf.",
        officers:
          "Sector, district and RCA officers review; they do not file on their own account.",
      },
      viewerIsOversight: isOversight,
    },
  });
});

// ─── POST /:type ──────────────────────────────────────────────────────────────
// File one of the four certificate services.
router.post("/:type", async (req: Request, res: Response) => {
  try {
    const type = req.params.type as ServiceRequestType;
    if (!NEW_SERVICE_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message:
          `Unknown service "${type}". This endpoint files: ${NEW_SERVICE_TYPES.join(", ")}. ` +
          "Formation and dissolution have their own endpoints.",
      });
    }
    const spec = SERVICE_REQUESTS[type];

    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const cooperativeId =
      OVERSIGHT_ROLES.includes(actor.role) && req.body.cooperativeId
        ? String(req.body.cooperativeId)
        : actor.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        message: "Your account is not linked to a cooperative.",
      });
    }

    const coopRes = await query(
      `SELECT id, name, sector, cell, village, type FROM cooperatives
        WHERE id = $1 AND deleted_at IS NULL`,
      [cooperativeId]
    );
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const coop = coopRes.rows[0];

    let filedAsRole: string | null;
    try {
      filedAsRole = await assertPresident(cooperativeId, actor, coop.name);
    } catch (err: any) {
      return res.status(403).json({ success: false, message: err.message });
    }

    const open = await query(
      `SELECT reference FROM cooperative_requests
        WHERE cooperative_id = $1 AND request_type = $2 AND status LIKE 'pending%'`,
      [cooperativeId, type]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `${open.rows[0].reference} of the same kind is already in the review chain.`,
      });
    }

    const {
      reason, assemblyHeldOn, membersPresent, votesFor, votesAgainst, votesAbstain,
      minutesNotarized, certificateReturned, feePaidRwf, rraClearance, creditorsNotified,
      cmisReference, shareCapital, shareValue,
      proposedName, proposedObjective, addedActivities, valueChainJustification,
      lossCircumstances, contactName, contactPhone, contactEmail,
    } = req.body;

    // The assembly denominator is computed here, not accepted from the client —
    // it decides whether three-quarters was actually reached.
    const assembly = await eligibleAssemblySize(cooperativeId);
    if (spec.attendanceFraction != null && assembly.usesDelegates && !assembly.delegates) {
      return res.status(409).json({
        success: false,
        message:
          `${coop.name} has ${assembly.members} members, so its assembly is made up of delegates. ` +
          "Record the delegate count on the cooperative before filing, or attendance cannot be " +
          "measured against the right body.",
        needsDelegateCount: true,
      });
    }

    const nameTaken =
      type === "change_name" && proposedName
        ? ((
            await query(
              `SELECT 1 FROM cooperatives WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
              [proposedName]
            )
          ).rowCount ?? 0) > 0
        : false;

    const reference = await nextReference(type);
    const inserted = await query(
      `INSERT INTO cooperative_requests
         (request_type, reference, submitted_by, contact_name, contact_phone, contact_email,
          sector, cell, village, cooperative_id, purpose, filed_as_role,
          assembly_members_eligible, assembly_members_present, assembly_held_on,
          votes_for, votes_against, votes_abstain,
          minutes_notarized, certificate_returned, fee_paid_rwf, rra_clearance,
          creditors_notified, cmis_reference, share_capital_value, share_unit_value,
          proposed_new_name, proposed_new_objective, added_activities,
          value_chain_justification, loss_circumstances,
          current_stage, status, response_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,'sector','pending_sector',
               NOW() + INTERVAL '21 days')
       RETURNING id`,
      [
        type, reference, actor.id,
        contactName || actor.name, contactPhone || "", contactEmail || null,
        coop.sector, coop.cell, coop.village, cooperativeId,
        reason ? String(reason).trim() : null, filedAsRole,
        spec.attendanceFraction != null ? assembly.eligible : null,
        membersPresent != null ? Number(membersPresent) : null,
        assemblyHeldOn || null,
        votesFor != null ? Number(votesFor) : null,
        votesAgainst != null ? Number(votesAgainst) : null,
        votesAbstain != null ? Number(votesAbstain) : null,
        minutesNotarized === true, certificateReturned === true,
        feePaidRwf != null ? Number(feePaidRwf) : null,
        rraClearance === true, creditorsNotified === true,
        cmisReference || null,
        shareCapital != null ? Number(shareCapital) : null,
        shareValue != null ? Number(shareValue) : null,
        proposedName || null, proposedObjective || null,
        JSON.stringify(Array.isArray(addedActivities) ? addedActivities : []),
        valueChainJustification || null, lossCircumstances || null,
      ]
    );
    const id = inserted.rows[0].id as string;

    const assessment = assessServiceRequest(type, {
      ...toAssessmentInput({
        assembly_members_eligible: spec.attendanceFraction != null ? assembly.eligible : null,
        assembly_members_present: membersPresent != null ? Number(membersPresent) : null,
        votes_for: votesFor, votes_against: votesAgainst, votes_abstain: votesAbstain,
        purpose: reason, minutes_notarized: minutesNotarized === true,
        certificate_returned: certificateReturned === true,
        fee_paid_rwf: feePaidRwf, rra_clearance: rraClearance === true,
        creditors_notified: creditorsNotified === true, cmis_reference: cmisReference,
        share_capital_value: shareCapital, share_unit_value: shareValue,
        proposed_new_name: proposedName, proposed_new_objective: proposedObjective,
        added_activities: addedActivities, value_chain_justification: valueChainJustification,
        loss_circumstances: lossCircumstances, documents: [],
      }),
      nameTaken,
    });

    await query(`UPDATE cooperative_requests SET ai_assessment = $1 WHERE id = $2`, [
      JSON.stringify(assessment), id,
    ]);

    const officers = await query(
      `SELECT id FROM users
        WHERE status = 'active' AND oversight_level = 'sector' AND sector = $1`,
      [coop.sector]
    );
    for (const o of officers.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,$2,$3,'alert','/cooperative-requests')`,
        [
          o.id,
          `Cooperative service request — ${spec.label}`,
          `${coop.name} has filed ${reference}: ${spec.label.toLowerCase()}.`,
        ]
      );
    }

    res.status(201).json({
      success: true,
      message:
        `${reference} submitted to the ${coop.sector} sector cooperative officer. ` +
        (assessment.eligible
          ? "It meets the published requirements on the information given."
          : `${assessment.failedMandatory.length} mandatory requirement(s) are not yet met — ` +
            "attach the outstanding documents and re-run the check."),
      data: { id, reference, type },
      assessment,
      assemblyBasis: assembly,
    });
  } catch (err) {
    console.error("POST /service-requests/:type error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/assess ─────────────────────────────────────────────────────────
// Re-run the checklist after documents have been attached.
router.post("/:id/assess", async (req: Request, res: Response) => {
  try {
    const found = await query(
      `SELECT r.*,
              COALESCE((SELECT json_agg(json_build_object('criterionId', d.criterion_id))
                          FROM cooperative_request_documents d WHERE d.request_id = r.id), '[]') AS documents
         FROM cooperative_requests r WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const r = found.rows[0];
    const type = r.request_type as ServiceRequestType;
    if (!NEW_SERVICE_TYPES.includes(type) && type !== "dissolution") {
      return res.status(400).json({
        success: false,
        message: "This checklist applies to RCA service requests and dissolutions.",
      });
    }

    const nameTaken =
      type === "change_name" && r.proposed_new_name
        ? ((
            await query(
              `SELECT 1 FROM cooperatives
                WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL AND id <> $2`,
              [r.proposed_new_name, r.cooperative_id]
            )
          ).rowCount ?? 0) > 0
        : false;

    const assessment = assessServiceRequest(type, toAssessmentInput(r, { nameTaken }));
    await query(
      `UPDATE cooperative_requests SET ai_assessment = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(assessment), r.id]
    );

    res.json({ success: true, data: assessment });
  } catch (err) {
    console.error("POST /service-requests/:id/assess error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/dissolution-stage ─────────────────────────────────────────────
// Record the second-stage assembly: the liquidator's report and the close-out.
router.patch("/:id/dissolution-stage", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const found = await query(
      `SELECT r.*, c.name AS cooperative_name FROM cooperative_requests r
         LEFT JOIN cooperatives c ON c.id = r.cooperative_id WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const r = found.rows[0];
    if (r.request_type !== "dissolution") {
      return res.status(400).json({ success: false, message: "Not a dissolution request." });
    }
    if (
      !OVERSIGHT_ROLES.includes(actor.role) &&
      actor.cooperativeId !== r.cooperative_id
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const {
      loansRecovered, creditorsPaid, assetsDistributed, secondAssemblyHeldOn,
      liquidatorReport, certificateReturned, creditorsNotified,
    } = req.body;

    if (r.dissolution_stage !== "distribution") {
      return res.status(409).json({
        success: false,
        message:
          "The first-stage assembly must be recorded and the liquidator appointed before the " +
          "distribution stage can be filed.",
      });
    }
    if (assetsDistributed === true && !secondAssemblyHeldOn) {
      return res.status(400).json({
        success: false,
        message: "The date of the second General Assembly is required to close the dissolution.",
      });
    }

    await query(
      `UPDATE cooperative_requests
          SET loans_recovered = COALESCE($1, loans_recovered),
              creditors_paid = COALESCE($2, creditors_paid),
              assets_distributed = COALESCE($3, assets_distributed),
              second_assembly_held_on = COALESCE($4::date, second_assembly_held_on),
              liquidator_report = COALESCE($5::jsonb, liquidator_report),
              certificate_returned = COALESCE($6, certificate_returned),
              creditors_notified = COALESCE($7, creditors_notified),
              dissolution_stage = CASE WHEN $3 = TRUE AND $6 = TRUE THEN 'complete'
                                       ELSE dissolution_stage END,
              updated_at = NOW()
        WHERE id = $8`,
      [
        loansRecovered != null ? Number(loansRecovered) : null,
        creditorsPaid != null ? Number(creditorsPaid) : null,
        assetsDistributed === undefined ? null : assetsDistributed === true,
        secondAssemblyHeldOn || null,
        liquidatorReport ? JSON.stringify(liquidatorReport) : null,
        certificateReturned === undefined ? null : certificateReturned === true,
        creditorsNotified === undefined ? null : creditorsNotified === true,
        r.id,
      ]
    );

    const updated = await query(
      `SELECT r.*,
              COALESCE((SELECT json_agg(json_build_object('criterionId', d.criterion_id))
                          FROM cooperative_request_documents d WHERE d.request_id = r.id), '[]') AS documents
         FROM cooperative_requests r WHERE r.id = $1`,
      [r.id]
    );
    const assessment = assessServiceRequest("dissolution", toAssessmentInput(updated.rows[0]));
    await query(`UPDATE cooperative_requests SET ai_assessment = $1 WHERE id = $2`, [
      JSON.stringify(assessment), r.id,
    ]);

    res.json({
      success: true,
      message:
        updated.rows[0].dissolution_stage === "complete"
          ? "Distribution recorded and the certificate returned. The RCA can now strike the " +
            "cooperative off."
          : "Distribution stage updated.",
      data: updated.rows[0],
      assessment,
    });
  } catch (err) {
    console.error("PATCH /service-requests/:id/dissolution-stage error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── Independent auditors ─────────────────────────────────────────────────────

// GET /auditors — the RCA-approved list, and the rules that govern engagement.
router.get("/auditors/list", async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM independent_auditors WHERE active = TRUE ORDER BY name`
    );
    res.json({
      success: true,
      data: result.rows,
      rules: {
        disqualifications: AUDITOR_DISQUALIFICATIONS,
        scope: AUDIT_SCOPE,
        conduct: AUDITOR_CONDUCT,
        otherRoutes: OTHER_AUDIT_ROUTES,
      },
    });
  } catch (err) {
    console.error("GET /service-requests/auditors/list error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /auditors/engage — propose an auditor for a cooperative's financial year.
//
// The six disqualifications are checked here rather than after the report: a
// conflicted auditor invalidates the audit, and the cheapest place to catch
// that is before the engagement.
router.post("/auditors/engage", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const { auditorId, financialYear, approvedByAssembly, assemblyHeldOn, agreedFee, declaredConflicts } =
      req.body;
    const cooperativeId =
      OVERSIGHT_ROLES.includes(actor.role) && req.body.cooperativeId
        ? String(req.body.cooperativeId)
        : actor.cooperativeId;

    if (!cooperativeId || !auditorId || !financialYear) {
      return res.status(400).json({
        success: false,
        message: "cooperativeId, auditorId and financialYear are required.",
      });
    }

    const auditor = await query(`SELECT * FROM independent_auditors WHERE id = $1`, [auditorId]);
    if (auditor.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Auditor not found" });
    }

    const conflicts: string[] = Array.isArray(declaredConflicts) ? declaredConflicts : [];
    const eligibility = auditorEligibility({
      onRcaApprovedList: auditor.rows[0].on_rca_approved_list === true,
      approvedByAssembly: approvedByAssembly === true,
      disqualifications: conflicts,
    });

    if (!eligibility.eligible) {
      return res.status(409).json({
        success: false,
        message: `${auditor.rows[0].name} cannot audit this cooperative.`,
        blockers: eligibility.blockers,
      });
    }

    const inserted = await query(
      `INSERT INTO auditor_engagements
         (auditor_id, cooperative_id, financial_year, approved_by_assembly, assembly_held_on,
          agreed_fee, declared_conflicts, status, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'engaged',$8)
       ON CONFLICT (cooperative_id, financial_year, auditor_id) DO UPDATE SET
         approved_by_assembly = EXCLUDED.approved_by_assembly,
         assembly_held_on = EXCLUDED.assembly_held_on,
         agreed_fee = EXCLUDED.agreed_fee,
         declared_conflicts = EXCLUDED.declared_conflicts,
         updated_at = NOW()
       RETURNING id`,
      [
        auditorId, cooperativeId, financialYear, approvedByAssembly === true,
        assemblyHeldOn || null,
        agreedFee != null ? Number(agreedFee) : null,
        JSON.stringify(conflicts), actor.id,
      ]
    );

    res.status(201).json({
      success: true,
      message:
        `${auditor.rows[0].name} engaged for ${financialYear}. The General Assembly approves ` +
        "the auditor and their fee.",
      data: { id: inserted.rows[0].id },
    });
  } catch (err) {
    console.error("POST /service-requests/auditors/engage error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
