/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CALLING A GENERAL ASSEMBLY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * However an assembly comes to be called — a member asking to leave, the
 * members resolving to dissolve, the liquidator reporting back — it is the same
 * event for the members: a meeting they are entitled to attend and vote at.
 * So calling one always does the same three things:
 *
 *   1. it goes into the cooperative's activities as a planned meeting,
 *   2. every active member is registered for it, so it is on their own list
 *      and attendance can be taken against the whole register, and
 *   3. every account gets the notice — a message in Messages that can be read
 *      back later, and a notification that opens the activity itself.
 */

import { query } from "../config/db";
import { broadcastToCooperative, BroadcastResult } from "./broadcast";
import { NOTICE_DAYS } from "./governance";

export type AssemblyKind = keyof typeof NOTICE_DAYS;

/**
 * The date and wall-clock time the assembly sits, as the manager typed them.
 *
 * A browser's datetime-local value has no time zone. Converting it through a
 * Date and back with toISOString() turned 10:00 in Kigali into 08:00 UTC on the
 * activity, so the meeting showed two hours early. The typed values are kept.
 */
export function assemblyDateTime(scheduledFor: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(scheduledFor);
  if (m) return { date: m[1], time: `${m[2]}:00` };
  const d = new Date(scheduledFor);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
  };
}

/** Why the notice is too short, or null when it is long enough. */
export function noticeProblem(scheduledFor: string, kind: AssemblyKind): string | null {
  if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
    return "scheduledFor must be the date and time the assembly will sit.";
  }
  const days = Math.ceil((new Date(scheduledFor).getTime() - Date.now()) / 86_400_000);
  const required = NOTICE_DAYS[kind];
  return days < required
    ? `An ${kind} assembly needs at least ${required} days' notice under the RCA rules. ` +
        `The date chosen is ${days} day(s) away.`
    : null;
}

/** Puts every active member of the cooperative on the activity's register. */
export async function registerAllMembers(activityId: string, cooperativeId: string): Promise<number> {
  const result = await query(
    `INSERT INTO activity_participants (activity_id, member_id, attended)
     SELECT $1, m.id, false FROM members m
      WHERE m.cooperative_id = $2 AND m.deleted_at IS NULL AND m.status = 'active'
     ON CONFLICT (activity_id, member_id) DO NOTHING`,
    [activityId, cooperativeId]
  );
  return result.rowCount ?? 0;
}

export interface ConvenedAssembly {
  activityId: string;
  date: string;
  time: string;
  membersRegistered: number;
  notice: BroadcastResult;
}

export async function conveneAssembly(options: {
  cooperativeId: string;
  cooperativeName: string;
  kind: AssemblyKind;
  title: string;
  purpose: string;
  objectives: string[];
  agenda: string;
  scheduledFor: string;
  location: string;
  convenedBy: { id: string; name?: string };
}): Promise<ConvenedAssembly> {
  const { date, time } = assemblyDateTime(options.scheduledFor);

  const activity = await query(
    `INSERT INTO activities
       (cooperative_id, title, type, status, date, start_time, location, description,
        objectives, budget, actual_cost, created_by, created_at, updated_at)
     VALUES ($1,$2,'meeting','planned',$3,$4,$5,$6,$7,0,0,$8,NOW(),NOW())
     RETURNING id`,
    [
      options.cooperativeId,
      options.title,
      date,
      time,
      options.location,
      options.purpose,
      JSON.stringify(options.objectives),
      options.convenedBy.id,
    ]
  );
  const activityId = activity.rows[0].id as string;
  const membersRegistered = await registerAllMembers(activityId, options.cooperativeId);

  const when = new Date(`${date}T${time}`);
  const notice = await broadcastToCooperative({
    cooperativeId: options.cooperativeId,
    senderId: options.convenedBy.id,
    senderName: options.convenedBy.name,
    subject: `Notice of general assembly — ${when.toLocaleDateString()}`,
    body:
      `An ${options.kind} general assembly of ${options.cooperativeName} is called for ` +
      `${when.toLocaleDateString()} at ${time.slice(0, 5)}, at ${options.location}.\n\n` +
      `Purpose: ${options.purpose}\n\n` +
      `Agenda:\n${options.agenda}\n\n` +
      "You are registered for it. Please attend: decisions taken at a general assembly bind every member.",
    // The notification opens the meeting itself.
    link: `/activities/${activityId}`,
  });

  return { activityId, date, time, membersRegistered, notice };
}
