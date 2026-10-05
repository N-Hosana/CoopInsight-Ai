import { Request } from "express";

/**
 * Who may WRITE a cooperative's records.
 *
 * The manager (and the cooperative's own account) keep the books, so they may
 * write their own cooperative and nothing else. Administrators and the general
 * manager may write any cooperative they name — that is how records reach a
 * cooperative with nobody on the system. Members and oversight officers read;
 * they do not keep another body's books.
 *
 * Several routes used to take `cooperativeId` straight from the request body,
 * so a manager could record a transaction or an attendance against somebody
 * else's cooperative. Every data-entry route goes through this instead.
 */
export type WriteAccess =
  | { ok: true; cooperativeId: string }
  | { ok: false; status: number; message: string };

const KEEPERS = ["manager", "cooperative"];
const ADMINISTRATORS = ["admin", "generalManager"];

export function writableCooperative(req: Request, requestedId?: string | null): WriteAccess {
  const { role, cooperativeId } = req.user!;

  if (KEEPERS.includes(role)) {
    if (!cooperativeId) {
      return { ok: false, status: 400, message: "Your account is not attached to a cooperative." };
    }
    if (requestedId && requestedId !== cooperativeId) {
      return { ok: false, status: 403, message: "You can only record data for your own cooperative." };
    }
    return { ok: true, cooperativeId };
  }

  if (ADMINISTRATORS.includes(role)) {
    if (!requestedId) {
      return { ok: false, status: 400, message: "cooperativeId is required." };
    }
    return { ok: true, cooperativeId: requestedId };
  }

  return {
    ok: false,
    status: 403,
    message: "Only the cooperative's manager or an administrator can record this data.",
  };
}
