import { requireUser } from "./auth";

const MATRIX = {
  ADMIN: new Set(["create", "update", "delete", "approve", "manage", "allocate"]),
  ALLOCATOR: new Set(["allocate"]),
  USER: new Set(["create"]),
  WORKSHOP: new Set(["create"]),
  // Store keeper: runs the oil/lubricant stock book — records receipts & issues,
  // manages products, and approves/sends material requisitions. Not allowed to
  // hard-delete (admin only) or allocate fuel.
  STOREKEEPER: new Set(["create", "update", "approve", "manage"]),
};

export type RBACAction = "create" | "update" | "delete" | "approve" | "manage" | "allocate";

export async function assertCan(action: RBACAction) {
  const user = await requireUser();
  const roleActions = MATRIX[user.role as keyof typeof MATRIX];
  if (!roleActions || !roleActions.has(action)) {
    throw new Error("FORBIDDEN");
  }
  return user;
}
