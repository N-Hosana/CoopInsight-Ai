import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../config/db";

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  cooperativeId?: string | null;
  name?: string;
  /**
   * Which tier of the sector → district → RCA chain this account decides at.
   * Null for everyone who is not an oversight officer. `role` alone cannot
   * answer this: all three tiers carry the role `government`.
   *
   * Tokens issued before this claim existed will not carry it, so anything that
   * must be authoritative reads `users.oversight_level` from the row instead —
   * the claim is here for the cheap checks and for the client.
   */
  oversightLevel?: "sector" | "district" | "rca" | null;
  sector?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Verifies the token, then refreshes the claims that go stale.
 *
 * A JWT is a cache, and `cooperativeId`, `role` and `oversightLevel` are all
 * things an administrator can change while somebody is signed in. Trusting the
 * token for them produced a whole class of bug where the app contradicted
 * itself: a member released from their cooperative kept a token saying they
 * were still in it, and a member added to one kept a token saying they were in
 * none — so the page reported "your account is not linked to a cooperative"
 * while the header, reading a differently-cached copy, showed the cooperative's
 * name.
 *
 * So the identity comes from the token (that is what it is for — it is signed)
 * and the mutable attributes come from the row. That is one extra query per
 * authenticated request, which at district scale is a fair price for not having
 * to reason about token staleness in nineteen route modules. If it ever matters,
 * cache it per request-id rather than going back to trusting the claim.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access token required" });
  }

  const token = authHeader.slice(7);
  let decoded: AuthUser;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const result = await query(
      `SELECT role, status, cooperative_id, oversight_level, sector, name
         FROM users WHERE id = $1`,
      [decoded.userId]
    );
    const row = result.rows[0];

    if (!row) {
      return res.status(401).json({ message: "This account no longer exists." });
    }
    if (row.status === "suspended") {
      return res.status(403).json({
        message: "This account is suspended. Contact an administrator.",
      });
    }

    req.user = {
      ...decoded,
      role: row.role,
      cooperativeId: row.cooperative_id,
      oversightLevel: row.oversight_level,
      sector: row.sector,
      name: row.name ?? decoded.name,
    };
    next();
  } catch (err) {
    // The token verified; the lookup failed. Falling back to the claims keeps
    // the app usable through a transient database blip rather than logging
    // everybody out, and the claims were what it trusted before anyway.
    console.error("authenticate: could not refresh claims, using token:", err);
    req.user = decoded;
    next();
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
};
