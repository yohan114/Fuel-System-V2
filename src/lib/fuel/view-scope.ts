import { prisma } from "../db";
import { isPumpOperator, isSiteUser } from "../roles";

// Who may read which fuel issues.
//
// Two different questions, and which one a login gets depends on what it does:
//
//   pump       — a pump operator (WORKSHOP or SITE_PUMP) sees their own pump's
//                book: everything dispensed from the tank they sign for. They
//                fuel visiting machines from other sites and must see those; a
//                vehicle posted to their site but fuelled at another yard is not
//                their record. Scoping them by the vehicle's site got both of
//                those backwards — it hid work they did and showed work they
//                did not.
//   allocation — a site login that works no pump (USER) sees the fuel their
//                site is CHARGED for, attributed by the vehicle's posting on the
//                day. That is the figure on the bill, which is what a site PM is
//                reconciling against.
//   all        — ADMIN and ALLOCATOR.
//   none       — everyone else, and any site or pump login whose scope cannot be
//                resolved. It fails closed: the earlier "narrow the query IF the
//                user has a site" shape let an operator with no site set read
//                the whole company's fuel book.
//
// A pump operator's site comes from their tank before their user record — the
// tank is the firmer fact, and it is the thing they actually answer for.

export type FuelViewScope =
  | { kind: "all" }
  | { kind: "pump"; projectId: string }
  | { kind: "allocation"; projectId: string }
  | { kind: "none" };

const UNRESTRICTED = new Set(["ADMIN", "ALLOCATOR"]);

/**
 * The decision itself, with the tank already looked up — pure, so the rule can
 * be tested without a database.
 */
export function resolveFuelViewScope(
  role: string | null | undefined,
  userProjectId: string | null | undefined,
  tankProjectId: string | null | undefined,
): FuelViewScope {
  if (!role) return { kind: "none" };
  if (UNRESTRICTED.has(role)) return { kind: "all" };

  // SITE_PUMP is both a pump operator and a site user; the pump rule wins.
  if (isPumpOperator(role)) {
    const projectId = tankProjectId ?? userProjectId ?? null;
    return projectId ? { kind: "pump", projectId } : { kind: "none" };
  }

  if (isSiteUser(role)) {
    return userProjectId ? { kind: "allocation", projectId: userProjectId } : { kind: "none" };
  }

  return { kind: "none" };
}

export async function fuelViewScope(
  session:
    | { role: string | null | undefined; projectId?: string | null; bulkTankId?: string | null }
    | null
    | undefined,
): Promise<FuelViewScope> {
  if (!session?.role) return { kind: "none" };
  if (UNRESTRICTED.has(session.role)) return { kind: "all" };

  let tankProjectId: string | null = null;
  if (isPumpOperator(session.role) && session.bulkTankId) {
    const own = await prisma.bulkTank.findUnique({
      where: { id: session.bulkTankId },
      select: { projectId: true },
    });
    tankProjectId = own?.projectId ?? null;
  }
  return resolveFuelViewScope(session.role, session.projectId, tankProjectId);
}
