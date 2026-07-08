// Role helpers shared across the app.
//
// "Site users" are scoped to their own allocated site (session.projectId): they
// see and enter data only for vehicles allocated to that site, and every report
// / billing view is filtered to it. Two roles behave this way and must always be
// treated identically for scope:
//   USER       — site data-entry / PM login
//   SITE_PUMP  — site pump operator (e.g. Ishadi at CEP-03 E Package)
//
// WORKSHOP is deliberately NOT site-scoped: a workshop pump operator may issue
// fuel for any site / any vehicle. The fuel cost still lands on the vehicle's
// allocated site because attribution is by assignment, not by the issuing pump
// (see src/lib/fuel/site-attribution.ts). ADMIN and ALLOCATOR are unrestricted.

export type Role = "ADMIN" | "ALLOCATOR" | "USER" | "SITE_PUMP" | "WORKSHOP";

const SITE_ROLES = new Set(["USER", "SITE_PUMP"]);

/** True when the role is scoped to its own allocated site. */
export function isSiteUser(role: string | null | undefined): boolean {
  return !!role && SITE_ROLES.has(role);
}

/** A site user who also carries a concrete site scope. */
export function isScopedSiteUser(
  u: { role: string | null | undefined; projectId: string | null | undefined } | null | undefined,
): boolean {
  return !!u && isSiteUser(u.role) && !!u.projectId;
}
