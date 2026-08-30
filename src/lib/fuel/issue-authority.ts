// Which pump may a given person record fuel out of?
//
// Two consoles write fuel issues and they answer this question differently, on
// purpose:
//
//   * An operator's console takes the tank from the SESSION. A pump operator
//     signs for one pump and may only ever move that pump's stock, so the
//     browser is never asked which tank it is — the answer is not the browser's
//     to give.
//
//   * The admin's pump panel takes the tank from the FORM. The office keys
//     paper sheets for sites nobody there visits, and that only works if the
//     pump can be named.
//
// The rule lived nowhere until now: it was implied by an `isPumpOperator(role)
// && user.bulkTankId` test in one action and by an `assertCan("approve")` in
// another, and neither said what the other did. Stating it once means the two
// consoles cannot drift into disagreeing about who may move whose stock.

export interface IssueAuthorityInput {
  role: string | null | undefined;
  /** The tank on the caller's own login, if any. */
  ownTankId: string | null | undefined;
  /** The tank named by the request, if any. Null means a station purchase. */
  targetTankId: string | null | undefined;
}

export type IssueAuthority =
  | { allowed: true; tankId: string | null; reason: "admin-any-pump" | "own-pump" | "no-pump" }
  | { allowed: false; error: string };

/**
 * Decide the pump, or refuse.
 *
 * Returns the tank id to use rather than a bare boolean, because "may they?"
 * and "which one?" are the same question and answering them separately is how
 * a caller ends up authorised against one tank and writing to another.
 */
export function resolveIssueAuthority(input: IssueAuthorityInput): IssueAuthority {
  const role = input.role ?? "";
  const target = input.targetTankId?.trim() || null;
  const own = input.ownTankId?.trim() || null;

  if (role === "ADMIN") {
    // An admin may name any pump — including one they happen to hold on their
    // own login, which is why the target wins over `own` rather than being
    // checked against it.
    return { allowed: true, tankId: target, reason: target ? "admin-any-pump" : "no-pump" };
  }

  const isOperator = role === "WORKSHOP" || role === "SITE_PUMP";
  if (!isOperator) {
    return { allowed: false, error: "Only accounts with a linked pump (workshop or site) can issue fuel from bulk." };
  }
  if (!own) {
    return { allowed: false, error: "Only accounts with a linked pump (workshop or site) can issue fuel from bulk." };
  }
  // An operator naming someone else's pump is refused outright rather than
  // quietly redirected to their own — a request that says Badalgama must not
  // succeed against Awissawella.
  if (target && target !== own) {
    return { allowed: false, error: "You can only issue fuel from your own pump." };
  }
  return { allowed: true, tankId: own, reason: "own-pump" };
}
